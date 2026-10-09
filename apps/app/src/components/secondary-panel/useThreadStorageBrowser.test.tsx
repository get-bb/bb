// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import type { WorkspaceFile } from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useThreadStorageBrowser } from "./useThreadStorageBrowser";

const FILES: WorkspaceFile[] = [
  { name: "notes.md", path: "docs/notes.md" },
  { name: "Screenshot.png", path: "Attachments/Screenshot.png" },
];

afterEach(cleanup);

describe("useThreadStorageBrowser", () => {
  it("filters stored files by path without case sensitivity", () => {
    const { result } = renderHook(() =>
      useThreadStorageBrowser({
        files: FILES,
        onSelectPath: vi.fn(),
        selectedPath: null,
        threadId: "thr_a",
      }),
    );

    act(() => {
      result.current.setSearchQuery("attach");
    });
    expect(result.current.filteredFiles.map((file) => file.path)).toEqual([
      "Attachments/Screenshot.png",
    ]);

    act(() => {
      result.current.setSearchQuery("");
    });
    expect(result.current.filteredFiles).toHaveLength(2);
  });

  it("opens the folders above a newly selected file", () => {
    const { result, rerender } = renderHook(
      ({ selectedPath }: { selectedPath: string | null }) =>
        useThreadStorageBrowser({
          files: FILES,
          onSelectPath: vi.fn(),
          selectedPath,
          threadId: "thr_a",
        }),
      { initialProps: { selectedPath: null as string | null } },
    );
    expect(result.current.expandedFolders.size).toBe(0);

    rerender({ selectedPath: "docs/notes.md" });
    expect([...result.current.expandedFolders]).toEqual(["docs"]);
    expect([...result.current.foldersShowingAll]).toEqual(["docs"]);

    rerender({ selectedPath: null });
    expect(result.current.lastSelectedPath).toBe("docs/notes.md");

    act(() => {
      result.current.toggleFolder(["docs"]);
    });
    expect(result.current.expandedFolders.has("docs")).toBe(false);
  });

  it("opens and closes every folder in a merged chain together", () => {
    const { result } = renderHook(() =>
      useThreadStorageBrowser({
        files: FILES,
        onSelectPath: vi.fn(),
        selectedPath: null,
        threadId: "thr_a",
      }),
    );
    act(() => {
      result.current.toggleFolder(["qa", "qa/shots"]);
    });
    expect([...result.current.expandedFolders]).toEqual(["qa", "qa/shots"]);

    act(() => {
      result.current.toggleFolder(["qa", "qa/shots"]);
    });
    expect(result.current.expandedFolders.size).toBe(0);
  });

  it("starts each thread with only the selected file's folders open", () => {
    const { result, rerender } = renderHook(
      ({ threadId }: { threadId: string }) =>
        useThreadStorageBrowser({
          files: FILES,
          onSelectPath: vi.fn(),
          selectedPath: null,
          threadId,
        }),
      { initialProps: { threadId: "thr_a" } },
    );
    act(() => {
      result.current.toggleFolder(["docs"]);
      result.current.showAllInFolder("docs");
    });
    expect(result.current.expandedFolders.has("docs")).toBe(true);

    rerender({ threadId: "thr_b" });
    expect(result.current.expandedFolders.size).toBe(0);
    expect(result.current.foldersShowingAll.size).toBe(0);
  });
});
