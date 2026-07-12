import { cp, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The Simple Notes example bundles Tiptap (prosemirror) — a large graph that
// blows the 5s default on cold CI runners.
vi.setConfig({ testTimeout: 120_000 });
import { buildPluginApp } from "@bb/plugin-build";

/**
 * Evaluates the Simple Notes example's built bundle against a stub runtime (the
 * github-example-bundle.test.ts pattern) and asserts its default export
 * registers the installed plugin's nav panel surface.
 */
const SIMPLE_NOTES_DIR = fileURLToPath(
  new URL("../../../../examples/plugins/simple-notes", import.meta.url),
);

interface SlotRegistration {
  id: string;
  title?: string;
  icon?: string;
  path?: string;
  chrome?: string;
  extensions?: string[];
  component: unknown;
}

describe("simple notes example frontend bundle", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "bb-simple-notes-bundle-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    delete (globalThis as { __bbPluginRuntime?: unknown }).__bbPluginRuntime;
    delete (globalThis as { document?: unknown }).document;
  });

  it("registers the Simple Notes nav panel", async () => {
    const pluginDir = join(root, "simple-notes");
    await cp(SIMPLE_NOTES_DIR, pluginDir, {
      recursive: true,
      filter: (source) => {
        const name = basename(source);
        return name !== "dist" && name !== "node_modules";
      },
    });
    // The example's own node_modules already holds every bundled dep
    // (Tiptap among them) — link it wholesale instead of per-package.
    await symlink(
      join(SIMPLE_NOTES_DIR, "node_modules"),
      join(pluginDir, "node_modules"),
      "dir",
    );
    const { jsPath } = await buildPluginApp(pluginDir, "0.9.0-test");

    const registered: Record<string, SlotRegistration[]> = {
      homepageSection: [],
      navPanel: [],
      threadPanelAction: [],
      composerAccessory: [],
      sidebarFooterAction: [],
      fileOpener: [],
    };
    const componentStub: unknown = new Proxy(function stub() {}, {
      get: (target, prop) =>
        prop === "prototype"
          ? Reflect.get(target, prop)
          : (componentStub as object),
      set: () => true,
    });
    (globalThis as { __bbPluginRuntime?: unknown }).__bbPluginRuntime = {
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
      sonner: componentStub,
      vaul: componentStub,
      pierreDiffs: componentStub,
      pierreDiffsReact: componentStub,
    };
    // Some browser-bundle dependencies touch `document` at module scope.
    // Registration evaluation never renders, so inert stubs suffice.
    (globalThis as { document?: unknown }).document = {
      createElement: () => ({ innerHTML: "", textContent: "", style: {} }),
      documentElement: { style: {} },
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
        threadPanelAction: (r) => registered.threadPanelAction.push(r),
        composerAccessory: (r) => registered.composerAccessory.push(r),
        sidebarFooterAction: (r) => registered.sidebarFooterAction.push(r),
        fileOpener: (r) => registered.fileOpener.push(r),
      },
    });

    expect(registered.navPanel).toHaveLength(1);
    expect(registered.navPanel[0]).toMatchObject({
      id: "simple-notes",
      title: "Simple Notes",
      path: "simple-notes",
      chrome: "none",
    });
    expect(typeof registered.navPanel[0]?.component).toBe("function");

    expect(registered.homepageSection).toHaveLength(0);
    expect(registered.threadPanelAction).toHaveLength(0);
    expect(registered.composerAccessory).toHaveLength(0);
    expect(registered.sidebarFooterAction).toHaveLength(0);
    expect(registered.fileOpener).toHaveLength(0);
  });
});
