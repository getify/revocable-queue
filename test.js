"use strict";

var util = require("util");

var delay = util.promisify(setTimeout);

// NOTE: Right now, this is a very incomplete test suite. It
// covers basic core of queue add / revoke, and a bit of
// the eventState (and thus lazyZip). These tests should
// eventually be made a lot more comprehensive.
(async function runAllTests(){
	try {
		await test1();
		await test2();
		console.log("all tests passed.");
		process.exitCode = 0;
	}
	catch (errMsg) {
		console.error(errMsg);
		process.exitCode = 1;
	}
})();


// ***********************************

async function test1() {
	var expected = [1,2,4,5,6,8,10,];
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
	})();

	// push numbers 1 - 10 into queue, and also revoke a few
	for (let i = 1; i <= 10; i++) {
		revokes.push( q.add(i) );

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
	var expected = ["one","two","three","four","five","six",];
	var actual = [];

	var emitters = [
		new RevocableQueue.EventEmitter(),
		new RevocableQueue.EventEmitter(),
		new RevocableQueue.EventEmitter(),
	];

	var gate = RevocableQueue.eventState([
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

		await delay(50);
		actual.push("nope");
	})();

	await Promise.race([
		gate,
		timeout(1000),
	]);

	if (JSON.stringify(expected) !== JSON.stringify(actual)) {
		throw new Error(`eventState tests failed.\n  expected: ${expected}\n  actual: ${actual}`);
	}
}

async function timeout(ms) {
	await delay(ms);
	throw new Error("Timeout!");
}
