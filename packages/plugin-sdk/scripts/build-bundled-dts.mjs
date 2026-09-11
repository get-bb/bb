// Generates the self-contained `.d.ts` bundles that `bb plugin new` ships into
// a scaffolded plugin's `types/` directory, so authors get real BbPluginApi /
// @get-bb/plugin-sdk/app types WITHOUT the (unpublished) @bb/* workspace packages
// on disk.
//
// rollup-plugin-dts flattens @get-bb/plugin-sdk's own contracts plus every @bb/*
// type it references (BbSdk, PromptInput, ThreadResponse, …) into the root
// file. Testing subpaths reuse that already-portable root declaration through
// the package's own public name instead of flattening the same contracts a
// second time. Genuine npm packages remain external imports and resolve from
// the consumer's own dependencies.
//
// The output, bundled-types/*.d.ts, is NOT committed. It is the package's
// published `types` surface and a build output of the turbo task
// `@get-bb/plugin-sdk#build:types`; @bb/templates reads it at scaffold-embed
// time by file path (no package edge, to avoid a dependency cycle), and the
// in-repo plugins typecheck against it. Unchanged files are not rewritten so
// mtimes stay stable for watchers.
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rollup } from "rollup";
import { dts } from "rollup-plugin-dts";
import {
  declarationId,
  sharedDeclarationEmit,
} from "./shared-declaration-emit.mjs";

import { normalizeBundledDts } from "./normalize-bundled-dts.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, "..");
const pkgsDir = path.resolve(pkgRoot, "..");
// Server-contract modules whose real declarations are not portable into a
// flattened .d.ts, each redirected to a loose stub (the stub headers say why).
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
  "bb-plugin-sdk-environment-provider.d.ts": path.join(
    pkgRoot,
    "src/environment-provider.ts",
  ),
  "bb-plugin-sdk-machine-provider.d.ts": path.join(
    pkgRoot,
    "src/machine-provider.ts",
  ),
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

// Real npm packages the bundle imports from — kept external so they resolve
// from the scaffold's devDependencies rather than being inlined.
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

/** Resolve any `@bb/<pkg>[/<sub>]` to its `source` export target on disk. */
function resolveBbSource(id) {
  const match = /^@bb\/([^/]+)(\/.*)?$/.exec(id);
  if (!match) return null;
  const pkgDir = path.join(pkgsDir, match[1]);
  const manifestPath = path.join(pkgDir, "package.json");
  if (!existsSync(manifestPath)) return null;
  const { exports } = JSON.parse(readFileSync(manifestPath, "utf8"));
  const key = match[2] ? "." + match[2] : ".";
  const entry = exports?.[key];
  const source =
    typeof entry === "string"
      ? entry
      : (entry?.source ?? entry?.types ?? entry?.default);
  return source ? path.join(pkgDir, source) : null;
}

const inlineWorkspace = {
  name: "inline-bb-workspace",
  resolveId(id, importer) {
    // Redirect server-contract's non-portable modules to their loose stubs,
    // whether imported by bare specifier or by a sibling's relative path.
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

const emitDeclarations = sharedDeclarationEmit(
  Object.values(outputs),
  pkgsDir,
  inlineWorkspace.resolveId,
);

async function bundle(input) {
  const build = await rollup({
    input: declarationId(input),
    external: EXTERNAL,
    plugins: [emitDeclarations, dts({ respectExternal: false })],
    onwarn(warning) {
      // Circular type references are fine in .d.ts output; surface everything
      // else so a genuinely broken bundle is visible.
      if (warning.code === "CIRCULAR_DEPENDENCY") return;
      console.warn(`[build-bundled-dts] ${warning.code}: ${warning.message}`);
    },
  });
  try {
    const { output } = await build.generate({ format: "es" });
    return output[0].code;
  } finally {
    await build.close();
  }
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

const generated = {};
for (const [name, entry] of Object.entries(outputs)) {
  generated[name] = await generateBundle(entry);
}
writeOutputs(generated);

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

/**
 * Temp sibling + rename, so a concurrent reader (another turbo process, tsc
 * in an editor) never sees a truncated declaration file.
 */
function writeAtomically(target, content) {
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, content);
    renameSync(temporary, target);
  } finally {
    rmSync(temporary, { force: true });
  }
}
