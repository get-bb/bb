import { describe, expect, it, vi } from "vitest";
import type { BaseWindow, MenuItemConstructorOptions } from "electron";

vi.mock("electron", () => ({
  app: { name: "bb" },
  Menu: {
    buildFromTemplate: vi.fn((template: unknown) => ({
      getMenuItemById: () => null,
      template,
    })),
    sendActionToFirstResponder: vi.fn(),
    setApplicationMenu: vi.fn(),
  },
}));

import { Menu } from "electron";

import {
  buildApplicationMenuTemplate,
  installApplicationMenu,
  SET_SERVER_URL_MENU_LABEL,
  type InstallApplicationMenuArgs,
} from "../src/menu.js";
import { buildDesktopServerChoices } from "../src/server-list.js";
import {
  createServerTargetStore,
  BUILTIN_SERVER_NAME,
} from "../src/server-target.js";

function menuArgs(
  reloadWindow: InstallApplicationMenuArgs["reloadWindow"],
  overrides: Partial<InstallApplicationMenuArgs> = {},
): InstallApplicationMenuArgs {
  return {
    accelerators: {
      closeWindowOrSideTab: undefined,
      createNewWindow: undefined,
      openNewTab: undefined,
      openNewThread: undefined,
      openSettings: undefined,
      reopenClosedTab: undefined,
    },
    closeWindowOrSideTab: () => {},
    connectServersSkipReason: null,
    createNewWindow: () => {},
    isMac: true,
    showBuiltinServer: true,
    toggleBuiltinServer: () => {},
    openAbout: () => {},
    openNewTab: () => {},
    openNewThread: () => {},
    openLocalLogs: () => {},
    openSettings: () => {},
    reopenClosedTab: () => {},
    reloadWindow,
    zoomFocusedPage: () => {},
    selectServer: () => {},
    servers: [{ checked: true, id: "builtin", name: BUILTIN_SERVER_NAME }],
    setServerUrl: () => {},
    signInToConnect: () => {},
    addServer: () => {},
    ...overrides,
  };
}

function findServerSubmenu(
  template: MenuItemConstructorOptions[],
): MenuItemConstructorOptions[] {
  const windowMenu = template.find((item) => item.label === "Window");
  const windowSubmenu = windowMenu?.submenu as MenuItemConstructorOptions[];
  const serverMenu = windowSubmenu.find((item) => item.label === "Server");
  return serverMenu?.submenu as MenuItemConstructorOptions[];
}

function findDesktopSettingsServerSubmenu(
  template: MenuItemConstructorOptions[],
): MenuItemConstructorOptions[] {
  const appSubmenu = template[0]?.submenu as MenuItemConstructorOptions[];
  const desktopSettingsMenu = appSubmenu.find(
    (item) => item.label === "Desktop Settings",
  );
  const desktopSettingsSubmenu =
    desktopSettingsMenu?.submenu as MenuItemConstructorOptions[];
  const serverMenu = desktopSettingsSubmenu.find(
    (item) => item.label === "Server",
  );
  return serverMenu?.submenu as MenuItemConstructorOptions[];
}

