// Builds the BB plugin component registry (plugin design §5.5): shadcn
// registry-item JSONs generated from the app's own component source, so the
// registry can never drift from the UI the app actually ships.
//
//   node packages/plugin-registry/scripts/build-registry.mjs [--check]
//
// Inputs:
// - registry.json — the item list (uiItems), npm version pins, and the
//   app-file → plugin-flavor override map.
// - apps/app/src/components/ui/*.tsx — component source, verbatim.
// - src/** here — plugin-flavored overrides (portal-scope, browser-dimming).
//
// Every file in an item's transitive @/-import closure becomes its own
// registry item (named from its basename), referenced via
// registryDependencies — `npx shadcn add @bb/dialog` pulls the closure
// automatically. Bare npm imports become item `dependencies` (react and
// react-dom excluded: the plugin runtime provides them; the shimmed
// radix/sonner/vaul packages are KEPT as dependencies — the build shims them
// at bundle time, but plugin authors need their types to typecheck).
//
// Output: r/<item>.json + r/index.json, checked in; `--check` exits 1 on any
// drift (wired into this package's typecheck/test like @bb/templates).
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.join(scriptDir, "..");
const repoRoot = path.join(packageRoot, "..", "..");
const appSrc = path.join(repoRoot, "apps", "app", "src");
const outDir = path.join(packageRoot, "r");

const config = JSON.parse(
  await readFile(path.join(packageRoot, "registry.json"), "utf8"),
);
const overrides = new Map(Object.entries(config.overrides ?? {}));
const dependencyPins = config.dependencyPins ?? {};

/** apps/app/src-relative path → absolute source path, honoring overrides. */
function sourcePathFor(relPath) {
  const override = overrides.get(relPath);
  if (override) return path.join(packageRoot, override);
  return path.join(appSrc, relPath);
}

