import { describe, expect, it, vi } from "vitest";
import {
  collectPluginAppRegistrations,
  definePluginApp,
  interpretPluginFrontends,
  isPluginAppDefinition,
} from "./plugin-app-definition";
import type { PluginFrontendRecord } from "./plugin-frontend";
import type { PluginRegistrationSet } from "./plugin-slots";

function Component() {
  return null;
}

describe("definePluginApp", () => {
  it("brands the setup for host detection", () => {
    const definition = definePluginApp(() => {});
    expect(isPluginAppDefinition(definition)).toBe(true);
    expect(isPluginAppDefinition({})).toBe(false);
    expect(isPluginAppDefinition({ __bbPluginApp: true })).toBe(false);
    expect(isPluginAppDefinition(null)).toBe(false);
  });

  it("rejects a non-function setup", () => {
    expect(() => definePluginApp(undefined as unknown as () => void)).toThrow(
      /setup function/,
    );
  });
});

describe("collectPluginAppRegistrations", () => {
  it("collects every slot kind as plain data", () => {
    const run = () => {};
    const definition = definePluginApp((app) => {
      app.slots.homepageSection({
        id: "issues",
        title: "Issues",
        component: Component,
      });
      app.slots.settingsSection({
        id: "custom-settings",
        title: "Custom settings",
        component: Component,
      });
      app.slots.navPanel({
        id: "board",
        title: "Board",
        icon: "columns",
        path: "board",
        component: Component,
      });
      app.slots.threadPanelAction({
        id: "issue",
        title: "Issue",
        icon: "Columns",
        component: Component,
        run,
      });
      app.slots.composerAccessory({ id: "picker", component: Component });
      app.slots.sidebarFooterAction({
        id: "remote",
        title: "Remote access",
        icon: "Smartphone",
        run,
      });
      app.slots.fileOpener({
        id: "editor",
        title: "Notes editor",
        extensions: ["md", "mdx"],
        component: Component,
      });
      app.slots.messageDirective({
        id: "inline-vis",
        component: Component,
      });
      app.slots.experimental_messageAction({
        id: "summarize",
        title: "Summarize",
        icon: "Zap",
        run,
      });
    });

    const registrations = collectPluginAppRegistrations(definition);
    expect(registrations.homepageSections).toEqual([
      { id: "issues", title: "Issues", component: Component },
    ]);
    expect(registrations.settingsSections).toEqual([
      {
        id: "custom-settings",
        title: "Custom settings",
        component: Component,
      },
    ]);
    expect(registrations.navPanels).toEqual([
      {
        id: "board",
        title: "Board",
        icon: "columns",
        path: "board",
        component: Component,
      },
    ]);
    expect(registrations.threadPanelActions).toEqual([
      {
        id: "issue",
        title: "Issue",
        icon: "Columns",
        component: Component,
        run,
      },
    ]);
    expect(registrations.composerAccessories).toEqual([
      { id: "picker", component: Component },
    ]);
    expect(registrations.sidebarFooterActions).toEqual([
      {
        id: "remote",
        title: "Remote access",
        icon: "Smartphone",
        run,
      },
    ]);
    expect(registrations.fileOpeners).toEqual([
      {
        id: "editor",
        title: "Notes editor",
        extensions: ["md", "mdx"],
        component: Component,
      },
    ]);
    expect(registrations.messageDirectives).toEqual([
      { id: "inline-vis", component: Component },
    ]);
    expect(registrations.messageActions).toEqual([
      { id: "summarize", title: "Summarize", icon: "Zap", run },
    ]);
  });

  it.each([
    [
      "settings section with a non-string title",
      () =>
        definePluginApp((app) => {
          app.slots.settingsSection({
            id: "x",
            title: 12 as never,
            component: Component,
          });
        }),
      /"title" must be a string when set/,
    ],
    [
      "duplicate settings section id",
      () =>
        definePluginApp((app) => {
          app.slots.settingsSection({ id: "a", component: Component });
          app.slots.settingsSection({ id: "a", component: Component });
        }),
      /duplicate id/,
    ],
    [
      "bad id",
      () =>
        definePluginApp((app) => {
          app.slots.homepageSection({
            id: "has space",
            title: "X",
            component: Component,
          });
        }),
      /"id" must match/,
    ],
    [
      "message action without a run function",
      () =>
        definePluginApp((app) => {
          app.slots.experimental_messageAction({
            id: "no-run",
            title: "No run",
            run: undefined as never,
          });
        }),
      /"run" must be a function/,
    ],
    [
      "duplicate message action id",
      () =>
        definePluginApp((app) => {
          app.slots.experimental_messageAction({ id: "a", title: "A", run: () => {} });
          app.slots.experimental_messageAction({ id: "a", title: "B", run: () => {} });
        }),
      /duplicate id "a"/,
    ],
    [
      "duplicate id",
      () =>
        definePluginApp((app) => {
          app.slots.composerAccessory({ id: "a", component: Component });
          app.slots.composerAccessory({ id: "a", component: Component });
        }),
      /duplicate id/,
    ],
    [
      "sidebar footer action missing run",
      () =>
        definePluginApp((app) => {
          app.slots.sidebarFooterAction({
            id: "x",
            title: "X",
            icon: "Smartphone",
          } as never);
        }),
      /"run" must be a function/,
    ],
    [
      "nav panel path with slash",
      () =>
        definePluginApp((app) => {
          app.slots.navPanel({
            id: "x",
            title: "X",
            icon: "columns",
            path: "a/b",
            component: Component,
          });
        }),
      /"path" must match/,
    ],
    [
      "file opener with no extensions",
      () =>
        definePluginApp((app) => {
          app.slots.fileOpener({
            id: "x",
            title: "X",
            extensions: [],
            component: Component,
          });
        }),
      /"extensions" must be a non-empty array/,
    ],
    [
      "file opener with a dotted extension",
      () =>
        definePluginApp((app) => {
          app.slots.fileOpener({
            id: "x",
            title: "X",
            extensions: [".md"],
            component: Component,
          });
        }),
      /extensions must be lowercase alphanumerics/,
    ],
    [
      "thread panel action with a non-function run",
      () =>
        definePluginApp((app) => {
          app.slots.threadPanelAction({
            id: "x",
            title: "X",
            component: Component,
            run: "nope" as never,
          });
        }),
      /"run" must be a function/,
    ],
    [
      "missing component",
      () =>
        definePluginApp((app) => {
          app.slots.homepageSection({
            id: "x",
            title: "X",
            component: undefined as never,
          });
        }),
      /"component" must be/,
    ],
    [
      "nav panel with a non-component headerContent",
      () =>
        definePluginApp((app) => {
          app.slots.navPanel({
            id: "x",
            title: "X",
            icon: "columns",
            path: "x",
            component: Component,
            headerContent: "nope" as never,
          });
        }),
      /"headerContent" must be a React component/,
    ],
    [
      "message directive with uppercase id",
      () =>
        definePluginApp((app) => {
          app.slots.messageDirective({
            id: "Inline-Vis",
            component: Component,
          });
        }),
      /"id" must match/,
    ],
    [
      "message directive with underscore id",
      () =>
        definePluginApp((app) => {
          app.slots.messageDirective({
            id: "inline_vis",
            component: Component,
          });
        }),
      /"id" must match/,
    ],
    [
      "message directive with leading digit",
      () =>
        definePluginApp((app) => {
          app.slots.messageDirective({
            id: "1inline",
            component: Component,
          });
        }),
      /"id" must match/,
    ],
    [
      "duplicate message directive id",
      () =>
        definePluginApp((app) => {
          app.slots.messageDirective({
            id: "inline-vis",
            component: Component,
          });
          app.slots.messageDirective({
            id: "inline-vis",
            component: Component,
          });
        }),
      /duplicate id/,
    ],
    [
      "message directive missing component",
      () =>
        definePluginApp((app) => {
          app.slots.messageDirective({
            id: "inline-vis",
            component: undefined as never,
          });
        }),
      /"component" must be/,
    ],
  ])("rejects %s", (_name, build, message) => {
    expect(() => collectPluginAppRegistrations(build())).toThrow(message);
  });

  it("keeps a headerContent registration", () => {
    function Accessory() {
      return null;
    }
    const definition = definePluginApp((app) => {
      app.slots.navPanel({
        id: "board",
        title: "Board",
        icon: "columns",
        path: "board",
        component: Component,
        headerContent: Accessory,
      });
    });
    expect(
      collectPluginAppRegistrations(definition).navPanels[0],
    ).toMatchObject({
      headerContent: Accessory,
    });
  });
});

