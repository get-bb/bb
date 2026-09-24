const PLUGIN_SDK_PACKAGE = "@get-bb/plugin-sdk";
const SHARED_UI_PACKAGE = "@bb/shared-ui";
const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];
const REGISTRY_ALIAS_PREFIX = "@/";
const MODULE_SPECIFIER =
  /\b(?:from|import)\s*\(?\s*["']([^"']+)["']|\bvi\.(?:mock|doMock|importActual)\(\s*["']([^"']+)["']/gu;

function isWorkspaceSpecifier(specifier) {
  return typeof specifier === "string" && specifier.startsWith("workspace:");
}

function withoutExtension(path) {
  return path.replace(/\.(?:tsx?|jsx?)$/u, "");
}

export function registryAliasImports(source) {
  const specifiers = new Set();
  for (const match of source.matchAll(MODULE_SPECIFIER)) {
    const specifier = match[1] ?? match[2];
    if (specifier?.startsWith(REGISTRY_ALIAS_PREFIX)) specifiers.add(specifier);
  }
  return specifiers;
}

export function registryItemsForImports(specifiers, registryItems) {
  const itemByTarget = new Map();
  const itemByName = new Map();
  for (const item of registryItems) {
    itemByName.set(item.name, item);
    for (const file of item.files) {
      itemByTarget.set(withoutExtension(file.target), item);
    }
  }
  const queue = [];
  for (const specifier of specifiers) {
    const item = itemByTarget.get(
      withoutExtension(specifier.slice(REGISTRY_ALIAS_PREFIX.length)),
    );
    if (item === undefined) {
      throw new Error(
        `${specifier} is not a file of any component registry item`,
      );
    }
    queue.push(item);
  }
  const closure = new Map();
  while (queue.length > 0) {
    const item = queue.pop();
    if (closure.has(item.name)) continue;
    closure.set(item.name, item);
    for (const dependency of item.registryDependencies ?? []) {
      const name = dependency.replace(/^@bb\//u, "");
      const dependencyItem = itemByName.get(name);
      if (dependencyItem === undefined) {
        throw new Error(
          `registry item ${item.name} needs unknown ${dependency}`,
        );
      }
      queue.push(dependencyItem);
    }
  }
  return [...closure.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function registryPackages(items, { shimmedPackages, versions }) {
  const packages = { dependencies: {}, devDependencies: {} };
  for (const name of new Set(
    items.flatMap((item) => item.dependencies ?? []),
  )) {
    const version = versions[name];
    if (version === undefined) {
      throw new Error(`no version known for registry dependency ${name}`);
    }
    const field = shimmedPackages.has(name)
      ? "devDependencies"
      : "dependencies";
    packages[field][name] = version;
  }
  return packages;
}

export function forkPluginPackageJson(
  manifest,
  { sdkSpecifier, workspaceBinsByPackage, registryDependencies },
) {
  const forked = structuredClone(manifest);
  const droppedDevDependencies = [];
  for (const field of DEPENDENCY_FIELDS) {
    const dependencies = forked[field];
    if (dependencies === undefined) continue;
    for (const [name, specifier] of Object.entries(dependencies)) {
      if (!isWorkspaceSpecifier(specifier)) continue;
      if (name === PLUGIN_SDK_PACKAGE) {
        dependencies[name] = sdkSpecifier;
        continue;
      }
      if (name === SHARED_UI_PACKAGE) {
        delete dependencies[name];
        continue;
      }
      if (field !== "devDependencies") {
        throw new Error(
          `${field}.${name} is a workspace package, which a copy of the plugin cannot install`,
        );
      }
      delete dependencies[name];
      droppedDevDependencies.push(name);
    }
  }

  for (const field of ["dependencies", "devDependencies"]) {
    const additions = registryDependencies[field];
    if (Object.keys(additions).length === 0) continue;
    const merged = { ...forked[field] };
    for (const [name, version] of Object.entries(additions)) {
      if (
        forked.dependencies?.[name] === undefined &&
        forked.devDependencies?.[name] === undefined
      ) {
        merged[name] = version;
      }
    }
    forked[field] = Object.fromEntries(
      Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)),
    );
  }

  const droppedBins = new Set(
    droppedDevDependencies.flatMap(
      (name) => workspaceBinsByPackage.get(name) ?? [],
    ),
  );
  const droppedScripts = [];
  for (const [name, command] of Object.entries(forked.scripts ?? {})) {
    const [executable] = command.trim().split(/\s+/u);
    if (droppedBins.has(executable)) {
      delete forked.scripts[name];
      droppedScripts.push(name);
    }
  }

  return { manifest: forked, droppedDevDependencies, droppedScripts };
}

export function forkPluginTsconfig(tsconfig) {
  const forked = structuredClone(tsconfig);
  forked.compilerOptions = {
    ...forked.compilerOptions,
    paths: { "@/*": ["./*"] },
  };
  return forked;
}
