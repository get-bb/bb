import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { mergeConfig, type ViteUserConfig } from "vitest/config";
import { BaseSequencer, type TestSpecification } from "vitest/node";

const GLOBAL_OBJECT = String.raw`(?:window|globalThis|global|document|navigator|[A-Z][\w$]*\.prototype)`;
/** A global object, optionally through a TypeScript cast: `(window as X)`. */
const GLOBAL_TARGET = String.raw`(?:${GLOBAL_OBJECT}|\(\s*${GLOBAL_OBJECT}\s+as\b[^)]*\))`;

/**
 * Syntax that mutates worker-global state: the vitest module registry and
 * stubs, `process.env`, the working directory, and properties of the global
 * objects (`window`, `document`, `navigator`, `globalThis`, prototypes),
 * including through a cast such as `(window as X).bbDesktop = ...`. A
 * file that contains any of it keeps the default isolated worker, whether or
 * not it restores what it changed: in a shared worker (`isolate: false`) a
 * missed restore bleeds into the next file, and mocks fail to apply when the
 * target module is already loaded.
 */
const ISOLATION_REQUIRING_API = new RegExp(
  [
    String.raw`\bvi\.(mock|doMock|unmock|doUnmock|resetModules|stubGlobal|stubEnv)\(`,
    String.raw`\bprocess\.chdir\(`,
    String.raw`\bprocess\.env(\.[A-Za-z_$][\w$]*|\[[^\]]+\])\s*=[^=]`,
    String.raw`\bdelete\s+process\.env\b`,
    String.raw`\b${GLOBAL_TARGET}\.[A-Za-z_$][\w$.]*\s*=[^=]`,
    String.raw`\bdelete\s+${GLOBAL_TARGET}(?![\w$])`,
    String.raw`\b(?:Object\.(?:defineProperty|defineProperties|assign)|Reflect\.(?:set|defineProperty|deleteProperty))\(\s*${GLOBAL_TARGET}(?![\w$])`,
  ].join("|"),
);

/**
 * Import specifiers in a module: `import x from "..."`, `export ... from
 * "..."`, `import "..."`, `import("...")`, and `require("...")`. Only
 * relative and aliased specifiers are followed; the rest resolve to `null`.
 */
