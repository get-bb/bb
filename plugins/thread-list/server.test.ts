import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import plugin, {
  migrateFromUiPreferences,
  migrateToUiPreferences,
} from "./server.js";
import { defaultPreferences } from "./shared/preferences.js";

const PLUGIN_ID = "thread-list";

interface UiPreferenceWrite {
  key: string;
  value: unknown;
  expectedRevision: number;
}

function setup(options: {
  uiPreferences?: Record<string, { revision: number; value: unknown }>;
  uiPreferencesFail?: boolean;
} = {}) {
  const uiStore = new Map(Object.entries(options.uiPreferences ?? {}));
  const uiWrites: UiPreferenceWrite[] = [];
  const host = createFakePluginHost({
    pluginId: PLUGIN_ID,
    sdk: {
      system: {
        uiPreferences: {
          list: async () => {
            if (options.uiPreferencesFail) throw new Error("offline");
            return { preferences: Object.fromEntries(uiStore) };
          },
          set: async (args: UiPreferenceWrite) => {
            const current = uiStore.get(args.key);
            if ((current?.revision ?? 0) !== args.expectedRevision) {
              throw new Error(`revision conflict on ${args.key}`);
            }
            uiWrites.push(args);
            const next = {
              revision: (current?.revision ?? 0) + 1,
              value: args.value,
            };
            uiStore.set(args.key, next);
            return { key: args.key, ...next };
          },
          reset: async (args: { key: string }) => {
            uiStore.delete(args.key);
            return { key: args.key, revision: 0, value: null };
          },
        },
      },
    },
  });
  return { ...host, uiStore, uiWrites };
}

