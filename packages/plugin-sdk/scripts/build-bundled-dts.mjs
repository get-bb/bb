// Generates the self-contained `.d.ts` bundles that `bb plugin new` ships into
// a scaffolded plugin's `types/` directory, so authors get real BbPluginApi /
// @bb/plugin-sdk/app types WITHOUT the (unpublished) @bb/* workspace packages
// on disk.
//
// rollup-plugin-dts flattens @bb/plugin-sdk's own contracts plus every @bb/*
// type it references (BbSdk, PromptInput, ThreadResponse, …) into one file,
// keeping only genuine npm packages (react, better-sqlite3, hono, zod) as
// external imports — those resolve from the scaffold's own devDependencies.
//
// The output is committed as bundled-types/*.d.ts (read at scaffold time by
// @bb/templates via file path — no package edge, to avoid a dependency cycle).
// Run with --check to fail (in CI/typecheck) when the committed copy is stale.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rollup } from "rollup";
import { dts } from "rollup-plugin-dts";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, "..");
const pkgsDir = path.resolve(pkgRoot, "..");
const publicApiModule = path.join(
  pkgsDir,
  "server-contract/src/public-api.ts",
);
const publicApiStub = path.join(here, "public-api-stub.d.ts");
const outDir = path.join(pkgRoot, "bundled-types");
const outputs = {
  "bb-plugin-sdk.d.ts": path.join(pkgRoot, "src/index.ts"),
  "bb-plugin-sdk-app.d.ts": path.join(pkgRoot, "src/app.ts"),
};

// Real npm packages the bundle imports from — kept external so they resolve
// from the scaffold's devDependencies rather than being inlined.
const EXTERNAL = [/^better-sqlite3/, /^hono($|\/)/, /^zod($|\/)/, /^react($|\/|-)/];

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
    // Redirect server-contract's non-portable route table to the loose stub,
    // whether imported by bare specifier or by its own barrel's relative path.
    if (importer) {
      const asTs = path.resolve(
        path.dirname(importer),
        id.replace(/\.js$/, ".ts"),
      );
      if (asTs === publicApiModule) return publicApiStub;
    }
    if (id === publicApiModule) return publicApiStub;
    return resolveBbSource(id);
  },
};

async function bundle(input) {
  const build = await rollup({
    input,
    external: EXTERNAL,
    plugins: [inlineWorkspace, dts({ respectExternal: false })],
    onwarn(warning) {
      // Circular type references are fine in .d.ts output; surface everything
      // else so a genuinely broken bundle is visible.
      if (warning.code === "CIRCULAR_DEPENDENCY") return;
      console.warn(`[build-bundled-dts] ${warning.code}: ${warning.message}`);
    },
  });
  const { output } = await build.generate({ format: "es" });
  await build.close();
  return output[0].code;
}

const HEADER = [
  "// Bundled type declarations for `@bb/plugin-sdk`, shipped into scaffolded",
  "// plugins so they typecheck without the @bb/* workspace on disk.",
  "//",
  "// Confused by the API, or need a symbol that isn't here? Clone the BB repo",
  "// and read the real source: https://github.com/ymichael/bb",
].join("\n");

const generated = {};
for (const [fileName, entry] of Object.entries(outputs)) {
  generated[fileName] = `${HEADER}\n\n${await bundle(entry)}`;
}

/**
 * rollup-plugin-dts loads modules concurrently, so the emission order of
 * inferred type members (zod enum maps especially) varies run to run while
 * the content stays semantically identical. Compare (and skip rewrites) on
 * the sorted line multiset: real drift adds/removes/changes lines and is
 * still caught, but a pure reordering neither fails --check nor churns the
 * committed bytes.
 */
function canonicalize(content) {
  return content.split("\n").sort().join("\n");
}

const check = process.argv.includes("--check");
let stale = false;
if (!check) mkdirSync(outDir, { recursive: true });

for (const [fileName, content] of Object.entries(generated)) {
  const target = path.join(outDir, fileName);
  const current = existsSync(target) ? readFileSync(target, "utf8") : null;
  const unchanged =
    current !== null && canonicalize(current) === canonicalize(content);
  if (check) {
    if (!unchanged) {
      console.error(
        `bundled-types/${fileName} is stale. Run \`pnpm --filter @bb/plugin-sdk build\`.`,
      );
      stale = true;
    }
  } else if (unchanged) {
    console.log(`Unchanged ${path.relative(pkgRoot, target)}`);
  } else {
    writeFileSync(target, content);
    console.log(`Wrote ${path.relative(pkgRoot, target)}`);
  }
}

if (check) {
  if (stale) process.exit(1);
  console.log("bundled-types/*.d.ts are up to date.");
}
