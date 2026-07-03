import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildPluginApp } from "@bb/plugin-build";

/**
 * Evaluates the real Linear hero example's built bundle against a stub
 * runtime (the plugin-build.test.ts pattern) and asserts its default export
 * registers exactly the expected slots. Built from a temp copy so this test
 * never races the server suite over examples/plugins/linear/dist.
 */
const LINEAR_DIR = fileURLToPath(
  new URL("../../../../examples/plugins/linear", import.meta.url),
);

interface SlotRegistration {
  id: string;
  title?: string;
  icon?: string;
  path?: string;
  component: unknown;
  visible?: (context: { threadId: string }) => boolean;
}

describe("linear example frontend bundle", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "bb-linear-bundle-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    delete (globalThis as { __bbPluginRuntime?: unknown }).__bbPluginRuntime;
  });

  it("registers the homepage section, board nav panel, and Issue tab with a sync visible()", async () => {
    const pluginDir = join(root, "linear");
    await cp(LINEAR_DIR, pluginDir, {
      recursive: true,
      filter: (source) => {
        const name = basename(source);
        return name !== "dist" && name !== "node_modules";
      },
    });
    const { jsPath } = await buildPluginApp(pluginDir);

    const registered: Record<string, SlotRegistration[]> = {
      homepageSection: [],
      navPanel: [],
      threadPanelTab: [],
      composerAccessory: [],
    };
    (globalThis as { __bbPluginRuntime?: unknown }).__bbPluginRuntime = {
      react: {},
      jsxRuntime: { jsx: () => ({}), jsxs: () => ({}), Fragment: {} },
      pluginSdkApp: {
        definePluginApp: (setup: unknown) => ({ __bbPluginApp: true, setup }),
      },
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

    expect(registered.homepageSection).toHaveLength(1);
    expect(registered.homepageSection[0]).toMatchObject({
      id: "open-issues",
      title: "Open Linear issues",
    });
    expect(typeof registered.homepageSection[0]?.component).toBe("function");

    expect(registered.navPanel).toHaveLength(1);
    expect(registered.navPanel[0]).toMatchObject({
      id: "board",
      title: "Linear",
      icon: "Columns",
      path: "board",
    });

    expect(registered.threadPanelTab).toHaveLength(1);
    expect(registered.threadPanelTab[0]).toMatchObject({
      id: "issue",
      title: "Issue",
    });
    // The sync visible() predicate reads the module-level link cache —
    // false before the cache loads (and the node-side prime is skipped, so
    // evaluating the bundle here had no side effects).
    const visible = registered.threadPanelTab[0]?.visible;
    expect(typeof visible).toBe("function");
    expect(visible?.({ threadId: "thr_anything" })).toBe(false);

    expect(registered.composerAccessory).toHaveLength(0);
  }, 60_000);
});