const IMPORT_SPECIFIER =
  /\b(?:import|export)\b[^'"]*?\bfrom\s*["']([^"']+)["']|\bimport\s*\(?\s*["']([^"']+)["']|\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".mjs", ".cjs", ".js", ".jsx"];

/**
 * The scan follows a test's local imports only into test-support modules
 * (harnesses, helpers, fixtures, mocks): a `vi.mock` in a shared harness
 * makes every test that imports it need a fresh module registry. Production
 * sources are not followed — a module that sets `process.env` when the app
 * boots does so once per worker, exactly as it does once per process in
 * production, and following the whole source graph would flag nearly every
 * test.
 */
const TEST_SUPPORT_DIRS = new Set([
  "test",
  "tests",
  "__tests__",
  "__mocks__",
  "__fixtures__",
  "fixtures",
  "testing",
  "test-utils",
]);
const TEST_SUPPORT_FILE =
  /(^|[.-])(test|tests|mock|mocks|harness|fixture|fixtures|helpers?)(\.|-|$)/;

function isTestSupportModule(relativePath: string): boolean {
  const segments = relativePath.split(path.sep);
  const baseName = (segments.pop() ?? "").replace(/\.[cm]?[jt]sx?$/, "");
  return (
    segments.some((segment) => TEST_SUPPORT_DIRS.has(segment)) ||
    TEST_SUPPORT_FILE.test(baseName)
  );
}

/**
 * Every file name shape vitest's default `include` treats as a test. The
 * partition below must see every file a package's `include` globs select;
 * a file matched by `include` but not by this pattern would run in both
 * halves.
 */
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const SKIP_DIRS = new Set(["node_modules", "dist"]);

/** The per-file environment docblock vitest honors. */
const ENVIRONMENT_DOCBLOCK = /@(?:vitest|jest)-environment\s+([\w-]+)/;

/**
 * Environments whose files never share a worker. A DOM test mutates the
 * shared `document` in ways no source scan can enumerate — portals left in
 * `body`, focus, listeners on `window`, module caches keyed by the document
 * (media-query lists, drawer stacks) — and running the app's jsdom files
 * through one worker failed a different file on every ordering.
 */
const ISOLATED_ENVIRONMENTS = new Set(["jsdom", "happy-dom"]);

export interface PartitionOptions {
  /**
   * Import aliases to follow when the scan walks a test file's local
   * imports, as alias prefix to directory (absolute or package-relative),
   * e.g. `{ "@": "src" }`.
   */
  aliases?: Record<string, string>;
  /**
   * The root config's `test.environment`, which files without a docblock
   * use. Defaults to `node`. A DOM default isolates every such file.
   */
  defaultEnvironment?: string;
}

export interface SharedTestFileGroup {
  /**
   * The environment the files' docblocks select, or `null` for the files
   * that use the project default.
   */
  environment: string | null;
  files: string[];
}

export interface TestFilePartition {
  /**
   * Files safe to run in a shared worker context, grouped by environment.
   * The default-environment group comes first; the rest sort by name.
   */
  shared: SharedTestFileGroup[];
  /**
   * Files that need their own isolated worker: they mutate worker-global
   * state, or they run in a DOM environment.
   */
  isolated: string[];
}

interface IsolationScan {
  pkgDir: string;
  aliases: Record<string, string>;
  memo: Map<string, boolean>;
  visiting: Set<string>;
}

function isFile(filePath: string): boolean {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

/**
 * Resolves a relative or aliased import to a test-support module inside the
 * package, mapping the `.js` specifiers TypeScript sources use back to
 * `.ts`/`.tsx`. Production sources and anything outside the package resolve
 * to `null`.
 */
function resolveLocalImport(
  fromFile: string,
  specifier: string,
  scan: IsolationScan,
): string | null {
  let base: string | null = null;
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    base = path.resolve(path.dirname(fromFile), specifier);
  } else {
    for (const [alias, target] of Object.entries(scan.aliases)) {
      if (specifier === alias || specifier.startsWith(`${alias}/`)) {
        base = path.resolve(scan.pkgDir, target, specifier.slice(alias.length + 1));
        break;
      }
    }
  }
  if (base === null) return null;
  const withoutJs = base.replace(/\.[cm]?jsx?$/, "");
  const candidates = [
    base,
    ...SOURCE_EXTENSIONS.map((extension) => withoutJs + extension),
    ...SOURCE_EXTENSIONS.map((extension) => path.join(base, `index${extension}`)),
  ];
  for (const candidate of candidates) {
    const relative = path.relative(scan.pkgDir, candidate);
    if (relative.startsWith("..") || relative.split(path.sep).includes("node_modules")) {
      continue;
    }
    if (!isFile(candidate)) continue;
    return isTestSupportModule(relative) ? candidate : null;
  }
  return null;
}

/**
 * Whether `file` — or any local module it imports, transitively — uses an
 * isolation-requiring API. A test helper that calls `vi.mock` makes every
 * test that imports it depend on a fresh module registry.
 */
function requiresIsolation(file: string, scan: IsolationScan): boolean {
  const memo = scan.memo.get(file);
  if (memo !== undefined) return memo;
  if (scan.visiting.has(file)) return false;
  scan.visiting.add(file);
  const source = readFileSync(file, "utf8");
  let result = ISOLATION_REQUIRING_API.test(source);
  if (!result) {
    for (const match of source.matchAll(IMPORT_SPECIFIER)) {
      const specifier = match[1] ?? match[2] ?? match[3];
      if (specifier === undefined) continue;
      const target = resolveLocalImport(file, specifier, scan);
      if (target !== null && requiresIsolation(target, scan)) {
        result = true;
        break;
      }
    }
  }
  scan.visiting.delete(file);
  scan.memo.set(file, result);
  return result;
}

/**
 * Walks `roots` (relative to `pkgDir`) and splits the test files found there
 * by whether they need an isolated worker: files that, directly or through
 * a local test helper, use worker-global APIs, and files that run in a DOM
 * environment. Everything else can run in a shared worker context
 * (`isolate: false`), which skips re-importing the module graph for every
 * file — by far the dominant cost of the big suites.
 *
 * Shared files are further grouped by the environment their docblock names.
 * Vitest only hands a finished worker the next queued file when that file
 * has the same project and environment, so a queue that mixes `node` and
 * `jsdom` files churns workers instead of reusing them.
 *
 * Every path is package-relative posix, usable directly as a vitest
 * `include`/`exclude` entry.
 */
export function partitionTestFiles(
  pkgDir: string,
  roots: string[],
  options: PartitionOptions = {},
): TestFilePartition {
  const defaultEnvironment = options.defaultEnvironment ?? "node";
  const scan: IsolationScan = {
    pkgDir,
    aliases: options.aliases ?? {},
    memo: new Map(),
    visiting: new Set(),
  };
  const sharedByEnvironment = new Map<string | null, Set<string>>();
  const isolated = new Set<string>();
  const walk = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(fullPath);
      } else if (TEST_FILE.test(entry.name)) {
        const relative = path
          .relative(pkgDir, fullPath)
          .split(path.sep)
          .join("/");
        const source = readFileSync(fullPath, "utf8");
        const environment = ENVIRONMENT_DOCBLOCK.exec(source)?.[1] ?? null;
        if (
          ISOLATED_ENVIRONMENTS.has(environment ?? defaultEnvironment) ||
          requiresIsolation(fullPath, scan)
        ) {
          isolated.add(relative);
        } else {
          let group = sharedByEnvironment.get(environment);
          if (!group) {
            group = new Set();
            sharedByEnvironment.set(environment, group);
          }
          group.add(relative);
        }
      }
    }
  };
  for (const root of new Set(roots)) walk(path.join(pkgDir, root));
  const shared = [...sharedByEnvironment]
    .map(([environment, files]) => ({ environment, files: [...files].sort() }))
    .sort((a, b) => {
      if (a.environment === null) return -1;
      if (b.environment === null) return 1;
      return a.environment.localeCompare(b.environment);
    });
  return { shared, isolated: [...isolated].sort() };
}

