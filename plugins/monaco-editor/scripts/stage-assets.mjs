/**
 * Builds the Monaco bundle this plugin serves, into `dist/monaco`.
 *
 * Monaco cannot go through `bb plugin build` with everything else: that
 * config emits one file with no code splitting, so Monaco would parse at app
 * boot for every user — including everyone who never opens a file — and its
 * worker could not be emitted at all. Building it here instead keeps it
 * lazy: `lib/monaco-loader.ts` imports these files from a
 * `files.createPreview` URL the first time a file tab opens.
 *
 * Building rather than copying Monaco's prebuilt AMD bundle is what keeps
 * this small. esbuild proves which modules are reachable from the entry, so
 * the language services this plugin does not use are dropped by construction
 * — 3.3 MB against 24 MB for the AMD tree — with no risk that something we
 * pruned is requested later at runtime.
 *
 * Packaging ships only a builtin's `dist/` and `skills/`
 * (`apps/server/scripts/copy-builtin-plugins.ts`, which runs this), so
 * `dist/` is the only place these files can live.
 */
import { mkdir, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const require = createRequire(path.join(pluginRoot, "package.json"));
const esbuild = require("esbuild");

const outDir = path.join(pluginRoot, "dist", "monaco");
await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const shared = {
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  legalComments: "none",
  absWorkingDir: pluginRoot,
  // Monaco's contributions style their icons with a webfont. Inlining it
  // keeps the served bundle to the three files the loader knows how to
  // fetch, rather than adding an asset whose URL would have to resolve
  // relative to the preview lease.
  loader: { ".ttf": "dataurl" },
};

// Two entries, not one: the worker runs in its own global scope and must be
// a separate file for `new Worker(url)`.
const editor = await esbuild.build({
  ...shared,
  entryPoints: [path.join(pluginRoot, "monaco-bundle", "editor.js")],
  outfile: path.join(outDir, "editor.js"),
  metafile: true,
});
await esbuild.build({
  ...shared,
  entryPoints: [path.join(pluginRoot, "monaco-bundle", "worker.js")],
  outfile: path.join(outDir, "editor.worker.js"),
});

// A bundle can be missing whole features and still load, still open a file,
// and still let you type — which is how an earlier entry shipped without the
// find widget or word navigation, and how a wrong entry could ship without
// grammars and render every file as plain text. Fail the build instead of
// discovering it by hand.
const inputs = Object.keys(editor.metafile.inputs);
const output = await readFile(path.join(outDir, "editor.js"), "utf8");
const missing = [
  ["language grammars", () => inputs.some((i) => i.includes("languages/definitions/") || i.includes("basic-languages"))],
  ["editor contributions", () => inputs.some((i) => i.includes("editor/contrib/"))],
  ["find widget", () => output.includes("find-widget")],
  ["folding", () => output.includes("foldRecursively")],
  ["word navigation", () => output.includes("cursorWordLeft")],
  ["line sorting", () => output.includes("sortLinesAscending")],
]
  .filter(([, present]) => !present())
  .map(([name]) => name);
if (missing.length > 0) {
  throw new Error(
    `the Monaco bundle is missing: ${missing.join(", ")} — check monaco-bundle/editor.js`,
  );
}

const total = Object.values(editor.metafile.outputs).reduce(
  (bytes, output) => bytes + output.bytes,
  0,
);
console.log(
  `monaco: built ${outDir} (${(total / 1024 / 1024).toFixed(2)} MB editor + worker)`,
);
