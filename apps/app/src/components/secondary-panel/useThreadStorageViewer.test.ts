import { describe, expect, it } from "vitest";
import { shouldLoadThreadStorageFileList } from "./useThreadStorageViewer";

describe("shouldLoadThreadStorageFileList", () => {
  it("does not load the storage list on a plain thread open", () => {
    expect(
      shouldLoadThreadStorageFileList({
        hasThread: true,
        isSecondaryPanelOpen: false,
        secondaryTabs: [{ kind: "terminal" }, { kind: "host-file-preview" }],
      }),
    ).toBe(false);
  });

  it("loads once the secondary panel opens", () => {
    expect(
      shouldLoadThreadStorageFileList({
        hasThread: true,
        isSecondaryPanelOpen: true,
        secondaryTabs: [],
      }),
    ).toBe(true);
  });

  it("loads while a storage tab exists so tab pruning keeps working", () => {
    expect(
      shouldLoadThreadStorageFileList({
        hasThread: true,
        isSecondaryPanelOpen: false,
        secondaryTabs: [{ kind: "thread-storage-file-preview" }],
      }),
    ).toBe(true);
  });

  it("never loads without a thread", () => {
    expect(
      shouldLoadThreadStorageFileList({
        hasThread: false,
        isSecondaryPanelOpen: true,
        secondaryTabs: [{ kind: "thread-storage-file-preview" }],
      }),
    ).toBe(false);
  });
});
