(function UMD(name,context,definition){
	/* istanbul ignore next */if (typeof define === "function" && define.amd) { define(definition); }
	/* istanbul ignore next */else if (typeof module !== "undefined" && module.exports) { module.exports = definition(); }
	/* istanbul ignore next */else { context[name] = definition(); }
})("RevocableQueue",this,function DEF(){

	// a basic event-emitter, if you don't already have one
	class EventEmitter {
		constructor() {
			this.listeners = {};
		}
		emit(evtName,...args) {
			for (let handler of (this.listeners[evtName] || [])) {
				try { handler.apply(this,args); }
				catch (err) {}
			}
			return this;
		}
		on(evtName,handler) {
			this.listeners[evtName] = this.listeners[evtName] || new Set();
			this.listeners[evtName].add(handler);
			return this;
		}
		once(evtName,handler) {
			var onEvt = (...args) => {
				this.off(evtName,handler);
				handler.apply(this,args);
			};
			return this.on(evtName,onEvt);
		}
		removeListener(evtName,handler) {
			if (this.listeners[evtName]) {
				this.listeners[evtName].delete(handler);
			}
			return this;
		}
		off(...args) {
			return this.removeListener(...args);
		}
	}


	var moduleAPI = {
		create,
		lazyZip,
		eventState,
		EventEmitter,
	};
	Object.defineProperty(moduleAPI,"EMPTY",{ value: {}, writable: false, configurable: false, enumerable: false, });

	return moduleAPI;


	// ******************************

	function create() {
		var queue = [];
		var signals = [];

		var queueAPI = {
			add,
			insertFirst,
			next,
		};

		return queueAPI;


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
					return moduleAPI.EMPTY;
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
			if (!results.includes(moduleAPI.EMPTY)) {
				// mark all accessors as used
				for (let accessor of accessors) {
					accessor(/*take=*/true);
				}

				// send this set of results
				yield results;

				// force discarding of accessors
				results.fill(moduleAPI.EMPTY);
			}

			// discard any used accessors (for next iteration)
			for (let [idx,val,] of results.entries()) {
				if (val === moduleAPI.EMPTY) {
					accessors[idx] = null;
				}
			}
		}
	}

	async function eventState(segments) {
		// create a revocable queue to represent each gate segment
		var queues = segments.map(function createQueue(segment){
			var q = create();
			var revoke;

			q.segment = segment;
			q.wait = wait;
			q.signal = signal;

			if (segment.onEvent) {
				segment.listener.on(segment.onEvent,signal);
			}
			if (segment.offEvent) {
				segment.listener.on(segment.offEvent,wait);
			}
			if (segment.status) {
				signal();
			}

			return q;


			// **********************

			function wait() {
				if (revoke) {
					revoke();
					revoke = null;
				}
			}

			function signal() {
				if (!revoke) {
					revoke = q.add(true);
				}
			}
		});

		// wait for all events to be fired & active at the same time
		await lazyZip(...queues).next();

		// unsubscribe any listeners, avoid memory leaks
		queues.forEach(function unsubscribe(q){
			if (q.segment.onEvent) {
				q.segment.listener.off(q.segment.onEvent,q.signal);
			}
			if (q.segment.offEvent) {
				q.segment.listener.off(q.segment.offEvent,q.wait);
			}
			q.wait = q.signal = q.segment = null;
		});
		segments.length = queues.length = 0;
	}

});
