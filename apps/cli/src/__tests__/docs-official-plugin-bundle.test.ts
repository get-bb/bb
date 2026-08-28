import { cp, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 120_000 });
import { buildPluginApp, resolvePluginBuildToolchain } from "@bb/plugin-build";
function testToolchain() {
  return resolvePluginBuildToolchain(join(tmpdir(), "bb-toolchain-unused"));
}

const SIMPLE_NOTES_DIR = fileURLToPath(
  new URL("../../../../plugins/docs", import.meta.url),
);

interface SlotRegistration {
  id: string;
  title?: string;
  icon?: string;
  path?: string;
  extensions?: string[];
  component: () => void;
}

interface PluginSetup {
  slots: Record<string, (registration: SlotRegistration) => void>;
}

interface PluginApp {
  __bbPluginApp: true;
  setup: (app: PluginSetup) => void;
}

interface PluginRuntime {
  react: {
    forwardRef: (render: () => void) => () => void;
    createContext: () => object;
    memo: (component: () => void) => () => void;
  };
  reactDom: () => void;
  reactDomClient: () => void;
  jsxRuntime: { jsx: () => object; jsxs: () => object; Fragment: object };
  pluginSdkApp: {
    definePluginApp: (setup: (app: PluginSetup) => void) => PluginApp;
  };
  sonner: () => void;
  vaul: () => void;
  pierreDiffs: () => void;
  pierreDiffsReact: () => void;
  radixContextMenu: () => void;
  radixDialog: () => void;
  radixSelect: () => void;
  clsx: () => void;
  tailwindMerge: () => void;
  classVarianceAuthority: () => void;
  sharedUiIcon: () => void;
}

interface RegisteredSlots {
  homepageSection: SlotRegistration[];
  navPanel: SlotRegistration[];
  threadPanelAction: SlotRegistration[];
  sidebarFooterAction: SlotRegistration[];
  fileOpener: SlotRegistration[];
  messageDirective: SlotRegistration[];
}

const PLUGIN_RUNTIME_KEY = "__bbPluginRuntime";

describe("Docs official plugin frontend bundle", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "bb-simple-notes-bundle-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    Reflect.deleteProperty(globalThis, PLUGIN_RUNTIME_KEY);
    Reflect.deleteProperty(globalThis, "document");
  });

  it("registers the Docs nav, directive, thread-panel, and file-opener surfaces", async () => {
    const pluginDir = join(root, "simple-notes");
    await cp(SIMPLE_NOTES_DIR, pluginDir, {
      recursive: true,
      filter: (source) => {
        const name = basename(source);
        return name !== "dist" && name !== "node_modules";
      },
    });
    await symlink(
      join(SIMPLE_NOTES_DIR, "node_modules"),
      join(pluginDir, "node_modules"),
      "dir",
    );
    const { jsPath } = await buildPluginApp(
      pluginDir,
      "0.9.0-test",
      await testToolchain(),
    );

    const registered: RegisteredSlots = {
      homepageSection: [],
      navPanel: [],
      threadPanelAction: [],
      sidebarFooterAction: [],
      fileOpener: [],
      messageDirective: [],
    };
    const componentStubTarget = function stub() {};
    let componentStub: typeof componentStubTarget;
    componentStub = new Proxy(componentStubTarget, {
      get: (target, prop) =>
        prop === "prototype" ? target.prototype : componentStub,
      set: () => true,
    });
    const runtime: PluginRuntime = {
      react: {
        forwardRef: (render) => render,
        createContext: () => ({}),
        memo: (component) => component,
      },
      reactDom: componentStub,
      reactDomClient: componentStub,
      jsxRuntime: { jsx: () => ({}), jsxs: () => ({}), Fragment: {} },
      pluginSdkApp: {
        definePluginApp: (setup) => ({ __bbPluginApp: true, setup }),
      },
      sonner: componentStub,
      vaul: componentStub,
      pierreDiffs: componentStub,
      pierreDiffsReact: componentStub,
      radixContextMenu: componentStub,
      radixDialog: componentStub,
      radixSelect: componentStub,
      clsx: componentStub,
      tailwindMerge: componentStub,
      classVarianceAuthority: componentStub,
      sharedUiIcon: componentStub,
    };
    Object.defineProperty(globalThis, PLUGIN_RUNTIME_KEY, {
      configurable: true,
      value: runtime,
      writable: true,
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        createElement: () => ({ innerHTML: "", textContent: "", style: {} }),
        documentElement: { style: {} },
        addEventListener: () => {},
        removeEventListener: () => {},
      },
      writable: true,
    });
    const mod: { default: PluginApp } = await import(
      /* @vite-ignore */ pathToFileURL(jsPath).href
    );
    expect(mod.default.__bbPluginApp).toBe(true);
    mod.default.setup({
      slots: {
        homepageSection: (r) => registered.homepageSection.push(r),
        navPanel: (r) => registered.navPanel.push(r),
        threadPanelAction: (r) => registered.threadPanelAction.push(r),
        sidebarFooterAction: (r) => registered.sidebarFooterAction.push(r),
        fileOpener: (r) => registered.fileOpener.push(r),
        messageDirective: (r) => registered.messageDirective.push(r),
      },
    });

    expect(registered.navPanel).toHaveLength(1);
    expect(registered.navPanel[0]).toMatchObject({
      id: "docs",
      title: "Docs",
      path: "docs",
    });
    expect(registered.navPanel[0]?.component).toEqual(expect.any(Function));

    expect(registered.homepageSection).toHaveLength(0);
    expect(registered.threadPanelAction[0]).toMatchObject({
      id: "document",
      title: "Document",
    });
    expect(registered.threadPanelAction[0]?.component).toEqual(
      expect.any(Function),
    );
    expect(registered.messageDirective[0]).toMatchObject({ id: "docs" });
    expect(registered.messageDirective[0]?.component).toEqual(
      expect.any(Function),
    );
    expect(registered.sidebarFooterAction).toHaveLength(0);
    expect(registered.fileOpener[0]).toMatchObject({
      id: "docs",
      title: "Markdown",
      extensions: ["md", "mdx", "markdown"],
    });
    expect(registered.fileOpener[0]?.component).toEqual(expect.any(Function));
  });
});
