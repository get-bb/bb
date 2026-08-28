import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { availableParallelism } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} from "node:worker_threads";
import { rollup } from "rollup";
import { dts } from "rollup-plugin-dts";
import { z } from "zod";

import { normalizeBundledDts } from "./normalize-bundled-dts.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, "..");
const pkgsDir = path.resolve(pkgRoot, "..");
const STUBBED_MODULES = new Map([
  [
    path.join(pkgsDir, "server-contract/src/public-api.ts"),
    path.join(here, "public-api-stub.d.ts"),
  ],
  [
    path.join(pkgsDir, "server-contract/src/api-client.ts"),
    path.join(here, "api-client-stub.d.ts"),
  ],
]);
const outDir = path.join(pkgRoot, "bundled-types");
const outputs = {
  "bb-plugin-sdk.d.ts": path.join(pkgRoot, "src/index.ts"),
  "bb-plugin-sdk-app.d.ts": path.join(pkgRoot, "src/app.ts"),
  "bb-plugin-sdk-provider-bridge.d.ts": path.join(
    pkgRoot,
    "src/provider-bridge.ts",
  ),
  "bb-plugin-sdk-ai-services.d.ts": path.join(pkgRoot, "src/ai-services.ts"),
  "bb-plugin-sdk-provider-bridge-testing.d.ts": path.join(
    pkgRoot,
    "src/provider-bridge-testing.ts",
  ),
  "bb-plugin-sdk-provider-bridge-acp.d.ts": path.join(
    pkgRoot,
    "src/provider-bridge-acp.ts",
  ),
  "bb-plugin-sdk-host.d.ts": path.join(pkgRoot, "src/host.ts"),
  "bb-plugin-sdk-internal-composer-customization-validation.d.ts": path.join(
    pkgRoot,
    "src/internal/composer-customization-validation.ts",
  ),
  "bb-plugin-sdk-internal-composer-view.d.ts": path.join(
    pkgRoot,
    "src/internal/composer-view.ts",
  ),
  "bb-plugin-sdk-internal-file-navigation-validation.d.ts": path.join(
    pkgRoot,
    "src/internal/file-navigation-validation.ts",
  ),
  "bb-plugin-sdk-internal-host-policy.d.ts": path.join(
    pkgRoot,
    "src/internal/host-policy.ts",
  ),
  "bb-plugin-sdk-internal-plugin-app-collector.d.ts": path.join(
    pkgRoot,
    "src/internal/plugin-app-collector.ts",
  ),
  "bb-plugin-sdk-testing.d.ts": path.join(pkgRoot, "src/testing/index.ts"),
  "bb-plugin-sdk-testing-app.d.ts": path.join(pkgRoot, "src/testing/app.tsx"),
  "bb-plugin-sdk-testing-host.d.ts": path.join(pkgRoot, "src/testing/host.ts"),
};

const EXTERNAL = [
  /^@get-bb\/plugin-sdk$/,
  /^node:/,
  /^@testing-library\/react($|\/)/,
  /^better-sqlite3/,
  /^hono($|\/)/,
  /^react($|\/|-)/,
  /^react-dom($|\/)/,
  /^zod($|\/)/,
];

const packageExportSchema = z.union([
  z.string().transform((source) => ({ source })),
  z.object({ source: z.string() }).passthrough(),
]);

const packageManifestSchema = z.object({
  exports: z.record(z.string(), packageExportSchema),
});

function resolveBbSource(id) {
  const match = /^@bb\/([^/]+)(\/.*)?$/.exec(id);
  if (!match) return null;
  const pkgDir = path.join(pkgsDir, match[1]);
  const manifestPath = path.join(pkgDir, "package.json");
  if (!existsSync(manifestPath)) return null;
  const { exports } = packageManifestSchema.parse(
    JSON.parse(readFileSync(manifestPath, "utf8")),
  );
  const key = match[2] ? "." + match[2] : ".";
  const entry = exports?.[key];
  return entry === undefined ? null : path.join(pkgDir, entry.source);
}

const inlineWorkspace = {
  name: "inline-bb-workspace",
  resolveId(id, importer) {
    if (importer) {
      const asTs = path.resolve(
        path.dirname(importer),
        id.replace(/\.js$/, ".ts"),
      );
      const stub = STUBBED_MODULES.get(asTs);
      if (stub) return stub;
    }
    const stub = STUBBED_MODULES.get(id);
    if (stub) return stub;
    return resolveBbSource(id);
  },
};

async function bundle(input) {
  const build = await rollup({
    input,
    external: EXTERNAL,
    plugins: [inlineWorkspace, dts({ respectExternal: false })],
    onwarn(warning) {
      if (warning.code === "CIRCULAR_DEPENDENCY") return;
      console.warn(`[build-bundled-dts] ${warning.code}: ${warning.message}`);
    },
  });
  const { output } = await build.generate({ format: "es" });
  await build.close();
  return output[0].code;
}

const HEADER = [
  "// Portable type declarations for `@get-bb/plugin-sdk`. Unpublished BB",
  "// workspace contracts are flattened; public subpaths may reuse the",
  "// package root without requiring any other @bb/* package.",
  "//",
  "// Confused by the API, or need a symbol that isn't here? Clone the BB repo",
  "// and read the real source: https://github.com/get-bb/bb",
].join("\n");

function generateBundle(entry) {
  return bundle(entry).then((code) =>
    normalizeBundledDts(`${HEADER}\n\n${code}`),
  );
}

if (!isMainThread) {
  parentPort.postMessage(await generateBundle(workerData.entry));
} else {
  await main();
}

async function main() {
  const generated = {};
  const queue = Object.entries(outputs);
  const workers = Math.min(queue.length, availableParallelism());
  await Promise.all(
    Array.from({ length: workers }, async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        const [fileName, entry] = next;
        generated[fileName] = await generateInWorker(entry);
      }
    }),
  );
  writeOutputs(
    Object.fromEntries(
      Object.keys(outputs).map((fileName) => [fileName, generated[fileName]]),
    ),
  );
}

function generateInWorker(entry) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), {
      workerData: { entry },
    });
    worker.once("message", resolve);
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code !== 0) reject(new Error(`bundle worker exited with ${code}`));
    });
  });
}

function writeOutputs(generated) {
  mkdirSync(outDir, { recursive: true });

  for (const [fileName, content] of Object.entries(generated)) {
    const target = path.join(outDir, fileName);
    const current = existsSync(target) ? readFileSync(target, "utf8") : null;
    if (current === content) {
      console.log(`Unchanged ${path.relative(pkgRoot, target)}`);
    } else {
      writeAtomically(target, content);
      console.log(`Wrote ${path.relative(pkgRoot, target)}`);
    }
  }
}

function writeAtomically(target, content) {
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, content);
    renameSync(temporary, target);
  } finally {
    rmSync(temporary, { force: true });
  }
}
