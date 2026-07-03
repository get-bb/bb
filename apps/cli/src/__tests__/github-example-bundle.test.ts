import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
