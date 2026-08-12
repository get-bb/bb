import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import { derivePluginId, PLUGIN_SDK_VERSION } from "@bb/domain";
import {
  PLUGIN_SDK_APP_DTS,
  PLUGIN_SDK_DTS,
} from "./generated/plugin-sdk-dts.generated.js";
import {
  PLUGIN_STARTER_DEPENDENCIES,
  PLUGIN_STARTER_FILES,
  PLUGIN_STARTER_TYPE_DEPENDENCIES,
} from "./generated/plugin-starter-files.generated.js";

/**
 * `bb plugin new` scaffold. Lives in @bb/templates because both the CLI
 * (which writes it) and the server test suite (which verifies the scaffold
 * actually loads through the plugin service) consume it.
 */
export interface ScaffoldPluginArgs {
  /** Directory to create; scaffolding fails if it already exists. */
  targetDir: string;
  /** Full package name, e.g. "bb-plugin-hello". */
  packageName: string;
  /** BB app version; engines.bb is pinned to ">=<major.minor>". */
  bbVersion: string;
  /**
   * Also scaffold a frontend entry (`app.tsx`, wired as `bb.app` and built
   * by `bb plugin build`). Off by default so headless plugins stay lean.
   */
  app?: boolean;
}

/** Arguments for {@link syncPluginTypes}. */
export interface SyncPluginTypesArgs {
  /** Plugin root directory (the one holding `package.json`). */
  rootDir: string;
  /**
   * Also refresh the frontend declaration. Callers pass whether the manifest
   * declares `bb.app`; an existing `bb-plugin-sdk-app.d.ts` refreshes either
   * way, so a headless read of the manifest never strands a stale copy.
   */
  app: boolean;
  /**
   * Report what a write would do and touch nothing (`bb plugin types
   * --check`, CI). Stale or missing files come back as `stale`.
   */
  check?: boolean;
}

/** One declaration file considered by {@link syncPluginTypes}. */
export interface SyncedPluginTypeFile {
  /** Path relative to the plugin root, e.g. `types/bb-plugin-sdk.d.ts`. */
  path: string;
  /**
   * `written` when the file was created or its contents changed, `stale` when
   * a check found it missing or outdated, `unchanged` when it already matches.
   */
  outcome: "written" | "unchanged" | "stale";
}

/**
 * Write this build's bundled `@bb/plugin-sdk` declarations into a plugin's
 * `types/` directory, creating it when absent.
 *
 * `bb plugin new` seeds these once, but the SDK surface grows with every BB
 * release, so a copy scaffolded months ago silently under-reports the API.
 * `bb plugin types`, `bb plugin build`, and `bb plugin dev` all call this so
 * the local declarations track the bb that is actually running the plugin.
 * Files are compared before writing, so an already-current plugin reports
 * `unchanged` and keeps its mtime.
 */
export async function syncPluginTypes(
  args: SyncPluginTypesArgs,
): Promise<SyncedPluginTypeFile[]> {
  const { rootDir, app, check = false } = args;
  const typesDir = join(rootDir, "types");
  const candidates: { name: string; content: string; optional: boolean }[] = [
    { name: "bb-plugin-sdk.d.ts", content: PLUGIN_SDK_DTS, optional: false },
    {
      name: "bb-plugin-sdk-app.d.ts",
      content: PLUGIN_SDK_APP_DTS,
      // Refresh a frontend declaration the plugin already has even when the
      // caller did not detect bb.app; never create one it never asked for.
      optional: !app,
    },
  ];
  await assertWritableTypesDir(rootDir, typesDir);
  const results: SyncedPluginTypeFile[] = [];
  for (const candidate of candidates) {
    const filePath = join(typesDir, candidate.name);
    const relativePath = `types/${candidate.name}`;
    const existing = await statNoFollow(filePath, relativePath);
    if (existing !== null && !existing.isFile()) {
      throw new Error(`${relativePath} is not a regular file`);
    }
    const current = existing === null ? null : await readFile(filePath, "utf8");
    if (current === null && candidate.optional) continue;
    if (current === candidate.content) {
      results.push({ path: relativePath, outcome: "unchanged" });
      continue;
    }
    if (check) {
      results.push({ path: relativePath, outcome: "stale" });
      continue;
    }
    await mkdir(typesDir, { recursive: true });
    await writeDeclarationAtomically(filePath, relativePath, candidate.content);
    results.push({ path: relativePath, outcome: "written" });
  }
  return results;
}

