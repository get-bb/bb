// @vitest-environment jsdom

import { getDefaultStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyRemotePreferenceSignal,
  flushPreferenceWritesForTest,
  hydratePreferences,
  hydratePreferencesFromMirror,
  PREFERENCES_MIRROR_STORAGE_KEY,
  preferencesReadyAtom,
  resetPreferencesSyncForTest,
  setPreferencesMirrorStorageForTest,
  type PreferencesRpc,
} from "./preferences-sync.js";
import { createSyncedPreferenceAtom } from "./synced-preference-atom.js";
import { defaultPreferences } from "../../shared/preferences.js";

function fakeRpc(
  preferences: Record<string, unknown> = {},
): PreferencesRpc & { calls: { method: string; input: unknown }[] } {
  const calls: { method: string; input: unknown }[] = [];
  return {
    calls,
    async call(method: string, input: unknown) {
      calls.push({ method, input });
      if (method === "listPreferences") {
        return { preferences: { ...defaultPreferences(), ...preferences } };
      }
      return input;
    },
  };
}

function memoryStorage(): Storage {
  const rows = new Map<string, string>();
  return {
    get length() {
      return rows.size;
    },
    clear: () => rows.clear(),
    getItem: (key) => rows.get(key) ?? null,
    key: (index) => [...rows.keys()][index] ?? null,
    removeItem: (key) => {
      rows.delete(key);
    },
    setItem: (key, value) => {
      rows.set(key, String(value));
    },
  };
}

let mirror: Storage;

beforeEach(() => {
  vi.useFakeTimers();
  mirror = memoryStorage();
  setPreferencesMirrorStorageForTest(mirror);
});

afterEach(() => {
  resetPreferencesSyncForTest();
  setPreferencesMirrorStorageForTest(undefined);
  vi.useRealTimers();
});

describe("preferences sync", () => {
  it("hydrates from the server, marks ready, and mirrors to localStorage", async () => {
    const store = getDefaultStore();
    const modeAtom = createSyncedPreferenceAtom("organizationMode");
    expect(store.get(preferencesReadyAtom())).toBe(false);
    await hydratePreferences(fakeRpc({ organizationMode: "machine" }));
    expect(store.get(preferencesReadyAtom())).toBe(true);
    expect(store.get(modeAtom)).toBe("machine");
    expect(
      JSON.parse(mirror.getItem(PREFERENCES_MIRROR_STORAGE_KEY) ?? "{}")
        .organizationMode,
    ).toBe("machine");
  });

  it("paints from the mirror before the server answers and ignores junk in it", () => {
    mirror.setItem(
      PREFERENCES_MIRROR_STORAGE_KEY,
      JSON.stringify({ organizationMode: "project", chronologicalSort: "nonsense" }),
    );
    const store = getDefaultStore();
    expect(hydratePreferencesFromMirror()).toBe(true);
    expect(store.get(createSyncedPreferenceAtom("organizationMode"))).toBe("project");
    expect(store.get(createSyncedPreferenceAtom("chronologicalSort"))).toBe("updated");
    mirror.setItem(PREFERENCES_MIRROR_STORAGE_KEY, "{not json");
    expect(hydratePreferencesFromMirror()).toBe(false);
  });

  it("applies a local write immediately and coalesces the server write", async () => {
    const rpc = fakeRpc();
    await hydratePreferences(rpc);
    const store = getDefaultStore();
    const collapsedAtom = createSyncedPreferenceAtom("collapsedProjects");
    store.set(collapsedAtom, ["proj_a"]);
    store.set(collapsedAtom, (current) => [...current, "proj_b"]);
    store.set(collapsedAtom, (current) => current.filter((id) => id !== "proj_a"));
    expect(store.get(collapsedAtom)).toEqual(["proj_b"]);
    expect(rpc.calls.filter((call) => call.method === "setPreference")).toHaveLength(0);
    vi.advanceTimersByTime(200);
    await flushPreferenceWritesForTest();
    expect(rpc.calls.filter((call) => call.method === "setPreference")).toEqual([
      { method: "setPreference", input: { key: "collapsedProjects", value: ["proj_b"] } },
    ]);
  });

  it("takes a remote change from another window unless a local write is pending", async () => {
    const rpc = fakeRpc();
    await hydratePreferences(rpc);
    const store = getDefaultStore();
    const sortAtom = createSyncedPreferenceAtom("chronologicalSort");
    applyRemotePreferenceSignal({ key: "chronologicalSort", value: "alpha" });
    expect(store.get(sortAtom)).toBe("alpha");
    applyRemotePreferenceSignal({ key: "chronologicalSort", value: "bogus" });
    expect(store.get(sortAtom)).toBe("alpha");
    applyRemotePreferenceSignal({ key: "nope", value: 1 });
    expect(store.get(sortAtom)).toBe("alpha");

    store.set(sortAtom, "created");
    applyRemotePreferenceSignal({ key: "chronologicalSort", value: "updated" });
    expect(store.get(sortAtom)).toBe("created");
    vi.advanceTimersByTime(200);
    await flushPreferenceWritesForTest();
    applyRemotePreferenceSignal({ key: "chronologicalSort", value: "updated" });
    expect(store.get(sortAtom)).toBe("updated");
  });

  it("does not write back a value that did not change", async () => {
    const rpc = fakeRpc();
    await hydratePreferences(rpc);
    const store = getDefaultStore();
    const modeAtom = createSyncedPreferenceAtom("organizationMode");
    store.set(modeAtom, "chronological");
    vi.advanceTimersByTime(200);
    await flushPreferenceWritesForTest();
    expect(rpc.calls.filter((call) => call.method === "setPreference")).toHaveLength(0);
  });
});
