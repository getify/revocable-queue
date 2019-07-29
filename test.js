"use strict";

var util = require("util");

var delay = util.promisify(setTimeout);
var RevocableQueue = require("./index.js");


// NOTE: Right now, this is a very incomplete test suite,
// only covering the core queue read & revoke. Many more
// edge cases should eventually be tested, as well as the
// lazyZip() function.
(async function test(){
	var expected = [1,2,4,5,6,8,10];
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

	await readComplete;

	if (JSON.stringify(expected) === JSON.stringify(actual)) {
		console.log("tests passed.");
		process.exitCode = 0;
	}
	else {
		console.error("tests failed.");
		process.exitCode = 1;
	}
})().catch(console.error);