describe("interpretPluginFrontends", () => {
  function loadedRecord(
    pluginId: string,
    defaultExport: unknown,
  ): PluginFrontendRecord {
    return {
      pluginId,
      status: "loaded",
      module: { default: defaultExport },
    };
  }

  it("stores a valid app's registrations and leaves the record loaded", () => {
    const setRegistrations =
      vi.fn<(pluginId: string, set: PluginRegistrationSet) => void>();
    const records = new Map<string, PluginFrontendRecord>([
      [
        "good",
        loadedRecord(
          "good",
          definePluginApp((app) => {
            app.slots.composerAccessory({ id: "a", component: Component });
          }),
        ),
      ],
    ]);

    interpretPluginFrontends(records, {
      setRegistrations,
      warn: () => {},
    });

    expect(records.get("good")?.status).toBe("loaded");
    expect(setRegistrations).toHaveBeenCalledWith(
      "good",
      expect.objectContaining({
        composerAccessories: [{ id: "a", component: Component }],
      }),
    );
  });

  it("contains a junk default export to that plugin only", () => {
    const setRegistrations = vi.fn();
    const warn = vi.fn();
    const records = new Map<string, PluginFrontendRecord>([
      ["junk", loadedRecord("junk", { not: "an app" })],
      [
        "good",
        loadedRecord(
          "good",
          definePluginApp((app) => {
            app.slots.composerAccessory({ id: "a", component: Component });
          }),
        ),
      ],
      ["broken", { pluginId: "broken", status: "failed", error: "boom" }],
    ]);

    interpretPluginFrontends(records, { setRegistrations, warn });

    expect(records.get("junk")).toEqual({
      pluginId: "junk",
      status: "failed",
      error: expect.stringContaining("definePluginApp"),
    });
    expect(records.get("good")?.status).toBe("loaded");
    expect(records.get("broken")?.status).toBe("failed");
    expect(setRegistrations).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[plugin:junk]"));
  });

  it("contains a throwing setup", () => {
    const setRegistrations = vi.fn();
    const records = new Map<string, PluginFrontendRecord>([
      [
        "thrower",
        loadedRecord(
          "thrower",
          definePluginApp(() => {
            throw new Error("setup exploded");
          }),
        ),
      ],
    ]);

    interpretPluginFrontends(records, {
      setRegistrations,
      warn: () => {},
    });

    expect(records.get("thrower")).toEqual({
      pluginId: "thrower",
      status: "failed",
      error: "setup exploded",
    });
    expect(setRegistrations).not.toHaveBeenCalled();
  });
});
