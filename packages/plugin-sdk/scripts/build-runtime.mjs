import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const entries = [
  { source: "src/index.ts", output: "dist/index.js", external: [] },
  { source: "src/app.ts", output: "dist/app.js", external: [] },
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
    source: "src/internal/host-policy.ts",
    output: "dist/internal/host-policy.js",
    external: ["zod", "zod/*"],
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
];

await rm(path.join(packageRoot, "dist"), { force: true, recursive: true });

for (const entry of entries) {
  await build({
    bundle: true,
    conditions: ["source"],
    entryPoints: [path.join(packageRoot, entry.source)],
    external: entry.external,
    format: "esm",
    legalComments: "none",
    outfile: path.join(packageRoot, entry.output),
    platform: "node",
    target: "node20",
  });
}

process.stdout.write(
  `Built ${entries.length} @get-bb/plugin-sdk runtime entries.\n`,
);