type TestProjects = NonNullable<NonNullable<ViteUserConfig["test"]>["projects"]>;

export interface SharedWorkerProjectsArgs {
  /** The package directory, normally the config file's `__dirname`. */
  pkgDir: string;
  /**
   * The project name. Shared files that select another environment report
   * as `${name}:${environment}`; the isolated files as `${name}:isolated`.
   */
  name: string;
  /** Package-relative globs that select the package's test files. */
  include: string[];
  /** Globs excluded from every project. Defaults to `dist/**` and `node_modules/**`. */
  exclude?: string[];
  /** Import aliases the isolation scan follows; see {@link PartitionOptions}. */
  aliases?: Record<string, string>;
  /** The root config's `test.environment`; see {@link PartitionOptions}. */
  defaultEnvironment?: string;
}

/**
 * Splits a package's tests into projects that extend the package's root
 * config: one shared-worker project (`isolate: false`) per non-DOM
 * environment for the files {@link partitionTestFiles} finds safe, and an
 * isolated project for the rest. Every project keeps the package's own
 * `include` globs and excludes the other projects' files, so the split never
 * changes which files run — only where.
 *
 * {@link SharedWorkerSequencer} (installed by {@link defineWorkspaceTestConfig})
 * orders the run queue so the files of one shared project sit together.
 * Vitest hands a finished worker the next queued file only when that file
 * has the same project and environment, so this ordering is what turns
 * `isolate: false` into actual worker reuse. Re-importing the module graph
 * for every file is the dominant cost of most suites here (80–90% of total
 * CPU for the large ones).
 */
export function sharedWorkerProjects(
  args: SharedWorkerProjectsArgs,
): TestProjects {
  const exclude = args.exclude ?? ["dist/**", "node_modules/**"];
  const options: PartitionOptions = {};
  if (args.aliases !== undefined) options.aliases = args.aliases;
  if (args.defaultEnvironment !== undefined) {
    options.defaultEnvironment = args.defaultEnvironment;
  }
  const partition = partitionTestFiles(
    args.pkgDir,
    args.include.map(globRoot),
    options,
  );
  const allFiles = [
    ...partition.shared.flatMap((group) => group.files),
    ...partition.isolated,
  ];
  if (allFiles.length === 0) {
    return [{ extends: true, test: { name: args.name, include: args.include, exclude } }];
  }
  const otherFiles = (own: readonly string[]) => {
    const ownSet = new Set(own);
    return allFiles.filter((file) => !ownSet.has(file));
  };
  const projects: TestProjects = partition.shared.map((group) => ({
    extends: true,
    test: {
      name:
        group.environment === null
          ? args.name
          : `${args.name}:${group.environment}`,
      include: args.include,
      exclude: [...exclude, ...otherFiles(group.files)],
      isolate: false,
    },
  }));
  if (partition.isolated.length > 0) {
    projects.push({
      extends: true,
      test: {
        name: `${args.name}:isolated`,
        include: args.include,
        exclude: [...exclude, ...otherFiles(partition.isolated)],
      },
    });
  }
  return projects;
}

/**
 * Orders the run queue for worker reuse: isolated files first, then the
 * shared-worker projects one after another, keeping vitest's own
 * slowest-first order inside each block.
 *
 * Vitest reuses a finished shared worker only when the file at the head of
 * the queue belongs to the same project and environment; otherwise it
 * terminates the worker and starts a new one. Interleaved projects therefore
 * churn workers, and running the projects as separate phases
 * (`sequence.groupOrder`) leaves every worker idle at each phase's tail.
 * One queue with contiguous blocks avoids both. Isolated files go first
 * because each one pays a full module-graph import, so they are the longest
 * tasks and scheduling them early keeps the end of the run short.
 */