/**
 * `lstat` that never follows the final path component. Returns null when the
 * path does not exist, and refuses a symbolic link.
 *
 * `bb plugin build` and `bb plugin dev` refresh declarations automatically, so
 * a plugin that ships `types/` — or a declaration inside it — as a link would
 * otherwise redirect that write onto a file outside the plugin. Building a
 * plugin does not run its code, so cloning an untrusted plugin and building it
 * must not write anywhere but that plugin.
 */
async function statNoFollow(
  path: string,
  label: string,
): Promise<Awaited<ReturnType<typeof lstat>> | null> {
  let stats: Awaited<ReturnType<typeof lstat>>;
  try {
    stats = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (stats.isSymbolicLink()) {
    throw new Error(`refusing to write through the symbolic link ${label}`);
  }
  return stats;
}

/**
 * Reject a `types/` that is a link, is not a directory, or resolves outside
 * the plugin. Resolving both sides keeps a plugin inside a symlinked checkout
 * (a bb worktree, for example) working.
 */
async function assertWritableTypesDir(
  rootDir: string,
  typesDir: string,
): Promise<void> {
  const stats = await statNoFollow(typesDir, "types");
  if (stats === null) return;
  if (!stats.isDirectory())
    throw new Error("types exists but is not a directory");
  const [realRoot, realTypes] = await Promise.all([
    realpath(rootDir),
    realpath(typesDir),
  ]);
  const rel = relative(realRoot, realTypes);
  if (rel.length === 0 || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`types resolves outside the plugin (${realTypes})`);
  }
}

/**
 * Write through a temporary regular file and rename it into place, so a
 * concurrent reader never sees a partial declaration file and the rename
 * replaces the entry itself rather than following anything at the destination.
 */
async function writeDeclarationAtomically(
  filePath: string,
  label: string,
  content: string,
): Promise<void> {
  const tempPath = `${filePath}.bb-tmp`;
  await statNoFollow(tempPath, `${label}.bb-tmp`);
  await rm(tempPath, { force: true });
  await writeFile(tempPath, content, { flag: "wx" });
  try {
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

function pluginNameOf(packageName: string): string {
  return derivePluginId(packageName)
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function enginesRange(bbVersion: string): string {
  const match = /^(\d+)\.(\d+)/.exec(bbVersion);
  return match ? `>=${match[1]}.${match[2]}` : ">=0.0";
}

/**
 * Git ref the scaffold's component registry URL pins to: the release tag
 * matching the running BB, so `npx shadcn add @bb/<name>` vendors component
 * source version-matched to this install by construction. Dev builds
 * (0.0.0) track main.
 */
function registryRef(bbVersion: string): string {
  return bbVersion === "0.0.0" ? "main" : `desktop-v${bbVersion}`;
}

/**
 * shadcn `components.json`: lets stock `npx shadcn add @bb/<name>` pull more
 * components from the BB registry (checked-in items served raw from GitHub;
 * see packages/plugin-registry). Registry components install into
 * components/ui/ + lib/ + hooks/ via the aliases below; `bb plugin build`
 * resolves the `@/*` alias through tsconfig paths.
 */
function componentsJsonSource(bbVersion: string): string {
  return `${JSON.stringify(
    {
      $schema: "https://ui.shadcn.com/schema.json",
      style: "new-york",
      tsx: true,
      tailwind: {
        config: "",
        css: "app.css",
        baseColor: "neutral",
        cssVariables: true,
      },
      aliases: {
        components: "@/components",
        ui: "@/components/ui",
        lib: "@/lib",
        utils: "@/lib/utils",
        hooks: "@/hooks",
      },
      registries: {
        "@bb": `https://raw.githubusercontent.com/get-bb/bb/${registryRef(bbVersion)}/packages/plugin-registry/r/{name}.json`,
      },
    },
    null,
    2,
  )}\n`;
}

function serverEntrySource(packageName: string): string {
  const id = derivePluginId(packageName);
  return `// ${packageName} — a BB plugin backend entry.
//
// The default export is a factory that receives the plugin API. BB supplies
// the tiny defineRpcContract runtime helper; the API type remains type-only.
import { defineRpcContract, type BbPluginApi } from "@bb/plugin-sdk";
import { z } from "zod";

