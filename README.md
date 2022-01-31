# Revocable Queue

[![Build Status](https://travis-ci.org/getify/revocable-queue.svg?branch=master)](https://travis-ci.org/getify/revocable-queue)
[![npm Module](https://badge.fury.io/js/%40getify%2Frevocable-queue.svg)](https://www.npmjs.org/package/@getify/revocable-queue)
[![Coverage Status](https://coveralls.io/repos/github/getify/revocable-queue/badge.svg?branch=master)](https://coveralls.io/github/getify/revocable-queue?branch=master)
[![Modules](https://img.shields.io/badge/modules-UMD%2BCJS-a1356a)](https://nodejs.org/api/packages.html#dual-commonjses-module-packages)
[![License](https://img.shields.io/badge/license-MIT-a1356a)](LICENSE.txt)

**Revocable Queue** allows you to read/write a sequence of data values (aka, a queue) asynchronously, similar to streams or observables. But any data/event that is still pending in the queue -- hasn't yet been read -- can be revoked.

Several helpers are also included to make working with revocable queues easier, using the ES2018 asynchronous iteration protocol, including: [`lazyZip(..)`](#lazyzip), [`lazyMerge(..)`](#lazymerge), [`queueIterable(..)`](#iterating-a-single-queue), and [`eventIterable(..)`](#eventiterable). In addition, [`eventState(..)`](#eventstate) helps with managing the asynchronous toggling of event states.

## API

To create a queue, call `create()`:

```js
var q = RevocableQueue.create();
```

To add values to the queue, call `add(..)`:

```js
q.add( Math.random() );
```

### Revoking

The `add(..)` function call returns a function:

```js
var revoke = q.add( Math.random() );
```

This returned function attempts to revoke the specific value you previously added to the queue; it will either revoke the value from the queue and return it, if it hasn't been read yet, or return the `RevocableQueue.EMPTY` value if the value has already been read:

```js
// oops, let's try to revoke that value from the queue
var val = revoke();
if (val !== RevocableQueue.EMPTY) {
    console.log(`Random number we revoked: ${val}`);
}
else {
    console.log("Oops, too late to revoke");
}
```

This `revoke(..)` function takes one optional boolean argument, which defaults to `true`; the argument indicates if the value should be fully removed from the queue (if it hasn't been read yet). To essentially "peek" at the value without actually revoking it from the queue, pass `false` for the argument:

```js
var peek = revoke(/*take=*/false);

console.log(`This random number (${peek}) is still in the queue.`);
```

**Note:** This `revoke(..)` function is the same function returned when actually reading a value from the queue (with `next()`). The "peek" usage just described is generally more useful in that scenario; more on [that below](#peeking).

The `add(..)` utility adds a value to the end of the queue. If you need to override the order of the queue and ensure an inserted value will be consumed next from the queue, use `insertFirst(..)`. This utility works identically to `add(..)` except for where in the queue it ends up:

```js
var revoke = q.insertFirst( Math.random() );
```

### Reading / Taking

To read/take from a queue, call `next()`, which returns a promise that resolves as soon as there's a value in the queue to be read. The resolved value is a function (identical to the `revoke(..)` function described above) that is used to actually take a value from the queue (or just [peek at it](#peeking)):

```js
// using `async..await` syntax:
var get = await q.next();

var val = get();
if (val !== RevocableQueue.EMPTY) {
    console.log(`Random number taken from the queue: ${val}`);
}
else {
    console.log("Oops, value already revoked");
}
```

```js
// using promise chain syntax:
var pr = q.next();

pr.then(function t(get){
    var val = get();
    if (val !== RevocableQueue.EMPTY) {
        console.log(`Random number taken from the queue: ${val}`);
    }
    else {
        console.log("Oops, value already revoked");
    }
});
```

**Note:** The read function (named `get()` here) is only resolved if there's a value ready at the moment. However, it' *possible* (but rare!) that between that moment and when `get()` is called, the value has already been revoked. For this reason, it's recommended to call `get()` as soon as it's received, to significantly reduce the chances of such a race condition. For robustness, always perform the `if` check as illustrated above. If the `get()` call returns `RevocableQueue.EMPTY`, the value was already revoked, and that `get()` function should now be discarded. Call `next()` on the queue again to get a promise for the next `get()` read function.

### Peeking

Why does the promise returned from `next()` not just resolve to the taken value? The reason: you may want to "peek" at value before committing to taking it.

The usefulness of "peeking" is mostly if you want to synchronize taking values from two or more queues, and only want to take a value from each queue if all desired queue-values are (still) ready to take at that exact moment:

```js
var [ get1, get2 ] = await Promise.all([ q1.next(), q2.next() ]);
// both queue values ready?
if (
    get1(/*take=*/false) !== RevocableQueue.EMPTY &&
    get2(/*take=*/false) !== RevocableQueue.EMPTY
) {
    let val1 = get1(/*take=*/true);
    let val2 = get2(/* defaults to true */);

    console.log(`The values retrieved: ${val1} ${val2}`);
}
```

In this above snippet, the not-so-obvious race condition is that `get1` may have been resolved signficantly before (or after) `get2`, so by that time, either underlying value may have been revoked. The `if` statement peeks through each queue's ready-to-read accessor function to ensure the value is indeed *still* ready.

**Note:** There is no race condition between the `get1(false)` and the `get1(true)` call (or the two `get2(..)` calls), because JavaScript is single-threaded. So as long as this code pattern is followed, where the peeking and the reading happen synchronously (no promise/`await` deferral in between!), it's perfectly safe to assume that the peeked value is still ready to read in the next statement. Even if some other code was trying to revoke that value at that exact moment, it would be waiting for this code to finish, and since it's fully read/taken by then, the revoking would fail.

Synchronizing of lazy async reads from multiple queues is an expected common use-case for **Revocable Queue**; the [`lazyZip(..)`](#lazyzip) helper utility is thus provided.

### Closing a Queue

A queue can be closed at any point, which implicitly revokes and discards any unconsumed values in the queue at that point. After a queue is closed, any retained references to accessors from the queue will thereafter immediately return the `RevocableQueue.EMPTY` value.

A queue has an `isClosed()` method to check if it has been closed or not. Once a queue has been closed, avoid calling `add(..)` / `insertFirst(..)` (throws an exception) or `next()` (returns a rejected promise with an exception).

```js
async function main() {
    var q = RevocableQueue.create();

    q.add( 1 );
    q.add( 2 );
    q.add( 3 );
    q.add( 4 );
    var accessor = await q.next();
    accessor(/*take=*/true);     // 1

    accessor = await q.next();
    accessor(/*take=*/false);    // 2

    q.close();
    q.isClosed();                // true
    accessor(/*take=*/true);     // RevocableQueue.EMPTY
    try {
        q.add( 5 );
    }
    catch (err) {
        err.toString();          // Error: Queue is closed
    }
    try {
        v = await q.next();
    }
    catch (err) {
        err.toString();          // Error: Queue is closed
    }
}
```

### Example

To illustrate usage with (as expected) asynchronously produced and read values:

```js
var q = RevocableQueue.create();
var revokes = [];

// add a new value to the queue every 100ms
setInterval(function write(){
    var revoke = q.add( Math.random() );
    revokes.push(revoke);
},100);


// elsewhere:


// read a value from the queue every 500ms
(async function readValues(){
    while (true) {
        let get = await q.next();
        if (get(/*take=*/false) !== RevocableQueue.EMPTY) {
            let val = get();
            console.log(`Read value: ${val}`);
        }

        // `delay(..)` is a promisified `setTimeout(..)`
        await delay(500);
    }
})();


// elsewhere:


clearButton.addEventListener("click",function clearQueue(){
    for (let revoke of revokes) {
        let result = revoke();
        // NOTE: `result` would be `RevocableQueue.EMPTY` if
        // the revocation failed, which here doesn't matter
    }
    revokes.length = 0;
});
```

The `readValues(..)` asynchronous looping is only reading one value per 500ms, but the `setInterval(..)` loop is adding a new value every 100ms. As such, the queue is going to grow by \~8 values per second. The button click handler clears out the queue by calling all the collected `revoke()` functions.

`readValues(..)` shows how to manually consume a queue, which in some cases may be necessary. But it's generally recommended to use the ES2018 asynchronous iteration pattern, which is [illustrated later](#iterating-a-single-queue).

### Iterating Queues

Asynchronous iteration (ES2018) is a language-standard pattern for consuming an async stream of values. **Revocable Queue** provides helpers for consuming queues as async iterators, commonly with a `for await..` loop.

#### `lazyZip(..)`

In the [Peeking](#peeking) section above, the use case was presented to synchronize lazy asynchronous reads from multiple queues. For example, imagine a queue that collects customers who attempt to connect to a support chat, and another queue that collects support agents who become available for a chat.

You would want to read a value from each queue, whenever one was ready, but ensure that you have an *atomic pairing*, meaning that you only take a value from each queue when both queues have a value available. If a customer starts waiting, and later an agent becomes available, you pair them. But if the customer disconnects while waiting for an agent, they need to be removed (revoked) from the queue. The reverse scenario also applies: an agent could disconnect while waiting for a customer to connect.

In FP (functional programming) terms, as well as in reactive/streams based programming like with observables, this *atomic pairing* is most closely modeled as a `zip(..)` operation. But traditional FP `zip(..)` utilities don't account for reading from queues which are asynchronous, and observables' `zip(..)` doesn't really account for revocation. Neither is *exactly* the model we need.

Since **Revocable Queue** queues hold values that can be revoked, this `lazyZip(..)` helper utility has the nuanced but important difference from other "zip"s that it doesn't actually consume a value from a queue until all queues have a value available to consume. Any queue that's being iterated with `lazyZip(..)` can have a previous value revoked if it hasn't yet actually been consumed by `lazyZip(..)`. Also, that [queue may be closed](#closing-a-queue), which implicity revokes/discards any unconsumed values.

Here's how to use `lazyZip(..)`:

```js
var agents = RevocableQueue.create();
var customers = RevocableQueue.create();

async function supporChatSessions() {
    for await (
        let [customer,agent] of RevocableQueue.lazyZip(customers,agents)
    ) {
        console.log(`Chat session ready for ${customer} and ${agent}`);
    }
}
```

`lazyZip(..)` returns an ES2018 async iterator instance (suitable for use with `for await..` loops, etc). This makes consumption of the resulting stream (aka "queue") of value collections straightforward.

As is common for a "zip" operation, the iterator from `lazyZip(..)` will be closed if **any of the queues** are [closed](#closing-a-queue) (which would terminate the `for await..` loop). Also, the iterator will be closed if you early-exit a `for await..` loop (uncaught exception, `break`, `return`, etc), or if you directly call `return()` on an iterator instance.

**Note:** Closing an iterator does not close any of its observed queues, but closing **any** such queue will close the iterator.

#### `lazyMerge(..)`

You may want to consume the next available value from any of multiple queues, which in reactive programming speak is a "merge". `lazyMerge(..)` returns an ES2018 async iterator instance to make this consumption straightforward:

```js
var clicks = RevocableQueue.create();
var keypresses = RevocableQueue.create();

async function moveGameCharacter() {
    for await (
        let evt of RevocableQueue.lazyMerge(clicks,keypresses)
    ) {
        if (evt.type == "click") {
            // ..
        }
        else if (evt.type == "keypress") {
            // ..
        }
    }
}
```

As is common for a "merge" operation, the iterator from `lazyMerge(..)` will be closed if **all queues** are [closed](#closing-a-queue) (which would terminate the `for await..` loop). Also, the iterator will be closed if you early-exit a `for await..` loop (uncaught exception, `break`, `return`, etc), or if you directly call `return()` on an iterator instance.

**Note:** Closing an iterator does not close any of its observed queues, but closing **all** such queues will close the iterator.

#### Iterating a Single Queue

`lazyZip(..)` and `lazyMerge(..)` are primarily intended to zip/merge values from two or more revocable queues. However, you can pass either utility a single revocable queue, and what you get back is an async iterator to consume that single queue asynchronously in a language-standard, convenient form.

To illustrate, recall this manual iteration example from above:

```js
// read a value from the queue every 500ms
(async function readValues(){
    while (true) {
        let get = await q.next();
        if (get(/*take=*/false) !== RevocableQueue.EMPTY) {
            let val = get();
            console.log(`Read value: ${val}`);
        }

        // `delay(..)` is a promisified `setTimeout(..)`
        await delay(500);
    }
})();
```

Here's how to consume that queue using `lazyMerge(..)`:

```js
// read a value from the queue every 500ms
(async function readValues(){
    for await (let val of RevocableQueue.lazyMerge(q)) {
        console.log(`Read value: ${val}`);

        // `delay(..)` is a promisified `setTimeout(..)`
        await delay(500);
    }
})();
```

**Note:** `lazyZip(..)` can also be used for this purpose, but it always yields an array, even with a single value. So, the `for await..` statement above would be: `for await (let [val] of RevocableQueue.lazyZip(q))`, with the `[val]` array destructuring.

The semantic of using `lazyMerge(..)` / `lazyZip(..)` here with a single queue may be a bit confusing to readers of your code. So it's recommended to use the `queueIterable(..)` helper, which is solely provided as a better semantic name for this use-case (it just invokes `lazyMerge(..)` with a single passed in queue):

```js
// read a value from the queue every 500ms
(async function readValues(){
    for await (let val of RevocableQueue.queueIterable(q)) {
        console.log(`Read value: ${val}`);

        // `delay(..)` is a promisified `setTimeout(..)`
        await delay(500);
    }
})();
```

This form of queue iteration with `queueIterable(..)` is much nicer than doing it manually!

### `eventIterable(..)`

A common pattern is to turn a stream of events into an async iterable for consumption. You could do this manually by creating a queue, subscribing the event to push event objects into the queue, then turning the queue into an iterable with `queueIterable(..)`. But that's a fair amount of boilerplate.

For this purpose, the `eventIterable(..)` helper is provided:

```js
var btn = ..;

(async function logButtonClicks(){
    for await (let evt of RevocableQueue.eventIterable(btn,"click")) {
        console.log(`Clicked on: ${evt.target}`);
    }
})();
```

This loop will continue perpetually because nothing will close the iterator or the underlying queue from the event subscription. However, if the iterator is closed, the event is unsubscribed during cleanup.

### `eventState(..)`

Another use-case for revocable queues and `lazyZip(..)` is listening for alternating events to fire that represent a toggling of a state (between `true` and `false`). The concern is not receiving specific values from these events (as illustrated previously with `lazyZip(..)`), but rather just listening for a signal that all of the activation events for a set of two or more listeners has fired, and that no corresponding deactivation events occurred while waiting.

For example: managing a series of network socket connections which fire `"connected"` and `"disconnected"` events, and synchronizing operations to occur only when all the connections are active/connected at the same time.

For this kind of event/state synchronization use case, `eventState(..)` is provided, which wraps `lazyZip(..)` and subscribes to events on `EventEmitter`-compatible event emitter instances (ie, `.on(..)` for subscribing and `.off(..)` for unsubscribing).

**Note:** `eventState(..)` will typically be used with full event emitter instances (from streams, network sockets, etc). But if you need to create event emitters directly, see [`EventEmitter()`](#eventemitter) below.

To use `eventState(..)`, pass it an array of two or more objects. Each object should have at a minimum a `listener` property with the event emitter instance, as well as an `onEvent` property with the name of the activation event to listen for (or an array of event names).

Optionally, each of these objects can include an `offEvent` property to name a deactivation event (or array of event names) to listen for, and a `status` property (boolean, default: `false`) to initialize the status for each listener.

The return value from `eventState(..)` is a controller object, which has two properties: `wait` is the promise that will resolve when the event-state synchronization has completed, and `cancel()` which will cancel the processing (including cleaning up all event handlers) and cause the `wait` promise to be rejected.

```js
async function greetings(conn1,conn2,conn3) {
    var controller = RevocableQueue.eventState([
        {
            listener: conn1,
            onEvent: [ "connected", "reconnected", ],
            offEvent: "disconnected",
            status: conn1.isConnected
        },
        {
            listener: conn2,
            onEvent: [ "connected", "reconnected", ],
            offEvent: "disconnected",
            status: conn2.isConnected
        },
        {
            listener: conn3,
            onEvent: [ "connected", "reconnected", ],
            offEvent: "disconnected",
            status: conn3.isConnected
        }
    ]);

    // listen for an "abandon" event to cancel the event-state processing
    conn1.on("abandon",controller.cancel);

    try {
        await controller.wait;
        broadcastMessage( [conn1,conn2,conn3], "greetings!" );
    }
    catch (err) {
        console.log("Connections abandoned!");
    }
}
```

This code asserts that the three network socket connection objects (`conn1`, `conn2`, and `conn3`) all emit `"connected"` / `"reconnected"` and `"disconnected"` events, as well as have an `isConnected` boolean property that's `true` when connected or `false` when not. The moment all 3 connections are established simultaneously, the `await` expression waiting on the `wait` promise will complete, and then the `broadcastMessage(..)` operation will be performed.

If the `"abandon"` event is fired on `conn1`, `controller.cancel()` is invoked, which cancels the event-state processing, cleans up all the listeners, and then rejects the `wait` promise.

#### `EventEmitter`

`RevocableQueue.EventEmitter()` is an included utility to create simple event emitter instances:

```js
var listener = new RevocableQueue.EventEmitter();

listener.on("greeting",function onHello(msg){
    console.log(`Hello, ${msg}!`);
});

listener.emit("greeting","Kyle");
// Hello, Kyle!
```

`RevocableQueue.EventEmitter()` is a stripped-down implementation of a synchronous event emitter, with a generally compatible subset of the [Node.js `EventEmitter()`](https://nodejs.org/api/events.html) API.

**Note:** Only use if your code's environment doesn't already provide a suitable event emitter utility.

`RevocableQueue.EventEmitter()` instances have the following methods:

  - `emit(eventName,...data)`
  - `on(eventName,handler)`
  - `once(eventName,handler)`
  - `removeListener(eventName,handler)`
  - `off(eventName,handler)`
  - `removeAllListeners(eventName)` (note: `eventName` is optional)

## Builds

[![Build Status](https://travis-ci.org/getify/revocable-queue.svg?branch=master)](https://travis-ci.org/getify/revocable-queue)
[![npm Module](https://badge.fury.io/js/%40getify%2Frevocable-queue.svg)](https://www.npmjs.org/package/@getify/revocable-queue)
[![Modules](https://img.shields.io/badge/modules-UMD%2BCJS-a1356a)](https://nodejs.org/api/packages.html#dual-commonjses-module-packages)

The distribution library file (`dist/rq.js`) comes pre-built with the npm package distribution, so you shouldn't need to rebuild it under normal circumstances.

However, if you download this repository via Git:

1. The included build utility (`build-core.js`) builds (and minifies) `dist/rq.js` from source. **The build utility expects Node.js version 6+.**

2. To install the build and test dependencies, run `npm install` from the project root directory.

    - **Note:** This `npm install` has the effect of running the build for you, so no further action should be needed on your part.

3. To manually run the build utility with npm:

    ```
    npm run build
    ```

4. To run the build utility directly without npm:

    ```
    node build-core.js
    ```

## Tests

A test suite is included in this repository, as well as the npm package distribution. The default test behavior runs the test suite using `index.js`.

1. The included Node.js test utility (`node-tests.js`) runs the test suite. **This test utility expects Node.js version 6+.**

2. To run the test utility with npm:

    ```
    npm test
    ```

    Other npm test scripts:

    * `npm run test:dist` will run the test suite against `dist/rq.js` instead of the default of `index.js`.

    * `npm run test:package` will run the test suite as if the package had just been installed via npm. This ensures `package.json`:`main` properly references `dist/rq.js` for inclusion.

    * `npm run test:all` will run all three modes of the test suite.

3. To run the test utility directly without npm:

    ```
    node node-tests.js
    ```

### Test Coverage

[![Coverage Status](https://coveralls.io/repos/github/getify/revocable-queue/badge.svg?branch=master)](https://coveralls.io/github/getify/revocable-queue?branch=master)

If you have [NYC (Istanbul)](https://github.com/istanbuljs/nyc) already installed on your system (requires v14.1+), you can use it to check the test coverage:

```
npm run coverage
```

Then open up `coverage/lcov-report/index.html` in a browser to view the report.

**Note:** The npm script `coverage:report` is only intended for use by project maintainers. It sends coverage reports to [Coveralls](https://coveralls.io/).

## License

[![License](https://img.shields.io/badge/license-MIT-a1356a)](LICENSE.txt)

All code and documentation are (c) 2019 Kyle Simpson and released under the [MIT License](http://getify.mit-license.org/). A copy of the MIT License [is also included](LICENSE.txt).
