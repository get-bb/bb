import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

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
  // reload/disable/shutdown, and restarts with backoff if it crashes.
  // bb.background.service("worker", {
  //   async start(signal) {
  //     while (!signal.aborted) {
  //       await new Promise((resolve) => setTimeout(resolve, 60_000));
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
import { definePluginApp, useBbContext } from "@bb/plugin-sdk/app";

function HelloCard() {
  const { projectId } = useBbContext();
  // Tailwind classes compile against the host theme's live CSS variables —
  // derive colors from the theme tokens, never hardcoded grays.
  return (
    <div className="rounded-md border border-border bg-card p-3 text-sm text-foreground">
      Hello from ${packageName}.{" "}
      {projectId === null ? "No project selected." : \`Project: \${projectId}.\`}
    </div>
  );
}

// The default export must be definePluginApp(...); BB interprets it after
// loading the bundle. Other slots: navPanel, threadPanelTab,
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
 * Typecheck-only tsconfig: server.ts compiles against the real BbPluginApi
 * contract from @bb/plugin-sdk (type-only, erased at load time); app.tsx is
 * included when the plugin declares a frontend entry.
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
        noEmit: true,
        skipLibCheck: true,
      },
      include: app ? ["server.ts", "app.tsx"] : ["server.ts"],
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

function readmeSource(packageName: string): string {
  const id = pluginIdOf(packageName);
  return `# ${packageName}

A BB plugin.

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
        // Typecheck-only (BB provides the SDK — and react — at runtime;
        // `bb plugin build` never bundles them). @bb/plugin-sdk is not
        // published yet, so installing it works only inside a BB checkout
        // for now.
        devDependencies: {
          "@bb/plugin-sdk": "*",
          "@types/node": "^22.0.0",
          ...(app ? { "@types/react": "^19.0.0" } : {}),
          typescript: "^5.7.0",
        },
      },
      null,
      2,
    ) + "\n",
  );
  await writeFile(join(targetDir, "server.ts"), serverEntrySource(packageName));
  await writeFile(join(targetDir, "tsconfig.json"), tsconfigSource(app));
  if (app) {
    await writeFile(join(targetDir, "app.tsx"), appEntrySource(packageName));
  }
  const skillDir = join(targetDir, "skills", "example-skill");
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, "SKILL.md"), skillSource());
  await writeFile(join(targetDir, ".gitignore"), "dist/\nnode_modules/\n");
  await writeFile(join(targetDir, "README.md"), readmeSource(packageName));
}