export const rpcContract = defineRpcContract({
  greeting: {
    input: z.null(),
    output: z.object({ greeting: z.string(), loadCount: z.number().int() }),
  },
});

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("loaded");

  // Declarative settings — rendered in BB's settings UI and editable with
  // \`bb plugin config ${id}\`. Add \`secret: true\` for values like API keys.
  const settings = bb.settings.define({
    greeting: { type: "string", label: "Greeting", default: "hello" },
  });
  const { greeting } = await settings.get();

  // Namespaced key-value storage in bb.db (JSON values, up to 256KB each).
  // For bigger or relational data use bb.storage.database().
  const loadCount = ((await bb.storage.kv.get<number>("load-count")) ?? 0) + 1;
  await bb.storage.kv.set("load-count", loadCount);
  bb.log.info(\`\${greeting} — load #\${loadCount}\`);

  // Both schemas run at the wire boundary. Handler input/output are inferred
  // from the shared contract; app.tsx imports only its type.
  bb.rpc.register(rpcContract, {
    greeting: () => ({ greeting, loadCount }),
  });

  // Cleanup on reload/disable/shutdown; hooks run LIFO. The sanctioned place
  // to clear timers and close connections.
  bb.onDispose(() => {
    bb.log.info("disposed");
  });

  // Long-lived background work: starts after load, gets an AbortSignal on
  // reload/disable/shutdown, and restarts with backoff if it crashes. Sleeps
  // must wake on abort — a plain setTimeout sleeps through the stop window
  // and the plugin reports "degraded (service did not stop)" on reload.
  // bb.background.service("worker", {
  //   async start(signal) {
  //     while (!signal.aborted) {
  //       await new Promise((resolve) => {
  //         const timer = setTimeout(resolve, 60_000);
  //         signal.addEventListener(
  //           "abort",
  //           () => { clearTimeout(timer); resolve(undefined); },
  //           { once: true },
  //         );
  //       });
  //     }
  //   },
  // });
}
`;
}

function appEntrySource(packageName: string): string {
  const id = derivePluginId(packageName);
  return `// ${packageName} — a BB plugin frontend entry.
//
// Compiled by \`bb plugin build\` into dist/app.js + dist/app.css. React and
// @bb/plugin-sdk/app are provided by the BB app at load time (never bundled),
// so this file must be loaded by BB, not imported directly.
//
// The components under components/ui/ are YOURS: vendored source (shadcn
// model), edit freely. Add more from the BB registry with
// \`npx shadcn add @bb/<name>\` (see components.json) — dialogs, dropdowns,
// tables, the full shadcn set, version-matched to this BB install. Run
// \`npm install\` once before \`bb plugin build\`.
import { useState } from "react";
import { definePluginApp, useBbContext, useRpc } from "@bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function HelloCard() {
  const { projectId } = useBbContext();
  const rpc = useRpc<typeof rpcContract>();
  const [greeting, setGreeting] = useState("Say hello");
  // Tailwind classes compile against the host theme's live CSS variables —
  // derive colors from the theme tokens, never hardcoded grays.
  return (
    <Card>
      <CardHeader>
        <CardTitle>${packageName}</CardTitle>
      </CardHeader>
      <CardContent className="flex items-center gap-3 text-sm text-muted-foreground">
        <span>
          {projectId === null
            ? "No project selected."
            : \`Project: \${projectId}.\`}
        </span>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            void rpc.call("greeting").then((result) => {
              setGreeting(\`\${result.greeting} (#\${result.loadCount})\`);
            });
          }}
        >
          {greeting}
        </Button>
      </CardContent>
    </Card>
  );
}

// The default export must be definePluginApp(...); BB interprets it after
// loading the bundle. Register general UI under app.slots and composer actions,
// plus-menu rows, banners, or rich-text rules with app.composer.customize(...)
// (see the bb guide's plugins chapter).
export default definePluginApp((app) => {
  app.slots.homepageSection({
    id: "${id}-hello",
    title: "${packageName}",
    component: HelloCard,
  });
});
`;
}

/**
 * Typecheck-only tsconfig: server.ts compiles against the BbPluginApi contract
 * (type-only, erased at load time); app.tsx is included when the plugin
 * declares a frontend entry. `@bb/plugin-sdk` resolves to the bundled `.d.ts`
 * files shipped in `types/`, so authors get the root/app types without a
 * package install. Tests can install `@bb/plugin-sdk` for its testing subpaths.
 */
