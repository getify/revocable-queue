# Revocable Queue

[![npm Module](https://badge.fury.io/js/%40getify%2Frevocable-queue.svg)](https://www.npmjs.org/package/@getify/revocable-queue)
[![Dependencies](https://david-dm.org/getify/revocable-queue.svg)](https://david-dm.org/getify/revocable-queue)
[![devDependencies](https://david-dm.org/getify/revocable-queue/dev-status.svg)](https://david-dm.org/getify/revocable-queue?type=dev)

Revocable Queue allows you to read/write a sequence of data values (aka, a queue) asynchronously, similar to streams or observables. But any data/event that is still pending in the queue -- hasn't yet been read -- can be revoked.

Some helpers are included to make working with revocable queues easier for some common use-cases, including [`lazyZip(..)`](#lazyzip) and [`eventState(..)`](#eventstate).

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
    let val1 = get1();
    let val2 = get2();

    console.log(`The values retrieved: ${val1} ${val2}`);
}
```

In this above snippet, the not-so-obvious race condition is that `get1` may have been resolved signficantly before (or after) `get2`, so by that time, either underlying value may have been revoked. The `if` statment peeks through each queue's ready-to-read accessor function to ensure the value is indeed *still* ready.

**Note:** There is no race condition between the `get1(false)` and the `get1()` call (or the `get2(..)` calls), because JavaScript is single-threaded. So as long as this code pattern is followed, where the peeking and the reading happen synchronously (no promise/`await` deferral in between!), it's perfectly safe to assume that the peeked value is still ready to read in the next statement. Even if some other code was trying to revoke that value at that exact moment, it would be waiting for this code to finish, and since it's fully read/taken, the revoking would fail.

This synchronizing of lazy asynchronous reads from multiple queues is an expected common use-case for **RevocableQueue**. As such, the [`lazyZip(..)`](#lazyzip) helper utility is also provided.

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

`readValues(..)` shows how to manually consume the queue, which in some cases may be the preferred approach. But it also may be preferred to have a more standard consumption pattern, such as ES2018 async iterators. This is [illustrated later](#iterating-a-single-queue).

### `lazyZip(..)`

In the [Peeking](#peeking) section above, the use case was presented to synchronize lazy asynchronous reads from multiple queues. For example, imagine a queue that collects customers who attempt to connect to a support chat, and another queue that collects support agents who become available for a chat.

You would want to read a value from each queue, whenever one was ready, but ensure that you have an *atomic pairing*, meaning that you only take a value from each queue when both queues have a value available. If a customer starts waiting, and later an agent becomes available, you pair them. But if the customer disconnects while waiting for an agent, they need to be removed (revoked) from the queue. The reverse scenario also applies: an agent could disconnect while waiting for a customer to connect.

In FP (functional programming) terms, as well as in streams based programming like with observables, this *atomic pairing* is generally a `zip(..)` operation. But traditional FP `zip(..)` utilities don't account for reading from queues which are asynchronous, and observables' `zip(..)` doesn't really account for revocation.

As such, this library provides a `lazyZip(..)` helper utility. It is an asynchronous generator (ES2018), aka a JS "stream". Here's how it can be used:

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

Since `lazyZip(..)` is an ES2018 async generator, when called it returns an ES2018 async iterator instance (suitable for use with `for await..` loops, etc). This makes consumption of the resulting stream (aka "queue") of value pairings very straightforward.

#### Iterating a Single Queue

`lazyZip(..)` is primarily intended to zip values from two or more revocable queues, as shown above. However, you can pass it a single revocable queue, and what you get back is a convenient ES2018 async iterator to consume that single queue asynchronously in a convenient and JS-standard form.

To compare, recall this example from above:

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

Here's how to consume that queue using `lazyZip(..)`:

```js
// read a value from the queue every 500ms
(async function readValues(){
    for await (let val of RevocableQueue.lazyZip(q)) {
        console.log(`Read value: ${val}`);

        // `delay(..)` is a promisified `setTimeout(..)`
        await delay(500);
    }
})();
```

That approach is probably much cleaner in most cases!

### `eventState(..)`

Another use-case for revocable queues and `lazyZip(..)` is listening for alternating events to fire that represent a toggling of a state (between `true` and `false`). The concern is not receiving specific values from these events (as illustrated previously with `lazyZip(..)`), but rather just listening for a signal that all of the activation events for a set of two or more listeners has fired, and that no corresponding deactivation events occured while waiting.

For example: managing a series of network socket connections which fire `"connected"` and `"disconnected"` events, and synchronizing operations to occur only when all the connections are active/connected at the same time.

For this kind of event/state synchronization use case, `eventState(..)` is provided, which wraps `lazyZip(..)` and subscribes to events on `EventEmitter` compatible objects (ie, `.on(..)` for subscribing and `.off(..)` for unsubscribing).

To use `eventState(..)`, pass it an array of two or more objects. Each object should have at a minimum a `listener` property with the `EventEmitter` instance, as well as an `onEvent` property with the name of the activation event to listen for.

Optionally, each of these objects can include an `offEvent` property to name a deactivation event to listen for, and a `status` property (boolean, default: `false`) to initialize the status for each listener:

```js
async function greetings(conn1,conn2,conn3) {
    await RevocableQueue.eventState([
        {
            listener: conn1,
            onEvent: "connected",
            offEvent: "disconnected",
            status: conn1.isConnected
        },
        {
            listener: conn2,
            onEvent: "connected",
            offEvent: "disconnected",
            status: conn2.isConnected
        },
        {
            listener: conn3,
            onEvent: "connected",
            offEvent: "disconnected",
            status: conn3.isConnected
        }
    ]);

    broadcastMessage( [conn1,conn2,conn3], "greetings!" );
}
```

This code asserts that the three network socket connection objects (`conn1`, `conn2`, and `conn3`) all emit `"connected"` and `"disconnected"` events, as well as have an `isConnected` boolean property that's `true` when connected or `false` when not. The moment all 3 connections are established simultaneously, the `await` expression will complete and then the `broadcastMessage(..)` operation will be performed.

## Builds

[![npm Module](https://badge.fury.io/js/%40getify%2Frevocable-queue.svg)](https://www.npmjs.org/package/@getify/revocable-queue)

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

## License

All code and documentation are (c) 2019 Kyle Simpson and released under the [MIT License](http://getify.mit-license.org/). A copy of the MIT License [is also included](LICENSE.txt).