describe("thread-list preferences rpc", () => {
  it("lists defaults on a fresh install and round-trips a valid write", async () => {
    const { bb, harness } = setup();
    await plugin(bb);
    await expect(harness.behavior.callRpc("listPreferences", null)).resolves.toEqual({
      preferences: defaultPreferences(),
    });
    await expect(harness.behavior.callRpc("listPreferences", null)).resolves.toMatchObject({
      preferences: { showProviderIcons: true },
    });
    await harness.behavior.callRpc("setPreference", {
      key: "showProviderIcons",
      value: false,
    });
    await migrateFromUiPreferences(bb);
    await expect(harness.behavior.callRpc("listPreferences", null)).resolves.toMatchObject({
      preferences: { showProviderIcons: false },
    });

    await expect(
      harness.behavior.callRpc("setPreference", {
        key: "organizationMode",
        value: "machine",
      }),
    ).resolves.toEqual({ key: "organizationMode", value: "machine" });
    await expect(bb.storage.kv.get("preference:organizationMode")).resolves.toBeUndefined();
    const listed = (await harness.behavior.callRpc("listPreferences", null)) as {
      preferences: { organizationMode: string };
    };
    expect(listed.preferences.organizationMode).toBe("machine");
    expect(harness.realtimeSignals).toEqual([
      { channel: "preferences", payload: { key: "showProviderIcons", value: false } },
      { channel: "preferences", payload: { key: "organizationMode", value: "machine" } },
    ]);
  });

  it("rejects a value that fails the preference's schema and leaves storage alone", async () => {
    const { bb, harness } = setup();
    await plugin(bb);
    await expect(
      harness.behavior.callRpc("setPreference", {
        key: "organizationMode",
        value: "sideways",
      }),
    ).rejects.toThrow(/Invalid value for organizationMode/);
    await expect(bb.storage.kv.get("preference:organizationMode")).resolves.toBeUndefined();
    await expect(
      harness.behavior.callRpc("setPreference", {
        key: "hiddenGroups",
        value: ["project:a", "bogus"],
      }),
    ).rejects.toThrow(/Invalid value for hiddenGroups/);
    await expect(
      harness.behavior.callRpc("setPreference", {
        key: "showProviderIcons",
        value: "false",
      }),
    ).rejects.toThrow(/Invalid value for showProviderIcons/);
  });

  it("dedupes hidden groups and resets to the default", async () => {
    const { bb, harness } = setup();
    await plugin(bb);
    await expect(
      harness.behavior.callRpc("setPreference", {
        key: "hiddenGroups",
        value: ["threads", "project:a", "project:a", "machine:m"],
      }),
    ).resolves.toEqual({
      key: "hiddenGroups",
      value: ["threads", "project:a", "machine:m"],
    });
    await expect(
      harness.behavior.callRpc("resetPreference", { key: "hiddenGroups" }),
    ).resolves.toEqual({ key: "hiddenGroups", value: [] });
    await expect(bb.storage.kv.get("preference:hiddenGroups")).resolves.toBeUndefined();
  });

  it("defaults row actions to archive, dedupes them, and rejects unknown or too many actions", async () => {
    const { bb, harness } = setup();
    await plugin(bb);
    const listed = (await harness.behavior.callRpc("listPreferences", null)) as {
      preferences: { rowActions: string[] };
    };
    expect(listed.preferences.rowActions).toEqual(["core:archive"]);
    await expect(
      harness.behavior.callRpc("setPreference", {
        key: "rowActions",
        value: ["pin", "core:archive", "core:pin"],
      }),
    ).resolves.toEqual({
      key: "rowActions",
      value: ["core:pin", "core:archive"],
    });
    await expect(
      harness.behavior.callRpc("setPreference", {
        key: "rowActions",
        value: ["core:archive", "push-notifications/notifications"],
      }),
    ).resolves.toEqual({
      key: "rowActions",
      value: ["core:archive", "push-notifications/notifications"],
    });
    await expect(
      harness.behavior.callRpc("setPreference", {
        key: "rowActions",
        value: ["core:archive", ""],
      }),
    ).rejects.toThrow(/Invalid value for rowActions/);
    await expect(
      harness.behavior.callRpc("setPreference", {
        key: "rowActions",
        value: ["archive", "pin", "read", "rename"],
      }),
    ).rejects.toThrow(/at most 3 row actions/);
  });

  it("migrates legacy row action ids and keeps keys it does not know", async () => {
    const { bb, harness } = setup();
    await bb.storage.kv.set("preference:rowActions", [
      "pin",
      "futureAction",
      "archive",
      "rename",
    ]);
    await plugin(bb);
    const listed = (await harness.behavior.callRpc("listPreferences", null)) as {
      preferences: { rowActions: string[] };
    };
    expect(listed.preferences.rowActions).toEqual([
      "core:pin",
      "futureAction",
      "core:archive",
    ]);
  });

  it("stores organisation mode and manual section order in bb's sidebar preferences, not plugin storage", async () => {
    const { bb, harness, uiStore, uiWrites } = setup({
      uiPreferences: {
        "sidebar.manualSectionOrder": {
          revision: 4,
          value: ["pinned", "sections", "threads"],
        },
      },
    });
    await plugin(bb);
    await expect(
      harness.behavior.callRpc("setPreference", {
        key: "manualSectionOrder",
        value: ["threads", "pinned", "sections"],
      }),
    ).resolves.toEqual({
      key: "manualSectionOrder",
      value: ["threads", "pinned", "sections"],
    });
    expect(uiWrites).toEqual([
      {
        key: "sidebar.manualSectionOrder",
        value: ["threads", "pinned", "sections"],
        expectedRevision: 4,
      },
    ]);
    await expect(bb.storage.kv.get("preference:manualSectionOrder")).resolves.toBeUndefined();
    expect(harness.realtimeSignals).toContainEqual({
      channel: "preferences",
      payload: { key: "manualSectionOrder", value: ["threads", "pinned", "sections"] },
    });

    uiStore.set("sidebar.organizationMode", { revision: 9, value: "project" });
    const listed = (await harness.behavior.callRpc("listPreferences", null)) as {
      preferences: { organizationMode: string; manualSectionOrder: string[] };
    };
    expect(listed.preferences.organizationMode).toBe("project");
    expect(listed.preferences.manualSectionOrder).toEqual(["threads", "pinned", "sections"]);

    await expect(
      harness.behavior.callRpc("resetPreference", { key: "organizationMode" }),
    ).resolves.toEqual({ key: "organizationMode", value: "chronological" });
    expect(uiStore.has("sidebar.organizationMode")).toBe(false);
  });

  it("falls back to the default when a stored value no longer parses", async () => {
    const { bb, harness } = setup();
    await bb.storage.kv.set("preference:chronologicalSort", "by-vibes");
    await plugin(bb);
    const listed = (await harness.behavior.callRpc("listPreferences", null)) as {
      preferences: { chronologicalSort: string };
    };
    expect(listed.preferences.chronologicalSort).toBe("updated");
  });
});

