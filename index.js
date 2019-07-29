"use strict";

var API = module.exports = {
	create,
	lazyZip,
};
Object.defineProperty(module.exports,"EMPTY",{ value: {}, writable: false, configurable: false, enumerable: false, });


// ******************************

function create() {
	var queue = [];
	var signals = [];

	var publicAPI = {
		add,
		insertFirst,
		next,
	};

	return publicAPI;


	// ******************************

	function next() {
		return new Promise(function c(res){
			signals.push(res);
			notify();
		});
	}

	function add(v) {
		var entry = {
			use(take = true) {
				// entry still pending?
				if (entry.use) {
					if (take) {
						entry.use = null;
					}
					return v;
				}
				return API.EMPTY;
			},
		};
		queue.push(entry);

		// microtask defer
		Promise.resolve().then(notify);

		return entry.use;
	}

	function insertFirst(v) {
		var use = add(v);
		// move entry to the front of the line
		if (queue.length > 1) {
			queue.unshift(queue.pop());
		}
		return use;
	}

	function notify() {
		while (queue.length > 0 && signals.length > 0) {
			let entry = queue.shift();
			// entry still pending?
			if (entry.use) {
				signals.shift()(entry.use);
			}
		}
	}
}

async function *lazyZip(...queues) {
	var accessors = [];

	while (true) {
		// wait on either previously un-used accessors or new
		// accessors from the queues
		let waiters = [];
		for (let [idx,queue,] of queues.entries()) {
			waiters[idx] = accessors[idx] || queue.next();
		}

		// wait for all accessors to resolve
		accessors = await Promise.all(waiters);

		// peek at accessor results
		let results = [];
		for (let [idx,accessor,] of accessors.entries()) {
			results[idx] = accessor(/*take=*/false);
		}

		// all results available?
		if (!results.includes(API.EMPTY)) {
			// mark all accessors as used
			for (let accessor of accessors) {
				accessor(/*take=*/true);
			}

			// send this set of results
			yield results;

			// force discarding of accessors
			results.fill(API.EMPTY);
		}

		// discard any used accessors (for next iteration)
		for (let [idx,val,] of results.entries()) {
			if (val === API.EMPTY) {
				accessors[idx] = null;
			}
		}
	}
}
