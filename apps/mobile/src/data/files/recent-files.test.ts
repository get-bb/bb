import { describe, expect, it } from "vitest";
import {
  createRecentFilesStore,
  parseRecentFiles,
  recordRecentFile,
  threadRecentFilesStorageKey,
  type RecentFilesStorage,
} from "./recent-files";

function memoryStorage(): RecentFilesStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getString: (key) => map.get(key),
    set: (key, value) => void map.set(key, value),
    remove: (key) => void map.delete(key),
  };
}

describe("recordRecentFile", () => {
  it("moves a reopened file to the front and caps the list", () => {
    const items = recordRecentFile(
      [
        { source: "workspace", path: "a", openedAt: 1 },
        { source: "thread-storage", path: "a", openedAt: 2 },
      ],
      { source: "workspace", path: "a", openedAt: 3 },
      2,
    );
    expect(items).toEqual([
      { source: "workspace", path: "a", openedAt: 3 },
      { source: "thread-storage", path: "a", openedAt: 2 },
    ]);
  });
});

describe("parseRecentFiles", () => {
  it("rejects malformed storage", () => {
    expect(parseRecentFiles(undefined)).toEqual([]);
    expect(parseRecentFiles("nope")).toEqual([]);
    expect(
      parseRecentFiles('[{"source":"x","path":"a","openedAt":1}]'),
    ).toEqual([]);
    expect(
      parseRecentFiles('[{"source":"workspace","path":"a","openedAt":1}]'),
    ).toEqual([{ source: "workspace", path: "a", openedAt: 1 }]);
  });
});

describe("createRecentFilesStore", () => {
  it("persists under the web key, notifies subscribers, and reads back after a cold start", () => {
    const storage = memoryStorage();
    let now = 100;
    const store = createRecentFilesStore(storage, { now: () => now });
    let notified = 0;
    const unsubscribe = store.subscribe("t1", () => {
      notified += 1;
    });
    store.record("t1", { source: "workspace", path: "src/a.ts" });
    now = 200;
    store.record("t1", { source: "thread-storage", path: "n.md" });
    expect(notified).toBe(2);
    expect(store.read("t1").map((item) => item.path)).toEqual([
      "n.md",
      "src/a.ts",
    ]);
    expect(storage.map.has(threadRecentFilesStorageKey("t1"))).toBe(true);
    expect(threadRecentFilesStorageKey("t/1")).toBe(
      "bb.thread.recentItems-t%2F1-1",
    );
    unsubscribe();

    const reopened = createRecentFilesStore(storage);
    expect(reopened.read("t1")).toEqual([
      { source: "thread-storage", path: "n.md", openedAt: 200 },
      { source: "workspace", path: "src/a.ts", openedAt: 100 },
    ]);
    expect(reopened.read("t2")).toEqual([]);
  });
});
