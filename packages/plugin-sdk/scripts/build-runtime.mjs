import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { promoteRuntimeEntries } from "./promote-runtime-entries.mjs";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const entries = [
  { source: "src/index.ts", output: "dist/index.js", external: [] },
  { source: "src/app.ts", output: "dist/app.js", external: [] },
  // Real code, not a stub: the provider-bridge surface is schemas and pure
  // helpers, so the published bundle carries them. zod stays external (peer
  // dependency).
  {
    source: "src/provider-bridge.ts",
    output: "dist/provider-bridge.js",
    external: ["zod", "zod/*"],
  },
  // The testing kit: conformance scenarios, the real delta assembler, the
  // JSON-RPC harness and the calibration normalizer. Framework-agnostic, so
  // only zod stays external.
  {
    source: "src/provider-bridge-testing.ts",
    output: "dist/provider-bridge-testing.js",
    external: ["zod", "zod/*"],
  },
  { source: "src/host.ts", output: "dist/host.js", external: [] },
  {
    source: "src/internal/composer-customization-validation.ts",
    output: "dist/internal/composer-customization-validation.js",
    external: [],
  },
  {
    source: "src/internal/composer-view.ts",
    output: "dist/internal/composer-view.js",
    external: [],
  },
  {
    source: "src/internal/file-navigation-validation.ts",
    output: "dist/internal/file-navigation-validation.js",
    external: [],
  },
  {
    source: "src/internal/host-policy.ts",
    output: "dist/internal/host-policy.js",
    external: ["zod", "zod/*"],
  },
  {
    source: "src/internal/plugin-app-collector.ts",
    output: "dist/internal/plugin-app-collector.js",
    external: [],
  },
  {
    source: "src/testing/index.ts",
    output: "dist/testing/index.js",
    external: [
      "better-sqlite3",
      "cron-parser",
      "hono",
      "hono/*",
      "zod",
      "zod/*",
    ],
  },
  {
    source: "src/testing/app.tsx",
    output: "dist/testing/app.js",
    external: [
      "@testing-library/react",
      "@testing-library/react/*",
      "react",
      "react/*",
      "react-dom",
      "react-dom/*",
    ],
  },
  {
    source: "src/testing/host.ts",
    output: "dist/testing/host.js",
    external: [],
  },
];

const stagingDir = await mkdtemp(path.join(packageRoot, ".runtime-build-"));
try {
  for (const entry of entries) {
    await build({
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