/** Resolve an import specifier from `importerRel` to an app-src-relative path. */
function resolveLocal(specifier, importerRel) {
  let base;
  if (specifier.startsWith("@/")) {
    base = specifier.slice(2);
  } else if (specifier.startsWith(".")) {
    base = path.normalize(
      path.join(path.dirname(importerRel), specifier),
    );
  } else {
    return null;
  }
  base = base.replace(/\.js$/, "");
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    base,
    `${base}/index.ts`,
    `${base}/index.tsx`,
  ]) {
    if (existsSync(path.join(appSrc, candidate)) || overrides.has(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    `cannot resolve import "${specifier}" from ${importerRel} — registry items must stay within apps/app/src`,
  );
}

function importSpecifiersOf(content) {
  const specs = [];
  const re = /(?:^|\n)\s*(?:import|export)[^;]*?from\s+["']([^"']+)["']|(?:^|\n)\s*import\s+["']([^"']+)["']/g;
  let match;
  while ((match = re.exec(content)) !== null) {
    specs.push(match[1] ?? match[2]);
  }
  return specs;
}

/** npm package name of a bare specifier ("@scope/pkg/sub" → "@scope/pkg"). */
function npmPackageOf(specifier) {
  const parts = specifier.split("/");
  return specifier.startsWith("@")
    ? parts.slice(0, 2).join("/")
    : parts[0];
}

/** react/react-dom come from the plugin runtime; never item dependencies. */
const RUNTIME_PROVIDED = new Set(["react", "react-dom"]);

/** Item name from an app-src-relative file path. */
function itemNameFor(relPath) {
  const base = path.basename(relPath).replace(/\.(tsx?|jsx?)$/, "");
  // camelCase hooks (useBrowserDimmingModal) → kebab-case item names.
  return base
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase();
}

/** shadcn item type + install target for an app-src-relative path. */
function classify(relPath) {
  const base = path.basename(relPath);
  if (relPath.startsWith("components/ui/hooks/")) {
    return { type: "registry:hook", target: `components/ui/hooks/${base}` };
  }
  if (relPath.startsWith("components/ui/")) {
    return { type: "registry:ui", target: `components/ui/${base}` };
  }
  if (relPath.startsWith("lib/")) {
    return { type: "registry:lib", target: `lib/${base}` };
  }
  if (relPath.startsWith("hooks/")) {
    return { type: "registry:hook", target: `hooks/${base}` };
  }
  throw new Error(`no registry mapping for ${relPath}`);
}

// ---------------------------------------------------------------------------
// Walk every uiItem's closure; each discovered file becomes an item.
// ---------------------------------------------------------------------------
const fileByItem = new Map(); // itemName → relPath
const queue = [];
for (const name of config.uiItems) {
  const relPath = `components/ui/${name}.tsx`;
  if (!existsSync(sourcePathFor(relPath))) {
    throw new Error(`uiItem "${name}" has no source at apps/app/src/${relPath}`);
  }
  queue.push(relPath);
}
const seen = new Set();
const itemMeta = new Map(); // relPath → { dependencies:Set, registryDependencies:Set, content }
while (queue.length > 0) {
  const relPath = queue.pop();
  if (seen.has(relPath)) continue;
  seen.add(relPath);
  const itemName = itemNameFor(relPath);
  const existing = fileByItem.get(itemName);
  if (existing && existing !== relPath) {
    throw new Error(
      `item name collision: "${itemName}" from both ${existing} and ${relPath}`,
    );
  }
  fileByItem.set(itemName, relPath);

  const content = await readFile(sourcePathFor(relPath), "utf8");
  const dependencies = new Set();
  const registryDependencies = new Set();
  for (const spec of importSpecifiersOf(content)) {
    const local = resolveLocal(spec, relPath);
    if (local === null) {
      const pkg = npmPackageOf(spec);
      if (!RUNTIME_PROVIDED.has(pkg)) dependencies.add(pkg);
      continue;
    }
    if (local !== relPath) {
      registryDependencies.add(itemNameFor(local));
      queue.push(local);
    }
  }
  itemMeta.set(relPath, { content, dependencies, registryDependencies });
}

// ---------------------------------------------------------------------------
// Emit r/<item>.json + r/index.json.
// ---------------------------------------------------------------------------
function pinned(pkg) {
  const pin = dependencyPins[pkg];
  return pin ? `${pkg}@${pin}` : pkg;
}

const generatedFiles = new Map(); // filename → content string
const indexEntries = [];
for (const [itemName, relPath] of [...fileByItem.entries()].sort()) {
  const { content, dependencies, registryDependencies } =
    itemMeta.get(relPath);
  const { type, target } = classify(relPath);
  const item = {
    $schema: "https://ui.shadcn.com/schema/registry-item.json",
    name: itemName,
    type,
    title: itemName,
    description: `BB ${type.replace("registry:", "")} "${itemName}" — vendored from the BB app's own source (version-matched to this BB release).`,
    ...(dependencies.size > 0
      ? { dependencies: [...dependencies].sort().map(pinned) }
      : {}),
    ...(registryDependencies.size > 0
      ? {
          // Namespaced: the shadcn CLI resolves UNPREFIXED registryDependencies
          // against the default ui.shadcn.com registry, not the originating
          // one — cross-item references must carry @bb/ explicitly.
          registryDependencies: [...registryDependencies]
            .sort()
            .map((name) => `@bb/${name}`),
        }
      : {}),
    files: [
      {
        path: `registry/${target}`,
        content,
        type,
        target,
      },
    ],
  };
  generatedFiles.set(`${itemName}.json`, JSON.stringify(item, null, 2) + "\n");
  indexEntries.push({ name: itemName, type });
}
generatedFiles.set(
  "index.json",
  JSON.stringify(
    {
      $comment:
        "BB plugin component registry index. Install via: npx shadcn add @bb/<name> (see the bb-plugin-authoring skill).",
      items: indexEntries.sort((a, b) => a.name.localeCompare(b.name)),
    },
    null,
    2,
  ) + "\n",
);

const check = process.argv.includes("--check");
const existingNames = existsSync(outDir) ? await readdir(outDir) : [];
let stale = false;
const staleReasons = [];
for (const name of existingNames) {
  if (!generatedFiles.has(name)) {
    stale = true;
    staleReasons.push(`extra file r/${name}`);
  }
}
for (const [name, content] of generatedFiles) {
  const existingPath = path.join(outDir, name);
  const existing = existsSync(existingPath)
    ? await readFile(existingPath, "utf8")
    : null;
  if (existing !== content) {
    stale = true;
    staleReasons.push(existing === null ? `missing r/${name}` : `changed r/${name}`);
  }
}

if (check) {
  if (stale) {
    console.error(
      `plugin registry is stale (${staleReasons.slice(0, 5).join(", ")}${staleReasons.length > 5 ? ", …" : ""}). Run: node packages/plugin-registry/scripts/build-registry.mjs`,
    );
    process.exit(1);
  }
  console.log(`plugin registry up to date (${fileByItem.size} items)`);
} else if (stale) {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  for (const [name, content] of generatedFiles) {
    await writeFile(path.join(outDir, name), content);
  }
  console.log(`wrote ${generatedFiles.size} files to r/ (${fileByItem.size} items)`);
} else {
  console.log(`plugin registry up to date (${fileByItem.size} items)`);
}
