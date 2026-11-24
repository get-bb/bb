import type { ThreadStorageFileEntry } from "./thread-storage-tree";
import { describe, expect, it } from "vitest";
import {
  filterThreadStorageFiles,
  initialThreadStorageFolderState,
  syncThreadStorageFolderState,
  toggleThreadStorageFolderChain,
} from "./use-thread-storage-browser";

const FILES: ThreadStorageFileEntry[] = [
  { name: "notes.md", path: "docs/notes.md" },
  { name: "Screenshot.png", path: "Attachments/Screenshot.png" },
];

describe("filterThreadStorageFiles", () => {
  it("filters stored files by path without case sensitivity", () => {
    expect(
      filterThreadStorageFiles(FILES, "attach").map((file) => file.path),
    ).toEqual(["Attachments/Screenshot.png"]);
    expect(filterThreadStorageFiles(FILES, "")).toHaveLength(2);
  });
});

describe("thread storage folder state", () => {
  it("opens and closes every folder in a merged chain together", () => {
    const opened = toggleThreadStorageFolderChain(new Set(), [
      "qa",
      "qa/shots",
    ]);
    expect([...opened]).toEqual(["qa", "qa/shots"]);

    expect(
      toggleThreadStorageFolderChain(opened, ["qa", "qa/shots"]).size,
    ).toBe(0);
  });

  it("starts each thread with every folder closed", () => {
    const threadA = {
      ...initialThreadStorageFolderState("thr_a"),
      expandedFolders: new Set(["docs"]),
      foldersShowingAll: new Set(["docs"]),
    };

    expect(syncThreadStorageFolderState(threadA, "thr_a")).toBe(threadA);
    const threadB = syncThreadStorageFolderState(threadA, "thr_b");
    expect(threadB.expandedFolders.size).toBe(0);
    expect(threadB.foldersShowingAll.size).toBe(0);
  });
});
