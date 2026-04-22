/**
 * esbuild build script for roo-plugin-example.
 *
 * Using esbuild instead of plain tsc lets us bundle @roo-code/plugin-api
 * (and its dependency `ws`) directly into out/extension.js, so the VS Code
 * extension host can load them without any extra install steps.
 *
 * Usage:
 *   node esbuild.mjs          # single production build
 *   node esbuild.mjs --watch  # incremental rebuild on changes
 */

import * as esbuild from "esbuild"

const isWatch = process.argv.includes("--watch")

const ctx = await esbuild.context({
	entryPoints: ["src/extension.ts"],
	bundle: true,
	outfile: "out/extension.js",
	/**
	 * `vscode` is provided by the VS Code runtime and must NOT be bundled.
	 * Everything else (including ws and @roo-code/plugin-api) is inlined.
	 */
	external: ["vscode"],
	format: "cjs", // VS Code extensions use CommonJS
	platform: "node",
	target: "node18",
	sourcemap: true,
})

if (isWatch) {
	await ctx.watch()
	console.log("[esbuild] watching for changes…")
} else {
	await ctx.rebuild()
	await ctx.dispose()
	console.log("[esbuild] build complete → out/extension.js")
}
