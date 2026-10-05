// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { WorkspaceFile } from "@bb/server-contract";
import { afterEach, expect, it, vi } from "vitest";
import { useThreadStorageBrowser } from "./useThreadStorageBrowser";

const { treesModuleEvaluated } = vi.hoisted(() => ({
  treesModuleEvaluated: vi.fn<(specifier: string) => void>(),
}));
vi.mock("@pierre/trees", async (importOriginal) => {
  treesModuleEvaluated("@pierre/trees");
  return importOriginal();
});
vi.mock("@pierre/trees/react", async (importOriginal) => {
  treesModuleEvaluated("@pierre/trees/react");
  return importOriginal();
});

afterEach(cleanup);

it("loads the tree library only once there are files to show", async () => {
  const onSelectPath = vi.fn();
  const initialProps: { files: readonly WorkspaceFile[] | undefined } = {
    files: undefined,
  };
  const { result, rerender } = renderHook(
    ({ files }: typeof initialProps) =>
      useThreadStorageBrowser({ files, onSelectPath, selectedPath: null }),
    { initialProps },
  );

  expect(treesModuleEvaluated).not.toHaveBeenCalled();
  expect(result.current.model).toBeNull();

  rerender({ files: [] });
  await Promise.resolve();
  expect(treesModuleEvaluated).not.toHaveBeenCalled();
  expect(result.current.model).toBeNull();

  rerender({
    files: [
      { name: "notes.md", path: "docs/notes.md" },
      { name: "main.ts", path: "src/main.ts" },
    ],
  });
  await waitFor(() => {
    expect(result.current.model).not.toBeNull();
  });
  expect(treesModuleEvaluated).toHaveBeenCalled();
});
