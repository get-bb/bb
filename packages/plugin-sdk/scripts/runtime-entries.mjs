import path from "node:path";

const NODE_ESM_REQUIRE_BANNER = [
  'import { createRequire as __createRequire } from "node:module";',
  'import { dirname as __pathDirname } from "node:path";',
  'import { fileURLToPath as __fileURLToPath } from "node:url";',
  "const require = __createRequire(import.meta.url);",
  "const __filename = __fileURLToPath(import.meta.url);",
  "const __dirname = __pathDirname(__filename);",
].join("\n");

const PACKAGE_EXTERNALS = ["zod", "zod/*", "cross-spawn"];

const EXTRA_EXTERNALS = {
  "./testing": ["better-sqlite3", "cron-parser", "hono", "hono/*"],
  "./testing/app": [
    "@testing-library/react",
    "@testing-library/react/*",
    "react",
    "react/*",
    "react-dom",
    "react-dom/*",
  ],
};

export function runtimeEntries(packageExports) {
  return [
    ...Object.entries(packageExports).map(([subpath, entry]) => ({
      subpath,
      source: entry.source.slice(2),
      output: entry.import.slice(2),
      external: [...PACKAGE_EXTERNALS, ...(EXTRA_EXTERNALS[subpath] ?? [])],
    })),
    {
      source: "../provider-bridge-protocol/src/bridge-worker-entry.ts",
      output: "dist/provider-bridge-worker-entry.mjs",
      external: [],
      banner: NODE_ESM_REQUIRE_BANNER,
    },
    {
      copy: "../provider-bridge-protocol/src/testing/replay-provider-child.mjs",
      output: "dist/replay-provider-child.mjs",
    },
  ];
}

export function runtimeBuildOptions(packageRoot, entry, outfile) {
  return {
    ...(entry.banner === undefined ? {} : { banner: { js: entry.banner } }),
    bundle: true,
    conditions: ["source"],
    entryPoints: [path.join(packageRoot, entry.source)],
    external: entry.external,
    format: "esm",
    legalComments: "none",
    outfile,
    platform: "node",
    target: "node20",
  };
}
