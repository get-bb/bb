import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PLUGIN_SDK_MAJOR, PLUGIN_SDK_VERSION } from "@bb/domain";
import { scaffoldPlugin } from "@bb/templates/plugin-scaffold";
import { buildPluginApp } from "@bb/plugin-build";

// Pass-through wrapper around the real Tailwind compiler (a third-party
// boundary) so a single test can make the CSS step fail after esbuild
// succeeded. Every other test hits the real `compile`.
const tailwindFailure = vi.hoisted(() => ({ error: null as Error | null }));
vi.mock("@tailwindcss/node", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tailwindcss/node")>();
  const compile: typeof actual.compile = (...args) => {
    if (tailwindFailure.error) throw tailwindFailure.error;
    return actual.compile(...args);
  };
  return { ...actual, compile };
});

const FIXTURE_PACKAGE_JSON = JSON.stringify(
  {
    name: "bb-plugin-fixture",
    version: "0.1.0",
    type: "module",
    bb: { server: "./server.ts", app: "./app.tsx" },
  },
  null,
  2,
);

// Exercises every shimmed specifier a real plugin hits: react (hook), jsx
// (automatic transform → react/jsx-runtime), react-dom/client, the SDK — and
// a Tailwind utility class for the CSS pass.
const FIXTURE_APP_TSX = `
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { definePluginApp } from "@bb/plugin-sdk/app";

void createRoot;

function Card() {
  const [count] = useState(0);
  return (
    <div className="line-clamp-3 bg-background text-sm text-muted-foreground animate-in fade-in-0 rounded-lg">
      count: {count}
    </div>
  );
}

export default definePluginApp(Card);
`;

