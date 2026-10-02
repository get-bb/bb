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
  loader: { ".ttf": "dataurl" },
};

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

const inputs = Object.keys(editor.metafile.inputs);
const output = await readFile(path.join(outDir, "editor.js"), "utf8");
const languagesModule = await esbuild.build({
  entryPoints: [path.join(pluginRoot, "lib", "languages.ts")],
  bundle: true,
  format: "esm",
  platform: "neutral",
  write: false,
});
const { CLAIMED_EXTENSIONS, languageForPath } = await import(
  `data:text/javascript;base64,${Buffer.from(languagesModule.outputFiles[0].contents).toString("base64")}`
);
const registeredLanguages = new Set(
  [...output.matchAll(/id:"([a-z0-9+#-]+)"/g)].map((match) => match[1]),
);
const unregisteredLanguages = [
  ...new Set(
    CLAIMED_EXTENSIONS.map((extension) => languageForPath(`f.${extension}`)),
  ),
].filter(
  (language) => language !== "plaintext" && !registeredLanguages.has(language),
);
const missing = [
  [
    "language grammars",
    () =>
      inputs.some(
        (i) =>
          i.includes("languages/definitions/") || i.includes("basic-languages"),
      ),
  ],
  [
    "editor contributions",
    () => inputs.some((i) => i.includes("editor/contrib/")),
  ],
  ["find widget", () => output.includes("find-widget")],
  ["folding", () => output.includes("foldRecursively")],
  ["word navigation", () => output.includes("cursorWordLeft")],
  ["line sorting", () => output.includes("sortLinesAscending")],
]
  .filter(([, present]) => !present())
  .map(([name]) => name)
  .concat(unregisteredLanguages.map((language) => `language ${language}`));
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
