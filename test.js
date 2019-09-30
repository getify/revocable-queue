"use strict";

var util = require("util");

var delay = util.promisify(setTimeout);


(async function runAllTests(){
	try {
		for (let testFn of [
			test1, test2, test3, test4, test5, test6,
			test7, test8, test9, test10, test11, test12,
		]) {
			await testFn();
		}
		console.log("all tests passed.");
		process.exitCode = 0;
	}
	catch (errMsg) {
		console.error("error",errMsg);
		process.exitCode = 1;
	}
})();


// ***********************************

async function test1() {
	var expected = [4,1,2,5,6,8,10,];
	var actual = [];

	var q = RevocableQueue.create();
	var revokes = [];

	// read values from queue
	var readComplete = (async function readFromQueue(){
		await delay(150);

		while (actual.length < 7) {
			let get = await q.next();
			if (get(/*take=*/false) !== RevocableQueue.EMPTY) {
				actual.push( get() );
			}
			await delay(50);
		}
		q.close();
	})();

	// push numbers 1 - 10 into queue, and also revoke a few
	for (let i = 1; i <= 10; i++) {
		if (i == 1 || i == 4) {
			revokes.push( q.insertFirst(i) );
		}
		else {
			revokes.push( q.add(i) );
		}

		// do some revokes
		await delay(5);
		if (i == 4) {
			revokes[2]();
		}
		else if (i == 8) {
			revokes[6]();
		}
		else if (i == 9) {
			revokes[8]();
		}

		await delay(30);
	}

	await Promise.race([
		readComplete,
		timeout(1000),
	]);

	if (JSON.stringify(expected) !== JSON.stringify(actual)) {
		throw new Error(`read/revoke tests failed.\n  expected: ${expected}\n  actual: ${actual}`);
	}
}

async function test2() {
	var expected = ["one","two","three","Error: Queue is closed","Error: Queue is closed",];
	var actual = [];

	var q = RevocableQueue.create();

	(async function emitting(){
		q.add("one");
		q.add("two");
		q.add("three");

		await delay(50);

		q.close();
		try {
			q.add("four");
		}
		catch (err) {
			actual.push(err.toString());
		}
	})();

	while (!q.isClosed()) {
		try {
			let get = await Promise.race([
				q.next(),
				timeout(1000),
			]);
			if (get(/*take=*/false) !== RevocableQueue.EMPTY) {
				actual.push( get() );
			}
		}
		catch (err) {
			actual.push(err.toString());
		}
	}

	if (JSON.stringify(expected) !== JSON.stringify(actual)) {
		throw new Error(`queue.close() tests failed.\n  expected: ${expected}\n  actual: ${actual}`);
	}
}

async function test3() {
	var expected = ["one","two","three","four","five","six",];
	var actual = [];

	var emitters = [
		new RevocableQueue.EventEmitter(),
		new RevocableQueue.EventEmitter(),
		new RevocableQueue.EventEmitter(),
	];

	var gate = RevocableQueue.eventState([
		{ listener: emitters[0], onEvent: [ "yes", "yep", ], offEvent: "no", status: false, },
		{ listener: emitters[1], onEvent: "yes", offEvent: [ "no", "nope", ], status: true, },
		{ listener: emitters[2], onEvent: "yes", offEvent: "no", status: false, },
	]).wait;

	(async function emitting(){
		await delay(50);
		actual.push("one");
		emitters[0].emit("yes");

		await delay(50);
		actual.push("two");
		emitters[1].emit("nope");

		await delay(50);
		actual.push("three");
		emitters[2].emit("yes");

		await delay(50);
		actual.push("four");
		emitters[0].emit("no");
		emitters[1].emit("yes");

		await delay(50);
		actual.push("five");
		emitters[1].emit("no");
		emitters[1].emit("yes");

		await delay(50);
		actual.push("six");
		emitters[0].emit("yep");

		await delay(50);
		actual.push("nope");
	})();

	await Promise.race([
		gate,
		timeout(1000),
	]);

	if (JSON.stringify(expected) !== JSON.stringify(actual)) {
		throw new Error(`eventState():1 tests failed.\n  expected: ${expected}\n  actual: ${actual}`);
	}
}

