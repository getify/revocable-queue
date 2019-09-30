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
			for (let handler of (/* istanbul ignore next */this.listeners[evtName] || [])) {
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
		/* istanbul ignore next */
		once(evtName,handler) {
			var onEvt = (...args) => {
				this.off(evtName,handler);
				handler.apply(this,args);
			};
			return this.on(evtName,onEvt);
		}
		removeListener(evtName,handler) {
			/* istanbul ignore else */
			if (this.listeners[evtName]) {
				this.listeners[evtName].delete(handler);
			}
			return this;
		}
		/* istanbul ignore next */
		removeAllListeners(evtName) {
			var evtNames = (evtName !== undefined) ? [evtName,] : Object.keys(this.listeners);
			for (let name of evtNames) {
				this.listeners[name].clear();
			}
		}
		off(...args) {
			return this.removeListener(...args);
		}
	}

	class IteratorClosed extends Error {
		constructor() {
			super("Iterator is closed");
		}
	}

	class QueueClosed extends Error {
		constructor() {
			super("Queue is closed");
		}
	}

	var moduleAPI = {
		create,
		lazyZip,
		lazyMerge,
		eventState,
		queueIterable,
		eventIterable,
		EventEmitter,
	};
	Object.defineProperty(moduleAPI,"EMPTY",{ value: {}, writable: false, configurable: false, enumerable: false, });

	return moduleAPI;


	// ******************************

	function create() {
		var closed = false;
		var queue = [];
		var signals = [];

		var queueAPI = {
			add,
			insertFirst,
			next,
			close,
			isClosed,
		};

		return queueAPI;


		// ******************************

		function next() {
			if (!closed) {
				return new Promise(function c(res,rej){
					signals.push([ res, rej, ]);
					notify();
				});
			}
			else {
				return Promise.reject(new QueueClosed());
			}
		}

		function add(v) {
			if (!closed) {
				var entry = {
					use(take = true) {
						// entry still pending?
						if (!closed && entry.use) {
							if (take) {
								entry.use = null;
							}
							return v;
						}
						return moduleAPI.EMPTY;
					},
				};
				queue.push(entry);

				notify();

				return entry.use;
			}
			else {
				throw new QueueClosed();
			}
		}

		function insertFirst(v) {
			var use = add(v);
			// move entry to the front of the line
			if (queue.length > 1) {
				queue.unshift(queue.pop());
			}
			return use;
		}

		function close() {
			if (!closed) {
				closed = true;

				// pending queue signals that should be forcibly rejected?
				if (queue.length < signals.length) {
					for (let [,rej,] of signals) {
						rej(new QueueClosed());
					}
				}
				queue.length = signals.length = 0;
			}
		}

		function isClosed() {
			return closed;
		}

		function notify() {
			while (queue.length > 0 && signals.length > 0) {
				let entry = queue.shift();
				// entry still pending?
				if (entry.use) {
					signals.shift()[0](entry.use);
				}
			}
		}
	}

	function lazyZip(...queues) {
		return makeCloseableAsyncIterable(async function *lazyZip(iteratorHasClosed){
			var accessors = [];

			while (true) {
				// wait on either previously un-used accessors or new
				// accessors from the queues
				let waiters = [];
				for (let [idx,queue,] of queues.entries()) {
					waiters[idx] = accessors[idx] || queue.next();
				}

				try {
					// wait for all accessors to resolve
					accessors = await Promise.race([
						iteratorHasClosed,
						Promise.all(waiters),
					]);
				}
				catch (err) {
					/* istanbul ignore else */
					if (
						err instanceof QueueClosed ||
						err instanceof IteratorClosed
					) {
						return;
					}
					else {
						throw err;
					}
				}

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
		});
	}

	function lazyMerge(...queues) {
		return makeCloseableAsyncIterable(async function *lazyMerge(iteratorHasClosed){
			// pull promises from each queue
			var waiters = queues.map(waitForNextAccessor);

			while (true) {
				let accessorIdx, accessor;

				// wait for an accessor to become available
				try {
					[ accessorIdx, accessor, ] = await Promise.race([ iteratorHasClosed, ...waiters, ]);
				}
				catch (err) {
					if (err instanceof IteratorClosed) {
						return;
					}
					else {
						/* istanbul ignore else */
						if (err instanceof QueueClosed) {
							let allClosed = true;

							// find which queue(s) are now closed
							for (let [idx,q,] of queues.entries()) {
								if (q.isClosed()) {
									// replace with a dead promise
									waiters[idx] = waitForNextAccessor(queues[idx],idx);
								}
								else {
									allClosed = false;
								}
							}

							if (allClosed) {
								return;
							}

							continue;
						}
						else {
							throw err;
						}
					}
				}

				// does winning accessor have a result available?
				let result = accessor(/*take=*/false);
				/* istanbul ignore else */
				if (result !== moduleAPI.EMPTY) {
					accessor(/*take=*/true);
					yield result;
				}

				// replace the winning accessor with a new waiter
				waiters[accessorIdx] = waitForNextAccessor(queues[accessorIdx],accessorIdx);
			}
		});
	}

	function waitForNextAccessor(q,idx) {
		if (!q.isClosed()) {
			return q.next().then(function t(accessor){
				return [ idx, accessor, ];
			});
		}
		else {
			return new Promise(Function.prototype);
		}
	}

	function eventState(segments) {
		// create revocable queues for each gate segment
		var queues = segments.map(createQueue);
		var cancel;

		var wait = Promise.race([
			// promise to wait for all events to be activated at the same time
			lazyZip(...queues).next(),
			new Promise(function c(res,rej){
				cancel = rej;
			}),
		]);
		wait.then(cleanup,cleanup);

		var eventStateAPI = { wait, cancel, };
		return eventStateAPI;


		// *************************

		function createQueue(segment){
			var q = create();
			var revoke;

			q.segment = segment;
			q.wait = wait;
			q.signal = signal;

			/* istanbul ignore else */
			if (segment.onEvent) {
				let evtNames = Array.isArray(segment.onEvent) ? segment.onEvent : [ segment.onEvent, ];
				for (let evtName of evtNames) {
					segment.listener.on(evtName,signal);
				}
			}
			/* istanbul ignore else */
			if (segment.offEvent) {
				let evtNames = Array.isArray(segment.offEvent) ? segment.offEvent : [ segment.offEvent, ];
				for (let evtName of evtNames) {
					segment.listener.on(evtName,wait);
				}
			}
			if (segment.status) {
				signal();
			}

			return q;


			// **********************

			function wait() {
				/* istanbul ignore else */
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
		}

		function cleanup() {
			// unsubscribe any listeners to avoid memory leaks
			queues.forEach(function unsubscribe(q){
				/* istanbul ignore else */
				if (q.segment.onEvent) {
					let evtNames = Array.isArray(q.segment.onEvent) ? q.segment.onEvent : [ q.segment.onEvent, ];
					for (let evtName of evtNames) {
						q.segment.listener.off(evtName,q.signal);
					}
				}
				/* istanbul ignore else */
				if (q.segment.offEvent) {
					let evtNames = Array.isArray(q.segment.offEvent) ? q.segment.offEvent : [ q.segment.offEvent, ];
					for (let evtName of evtNames) {
						q.segment.listener.off(evtName,q.wait);
					}
				}
				q.wait = q.signal = q.segment = null;
			});
			segments.length = queues.length = 0;
			eventStateAPI = wait = cancel = null;
		}
	}

	function queueIterable(q) {
		return lazyMerge(q);
	}

	function eventIterable(listener,eventName) {
		return makeCloseableAsyncIterable(async function *eventIterable(iteratorHasClosed){
			try {
				var q = create();
				listener.on(eventName,q.add);

				// NOTE: instead of `yield*` here, we're manually consuming
				// the iterator and forwarding each result, so that we can
				// properly be notified of an external return() closing
				let it = queueIterable(q);
				while (true) {
					let value;
					try {
						({ value, } = await Promise.race([ iteratorHasClosed, it.next(), ]));
					}
					catch (err) {
						/* istanbul ignore else */
						if (err instanceof IteratorClosed) {
							return;
						}
						else {
							throw err;
						}
					}

					yield value;
				}
			}
			finally {
				listener.off(eventName,q.add);
			}
		});
	}

	function makeCloseableAsyncIterable(asyncGen) {
		var triggerClosed;
		var closed = new Promise(function c(res,rej){
			triggerClosed = rej;
		});
		var genIt = asyncGen(closed);

		return {
			__proto__: Object.getPrototypeOf(genIt),
			[Symbol.toStringTag]: genIt[Symbol.toStringTag],
			[Symbol.asyncIterator]() { return this; },
			next(...args) { return genIt.next(...args); },
			/* istanbul ignore next */
			throw(...args) { return genIt.throw(...args); },
			return(...args) {
				try {
					return genIt.return(...args);
				}
				finally {
					triggerClosed(new IteratorClosed());
				}
			},
		};
	}

});
