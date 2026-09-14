import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { promoteRuntimeEntries } from "./promote-runtime-entries.mjs";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

// A node program bundled from CommonJS dependencies (the bootstrap pulls
// cross-spawn through @bb/process-utils) needs `require` in ESM scope; the
// daemon's bundles carry the same banner (apps/host-daemon/scripts/bundle-manifest.mjs).
const NODE_ESM_REQUIRE_BANNER = [
  'import { createRequire as __createRequire } from "node:module";',
  'import { dirname as __pathDirname } from "node:path";',
  'import { fileURLToPath as __fileURLToPath } from "node:url";',
  "const require = __createRequire(import.meta.url);",
  "const __filename = __fileURLToPath(import.meta.url);",
  "const __dirname = __pathDirname(__filename);",
].join("\n");

const ZOD_EXTERNALS = ["zod", "zod/*"];

const EXTERNALS = {
  "./provider-bridge": ZOD_EXTERNALS,
  "./ai-services": ZOD_EXTERNALS,
  "./provider-bridge/testing": ZOD_EXTERNALS,
  "./provider-bridge/acp": ZOD_EXTERNALS,
  "./environment-provider": ZOD_EXTERNALS,
  "./machine-provider": ZOD_EXTERNALS,
  "./internal/host-policy": ZOD_EXTERNALS,
  "./testing": [
    "better-sqlite3",
    "cron-parser",
    "hono",
    "hono/*",
    "zod",
    "zod/*",
  ],
  "./testing/app": [
    "@testing-library/react",
    "@testing-library/react/*",
    "react",
    "react/*",
    "react-dom",
    "react-dom/*",
  ],
};

const { exports: packageExports } = JSON.parse(
  await readFile(path.join(packageRoot, "package.json"), "utf8"),
);

const entries = [
  ...Object.entries(packageExports).map(([subpath, entry]) => ({
    source: entry.source.slice(2),
    output: entry.import.slice(2),
    external: EXTERNALS[subpath] ?? [],
  })),
  // The replay harness spawns two programs beside its own bundle: the
  // provider-bridge bootstrap that runs a bridge module the way the runtime
  // does, and the replay child a bridge spawns in place of its provider.
  // Both are resolved relative to `import.meta.url` of the testing bundle
  // (`packages/provider-bridge-protocol/src/testing/parity.ts`), so they must
  // land next to it under the names it expects.
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

const stagingDir = await mkdtemp(path.join(packageRoot, ".runtime-build-"));
try {
  for (const entry of entries) {
    if (entry.copy !== undefined) {
      const destination = path.join(
        stagingDir,
        path.relative("dist", entry.output),
      );
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(path.join(packageRoot, entry.copy), destination);
      continue;
    }
    await build({
      ...(entry.banner === undefined ? {} : { banner: { js: entry.banner } }),
      bundle: true,
      conditions: ["source"],
      entryPoints: [path.join(packageRoot, entry.source)],
      external: entry.external,
      format: "esm",
      legalComments: "none",
      outfile: path.join(stagingDir, path.relative("dist", entry.output)),
      platform: "node",
      target: "node20",
    });
  }
  await promoteRuntimeEntries({
    distDir: path.join(packageRoot, "dist"),
    stagingDir,
    relativeOutputs: entries.map((entry) =>
      path.relative("dist", entry.output),
    ),
  });
} finally {
  await rm(stagingDir, { force: true, recursive: true });
}

process.stdout.write(
  `Built ${entries.length} @get-bb/plugin-sdk runtime entries.\n`,
);