function tsconfigSource(app: boolean): string {
  return `${JSON.stringify(
    {
      compilerOptions: {
        strict: true,
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "bundler",
        jsx: "react-jsx",
        lib: ["ES2022", "DOM"],
        // Only @types/node ambiently — stray ancestor node_modules/@types
        // (e.g. bun-types in a home directory) must not leak in.
        types: ["node"],
        paths: {
          "@bb/plugin-sdk": ["./types/bb-plugin-sdk.d.ts"],
          "@bb/plugin-sdk/app": ["./types/bb-plugin-sdk-app.d.ts"],
          // Vendored components import via "@/..." (shadcn convention);
          // esbuild reads this mapping too during `bb plugin build`.
          ...(app ? { "@/*": ["./*"] } : {}),
        },
        noEmit: true,
        skipLibCheck: false,
      },
      include: app
        ? ["server.ts", "app.tsx", "types", "components", "lib", "hooks"]
        : ["server.ts", "types"],
    },
    null,
    2,
  )}\n`;
}

function skillSource(): string {
  return `---
name: example-skill
description: Example skill scaffolded by \`bb plugin new\` — replace with a real capability description that tells agents when to use it.
---

<!-- Plugin skills/ directories auto-import in a later BB phase; until then
     this file documents the expected layout. -->

# Example skill

Describe when to use this skill and the steps to follow.
`;
}

function readmeSource(packageName: string, app: boolean): string {
  const id = derivePluginId(packageName);
  const componentsSection = app
    ? `
## UI components

\`components/ui/\` is vendored source you own (the shadcn model): edit the
files freely — they never update out from under you. Add more from the BB
component registry (the full shadcn set, version-matched to your BB install
via the pinned ref in \`components.json\`):

\`\`\`
npx shadcn add @bb/dialog @bb/select
\`\`\`

Run \`npm install\` once before \`bb plugin build\` — the vendored components'
npm deps bundle into your dist. React, and BB-shimmed packages like the
radix portal primitives and \`sonner\` (\`import { toast } from "sonner"\`
reaches BB's own toaster), are provided by the BB app at runtime and never
bundled. Ship \`dist/\` (npm tarball or committed for git installs) so
people installing your plugin never need npm.
`
    : "";
  return `# ${packageName}

A BB plugin.
${componentsSection}
## Manifest

\`package.json\` is the plugin manifest. Notable fields:

- \`bb.server\` — backend entry (required); optional \`bb.app\` for a frontend.
- \`bb.name\` and \`bb.description\` — required human-facing identity.
- \`bb.branding\` — required; declare \`icon\` as a BB icon name or a
  plugin-relative compact SVG, or declare \`logo.light\` (with optional
  \`logo.dark\`). Logo assets must be relative \`.svg\`, \`.png\`, or
  \`.webp\` files.
- \`engines.bb\` — supported bb app version range.
- \`engines.bbPluginSdk\` — supported plugin SDK range (scaffold: \`^${PLUGIN_SDK_VERSION}\`).
- \`dependencies\` — every package your source imports that BB does not provide.
  \`bb plugin build\` inlines them into \`dist/\`, and git installs resolve this
  list alone, so a build-required package here rather than in
  \`devDependencies\` is what keeps your plugin installable. \`devDependencies\`
  is for types and tooling only (BB shims React, the portal primitives, and
  \`@bb/plugin-sdk\` at runtime — never bundle them).

Run \`bb plugin build\` before publishing git/npm installs. It writes
\`dist/server.js\` + \`server.meta.json\` (and, with \`bb.app\`, \`app.js\` /
\`app.css\` / \`app.meta.json\`). Each \`*.meta.json\` stamps SDK major/version,
\`artifactFormatVersion\`, \`pluginId\`, \`pluginVersion\`, and
\`builtWith\` so managed installs can verify the artifacts.

## Install

From this directory (\`bb plugin new\` already ran the install; a fresh clone
needs it):

\`\`\`
npm install
bb plugin install .
\`\`\`

After editing sources, reload:

\`\`\`
bb plugin reload ${id}
\`\`\`

## Configure

\`\`\`
bb plugin config ${id}
bb plugin config ${id} set greeting hi
\`\`\`

## Types & API reference

\`types/bb-plugin-sdk.d.ts\` (and \`types/bb-plugin-sdk-app.d.ts\` for the
frontend) are the full, bundled BB plugin API — \`tsconfig.json\` maps
\`@bb/plugin-sdk\` to them, so your editor and \`tsc\` see real types with no extra
install. They are readable declarations: open them for an exact signature.

The SDK surface grows with every BB release, and these are a copy. Refresh
them from the BB you are running:

\`\`\`
bb plugin types          # rewrite types/ from this BB
bb plugin types --check  # CI: fail when they are out of date
\`\`\`

\`bb plugin build\` and \`bb plugin dev\` refresh them for you. Ask BB to write
plugins for you: the \`bb-plugin-authoring\` skill documents the whole surface
with examples.

Confused by the API, or need something the types don't explain? Clone the BB
repo and read the source: <https://github.com/get-bb/bb>.
`;
}