describe("migration from bb's sidebar preferences", () => {
  it("copies non-default values once and never overwrites a value the plugin already has", async () => {
    const { bb } = setup({
      uiPreferences: {
        "sidebar.sectionOrder": { revision: 3, value: ["threads", "pinned", "projects"] },
        "sidebar.collapsedProjects": { revision: 1, value: ["proj_a"] },
        "sidebar.chronologicalSort": { revision: 0, value: "updated" },
        "sidebar.hiddenGroups": { revision: 2, value: ["not-a-group"] },
      },
    });
    await bb.storage.kv.set("preference:collapsedProjects", ["proj_mine"]);
    const first = await migrateFromUiPreferences(bb);
    expect(first.migrated).toEqual(["sectionOrder"]);
    await expect(bb.storage.kv.get("preference:sectionOrder")).resolves.toEqual([
      "threads",
      "pinned",
      "projects",
    ]);
    await expect(bb.storage.kv.get("preference:collapsedProjects")).resolves.toEqual([
      "proj_mine",
    ]);
    await expect(bb.storage.kv.get("preference:chronologicalSort")).resolves.toBeUndefined();
    await expect(bb.storage.kv.get("preference:hiddenGroups")).resolves.toBeUndefined();

    await bb.storage.kv.delete("preference:sectionOrder");
    const second = await migrateFromUiPreferences(bb);
    expect(second.migrated).toEqual([]);
    await expect(bb.storage.kv.get("preference:sectionOrder")).resolves.toBeUndefined();
  });

  it("reads organisation mode live from bb on a fresh install that only has the old core keys", async () => {
    const { bb, harness, uiWrites } = setup({
      uiPreferences: {
        "sidebar.organizationMode": { revision: 3, value: "machine" },
        "sidebar.sectionOrder": { revision: 1, value: ["threads", "pinned", "projects"] },
      },
    });
    await plugin(bb);
    const listed = (await harness.behavior.callRpc("listPreferences", null)) as {
      preferences: { organizationMode: string; sectionOrder: string[] };
    };
    expect(listed.preferences.organizationMode).toBe("machine");
    expect(listed.preferences.sectionOrder).toEqual(["threads", "pinned", "projects"]);
    await expect(bb.storage.kv.get("preference:organizationMode")).resolves.toBeUndefined();
    await expect(bb.storage.kv.get("preference:sectionOrder")).resolves.toEqual([
      "threads",
      "pinned",
      "projects",
    ]);
    expect(uiWrites).toEqual([]);
  });

  it("moves plugin-stored organisation mode and section order back into bb once", async () => {
    const { bb, harness, uiStore, uiWrites } = setup({
      uiPreferences: {
        "sidebar.organizationMode": { revision: 2, value: "chronological" },
      },
    });
    await bb.storage.kv.set("preference:organizationMode", "machine");
    await bb.storage.kv.set("preference:manualSectionOrder", ["threads", "pinned", "sections"]);
    await bb.storage.kv.set("preference:collapsedProjects", ["proj_mine"]);
    await plugin(bb);
    expect(uiWrites).toEqual([
      { key: "sidebar.organizationMode", value: "machine", expectedRevision: 2 },
      {
        key: "sidebar.manualSectionOrder",
        value: ["threads", "pinned", "sections"],
        expectedRevision: 0,
      },
    ]);
    await expect(bb.storage.kv.get("preference:organizationMode")).resolves.toBeUndefined();
    await expect(bb.storage.kv.get("preference:manualSectionOrder")).resolves.toBeUndefined();
    await expect(bb.storage.kv.get("preference:collapsedProjects")).resolves.toEqual(["proj_mine"]);
    await expect(bb.storage.kv.get("migration:core-ui-preferences:v2")).resolves.toBe(true);
    const listed = (await harness.behavior.callRpc("listPreferences", null)) as {
      preferences: { organizationMode: string };
    };
    expect(listed.preferences.organizationMode).toBe("machine");

    uiStore.set("sidebar.organizationMode", { revision: 7, value: "project" });
    await bb.storage.kv.set("preference:organizationMode", "machine");
    expect((await migrateToUiPreferences(bb)).migrated).toEqual([]);
    expect(uiStore.get("sidebar.organizationMode")?.value).toBe("project");
  });

  it("skips the migration without marking it done when bb cannot be read", async () => {
    const { bb } = setup({ uiPreferencesFail: true });
    expect((await migrateFromUiPreferences(bb)).migrated).toEqual([]);
    await expect(bb.storage.kv.get("migration:ui-preferences:v1")).resolves.toBeUndefined();
  });
});

