#!/usr/bin/env node

var fs = require("fs"),
	path = require("path"),
	terser = require("terser"),
	packageJSON,
	copyrightHeader,
	version,
	year = (new Date()).getFullYear(),

	ROOT_DIR = __dirname,
	SRC_DIR = ROOT_DIR,
	DIST_DIR = path.join(ROOT_DIR,"dist"),

	CORE_SRC = path.join(SRC_DIR,"index.js"),
	CORE_DIST = path.join(DIST_DIR,"rq.js"),

	result = ""
;

console.log("*** Building Core ***");
console.log(`Building: ${CORE_DIST}`);

(async function main(){
	try {
		// try to make the dist directory, if needed
		try {
			fs.mkdirSync(DIST_DIR,0o755);
		}
		catch (err) { }

		result += fs.readFileSync(CORE_SRC,{ encoding: "utf8" });

		result = await terser.minify(result,{
			mangle: {
				keep_fnames: true,
			},
			compress: {
				keep_fnames: true,
			},
			output: {
				comments: /^!/,
			},
		});
		if (!(result && result.code)) {
			if (result.error) throw result.error;
			else throw result;
		}

		// read version number from package.json
		packageJSON = JSON.parse(
			fs.readFileSync(
				path.join(ROOT_DIR,"package.json"),
				{ encoding: "utf8" }
			)
		);
		version = packageJSON.version;

		// read copyright-header text, render with version and year
		copyrightHeader = fs.readFileSync(
			path.join(SRC_DIR,"copyright-header.txt"),
			{ encoding: "utf8" }
		).replace(/`/g,"");
		copyrightHeader = Function("version","year",`return \`${copyrightHeader}\`;`)( version, year );

		// append copyright-header text
		result = `${copyrightHeader}${result.code}`;

		// write dist
		fs.writeFileSync( CORE_DIST, result, { encoding: "utf8" } );

		console.log("Complete.");
	}
	catch (err) {
		console.error(err);
		process.exit(1);
	}
})();