describe("buildPluginApp", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "bb-plugin-build-"));
  });

  afterEach(async () => {
    tailwindFailure.error = null;
    await rm(root, { recursive: true, force: true });
  });

  async function writeFixture(): Promise<void> {
    await writeFile(join(root, "package.json"), FIXTURE_PACKAGE_JSON);
    await writeFile(join(root, "server.ts"), "export default () => {};\n");
    await writeFile(join(root, "app.tsx"), FIXTURE_APP_TSX);
  }

  it("builds an ESM bundle with runtime shims, plugin-scoped CSS, and the SDK meta sidecar", async () => {
    await writeFixture();
    const result = await buildPluginApp(root);

    const js = await readFile(result.jsPath, "utf8");
    // ESM output.
    expect(js).toMatch(/export\s*\{/);
    // Every shared-runtime module resolves through the global runtime — the
    // production jsx-runtime included (the automatic JSX transform's import
    // must not survive as a bare specifier or bundle React's own copy).
    expect(js).toContain("globalThis.__bbPluginRuntime");
    for (const slot of ["react", "reactDomClient", "jsxRuntime", "pluginSdkApp"]) {
      expect(js).toContain(`.${slot}`);
    }
    expect(js).not.toMatch(/from\s*["']react/);
    // No bundled React internals.
    expect(js).not.toContain("react.development");
    expect(js).not.toContain("__SECRET_INTERNALS");
    expect(js).not.toContain("__CLIENT_INTERNALS");

    const css = await readFile(result.cssPath, "utf8");
    expect(css).toContain(".line-clamp-3");
    // Host token bridge: semantic utilities compile against the live host
    // CSS variables (no bridge → these classes are silently absent).
    expect(css).toMatch(/\.bg-background\s*\{[^}]*var\(--background\)/);
    expect(css).toMatch(/\.text-muted-foreground\s*\{[^}]*var\(--muted-foreground\)/);
    expect(css).toMatch(/\.rounded-lg\s*\{[^}]*var\(--radius\)/);
    // Host typography scale: the utility reads the token, and the plugin
    // sheet carries the host's override (0.8125rem, not Tailwind's 0.875rem).
    expect(css).toMatch(/\.text-sm\s*\{[^}]*var\(--text-sm/);
    expect(css).toContain("--text-sm: 0.8125rem");
    // tw-animate-css utilities (host idiom for overlay open/close animation).
    expect(css).toContain(".animate-in");
    expect(css).toContain(".fade-in-0");
    // Utilities stay plugin-scoped.
    expect(css).toContain("@scope ([data-bb-plugin-root])");

    const meta = JSON.parse(await readFile(result.metaPath, "utf8"));
    expect(meta).toEqual({
      sdkMajor: PLUGIN_SDK_MAJOR,
      sdkVersion: PLUGIN_SDK_VERSION,
    });
  });

  it("throws at import time without the BB runtime and loads once slots are set", async () => {
    await writeFixture();
    const { jsPath } = await buildPluginApp(root);
    const url = pathToFileURL(jsPath).href;

    await expect(import(/* @vite-ignore */ url)).rejects.toThrow(
      /must be loaded by the BB app/,
    );

    (globalThis as { __bbPluginRuntime?: unknown }).__bbPluginRuntime = {
      react: { useState: () => [0, () => {}] },
      reactDomClient: { createRoot: () => ({}) },
      jsxRuntime: { jsx: () => ({}), jsxs: () => ({}), Fragment: {} },
      pluginSdkApp: { definePluginApp: (value: unknown) => value },
    };
    try {
      // Query string busts the cached failed evaluation above.
      const mod = await import(/* @vite-ignore */ `${url}?with-runtime`);
      expect(mod.default).toBeDefined();
    } finally {
      delete (globalThis as { __bbPluginRuntime?: unknown }).__bbPluginRuntime;
    }
  });

  it("shims the shared-singleton packages (portal radix, sonner, vaul, @pierre/diffs)", async () => {
    await writeFile(join(root, "package.json"), FIXTURE_PACKAGE_JSON);
    await writeFile(
      join(root, "app.tsx"),
      [
        `import * as Dialog from "@radix-ui/react-dialog";`,
        `import * as AlertDialog from "@radix-ui/react-alert-dialog";`,
        `import { toast } from "sonner";`,
        `import { Drawer } from "vaul";`,
        `import { parsePatchFiles } from "@pierre/diffs";`,
        `import { FileDiff } from "@pierre/diffs/react";`,
        `export default () => [Dialog, AlertDialog, toast, Drawer, parsePatchFiles, FileDiff];`,
      ].join("\n"),
    );
    const { jsPath } = await buildPluginApp(root);
    const js = await readFile(jsPath, "utf8");
    for (const slot of [
      "radixDialog",
      "radixAlertDialog",
      "sonner",
      "vaul",
      "pierreDiffs",
      "pierreDiffsReact",
    ]) {
      expect(js).toContain(`.${slot}`);
    }
    // Never bundled, never left as bare imports — always the runtime shim.
    expect(js).not.toMatch(/from\s*["']@radix-ui/);
    expect(js).not.toMatch(/from\s*["']sonner/);
    expect(js).not.toMatch(/from\s*["']vaul/);
    expect(js).not.toMatch(/from\s*["']@pierre/);
  });

  it("shims explicit react/jsx-dev-runtime imports (dev-mode transform output)", async () => {
    await writeFile(join(root, "package.json"), FIXTURE_PACKAGE_JSON);
    await writeFile(
      join(root, "app.tsx"),
      `import { jsxDEV } from "react/jsx-dev-runtime";\n` +
        `export default () => jsxDEV("div", { children: "x" }, undefined, false, undefined, undefined);\n`,
    );
    const { jsPath } = await buildPluginApp(root);
    const js = await readFile(jsPath, "utf8");
    expect(js).toContain(".jsxDevRuntime");
    expect(js).not.toMatch(/from\s*["']react/);
  });

  it("keeps the previous dist artifacts intact when a rebuild fails after esbuild", async () => {
    await writeFixture();
    const first = await buildPluginApp(root);
    const originalJs = await readFile(first.jsPath, "utf8");
    const originalCss = await readFile(first.cssPath, "utf8");
    const originalMeta = await readFile(first.metaPath, "utf8");

    // Change the entry so a non-atomic rebuild would visibly overwrite
    // app.js, then make the Tailwind step (which runs after esbuild) throw.
    await writeFile(
      join(root, "app.tsx"),
      FIXTURE_APP_TSX.replace("count:", "changed:"),
    );
    tailwindFailure.error = new Error("tailwind exploded");

    await expect(buildPluginApp(root)).rejects.toThrow("tailwind exploded");

    // dist/ still serves the last complete build — no fresh app.js beside
    // stale css/meta, and no staging leftovers.
    expect(await readFile(first.jsPath, "utf8")).toBe(originalJs);
    expect(await readFile(first.cssPath, "utf8")).toBe(originalCss);
    expect(await readFile(first.metaPath, "utf8")).toBe(originalMeta);
    expect((await readdir(join(root, "dist"))).sort()).toEqual([
      "app.css",
      "app.js",
      "app.meta.json",
    ]);
  });

  it("errors clearly when the plugin has no bb.app entry", async () => {
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        name: "bb-plugin-headless",
        version: "0.1.0",
        bb: { server: "./server.ts" },
      }),
    );
    await expect(buildPluginApp(root)).rejects.toThrow(/no frontend entry/);
  });

  it("errors when bb.app points at a missing file", async () => {
    await writeFile(join(root, "package.json"), FIXTURE_PACKAGE_JSON);
    await expect(buildPluginApp(root)).rejects.toThrow(/missing file/);
  });

  it("builds the `bb plugin new --app` scaffold end to end", async () => {
    const targetDir = join(root, "bb-plugin-scaffolded");
    await scaffoldPlugin({
      targetDir,
      packageName: "bb-plugin-scaffolded",
      bbVersion: "0.9.0",
      app: true,
    });
    // The vendored starter components bundle real npm deps (`bb plugin new`
    // runs npm install for authors); the offline test links them from the
    // repo's own install instead.
    await linkScaffoldDeps(targetDir, [
      "class-variance-authority",
      "clsx",
      "tailwind-merge",
      "@radix-ui/react-slot",
      "@hugeicons/react",
      "@hugeicons/core-free-icons",
    ]);
    const result = await buildPluginApp(targetDir);
    const js = await readFile(result.jsPath, "utf8");
    expect(js).toContain("globalThis.__bbPluginRuntime");
    const css = await readFile(result.cssPath, "utf8");
    expect(css).toContain(".rounded-md");

    // The scaffold's default export must be a definePluginApp product the
    // host interpreter accepts (a stub runtime stands in for the BB app).
    (globalThis as { __bbPluginRuntime?: unknown }).__bbPluginRuntime = {
      // The vendored starter components bundle radix Slot, which calls
      // forwardRef at module scope — the stub must provide it.
      react: { forwardRef: (render: unknown) => render },
      jsxRuntime: { jsx: () => ({}), jsxs: () => ({}), Fragment: {} },
      pluginSdkApp: {
        definePluginApp: (setup: unknown) => ({
          __bbPluginApp: true,
          setup,
        }),
        useBbContext: () => ({ projectId: null, threadId: null }),
      },
    };
    try {
      const mod = (await import(
        /* @vite-ignore */ pathToFileURL(result.jsPath).href
      )) as { default?: { __bbPluginApp?: unknown; setup?: unknown } };
      expect(mod.default?.__bbPluginApp).toBe(true);
      expect(typeof mod.default?.setup).toBe("function");
    } finally {
      delete (globalThis as { __bbPluginRuntime?: unknown }).__bbPluginRuntime;
    }
  });
});

/**
 * Symlink packages from the repo's install (resolved the way apps/app sees
 * them) into a scaffold's node_modules so esbuild can bundle the vendored
 * starter components without a network install.
 */
async function linkScaffoldDeps(
  targetDir: string,
  packageNames: string[],
): Promise<void> {
  const testDir = dirname(fileURLToPath(import.meta.url));
  const appRequire = createRequire(
    join(testDir, "..", "..", "..", "app", "package.json"),
  );
  for (const name of packageNames) {
    const entry = appRequire.resolve(name);
    let packageRoot = dirname(entry);
    while (true) {
      const candidate = join(packageRoot, "package.json");
      if (existsSync(candidate)) {
        const parsed = JSON.parse(readFileSync(candidate, "utf8")) as {
          name?: string;
        };
        if (parsed.name === name) break;
      }
      const parent = dirname(packageRoot);
      if (parent === packageRoot) {
        throw new Error(`could not find package root for ${name}`);
      }
      packageRoot = parent;
    }
    const linkPath = join(targetDir, "node_modules", name);
    await mkdir(dirname(linkPath), { recursive: true });
    await symlink(packageRoot, linkPath, "dir");
  }
}
