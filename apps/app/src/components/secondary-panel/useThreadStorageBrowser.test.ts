import type { WorkspaceFile } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import {
  filterThreadStorageFiles,
  initialThreadStorageFolderState,
  syncThreadStorageFolderState,
  toggleThreadStorageFolderChain,
} from "./useThreadStorageBrowser";

const FILES: WorkspaceFile[] = [
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
  it("opens the folders above a newly selected file", () => {
    const empty = initialThreadStorageFolderState("thr_a", null);
    expect(empty.expandedFolders.size).toBe(0);

    const selected = syncThreadStorageFolderState(empty, {
      selectedPath: "docs/notes.md",
      threadId: "thr_a",
    });
    expect([...selected.expandedFolders]).toEqual(["docs"]);
    expect([...selected.foldersShowingAll]).toEqual(["docs"]);

    const deselected = syncThreadStorageFolderState(selected, {
      selectedPath: null,
      threadId: "thr_a",
    });
    expect(deselected.lastSelectedPath).toBe("docs/notes.md");
    expect(
      toggleThreadStorageFolderChain(deselected.expandedFolders, ["docs"]).has(
        "docs",
      ),
    ).toBe(false);
  });

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

  it("starts each thread with only the selected file's folders open", () => {
    const threadA = {
      ...initialThreadStorageFolderState("thr_a", null),
      expandedFolders: new Set(["docs"]),
      foldersShowingAll: new Set(["docs"]),
    };

    const threadB = syncThreadStorageFolderState(threadA, {
      selectedPath: null,
      threadId: "thr_b",
    });
    expect(threadB.expandedFolders.size).toBe(0);
    expect(threadB.foldersShowingAll.size).toBe(0);
  });
});