async function test4() {
	var expected = ["one","two","three","seven","four","five","six",];
	var actual = [];

	var emitters = [
		new RevocableQueue.EventEmitter(),
		new RevocableQueue.EventEmitter(),
		new RevocableQueue.EventEmitter(),
	];

	var { wait: gate1, cancel: cancel1, } = RevocableQueue.eventState([
		{ listener: emitters[0], onEvent: "yes", offEvent: "no", status: false, },
		{ listener: emitters[1], onEvent: "yes", offEvent: "no", status: true, },
		{ listener: emitters[2], onEvent: "yes", offEvent: "no", status: false, },
	]);

	var { wait: gate2, cancel: cancel2, } = RevocableQueue.eventState([
		{ listener: emitters[0], onEvent: "yes", offEvent: "no", status: false, },
		{ listener: emitters[1], onEvent: "yes", offEvent: "no", status: true, },
		{ listener: emitters[2], onEvent: "yes", offEvent: "no", status: false, },
	]);

	(async function emitting(){
		await delay(50);
		actual.push("one");
		emitters[0].emit("yes");

		await delay(50);
		actual.push("two");
		emitters[1].emit("no");

		await delay(50);
		actual.push("three");
		emitters[2].emit("yes");
		cancel1();

		await delay(50);
		actual.push("four");
		emitters[0].emit("no");
		emitters[1].emit("yes");

		await delay(50);
		actual.push("five");
		emitters[1].emit("yes");

		await delay(50);
		actual.push("six");
		emitters[0].emit("yes");

		await delay(0);
		cancel2();	// note: should NOT cancel

		await delay(50);
		actual.push("nope");
	})();

	try {
		await Promise.race([
			gate1,
			timeout(1000),
		]);
	}
	catch (err) {
		actual.push("seven");
	}
	try {
		await Promise.race([
			gate2,
			timeout(1000),
		]);
	}
	catch (err) {
		actual.push("oops");
	}

	if (JSON.stringify(expected) !== JSON.stringify(actual)) {
		throw new Error(`eventState():2 tests failed.\n  expected: ${expected}\n  actual: ${actual}`);
	}
}

async function test5() {
	var expected = ["one","two","three",];
	var actual = [];

	var events = new RevocableQueue.EventEmitter();
	var it = RevocableQueue.eventIterable(events,"hello");

	(async function emitting(){
		await delay(50);
		events.emit("hello","one");

		await delay(50);
		events.emit("hello","two");

		await delay(50);
		events.emit("hello","three");

		await delay(50);
		it.return();
		events.emit("hello","four");

		await delay(50);
	})();

	for await (let v of it) {
		actual.push(v);
	}

	if (JSON.stringify(expected) !== JSON.stringify(actual)) {
		throw new Error(`eventIterable():1 tests failed.\n  expected: ${expected}\n  actual: ${actual}`);
	}
}

async function test6() {
	var expected = ["one","two","three",];
	var actual = [];

	var events = new RevocableQueue.EventEmitter();
	var it = RevocableQueue.eventIterable(events,"hello");

	(async function emitting(){
		await delay(50);
		events.emit("hello","one");

		await delay(50);
		events.emit("hello","two");

		await delay(50);
		events.emit("hello","three");

		await delay(50);
		events.emit("hello","four");

		await delay(50);
	})();

	var i = 0;
	for await (let v of it) {
		actual.push(v);
		i++;
		if (i == 3) break;
	}

	if (JSON.stringify(expected) !== JSON.stringify(actual)) {
		throw new Error(`eventIterable():2 tests failed.\n  expected: ${expected}\n  actual: ${actual}`);
	}
}

async function test7() {
	var expected = ["one","two","three","four","five","six",];
	var actual = [];

	var queues = [
		RevocableQueue.create(),
		RevocableQueue.create(),
		RevocableQueue.create(),
	];

	var it = RevocableQueue.lazyZip(...queues);


	(async function emitting(){
		queues[0].add("one");
		queues[1].add("two");

		await delay(50);
		queues[0].add("four");
		queues[2].add("three");

		await delay(50);
		queues[2].add("six");

		await delay(50);
		queues[1].add("five");

		await delay(50);
		it.return();

		queues[0].add("nope:0");
		queues[1].add("nope:1");
		queues[2].add("nope:2");

		await delay(50);
	})();

	for await (let [v1,v2,v3,] of it) {
		actual.push(v1,v2,v3);
	}

	if (JSON.stringify(expected) !== JSON.stringify(actual)) {
		throw new Error(`lazyZip():1 tests failed.\n  expected: ${expected}\n  actual: ${actual}`);
	}
}

