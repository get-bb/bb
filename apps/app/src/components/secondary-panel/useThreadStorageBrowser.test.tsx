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
});
