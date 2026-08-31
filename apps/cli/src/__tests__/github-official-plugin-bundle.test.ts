import { cp, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 60_000 });
import { buildPluginApp, resolvePluginBuildToolchain } from "@bb/plugin-build";
function testToolchain() {
  return resolvePluginBuildToolchain(join(tmpdir(), "bb-toolchain-unused"));
}

const GITHUB_DIR = fileURLToPath(
  new URL("../../../../plugins/github", import.meta.url),
);

interface SlotRegistration {
  id: string;
  title?: string;
  icon?: string;
  path?: string;
  component: unknown;
  headerContent?: unknown;
}

interface ComposerRegistration {
  id: string;
  actions?: { id: string; component: unknown }[];
}

describe("GitHub official plugin frontend bundle", () => {
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
    const sharedUiLink = join(pluginDir, "node_modules", "@bb", "shared-ui");
    await mkdir(dirname(sharedUiLink), { recursive: true });
    await symlink(
      fileURLToPath(new URL("../../../../packages/shared-ui", import.meta.url)),
      sharedUiLink,
      "dir",
    );
    const { jsPath } = await buildPluginApp(
      pluginDir,
      "0.9.0-test",
      await testToolchain(),
    );

    const registered: Record<string, SlotRegistration[]> = {
      homepageSection: [],
      navPanel: [],
      threadPanelAction: [],
      experimental_newThreadPanelAction: [],
      sidebarFooterAction: [],
    };
    const composerCustomizations: ComposerRegistration[] = [];
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
      radixDialog: componentStub,
      radixDropdownMenu: componentStub,
      radixSelect: componentStub,
      radixTooltip: componentStub,
      pierreDiffs: componentStub,
      pierreDiffsReact: componentStub,
      clsx: componentStub,
      tailwindMerge: componentStub,
      classVarianceAuthority: componentStub,
      sharedUiIcon: componentStub,
    };
    const mod = (await import(
      /* @vite-ignore */ pathToFileURL(jsPath).href
    )) as {
      default: {
        __bbPluginApp: boolean;
        setup: (app: {
          slots: Record<string, (registration: SlotRegistration) => void>;
          composer: {
            customize(registration: ComposerRegistration): void;
          };
        }) => void;
      };
    };
    expect(mod.default.__bbPluginApp).toBe(true);
    mod.default.setup({
      slots: {
        homepageSection: (r) => registered.homepageSection.push(r),
        navPanel: (r) => registered.navPanel.push(r),
        threadPanelAction: (r) => registered.threadPanelAction.push(r),
        experimental_newThreadPanelAction: (r) =>
          registered.experimental_newThreadPanelAction.push(r),
        sidebarFooterAction: (r) => registered.sidebarFooterAction.push(r),
      },
      composer: {
        customize: (registration) =>
          composerCustomizations.push(registration),
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

    expect(registered.threadPanelAction).toHaveLength(2);
    expect(registered.threadPanelAction[0]).toMatchObject({
      id: "pull",
      title: "GitHub PR",
      icon: "Github",
    });
    expect(typeof registered.threadPanelAction[0]?.component).toBe("function");
    expect(registered.threadPanelAction[1]).toMatchObject({
      id: "add-item",
      title: "Add GitHub item",
      icon: "Github",
    });

    expect(registered.experimental_newThreadPanelAction).toHaveLength(1);
    expect(registered.experimental_newThreadPanelAction[0]).toMatchObject({
      id: "add-item",
      title: "Add GitHub item",
      icon: "Github",
    });

    expect(composerCustomizations).toHaveLength(1);
    expect(composerCustomizations[0]).toMatchObject({
      id: "github-item",
      actions: [{ id: "add", component: expect.any(Function) }],
    });

    expect(registered.homepageSection).toHaveLength(0);
    expect(registered.sidebarFooterAction).toHaveLength(0);
  });
});