async function test8() {
	var expected = ["one","two","three","four","five","six",];
	var actual = [];

	var queues = [
		RevocableQueue.create(),
		RevocableQueue.create(),
		RevocableQueue.create(),
	];

	var it = RevocableQueue.lazyZip(...queues);


	(async function emitting(){
		queues[0].add("one");
		queues[1].add("two");

		await delay(50);
		queues[0].add("four");
		queues[2].add("three");

		await delay(50);
		queues[2].add("six");

		await delay(50);
		queues[0].add("nope:0");
		queues[2].add("nope:2");
		queues[1].add("five");
		queues[1].add("nope:1");

		await delay(50);
	})();

	var i = 0;
	for await (let [v1,v2,v3,] of it) {
		actual.push(v1,v2,v3);
		i++;
		if (i == 2) break;
	}

	if (JSON.stringify(expected) !== JSON.stringify(actual)) {
		throw new Error(`lazyZip():2 tests failed.\n  expected: ${expected}\n  actual: ${actual}`);
	}
}

async function test9() {
	var expected = ["one","two","three",];
	var actual = [];

	var queues = [
		RevocableQueue.create(),
		RevocableQueue.create(),
		RevocableQueue.create(),
	];

	var it = RevocableQueue.lazyZip(...queues);


	(async function emitting(){
		queues[0].add("one");
		queues[1].add("two");

		await delay(50);
		queues[0].add("four");
		queues[2].add("three");

		await delay(50);
		queues[2].add("six");

		await delay(50);
		queues[0].close();
		queues[0].close();
		queues[1].add("nope:1");
		queues[2].add("nope:2");

		await delay(50);
	})();

	for await (let [v1,v2,v3,] of it) {
		actual.push(v1,v2,v3);
	}

	if (JSON.stringify(expected) !== JSON.stringify(actual)) {
		throw new Error(`lazyZip():3 tests failed.\n  expected: ${expected}\n  actual: ${actual}`);
	}
}

async function test10() {
	var expected = ["one","two","three","four","five","six",];
	var actual = [];

	var queues = [
		RevocableQueue.create(),
		RevocableQueue.create(),
		RevocableQueue.create(),
	];

	var it = RevocableQueue.lazyMerge(...queues);


	(async function emitting(){
		queues[0].add("one");
		queues[1].add("two");

		await delay(50);
		queues[0].add("three");
		queues[2].add("four");

		await delay(50);
		queues[2].add("five");

		await delay(50);
		queues[1].add("six");

		await delay(50);
		it.return();

		queues[0].add("nope:0");
		queues[1].add("nope:1");
		queues[2].add("nope:2");

		await delay(50);
	})();

	for await (let v of it) {
		actual.push(v);
	}

	if (JSON.stringify(expected) !== JSON.stringify(actual)) {
		throw new Error(`lazyMerge():1 tests failed.\n  expected: ${expected}\n  actual: ${actual}`);
	}
}

async function test11() {
	var expected = ["one","two","three","four","five","six",];
	var actual = [];

	var queues = [
		RevocableQueue.create(),
		RevocableQueue.create(),
		RevocableQueue.create(),
	];

	var it = RevocableQueue.lazyMerge(...queues);


	(async function emitting(){
		queues[0].add("one");
		queues[1].add("two");

		await delay(50);
		queues[0].add("three");
		queues[2].add("four");

		await delay(50);
		queues[2].add("five");

		await delay(50);
		queues[1].add("six");
		queues[0].add("nope:0");
		queues[1].add("nope:1");
		queues[2].add("nope:2");

		await delay(50);
	})();

	var i = 0;
	for await (let v of it) {
		actual.push(v);
		i++;
		if (i == 6) break;
	}

	if (JSON.stringify(expected) !== JSON.stringify(actual)) {
		throw new Error(`lazyMerge():2 tests failed.\n  expected: ${expected}\n  actual: ${actual}`);
	}
}

async function test12() {
	var expected = ["one","two","three","four","five","six",];
	var actual = [];

	var queues = [
		RevocableQueue.create(),
		RevocableQueue.create(),
		RevocableQueue.create(),
	];

	var it = RevocableQueue.lazyMerge(...queues);


	(async function emitting(){
		queues[0].add("one");
		queues[1].add("two");

		await delay(50);
		queues[0].close();
		queues[1].add("three");
		queues[2].add("four");

		await delay(50);
		queues[2].close();
		queues[1].add("five");

		await delay(50);
		queues[1].add("six");

		await delay(50);
		queues[1].close();

		await delay(50);
	})();

	for await (let v of it) {
		actual.push(v);
	}

	if (JSON.stringify(expected) !== JSON.stringify(actual)) {
		throw new Error(`lazyMerge():1 tests failed.\n  expected: ${expected}\n  actual: ${actual}`);
	}
}





// ***************************

async function timeout(ms) {
	await delay(ms);
	throw new Error("Timeout!");
}