export class SharedWorkerSequencer extends BaseSequencer {
  override async sort(
    files: TestSpecification[],
  ): Promise<TestSpecification[]> {
    const sorted = await super.sort(files);
    const rank = (spec: TestSpecification) =>
      spec.project.config.isolate ? 0 : 1;
    return sorted
      .map((spec, index) => ({ spec, index }))
      .sort(
        (a, b) =>
          rank(a.spec) - rank(b.spec) ||
          a.spec.project.name.localeCompare(b.spec.project.name) ||
          a.index - b.index,
      )
      .map(({ spec }) => spec);
  }
}

/**
 * The literal directory prefix of a glob: `src/** /*.test.ts` is rooted at
 * `src`, and `** /*.test.ts` at the package itself.
 */
function globRoot(glob: string): string {
  const segments = glob.split("/");
  const literal: string[] = [];
  for (const segment of segments) {
    if (/[*?{}[\]]/.test(segment)) break;
    literal.push(segment);
  }
  // A fully literal glob names one file; its root is the containing directory.
  if (literal.length === segments.length) literal.pop();
  return literal.length > 0 ? literal.join("/") : ".";
}

/**
 * `@hugeicons/core-free-icons` resolves to a barrel that re-exports 5,122
 * one-icon modules, which Node loads in ~0.4–0.7s — paid by every isolated
 * worker, since the shared-ui icon registry imports it. The package also
 * ships the same exports as one self-contained minified bundle (its
 * `production` entry), which loads in ~45ms. Tests alias the bare specifier
 * to that bundle; deep imports are untouched. Resolved from the package
 * under test, and skipped when that package cannot see the dependency.
 */
function hugeiconsBundleAlias(): { find: RegExp; replacement: string }[] {
  try {
    const require = createRequire(path.join(process.cwd(), "package.json"));
    const packageJson = require.resolve("@hugeicons/core-free-icons/package.json");
    return [
      {
        find: /^@hugeicons\/core-free-icons$/,
        replacement: path.join(
          path.dirname(packageJson),
          "dist",
          "esm",
          "index.min.js",
        ),
      },
    ];
  } catch {
    return [];
  }
}

/**
 * Wraps a package's Vitest config so workspace imports (`@bb/*`) resolve to
 * package sources instead of built `dist/` output, installs
 * {@link SharedWorkerSequencer}, and applies {@link hugeiconsBundleAlias}.
 *
 * Every workspace package's export map carries a `source` condition pointing
 * at `src/` — the same condition used by `node --conditions=source` in dev,
 * esbuild bundling (`scripts/build-utils.mjs`), and tsc (`customConditions`
 * in `packages/tsconfig/typecheck-overrides.json`). Vitest resolves test
 * imports through Vite's server environment, which only honors conditions
 * under `ssr.resolve`, so a plain `resolve.conditions` entry has no effect on
 * tests. Only `source` is listed here: Vitest contributes its own default
 * conditions through a config plugin, and Vite concatenates these arrays
 * with them during config merge.
 */
export function defineWorkspaceTestConfig(
  config: ViteUserConfig,
): ViteUserConfig {
  return mergeConfig(
    {
      resolve: {
        alias: hugeiconsBundleAlias(),
        conditions: ["source"],
      },
      test: {
        sequence: { sequencer: SharedWorkerSequencer },
        coverage: {
          provider: "v8",
          include: ["**/*.{ts,tsx,js,jsx,mjs,cjs}"],
          exclude: [
            "**/*.d.ts",
            "**/*.test.{ts,tsx,js,jsx,mjs,cjs}",
            "**/*.spec.{ts,tsx,js,jsx,mjs,cjs}",
            "**/*.stories.{ts,tsx,js,jsx}",
            "**/*.gen.{ts,tsx,js,jsx}",
            "**/__fixtures__/**",
            "**/__tests__/**",
            "**/generated/**",
            ".turbo/**",
            "coverage/**",
            "dist/**",
            "node_modules/**",
            "scripts/**",
            "test/**",
            "tests/**",
            "*.config.{ts,js,mts,mjs}",
            "vite.{ts,js,mts,mjs}",
            "vitest.{ts,js,mts,mjs}",
          ],
          reporter: ["text-summary", "json-summary"],
        },
      },
      ssr: {
        resolve: {
          conditions: ["source"],
          externalConditions: ["source"],
        },
      },
    },
    config,
  );
}
