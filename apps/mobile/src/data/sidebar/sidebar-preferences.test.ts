import { describe, expect, it, vi } from "vitest";
import {
  createSidebarPreferencesStore,
  type SidebarPreferencesStorage,
} from "./sidebar-preferences";

function memoryStorage(
  seed: Record<string, string> = {},
): SidebarPreferencesStorage & { dump(): Record<string, string> } {
  const map = new Map(Object.entries(seed));
  return {
    getString: (key) => map.get(key),
    set: (key, value) => {
      map.set(key, value);
    },
    remove: (key) => {
      map.delete(key);
    },
    dump: () => Object.fromEntries(map),
  };
}

describe("createSidebarPreferencesStore", () => {
  it("reads defaults, and the web app's stored spellings, leniently", () => {
    expect(
      createSidebarPreferencesStore(memoryStorage()).getSnapshot(),
    ).toEqual({
      organize: "project",
      sort: "updated",
      collapsedProjectIds: [],
      collapsedThreadIds: [],
      collapsedEnvironmentIds: [],
      collapsedSectionKeys: [],
      collapsedMachineKeys: [],
      collapsedBuiltInSections: [],
      sectionOrder: { project: [], manual: [], machine: [] },
    });
    const store = createSidebarPreferencesStore(
      memoryStorage({
        "bb.sidebar.organizationMode": "manual",
        "bb.sidebar.chronologicalSort": "none",
        "bb.sidebar.collapsedProjects": '["p1","p1",7,"p2"]',
        "bb.sidebar.collapsedSections": '["pinned","bogus"]',
        "bb.sidebar.collapsedThreads": "not json",
        "bb.sidebar.manualSectionOrder": '["pinned","sections","threads"]',
      }),
    );
    expect(store.getSnapshot()).toMatchObject({
      organize: "manual",
      sort: "updated",
      collapsedProjectIds: ["p1", "p2"],
      collapsedBuiltInSections: ["pinned"],
      collapsedThreadIds: [],
      sectionOrder: {
        project: [],
        manual: ["pinned", "sections", "threads"],
        machine: [],
      },
    });
  });

  it("stores each mode's section order under the web key and drops an empty order", () => {
    const storage = memoryStorage();
    const store = createSidebarPreferencesStore(storage);
    const listener = vi.fn();
    store.subscribe(listener);
    store.setSectionOrder("project", ["threads", "project:p1", "pinned"]);
    expect(storage.getString("bb.sidebar.sectionOrder")).toBe(
      '["threads","project:p1","pinned"]',
    );
    expect(store.getSnapshot().sectionOrder.project).toEqual([
      "threads",
      "project:p1",
      "pinned",
    ]);
    // Same order again: no write, no notification.
    store.setSectionOrder("project", ["threads", "project:p1", "pinned"]);
    expect(listener).toHaveBeenCalledTimes(1);
    store.setSectionOrder("project", []);
    expect(storage.getString("bb.sidebar.sectionOrder")).toBeUndefined();
    expect(store.getSnapshot().sectionOrder.manual).toEqual([]);
  });

  it("persists writes, notifies subscribers once per change, and removes defaults", () => {
    const storage = memoryStorage();
    const store = createSidebarPreferencesStore(storage);
    const listener = vi.fn();
    store.subscribe(listener);
    const before = store.getSnapshot();

    store.setOrganize("machine");
    store.setSort("alpha");
    expect(listener).toHaveBeenCalledTimes(2);
    expect(storage.dump()).toEqual({
      "bb.sidebar.organizationMode": "machine",
      "bb.sidebar.chronologicalSort": "alpha",
    });
    // Same value again is a no-op (no re-render, no write).
    store.setSort("alpha");
    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot()).not.toBe(before);

    store.setOrganize("project");
    store.setSort("updated");
    expect(storage.dump()).toEqual({});
  });

  it("toggles, sets, and expands collapse lists per kind", () => {
    const storage = memoryStorage();
    const store = createSidebarPreferencesStore(storage);
    store.toggleCollapsed("project", "p1");
    store.toggleCollapsed("thread", "t1");
    store.toggleCollapsed("thread", "t2");
    store.setCollapsed("machine", "no-machine", true);
    store.setCollapsed("machine", "no-machine", true);
    expect(store.getSnapshot()).toMatchObject({
      collapsedProjectIds: ["p1"],
      collapsedThreadIds: ["t1", "t2"],
      collapsedMachineKeys: ["no-machine"],
    });
    expect(storage.dump()["bb.sidebar.collapsedThreads"]).toBe('["t1","t2"]');

    store.toggleCollapsed("thread", "t1");
    store.expand("thread", ["t2", "missing"]);
    expect(store.getSnapshot().collapsedThreadIds).toEqual([]);
    expect(storage.dump()["bb.sidebar.collapsedThreads"]).toBeUndefined();

    // Built-in sections only accept the two known ids.
    store.setCollapsed("builtIn", "threads", true);
    store.setCollapsed("builtIn", "projects", true);
    expect(store.getSnapshot().collapsedBuiltInSections).toEqual(["threads"]);
  });

  it("stops notifying after unsubscribe", () => {
    const store = createSidebarPreferencesStore(memoryStorage());
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    store.setOrganize("manual");
    expect(listener).not.toHaveBeenCalled();
    expect(store.getSnapshot().organize).toBe("manual");
  });
});