describe("bb thread-list prefs", () => {
  it("names the CLI after the plugin id", async () => {
    const builtIn = setup();
    await plugin(builtIn.bb);
    expect(builtIn.harness.inspection.registrations.cli?.name).toBe(
      "thread-list",
    );

    const copy = createFakePluginHost({ pluginId: "my-sidebar" });
    await plugin(copy.bb);
    expect(copy.harness.inspection.registrations.cli?.name).toBe("my-sidebar");
  });

  it("lists, gets, sets, and resets through the CLI", async () => {
    const { bb, harness } = setup();
    await plugin(bb);

    const listed = await harness.behavior.runCli(["prefs", "list", "--json"]);
    expect(listed.exitCode).toBe(0);
    expect(JSON.parse(listed.stdout)).toEqual(defaultPreferences());

    const set = await harness.behavior.runCli([
      "prefs",
      "set",
      "manualSectionOrder",
      '["threads","pinned","sections"]',
    ]);
    expect(set.exitCode).toBe(0);
    expect(set.stdout).toBe('manualSectionOrder = ["threads","pinned","sections"]');

    const bare = await harness.behavior.runCli(["prefs", "set", "organizationMode", "project"]);
    expect(bare.exitCode).toBe(0);

    const got = await harness.behavior.runCli(["prefs", "get", "organizationMode"]);
    expect(got.stdout).toBe('"project"');

    const iconsOn = await harness.behavior.runCli([
      "prefs", "set", "showProviderIcons", "true",
    ]);
    expect(iconsOn.exitCode).toBe(0);
    expect(iconsOn.stdout).toBe("showProviderIcons = true");
    await expect(bb.storage.kv.get("preference:showProviderIcons")).resolves.toBe(true);
    const resetIcons = await harness.behavior.runCli([
      "prefs", "reset", "showProviderIcons", "--json",
    ]);
    expect(JSON.parse(resetIcons.stdout)).toEqual({
      key: "showProviderIcons",
      value: true,
    });

    const bad = await harness.behavior.runCli(["prefs", "set", "organizationMode", "nope"]);
    expect(bad.exitCode).not.toBe(0);
    expect(bad.stderr).toMatch(/Invalid value for organizationMode/);

    const unknown = await harness.behavior.runCli(["prefs", "get", "colour"]);
    expect(unknown.exitCode).not.toBe(0);
    expect(unknown.stderr).toMatch(/Unknown preference: colour/);

    const reset = await harness.behavior.runCli(["prefs", "reset", "organizationMode", "--json"]);
    expect(JSON.parse(reset.stdout)).toEqual({
      key: "organizationMode",
      value: "chronological",
    });
  });
});

it("validates lifecycle selection through CLI and RPC and broadcasts it", async () => {
  const { bb, harness } = setup();
  await plugin(bb);
  expect((await harness.behavior.runCli(["prefs", "set", "threadLifecycles", '["archived"]'])).exitCode).toBe(0);
  await expect(bb.storage.kv.get("preference:threadLifecycles")).resolves.toEqual(["archived"]);
  for (const value of [[], ["archived", "archived"], ["deleted"]]) {
    await expect(harness.behavior.callRpc("setPreference", { key: "threadLifecycles", value })).rejects.toThrow(/Invalid value/);
  }
  await expect(bb.storage.kv.get("preference:threadLifecycles")).resolves.toEqual(["archived"]);
  expect(harness.realtimeSignals).toContainEqual({
    channel: "preferences", payload: { key: "threadLifecycles", value: ["archived"] },
  });
});
