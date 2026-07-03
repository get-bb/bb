import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
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

/** "bb-plugin-hello" → "hello" (mirrors the server's id derivation). */
function pluginIdOf(packageName: string): string {
  return packageName.replace(/^bb-plugin-/, "");
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
        "@bb": `https://raw.githubusercontent.com/ymichael/bb/${registryRef(bbVersion)}/packages/plugin-registry/r/{name}.json`,
      },
    },
    null,
    2,
  )}\n`;
}

function serverEntrySource(packageName: string): string {
  const id = pluginIdOf(packageName);
  return `// ${packageName} — a BB plugin backend entry.
//
// The default export is a factory that receives the plugin API. Type-only
// imports are erased when BB loads this file, so it runs as-is.
import type { BbPluginApi } from "@bb/plugin-sdk";

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("loaded");

  // Declarative settings — rendered in BB's settings UI and editable with
  // \`bb plugin config ${id}\`. Add \`secret: true\` for values like API keys.
  const settings = bb.settings.define({
    greeting: { type: "string", label: "Greeting", default: "hello" },
  });
  const { greeting } = await settings.get();

  // Namespaced key-value storage in bb.db (JSON values, up to 256KB each).
  // For bigger or relational data use bb.storage.sqlite().
  const loadCount = ((await bb.storage.kv.get<number>("load-count")) ?? 0) + 1;
  await bb.storage.kv.set("load-count", loadCount);
  bb.log.info(\`\${greeting} — load #\${loadCount}\`);

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
  const id = pluginIdOf(packageName);
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
import { definePluginApp, useBbContext } from "@bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function HelloCard() {
  const { projectId } = useBbContext();
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
        <Button size="sm" variant="outline" asChild>
          <a href="https://github.com/ymichael/bb" target="_blank" rel="noreferrer">
            Docs
          </a>
        </Button>
      </CardContent>
    </Card>
  );
}

// The default export must be definePluginApp(...); BB interprets it after
// loading the bundle. Other slots: navPanel, threadPanelAction,
// composerAccessory (see the bb guide's plugins chapter).
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
 * files shipped in `types/` — the workspace package is unpublished, so authors
 * get real types without it on disk.
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
        baseUrl: ".",
        paths: {
          "@bb/plugin-sdk": ["./types/bb-plugin-sdk.d.ts"],
          "@bb/plugin-sdk/app": ["./types/bb-plugin-sdk-app.d.ts"],
          // Vendored components import via "@/..." (shadcn convention);
          // esbuild reads this mapping too during `bb plugin build`.
          ...(app ? { "@/*": ["./*"] } : {}),
        },
        noEmit: true,
        skipLibCheck: true,
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
  const id = pluginIdOf(packageName);
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
## Install

From this directory:

\`\`\`
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
install. Ask BB to write plugins for you: the \`bb-plugin-authoring\` skill
documents the whole surface with examples.

Confused by the API, or need something the types don't explain? Clone the BB
repo and read the source: <https://github.com/ymichael/bb>.
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
        engines: { bb: enginesRange(bbVersion) },
        bb: app
          ? { server: "./server.ts", app: "./app.tsx" }
          : { server: "./server.ts" },
        // Typecheck-only. The BbPluginApi/SDK types come from the bundled
        // `.d.ts` in `types/` (tsconfig maps @bb/plugin-sdk to them), so the
        // unpublished workspace package is never needed. These deps supply the
        // real npm types the bundle references (zod/hono/better-sqlite3, plus
        // react for the frontend); BB provides them all at runtime, and
        // `bb plugin build` never bundles them.
        // Real runtime deps of the vendored starter components — esbuild
        // bundles these into dist/app.js, so they must be installed to
        // build (`npm install` once; authors need npm, consumers get
        // prebuilt dist/).
        ...(app ? { dependencies: PLUGIN_STARTER_DEPENDENCIES } : {}),
        devDependencies: {
          "@types/better-sqlite3": "^7.6.12",
          "@types/node": "^22.0.0",
          ...(app ? { "@types/react": "^19.0.0" } : {}),
          "better-sqlite3": "^12.0.0",
          hono: "^4.11.9",
          typescript: "^5.7.0",
          zod: "^4.3.6",
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
  // Bundled type declarations so the plugin typechecks without the (unpublished)
  // @bb/plugin-sdk workspace package on disk. tsconfig `paths` maps the imports
  // here.
  const typesDir = join(targetDir, "types");
  await mkdir(typesDir, { recursive: true });
  await writeFile(join(typesDir, "bb-plugin-sdk.d.ts"), PLUGIN_SDK_DTS);
  if (app) {
    await writeFile(join(targetDir, "app.tsx"), appEntrySource(packageName));
    await writeFile(
      join(typesDir, "bb-plugin-sdk-app.d.ts"),
      PLUGIN_SDK_APP_DTS,
    );
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
