// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { WorkspaceFile } from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useThreadStorageBrowser } from "./useThreadStorageBrowser";

const FILES: readonly WorkspaceFile[] = [
  { name: "notes.md", path: "docs/notes.md" },
  { name: "main.ts", path: "src/main.ts" },
];

interface StorageBrowserTestProps {
  files: readonly WorkspaceFile[] | undefined;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useThreadStorageBrowser", () => {
  it("keeps the tree model absent until files are available", async () => {
    const onSelectPath = vi.fn();
    const initialProps: StorageBrowserTestProps = {
      files: undefined,
    };
    const { result, rerender } = renderHook(
      ({ files }: typeof initialProps) =>
        useThreadStorageBrowser({ files, onSelectPath, selectedPath: null }),
      { initialProps },
    );

    expect(result.current.model).toBeNull();

    rerender({ files: [] });
    await Promise.resolve();
    expect(result.current.model).toBeNull();

    rerender({ files: FILES });
    await waitFor(() => {
      expect(result.current.model).not.toBeNull();
    });
  });

  it("syncs files and selection into the model once it arrives, then destroys it on unmount", async () => {
    const onSelectPath = vi.fn();
    const { result, rerender, unmount } = renderHook(
      ({ selectedPath }: { selectedPath: string | null }) =>
        useThreadStorageBrowser({ files: FILES, onSelectPath, selectedPath }),
      { initialProps: { selectedPath: "src/main.ts" } },
    );

    await waitFor(() => {
      expect(result.current.model).not.toBeNull();
    });
    const model = result.current.model;
    if (model === null) throw new Error("model should be loaded");
    expect(model.getItem("src/main.ts")).not.toBeNull();
    expect(model.getItem("docs/notes.md")).not.toBeNull();
    expect(model.getSelectedPaths()).toEqual(["src/main.ts"]);

    rerender({ selectedPath: "docs/notes.md" });
    expect(model.getSelectedPaths()).toEqual(["docs/notes.md"]);
    expect(onSelectPath).not.toHaveBeenCalled();

    const cleanUp = vi.spyOn(model, "cleanUp");
    unmount();
    expect(cleanUp).toHaveBeenCalledTimes(1);
  });
});
