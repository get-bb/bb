import { existsSync, readFileSync } from "node:fs";
import { cp, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The example now bundles real deps (hugeicons icon maps among them) —
// parsing that graph blows the 5s default on cold CI runners.
vi.setConfig({ testTimeout: 60_000 });
import { buildPluginApp } from "@bb/plugin-build";

/**
 * Evaluates the GitHub hero example's built bundle against a stub runtime
 * (the plugin-build.test.ts pattern) and asserts its default export
 * registers exactly the expected slots. Built from a temp copy so this test
 * never races the server suite over examples/plugins/github/dist.
 */
const GITHUB_DIR = fileURLToPath(
  new URL("../../../../examples/plugins/github", import.meta.url),
);

interface SlotRegistration {
  id: string;
  title?: string;
  icon?: string;
  path?: string;
  component: unknown;
  headerContent?: unknown;
}

describe("github example frontend bundle", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "bb-github-bundle-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    delete (globalThis as { __bbPluginRuntime?: unknown }).__bbPluginRuntime;
  });

  it("registers a single GitHub nav panel with header content", async () => {
    const pluginDir = join(root, "github");
    await cp(GITHUB_DIR, pluginDir, {
      recursive: true,
      filter: (source) => {
        const name = basename(source);
        return name !== "dist" && name !== "node_modules";
      },
    });
    // The temp copy has no node_modules; link the deps the bundle actually
    // inlines (shimmed packages — react, radix portal families, sonner, vaul
    // — never resolve from disk) so buildPluginApp can bundle them.
    await linkBundledDeps(pluginDir, [
      "class-variance-authority",
      "clsx",
      "tailwind-merge",
      "@radix-ui/react-slot",
      "@radix-ui/react-tabs",
      "@hugeicons/react",
      "@hugeicons/core-free-icons",
    ]);
    const { jsPath } = await buildPluginApp(pluginDir);

    const registered: Record<string, SlotRegistration[]> = {
      homepageSection: [],
      navPanel: [],
      threadPanelTab: [],
      composerAccessory: [],
    };
    // Vendored components read e.g. `Primitive.Trigger.displayName` at
    // module scope, so shimmed slots must answer any property chain — a
    // self-returning proxy does.
    const componentStub: unknown = new Proxy(function stub() {}, {
      get: (target, prop) =>
        prop === "prototype"
          ? Reflect.get(target, prop)
          : (componentStub as object),
      set: () => true,
    });
    (globalThis as { __bbPluginRuntime?: unknown }).__bbPluginRuntime = {
      // Bundled radix primitives (slot, tabs) call these at module scope.
      react: {
        forwardRef: (render: unknown) => render,
        createContext: () => ({}),
        memo: (component: unknown) => component,
      },
      reactDom: componentStub,
      reactDomClient: componentStub,
      jsxRuntime: { jsx: () => ({}), jsxs: () => ({}), Fragment: {} },
      pluginSdkApp: {
        definePluginApp: (setup: unknown) => ({ __bbPluginApp: true, setup }),
      },
      // Shimmed singleton packages the vendored components import.
      sonner: componentStub,
      vaul: componentStub,
      radixDropdownMenu: componentStub,
      radixSelect: componentStub,
    };
    const mod = (await import(
      /* @vite-ignore */ pathToFileURL(jsPath).href
    )) as {
      default: {
        __bbPluginApp: boolean;
        setup: (app: {
          slots: Record<string, (registration: SlotRegistration) => void>;
        }) => void;
      };
    };
    expect(mod.default.__bbPluginApp).toBe(true);
    mod.default.setup({
      slots: {
        homepageSection: (r) => registered.homepageSection.push(r),
        navPanel: (r) => registered.navPanel.push(r),
        threadPanelTab: (r) => registered.threadPanelTab.push(r),
        composerAccessory: (r) => registered.composerAccessory.push(r),
      },
    });

    expect(registered.navPanel).toHaveLength(1);
    expect(registered.navPanel[0]).toMatchObject({
      id: "github",
      title: "GitHub",
      icon: "Github",
      path: "github",
    });
    expect(typeof registered.navPanel[0]?.component).toBe("function");
    expect(typeof registered.navPanel[0]?.headerContent).toBe("function");

    expect(registered.homepageSection).toHaveLength(0);
    expect(registered.threadPanelTab).toHaveLength(0);
    expect(registered.composerAccessory).toHaveLength(0);
  });
});

/**
 * Symlinks real packages (resolved through apps/app, which depends on all of
 * them) into the temp plugin dir's node_modules — same pattern as
 * plugin-build.test.ts's linkScaffoldDeps.
 */
async function linkBundledDeps(
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
