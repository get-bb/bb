// Metro config for the bb mobile app inside the pnpm monorepo.
//
// Workspace packages (`@bb/*`) publish TypeScript source through
// `exports` conditions (`source` → `./src/*.ts`) and use NodeNext-style
// relative specifiers (`./foo.js` for `./foo.ts`). Metro needs:
//   1. package `exports` resolution (on by default in RN ≥ 0.79),
//   2. the `source` condition — applied ONLY to `@bb/*` packages here, because
//      third-party packages built with builder-bob also ship a `source`
//      condition and we do not want Metro compiling their raw sources,
//   3. a `.js` → `.ts(x)` fallback for relative imports inside workspace
//      sources.
const path = require("node:path");
const fs = require("node:fs");
const { getDefaultConfig } = require("expo/metro-config");
const { withNativewind } = require("nativewind/metro");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
config.resolver.unstable_enablePackageExports = true;

const WORKSPACE_SCOPES = ["@bb/", "@get-bb/"];
const TS_EXTENSIONS = [".ts", ".tsx"];
const workspaceSourceRoots = ["packages", "apps", "plugins"].map((dir) =>
  path.join(workspaceRoot, dir),
);

function isWorkspaceSource(filePath) {
  return workspaceSourceRoots.some(
    (root) =>
      filePath.startsWith(root + path.sep) &&
      !filePath.includes(`${path.sep}node_modules${path.sep}`),
  );
}

function fileWithTsExtension(base) {
  for (const ext of TS_EXTENSIONS) {
    if (fs.existsSync(base + ext)) return base + ext;
  }
  for (const ext of TS_EXTENSIONS) {
    const indexPath = path.join(base, `index${ext}`);
    if (fs.existsSync(indexPath)) return indexPath;
  }
  return null;
}

/** Split `@scope/name/sub/path` into package name and `./sub/path` subpath. */
function splitScopedSpecifier(moduleName) {
  const parts = moduleName.split("/");
  const packageName = parts.slice(0, 2).join("/");
  const subpath = parts.length > 2 ? "./" + parts.slice(2).join("/") : ".";
  return { packageName, subpath };
}

const workspacePackageDirCache = new Map();
function findWorkspacePackageDir(packageName) {
  if (workspacePackageDirCache.has(packageName)) {
    return workspacePackageDirCache.get(packageName);
  }
  let found = null;
  for (const nodeModules of config.resolver.nodeModulesPaths) {
    const candidate = path.join(nodeModules, packageName);
    if (fs.existsSync(path.join(candidate, "package.json"))) {
      found = fs.realpathSync(candidate);
      break;
    }
  }
  workspacePackageDirCache.set(packageName, found);
  return found;
}

/** Resolve a `@bb/*` specifier through its `exports[subpath].source` entry. */
function resolveWorkspaceSource(moduleName) {
  const { packageName, subpath } = splitScopedSpecifier(moduleName);
  const packageDir = findWorkspacePackageDir(packageName);
  if (!packageDir || !isWorkspaceSource(packageDir + path.sep)) return null;
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(packageDir, "package.json"), "utf8"),
  );
  const entry = packageJson.exports?.[subpath];
  if (!entry) return null;
  const source =
    typeof entry === "string" ? entry : (entry.source ?? entry.default);
  if (typeof source !== "string") return null;
  return path.resolve(packageDir, source);
}

const defaultResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = defaultResolveRequest ?? context.resolveRequest;

  if (WORKSPACE_SCOPES.some((scope) => moduleName.startsWith(scope))) {
    const filePath = resolveWorkspaceSource(moduleName);
    if (filePath && fs.existsSync(filePath)) {
      return { type: "sourceFile", filePath };
    }
  }

  // NodeNext `./x.js` → `./x.ts` inside workspace TS sources.
  if (
    moduleName.startsWith(".") &&
    moduleName.endsWith(".js") &&
    isWorkspaceSource(context.originModulePath)
  ) {
    const base = path.resolve(
      path.dirname(context.originModulePath),
      moduleName.slice(0, -3),
    );
    const filePath = fileWithTsExtension(base);
    if (filePath) return { type: "sourceFile", filePath };
  }

  return resolve(context, moduleName, platform);
};

// `inlineRem: 16` matches the browser default the web app's Tailwind values
// assume (react-native-css defaults to 14, which would shrink every spacing
// utility to a 3.5px grid). global.css also declares `:root { font-size:
// 16px }` for the runtime `rem` variable.
module.exports = withNativewind(config, { inlineRem: 16 });
