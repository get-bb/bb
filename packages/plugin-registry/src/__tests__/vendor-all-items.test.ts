import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildPluginApp,
  resolvePluginBuildToolchain,
} from "@bb/plugin-build";

/**
 * The monorepo's own toolchain: resolved from `@bb/plugin-build`'s
 * devDependencies, so tests never download one.
 */
function testToolchain() {
  return resolvePluginBuildToolchain(
    path.join(os.tmpdir(), "bb-toolchain-unused"),
  );
}

/**
 * The registry's CI gate (plugin design §5.5 exit criteria): vendor EVERY
 * registry item into one fixture plugin and run the real `bb plugin build`
 * over it. Catches items whose source no longer compiles outside the app
 * (missing registryDependency links, an app-internal import that escaped the
 * closure walker, a dep missing from the item), and asserts the compiled CSS
 * carries the host token bridge the components rely on.
 *
 * The fixture must live INSIDE this package (not os.tmpdir()) so esbuild's
 * node_modules walk-up resolves the vendored items' npm deps from this
 * package's devDependencies — which mirror the union of item `dependencies`.
 */

const packageRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const registryDir = path.join(packageRoot, "r");
let fixtureDir: string;

interface RegistryItemFile {
  content: string;
  target: string;
}

interface RegistryItem {
  name: string;
  files?: RegistryItemFile[];
}

beforeAll(async () => {
  fixtureDir = await mkdtemp(path.join(packageRoot, ".vendor-fixture-"));
});

afterAll(async () => {
  await rm(fixtureDir, { recursive: true, force: true });
});

describe("plugin component registry", () => {
  it("every item vendors into a plugin that bb plugin build compiles", async () => {
    const itemNames: string[] = [];
    for (const fileName of (await readdir(registryDir)).sort()) {
      if (fileName === "index.json") continue;
      const item = JSON.parse(
        await readFile(path.join(registryDir, fileName), "utf8"),
      ) as RegistryItem;
      itemNames.push(item.name);
      for (const file of item.files ?? []) {
        const target = path.join(fixtureDir, file.target);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, file.content);
      }
    }
    expect(itemNames.length).toBeGreaterThanOrEqual(50);

    // Entry importing every vendored module, so esbuild compiles them all.
    const uiFiles = (
      await readdir(path.join(fixtureDir, "components", "ui"))
    ).filter((name) => name.endsWith(".tsx") || name.endsWith(".ts"));
    const imports = uiFiles
      .map(
        (name, i) =>
          `import * as m${i} from "./components/ui/${name.replace(/\.tsx?$/, "")}";`,
      )
      .join("\n");
    await writeFile(
      path.join(fixtureDir, "app.tsx"),
      `${imports}\n` +
        `const modules = [${uiFiles.map((_, i) => `m${i}`).join(", ")}];\n` +
        `export default function App() {\n` +
        `  return <div className="bg-background text-sm animate-in fade-in-0 rounded-lg">{modules.length}</div>;\n` +
        `}\n`,
    );
    await writeFile(
      path.join(fixtureDir, "package.json"),
      JSON.stringify(
        {
          name: "bb-plugin-registry-fixture",
          version: "0.0.0",
          type: "module",
          bb: {
            name: "Registry vendor fixture",
            description:
              "Verify every registry item can be vendored and bundled.",
            branding: { icon: "Package" },
            server: "./server.ts",
            app: "./app.tsx",
          },
        },
        null,
        2,
      ),
    );
    await writeFile(
      path.join(fixtureDir, "server.ts"),
      "export default function plugin() {}\n",
    );
    // esbuild reads tsconfig paths for the "@/*" alias the vendored source
    // uses — the same file `bb plugin new` scaffolds.
    await writeFile(
      path.join(fixtureDir, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            jsx: "react-jsx",
            baseUrl: ".",
            paths: { "@/*": ["./*"] },
          },
        },
        null,
        2,
      ),
    );

    const result = await buildPluginApp(
      fixtureDir,
      "0.9.0-test",
      await testToolchain(),
    );

    const js = await readFile(result.jsPath, "utf8");
    // Shared singletons resolve through the runtime, never bundled copies.
    expect(js).toContain("globalThis.__bbPluginRuntime");
    // (sonner has no vendored component — plugins import { toast } directly;
    // that shim is asserted in apps/cli plugin-build.test.ts.)
    for (const slot of ["radixDialog", "radixAlertDialog", "vaul"]) {
      expect(js).toContain(`.${slot}`);
    }
    expect(js).not.toMatch(/from\s*["']react["']/);
    // Non-singleton deps (lucide, cmdk, hugeicons, non-portal radix) bundle
    // from this package's devDependencies — esbuild hard-errors on any
    // unresolved import, so a successful build proves the closure is whole.

    const css = await readFile(result.cssPath, "utf8");
    // Utilities scope to this plugin's own mounts (id derived from the
    // package name), with a generic-root fallback for pre-id hosts.
    expect(css).toContain(
      ":where([data-bb-plugin=registry-fixture],[data-bb-plugin-root]:not([data-bb-plugin]))",
    );
    expect(css).toMatch(/var\(--background\)/);
  });
});
