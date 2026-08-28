import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { promoteRuntimeEntries } from "./promote-runtime-entries.mjs";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const NODE_ESM_REQUIRE_BANNER = [
  'import { createRequire as __createRequire } from "node:module";',
  'import { dirname as __pathDirname } from "node:path";',
  'import { fileURLToPath as __fileURLToPath } from "node:url";',
  "const require = __createRequire(import.meta.url);",
  "const __filename = __fileURLToPath(import.meta.url);",
  "const __dirname = __pathDirname(__filename);",
].join("\n");

const entries = [
  { source: "src/index.ts", output: "dist/index.js", external: [] },
  { source: "src/app.ts", output: "dist/app.js", external: [] },
  {
    source: "src/provider-bridge.ts",
    output: "dist/provider-bridge.js",
    external: ["zod", "zod/*"],
  },
  {
    source: "src/ai-services.ts",
    output: "dist/ai-services.js",
    external: ["zod", "zod/*"],
  },
  {
    source: "src/provider-bridge-testing.ts",
    output: "dist/provider-bridge-testing.js",
    external: ["zod", "zod/*"],
  },
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
  {
    source: "src/provider-bridge-acp.ts",
    output: "dist/provider-bridge-acp.js",
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
    if (entry.copy !== undefined) {
      const destination = path.join(
        stagingDir,
        path.relative("dist", entry.output),
      );
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(path.join(packageRoot, entry.copy), destination);
      continue;
    }
    const buildOptions = {
      bundle: true,
      conditions: ["source"],
      entryPoints: [path.join(packageRoot, entry.source)],
      external: entry.external,
      format: "esm",
      legalComments: "none",
      outfile: path.join(stagingDir, path.relative("dist", entry.output)),
      platform: "node",
      target: "node20",
    };
    if (entry.banner !== undefined) {
      await build({ ...buildOptions, banner: { js: entry.banner } });
    } else {
      await build(buildOptions);
    }
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