/**
 * Write the plugin scaffold into `targetDir` (created; must not exist).
 * The generated server.ts loads cleanly against the live plugin API.
 */
export async function scaffoldPlugin(args: ScaffoldPluginArgs): Promise<void> {
  const { targetDir, packageName, bbVersion, app = false } = args;
  try {
    await mkdir(targetDir, { recursive: false });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`directory already exists: ${targetDir}`);
    }
    throw error;
  }
  await writeFile(
    join(targetDir, "package.json"),
    JSON.stringify(
      {
        name: packageName,
        version: "0.1.0",
        type: "module",
        engines: {
          bb: enginesRange(bbVersion),
          bbPluginSdk: `^${PLUGIN_SDK_VERSION}`,
        },
        bb: {
          name: pluginNameOf(packageName),
          description: "A BB plugin.",
          branding: { icon: "Zap" },
          server: "./server.ts",
          ...(app ? { app: "./app.tsx" } : {}),
        },
        // A package belongs here when generated source imports it AND the
        // build neither externalizes nor shims it — those imports are inlined
        // into dist/ by esbuild, and load from node_modules for path: installs
        // (which run server.ts from source). They must survive an install that
        // omits dev deps: the packaged CLI runs with NODE_ENV=production, and
        // the server installs git: plugins with an explicit `--omit=dev`.
        // - zod: `server.ts` imports it and buildPluginServer externalizes only
        //   @bb/plugin-sdk and better-sqlite3, so it is bundled, not provided.
        // - starter deps: the vendored components' real runtime deps, bundled
        //   into dist/app.js (consumers get the prebuilt dist/ and need none).
        dependencies: {
          ...(app ? PLUGIN_STARTER_DEPENDENCIES : {}),
          zod: "^4.3.6",
        },
        // Typecheck-only. The BbPluginApi/SDK types come from the bundled
        // `.d.ts` in `types/` (tsconfig maps @bb/plugin-sdk to them), so the
        // package is not needed for normal plugin source. These supply the real
        // npm types those declarations reference (hono/better-sqlite3 and the
        // root contract's React types) for packages generated source does not
        // import: BB provides them at runtime and the bundle never inlines
        // them. An author who imports one directly must promote it above.
        devDependencies: {
          "@types/better-sqlite3": "^7.6.12",
          "@types/node": "^22.0.0",
          // The root SDK declaration also exposes frontend contract types, so
          // React's declarations are required for headless plugin typechecks.
          "@types/react": "^19.0.0",
          ...(app ? { "@types/react-dom": "^19.0.0" } : {}),
          "better-sqlite3": "^12.0.0",
          hono: "^4.11.9",
          typescript: "^5.7.0",
          // Runtime-shimmed by BB (never bundled) — types only.
          ...(app ? PLUGIN_STARTER_TYPE_DEPENDENCIES : {}),
        },
      },
      null,
      2,
    ) + "\n",
  );
  await writeFile(join(targetDir, "server.ts"), serverEntrySource(packageName));
  await writeFile(join(targetDir, "tsconfig.json"), tsconfigSource(app));
  // Bundled root/app declarations keep normal plugin source self-contained.
  // Tests that use @bb/plugin-sdk/testing install the published package; the
  // exact root/app paths syncPluginTypes writes intentionally keep resolving
  // here. Seeding through the same function `bb plugin types` uses is what
  // stops a scaffolded plugin and a refreshed one from ever diverging.
  await syncPluginTypes({ rootDir: targetDir, app });
  if (app) {
    await writeFile(join(targetDir, "app.tsx"), appEntrySource(packageName));
    // Vendored starter components (shadcn model — the author owns and edits
    // them) + components.json so `npx shadcn add @bb/<name>` pulls more from
    // the BB registry at the version tag matching this install.
    for (const file of PLUGIN_STARTER_FILES) {
      const filePath = join(targetDir, file.target);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, file.content);
    }
    await writeFile(
      join(targetDir, "components.json"),
      componentsJsonSource(bbVersion),
    );
  }
  const skillDir = join(targetDir, "skills", "example-skill");
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, "SKILL.md"), skillSource());
  await writeFile(join(targetDir, ".gitignore"), "dist/\nnode_modules/\n");
  await writeFile(join(targetDir, "README.md"), readmeSource(packageName, app));
}
