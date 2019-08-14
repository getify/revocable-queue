#!/usr/bin/env node

var path = require("path");

/* istanbul ignore next */
if (process.env.TEST_DIST) {
	global.RevocableQueue = require(path.join(__dirname,"dist","rq.js"));
}
/* istanbul ignore next */
else if (process.env.TEST_PACKAGE) {
	global.RevocableQueue = require(__dirname);
}
else {
	global.RevocableQueue = require("./index.js");
}

require(path.join(__dirname,"test.js"));