describe("application menu", () => {
  it.each([true, false])(
    "opens local logs independently of runtime ownership (isMac=%s)",
    (isMac) => {
      const openLocalLogs = vi.fn();
      const template = buildApplicationMenuTemplate(
        menuArgs(() => {}, { isMac, openLocalLogs }),
      );
      const view = template.find((item) => item.label === "View")
        ?.submenu as MenuItemConstructorOptions[];
      const logs = view.find((item) => item.label === "Local Logs");
      expect(logs).toBeDefined();
      expect(logs?.enabled).not.toBe(false);
      if (logs?.click) logs.click({} as never, undefined, {} as never);
      expect(openLocalLogs).toHaveBeenCalledOnce();
    },
  );

  it("reopens the last closed tab from the File menu", () => {
    const reopenClosedTab = vi.fn();
    const template = buildApplicationMenuTemplate(
      menuArgs(() => {}, {
        accelerators: {
          closeWindowOrSideTab: undefined,
          createNewWindow: undefined,
          openNewTab: undefined,
          openNewThread: undefined,
          openSettings: undefined,
          reopenClosedTab: "CommandOrControl+Shift+T",
        },
        reopenClosedTab,
      }),
    );
    const fileMenu = template.find((item) => item.label === "File");
    const submenu = fileMenu?.submenu as MenuItemConstructorOptions[];
    const reopen = submenu.find((item) => item.label === "Reopen Closed Tab");

    expect(reopen?.accelerator).toBe("CommandOrControl+Shift+T");
    reopen?.click?.({} as never, {} as BaseWindow, {} as never);
    expect(reopenClosedTab).toHaveBeenCalledTimes(1);
  });

  it("closes a native panel when Electron omits its window", () => {
    vi.mocked(Menu.sendActionToFirstResponder).mockClear();
    const closeWindowOrSideTab = vi.fn();
    const template = buildApplicationMenuTemplate(
      menuArgs(() => {}, { closeWindowOrSideTab }),
    );
    const fileMenu = template.find((item) => item.label === "File");
    const submenu = fileMenu?.submenu as MenuItemConstructorOptions[];
    const closeWindow = submenu.find((item) => item.label === "Close Window");

    closeWindow?.click?.({} as never, null as never, {} as never);

    expect(Menu.sendActionToFirstResponder).toHaveBeenCalledWith(
      "performClose:",
    );
    expect(closeWindowOrSideTab).not.toHaveBeenCalled();
  });

  it("forwards an undefined window for detached DevTools", () => {
    vi.mocked(Menu.sendActionToFirstResponder).mockClear();
    const closeWindowOrSideTab = vi.fn();
    const template = buildApplicationMenuTemplate(
      menuArgs(() => {}, { closeWindowOrSideTab }),
    );
    const fileMenu = template.find((item) => item.label === "File");
    const submenu = fileMenu?.submenu as MenuItemConstructorOptions[];
    const closeWindow = submenu.find((item) => item.label === "Close Window");

    closeWindow?.click?.({} as never, undefined, {} as never);

    expect(closeWindowOrSideTab).toHaveBeenCalledWith(undefined);
    expect(Menu.sendActionToFirstResponder).not.toHaveBeenCalled();
  });

  it("routes zoom shortcuts to the focused page's clamped zoom", () => {
    const zoomFocusedPage = vi.fn();
    const template = buildApplicationMenuTemplate(
      menuArgs(vi.fn(), { zoomFocusedPage }),
    );
    const viewMenu = template.find((item) => item.label === "View");
    const submenu = viewMenu?.submenu as MenuItemConstructorOptions[];

    for (const [label, accelerator] of [
      ["Actual Size", "CommandOrControl+0"],
      ["Zoom In", "CommandOrControl+Plus"],
      ["Zoom Out", "CommandOrControl+-"],
    ]) {
      const item = submenu.find((entry) => entry.label === label);
      expect(item?.accelerator).toBe(accelerator);
      item?.click?.({} as never, undefined, {} as never);
    }
    expect(zoomFocusedPage.mock.calls).toEqual([["reset"], ["in"], ["out"]]);
  });

  it("shows reload shortcuts without globally stealing browser commands", () => {
    const reloadWindow = vi.fn();
    const template = buildApplicationMenuTemplate(menuArgs(reloadWindow));
    const viewMenu = template.find((item) => item.label === "View");
    const submenu = viewMenu?.submenu as MenuItemConstructorOptions[];
    const reload = submenu.find((item) => item.label === "Reload");
    const forceReload = submenu.find((item) => item.label === "Force Reload");
    const focusedWindow = {} as BaseWindow;

    expect(reload?.accelerator).toBe("CommandOrControl+R");
    expect(reload?.registerAccelerator).toBe(false);
    expect(forceReload?.accelerator).toBe("CommandOrControl+Shift+R");
    expect(forceReload?.registerAccelerator).toBe(false);
    reload?.click?.({} as never, focusedWindow, {} as never);
    forceReload?.click?.({} as never, focusedWindow, {} as never);
    expect(reloadWindow).toHaveBeenNthCalledWith(1, focusedWindow, false);
    expect(reloadWindow).toHaveBeenNthCalledWith(2, focusedWindow, true);
  });

  it.each([
    { selectedId: "builtin", enabled: false },
    { selectedId: "connect:office", enabled: true },
    { selectedId: "custom:office", enabled: true },
  ])(
    "enables editing only a selected saved or Connect server ($selectedId)",
    ({ selectedId, enabled }) => {
      const template = buildApplicationMenuTemplate(
        menuArgs(() => {}, {
          servers: [
            {
              checked: selectedId === "builtin",
              id: "builtin",
              name: BUILTIN_SERVER_NAME,
            },
            {
              checked: selectedId === "connect:office",
              id: "connect:office",
              name: "Connect Office",
            },
            {
              checked: selectedId === "custom:office",
              id: "custom:office",
              name: "Office",
            },
          ],
        }),
      );
      for (const submenu of [
        findServerSubmenu(template),
        findDesktopSettingsServerSubmenu(template),
      ]) {
        expect(
          submenu.find((item) => item.label === SET_SERVER_URL_MENU_LABEL)
            ?.enabled,
        ).toBe(enabled);
      }
    },
  );

  it("builds a Server menu with multiple custom targets and separate add/edit actions", () => {
    const selectServer = vi.fn();
    const setServerUrl = vi.fn();
    const addServer = vi.fn();
    const template = buildApplicationMenuTemplate(
      menuArgs(() => {}, {
        selectServer,
        servers: [
          { checked: false, id: "builtin", name: BUILTIN_SERVER_NAME },
          {
            checked: true,
            id: "custom:https://first.example",
            name: "first.example",
          },
          {
            checked: false,
            id: "custom:https://second.example",
            name: "second.example",
          },
        ],
        setServerUrl,
        addServer,
      }),
    );
    const serverSubmenu = findServerSubmenu(template);

    expect(serverSubmenu).toHaveLength(8);
    expect(
      serverSubmenu.slice(0, 3).map((item) => [item.type, item.checked]),
    ).toEqual([
      ["radio", false],
      ["radio", true],
      ["radio", false],
    ]);
    expect(serverSubmenu[3]?.type).toBe("separator");
    expect(serverSubmenu[4]?.label).toBe("Add Server…");
    expect(serverSubmenu[5]?.label).toBe(SET_SERVER_URL_MENU_LABEL);
    serverSubmenu[1]?.click?.({} as never, undefined, {} as never);
    serverSubmenu[2]?.click?.({} as never, undefined, {} as never);
    expect(selectServer).toHaveBeenNthCalledWith(
      1,
      "custom:https://first.example",
    );
    expect(selectServer).toHaveBeenNthCalledWith(
      2,
      "custom:https://second.example",
    );
    serverSubmenu[4]?.click?.({} as never, undefined, {} as never);
    expect(addServer).toHaveBeenCalledTimes(1);
    serverSubmenu[5]?.click?.({} as never, undefined, {} as never);
    expect(setServerUrl).toHaveBeenCalledTimes(1);
  });

  it("offers the Server menu under Desktop Settings with Window → Server as an alias", () => {
    const selectServer = vi.fn();
    const addServer = vi.fn();
    const template = buildApplicationMenuTemplate(
      menuArgs(() => {}, {
        addServer,
        selectServer,
        servers: [
          { checked: true, id: "builtin", name: "This Mac" },
          {
            checked: false,
            id: "custom:https://first.example",
            name: "first.example",
          },
        ],
      }),
    );
    const desktopSettingsServerSubmenu =
      findDesktopSettingsServerSubmenu(template);
    const labels = (items: MenuItemConstructorOptions[]) =>
      items.map((item) => item.label ?? `<${item.type}>`);

    expect(labels(desktopSettingsServerSubmenu)).toEqual([
      "This Mac",
      "first.example",
      "<separator>",
      "Add Server…",
      SET_SERVER_URL_MENU_LABEL,
      "<separator>",
      "Show This Mac",
    ]);
    expect(labels(findServerSubmenu(template))).toEqual(
      labels(desktopSettingsServerSubmenu),
    );
    desktopSettingsServerSubmenu[1]?.click?.(
      {} as never,
      undefined,
      {} as never,
    );
    desktopSettingsServerSubmenu[3]?.click?.(
      {} as never,
      undefined,
      {} as never,
    );
    expect(selectServer).toHaveBeenCalledWith("custom:https://first.example");
    expect(addServer).toHaveBeenCalledTimes(1);
  });

  it.each([
    { reason: "no-credential", label: "Sign in to bb Connect…" },
    { reason: "unauthorized", label: "Sign in to bb Connect again…" },
  ] as const)(
    "offers sign-in with the server actions when the sync needs it ($reason)",
    ({ reason, label }) => {
      const signInToConnect = vi.fn();
      const template = buildApplicationMenuTemplate(
        menuArgs(() => {}, {
          connectServersSkipReason: reason,
          servers: [
            { checked: false, id: "builtin", name: BUILTIN_SERVER_NAME },
            { checked: true, id: "connect:brsbl", name: "brsbl" },
          ],
          signInToConnect,
        }),
      );
      const serverSubmenu = findServerSubmenu(template);

      expect(
        serverSubmenu.map((item) => item.label ?? `<${item.type}>`),
      ).toEqual([
        BUILTIN_SERVER_NAME,
        "brsbl",
        "<separator>",
        label,
        "Add Server…",
        SET_SERVER_URL_MENU_LABEL,
        "<separator>",
        "Show This Mac",
      ]);
      const signIn = serverSubmenu[3];
      expect(signIn?.enabled).toBeUndefined();
      expect(signIn?.type).toBeUndefined();
      signIn?.click?.({} as never, undefined, {} as never);
      expect(signInToConnect).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["unavailable", "not-paired", "plugin-disabled"] as const)(
    "adds no Connect row when sign-in cannot fix the sync ($0)",
    (reason) => {
      const template = buildApplicationMenuTemplate(
        menuArgs(() => {}, {
          connectServersSkipReason: reason,
          servers: [
            { checked: false, id: "builtin", name: BUILTIN_SERVER_NAME },
            { checked: true, id: "connect:brsbl", name: "brsbl" },
          ],
        }),
      );

      expect(
        findServerSubmenu(template).map(
          (item) => item.label ?? `<${item.type}>`,
        ),
      ).toEqual([
        BUILTIN_SERVER_NAME,
        "brsbl",
        "<separator>",
        "Add Server…",
        SET_SERVER_URL_MENU_LABEL,
        "<separator>",
        "Show This Mac",
      ]);
    },
  );

  it("builds a native Linux menu with the Linux DevTools accelerator", () => {
    vi.mocked(Menu.sendActionToFirstResponder).mockClear();
    const template = buildApplicationMenuTemplate(
      menuArgs(() => {}, { isMac: false }),
    );
    const appMenu = template[0]?.submenu as MenuItemConstructorOptions[];
    const windowMenu = template.find((item) => item.label === "Window");
    const windowSubmenu = windowMenu?.submenu as MenuItemConstructorOptions[];
    const viewMenu = template.find((item) => item.label === "View");
    const viewSubmenu = viewMenu?.submenu as MenuItemConstructorOptions[];
    const fileMenu = template.find((item) => item.label === "File");
    const fileSubmenu = fileMenu?.submenu as MenuItemConstructorOptions[];
    const closeWindow = fileSubmenu.find(
      (item) => item.label === "Close Window",
    );

    expect(appMenu.map((item) => item.role).filter(Boolean)).toEqual(["quit"]);
    expect(windowSubmenu.map((item) => item.role).filter(Boolean)).toEqual([
      "minimize",
    ]);
    expect(windowSubmenu.some((item) => item.label === "Server")).toBe(true);
    expect(
      viewSubmenu.find((item) => item.label === "Toggle Developer Tools")
        ?.accelerator,
    ).toBe("Control+Shift+I");

    closeWindow?.click?.({} as never, null as never, {} as never);
    expect(Menu.sendActionToFirstResponder).not.toHaveBeenCalled();
  });
});

it.each([true, false])(
  "exposes the platform visibility checkbox (Mac: %s)",
  (isMac) => {
    const toggleBuiltinServer = vi.fn();
    const template = buildApplicationMenuTemplate(
      menuArgs(() => {}, {
        isMac,
        showBuiltinServer: false,
        servers: [{ id: "custom:remote", name: "Remote", checked: true }],
        toggleBuiltinServer,
      }),
    );
    const appMenu = template[0].submenu as MenuItemConstructorOptions[];
    const settings = appMenu.find((item) => item.label === "Desktop Settings")
      ?.submenu as MenuItemConstructorOptions[];
    expect(settings.some((item) => item.type === "checkbox")).toBe(false);
    for (const submenu of [
      findDesktopSettingsServerSubmenu(template),
      findServerSubmenu(template),
    ]) {
      const checkbox = submenu.find((item) => item.type === "checkbox");
      expect(checkbox?.label).toBe(
        isMac ? "Show This Mac" : "Show This Computer",
      );
      expect(checkbox?.checked).toBe(false);
      expect(checkbox?.enabled).toBe(true);
      checkbox?.click?.({} as never, undefined, {} as never);
    }
    expect(toggleBuiltinServer).toHaveBeenCalledTimes(2);
  },
);

it.each([
  { active: true, alternatives: 1, show: false, custom: false, visible: true },
  { active: true, alternatives: 0, show: false, custom: false, visible: true },
  {
    active: false,
    alternatives: 1,
    show: false,
    custom: false,
    visible: false,
  },
  { active: false, alternatives: 1, show: true, custom: false, visible: true },
  { active: false, alternatives: 1, show: false, custom: true, visible: false },
])(
  "shares native and palette visibility: %j",
  async ({ active, alternatives, show, custom, visible }) => {
    const store = createServerTargetStore({
      storagePath: "/test/server-target.json",
      fs: {
        mkdir: async () => undefined,
        readFile: async () => "",
        writeFile: async () => undefined,
      },
    });
    const connect = {
      handle: "laptop",
      name: "Laptop",
      url: "https://laptop.getbb.app",
    };
    if (alternatives) {
      if (custom) await store.setCustomServerUrl("https://custom.example");
      else await store.setConnectServer(connect);
    }
    if (active) await store.setTarget("builtin");
    await store.setShowBuiltinServer(show);
    const choices = buildDesktopServerChoices(
      store,
      alternatives && !custom ? [connect] : [],
      "http://127.0.0.1:38886",
    );
    expect(choices.some((choice) => choice.id === "builtin")).toBe(visible);
    expect(choices.filter((choice) => choice.active)).toHaveLength(1);
    const template = buildApplicationMenuTemplate(
      menuArgs(() => {}, {
        showBuiltinServer: show,
        servers: choices.map(({ id, name, active }) => ({
          id,
          name,
          checked: active,
        })),
      }),
    );
    for (const items of [
      findServerSubmenu(template),
      findDesktopSettingsServerSubmenu(template),
    ]) {
      expect(
        items.filter((item) => item.type === "radio").map((item) => item.label),
      ).toEqual(choices.map((choice) => choice.name));
      expect(items.find((item) => item.type === "checkbox")?.enabled).toBe(
        !active,
      );
      expect(items.filter((item) => item.type === "radio")).toHaveLength(
        alternatives + Number(visible),
      );
    }
  },
);

function legacyInstallApplicationMenu(args: InstallApplicationMenuArgs): void {
  const menu = Menu.buildFromTemplate(buildApplicationMenuTemplate(args));
  const onServerMenuWillShow = args.onServerMenuWillShow;
  if (onServerMenuWillShow !== undefined) {
    for (const id of ["bb-desktop-settings-server-menu", "bb-server-menu"]) {
      menu.getMenuItemById(id)?.submenu?.on("menu-will-show", () => {
        onServerMenuWillShow();
      });
    }
  }
  Menu.setApplicationMenu(menu);
}

function menuCallCounts() {
  return {
    built: vi.mocked(Menu.buildFromTemplate).mock.calls.length,
    set: vi.mocked(Menu.setApplicationMenu).mock.calls.length,
  };
}

function lastBuiltTemplate(): string {
  const calls = vi.mocked(Menu.buildFromTemplate).mock.calls;
  return JSON.stringify(calls[calls.length - 1]?.[0]);
}

function twoServers(activeId: string): InstallApplicationMenuArgs["servers"] {
  return [
    {
      checked: activeId === "builtin",
      id: "builtin",
      name: BUILTIN_SERVER_NAME,
    },
    { checked: activeId === "custom:a", id: "custom:a", name: "A" },
  ];
}

describe("installing the application menu", () => {
  it("builds the same menu as before when nothing is skipped", () => {
    const args = menuArgs(() => {}, { servers: twoServers("custom:a") });
    vi.mocked(Menu.buildFromTemplate).mockClear();
    vi.mocked(Menu.setApplicationMenu).mockClear();
    legacyInstallApplicationMenu(args);
    const legacyTemplate = lastBuiltTemplate();
    const legacyCounts = menuCallCounts();

    expect(installApplicationMenu(args)).toBe(true);

    expect(lastBuiltTemplate()).toBe(legacyTemplate);
    expect(menuCallCounts()).toEqual({
      built: legacyCounts.built + 1,
      set: legacyCounts.set + 1,
    });
  });

  it("legacy rebuilds on every refresh; skipIfUnchanged rebuilds only when the menu inputs changed", () => {
    const base = menuArgs(() => {}, { servers: twoServers("builtin") });
    const sameInputsNewClosures = menuArgs(() => {}, {
      createNewWindow: () => {},
      openAbout: () => {},
      servers: twoServers("builtin"),
    });
    const changedInputs: Array<Partial<InstallApplicationMenuArgs>> = [
      { servers: twoServers("custom:a") },
      {
        servers: [
          ...twoServers("builtin"),
          { checked: false, id: "custom:b", name: "B" },
        ],
      },
      { showBuiltinServer: false },
      { connectServersSkipReason: "no-credential" },
      { isMac: false },
      {
        accelerators: {
          ...base.accelerators,
          openNewTab: "CommandOrControl+T",
        },
      },
    ];

    vi.mocked(Menu.buildFromTemplate).mockClear();
    vi.mocked(Menu.setApplicationMenu).mockClear();
    legacyInstallApplicationMenu(base);
    legacyInstallApplicationMenu(sameInputsNewClosures);
    expect(menuCallCounts()).toEqual({ built: 2, set: 2 });

    vi.mocked(Menu.buildFromTemplate).mockClear();
    vi.mocked(Menu.setApplicationMenu).mockClear();
    expect(installApplicationMenu(base)).toBe(true);
    expect(
      installApplicationMenu(sameInputsNewClosures, { skipIfUnchanged: true }),
    ).toBe(false);
    expect(menuCallCounts()).toEqual({ built: 1, set: 1 });

    for (const change of changedInputs) {
      expect(installApplicationMenu(base)).toBe(true);
      expect(
        installApplicationMenu(
          menuArgs(() => {}, { ...base, ...change }),
          {
            skipIfUnchanged: true,
          },
        ),
      ).toBe(true);
    }
  });

  it("always rebuilds when the caller does not ask to skip, so a menu click that changed native state is reset", () => {
    const args = menuArgs(() => {});
    expect(installApplicationMenu(args)).toBe(true);
    vi.mocked(Menu.buildFromTemplate).mockClear();
    expect(installApplicationMenu(args)).toBe(true);
    expect(installApplicationMenu(args, { skipIfUnchanged: false })).toBe(true);
    expect(menuCallCounts().built).toBe(2);
  });

  it("never skips a rebuild whose menu would look different (seeded random inputs)", () => {
    let seed = 20260428;
    const next = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    const pick = <T>(values: T[]): T =>
      values[Math.floor(next() * values.length)]!;
    const randomArgs = (): InstallApplicationMenuArgs => {
      const serverCount = 1 + Math.floor(next() * 3);
      const servers = Array.from({ length: serverCount }, (_, index) => ({
        checked: false,
        id: pick(["builtin", "connect:h", "custom:u"]) + index,
        name: pick(["Local", "Work", "Home"]),
      }));
      servers[Math.floor(next() * serverCount)]!.checked = true;
      return menuArgs(() => {}, {
        accelerators: {
          closeWindowOrSideTab: pick([undefined, "CommandOrControl+W"]),
          createNewWindow: pick([undefined, "CommandOrControl+Shift+N"]),
          openNewTab: pick([undefined, "CommandOrControl+T"]),
          openNewThread: pick([undefined, "CommandOrControl+N"]),
          openSettings: pick([undefined, "CommandOrControl+,"]),
          reopenClosedTab: pick([undefined, "CommandOrControl+Shift+T"]),
        },
        connectServersSkipReason: pick([null, "no-credential", "unauthorized"]),
        isMac: pick([true, false]),
        servers,
        showBuiltinServer: pick([true, false]),
      });
    };

    let looksDifferent = 0;
    for (let round = 0; round < 300; round++) {
      const before = randomArgs();
      const after = randomArgs();
      installApplicationMenu(before);
      const skipped = !installApplicationMenu(after, { skipIfUnchanged: true });
      const sameMenu =
        JSON.stringify(buildApplicationMenuTemplate(before)) ===
        JSON.stringify(buildApplicationMenuTemplate(after));
      if (!sameMenu) {
        looksDifferent += 1;
        expect(skipped).toBe(false);
      }
    }
    expect(looksDifferent).toBeGreaterThan(100);
  });
});
