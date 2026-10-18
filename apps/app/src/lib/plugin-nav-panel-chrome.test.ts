import { createMemoryStorage } from "@bb/test-helpers";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import {
  markPluginFrontendBootStarted,
  markPluginFrontendSettleFloorReached,
  markPluginFrontendsSettled,
  resetPluginFrontendBootStateForTest,
  setServerPluginsStarting,
  setPluginFrontendReconcilePending,
  usePluginFrontendBootComplete,
  usePluginFrontendsSettled,
} from "./plugin-frontend-boot-state";
import {
  mergePluginNavPanelChrome,
  readLastKnownPluginNavPanelChrome,
  readRememberedPluginNavPanelChrome,
  rememberPluginNavPanelChrome,
  writeLastKnownPluginNavPanelChrome,
} from "./plugin-nav-panel-chrome";
import {
  getPluginSlotSnapshot,
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
  type PluginRegistrationSet,
} from "./plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import { renderHookStatically } from "@/test/render-hook-statically";

const localStorage = createMemoryStorage();
vi.stubGlobal("window", { localStorage });

afterAll(() => {
  vi.unstubAllGlobals();
});

function Body() {
  return null;
}

function registrations(
  navPanels: PluginRegistrationSet["navPanels"],
): PluginRegistrationSet {
  return makePluginRegistrationSet({
    navPanels,
  });
}

const TASKS = {
  pluginId: "tasks",
  id: "tasks",
  path: "tasks",
  title: "Tasks",
  icon: "ListTodo",
};
const DOCS = {
  pluginId: "docs",
  id: "docs",
  path: "docs",
  title: "Docs",
  icon: "Book",
};

function registerTasks() {
  setPluginSlotRegistrations(
    "tasks",
    registrations([
      {
        id: "tasks",
        path: "tasks",
        title: "Tasks",
        icon: "ListTodo",
        component: Body,
      },
    ]),
  );
}

function chromeEntries() {
  return mergePluginNavPanelChrome(
    readRememberedPluginNavPanelChrome(
      renderHookStatically(usePluginFrontendsSettled),
    ),
    getPluginSlotSnapshot().navPanels,
  );
}

function remember() {
  rememberPluginNavPanelChrome(
    renderHookStatically(usePluginFrontendBootComplete),
    getPluginSlotSnapshot().navPanels,
  );
}

afterEach(() => {
  resetPluginSlotStoreForTest();
  resetPluginFrontendBootStateForTest();
  localStorage.clear();
});

describe("plugin nav panel chrome entries", () => {
  it("draws remembered chrome before boot and swaps to the live registration in place", () => {
    writeLastKnownPluginNavPanelChrome([TASKS, DOCS]);
    const beforeBoot = chromeEntries();
    expect(beforeBoot.map((entry) => entry.chrome.title)).toEqual([
      "Tasks",
      "Docs",
    ]);
    expect(beforeBoot.every((entry) => entry.panel === null)).toBe(true);

    registerTasks();
    const afterTasks = chromeEntries();
    expect(afterTasks.map((entry) => entry.chrome.title)).toEqual([
      "Tasks",
      "Docs",
    ]);
    expect(afterTasks[0]!.panel).not.toBeNull();
    expect(afterTasks[1]!.panel).toBeNull();
  });

  it("forgets remembered panels that never registered once frontends settle", () => {
    writeLastKnownPluginNavPanelChrome([TASKS, DOCS]);
    registerTasks();
    expect(chromeEntries()).toHaveLength(2);
    markPluginFrontendsSettled();
    expect(chromeEntries().map((entry) => entry.chrome.title)).toEqual([
      "Tasks",
    ]);
  });

  it("appends live panels the profile had not seen before", () => {
    writeLastKnownPluginNavPanelChrome([TASKS]);
    setPluginSlotRegistrations(
      "docs",
      registrations([
        {
          id: "docs",
          path: "docs",
          title: "Docs",
          icon: "Book",
          component: Body,
        },
      ]),
    );
    expect(chromeEntries().map((entry) => entry.chrome.title)).toEqual([
      "Tasks",
      "Docs",
    ]);
  });
});

describe("rememberPluginNavPanelChrome", () => {
  it("preserves the complete cache until server startup and the final frontend load finish", () => {
    writeLastKnownPluginNavPanelChrome([TASKS, DOCS]);
    setServerPluginsStarting(true);
    markPluginFrontendsSettled();
    remember();
    expect(readLastKnownPluginNavPanelChrome()).toEqual([TASKS, DOCS]);
    setPluginFrontendReconcilePending(true);
    setServerPluginsStarting(false);
    registerTasks();
    remember();
    expect(readLastKnownPluginNavPanelChrome()).toEqual([TASKS, DOCS]);
    setPluginFrontendReconcilePending(false);
    remember();
    expect(readLastKnownPluginNavPanelChrome()).toEqual([TASKS]);
  });

  it("writes the live panels only after frontends have settled, and follows later changes", () => {
    registerTasks();
    remember();
    expect(readLastKnownPluginNavPanelChrome()).toEqual([]);

    markPluginFrontendsSettled();
    remember();
    expect(readLastKnownPluginNavPanelChrome()).toEqual([TASKS]);

    setPluginSlotRegistrations("tasks", registrations([]));
    remember();
    expect(readLastKnownPluginNavPanelChrome()).toEqual([]);
  });

  it("does not overwrite remembered chrome on the settle floor or during a boot", () => {
    writeLastKnownPluginNavPanelChrome([TASKS, DOCS]);
    remember();

    markPluginFrontendSettleFloorReached();
    remember();
    expect(readLastKnownPluginNavPanelChrome()).toEqual([TASKS, DOCS]);

    markPluginFrontendBootStarted();
    registerTasks();
    remember();
    expect(readLastKnownPluginNavPanelChrome()).toEqual([TASKS, DOCS]);

    markPluginFrontendsSettled();
    remember();
    expect(readLastKnownPluginNavPanelChrome()).toEqual([TASKS]);
  });
});
