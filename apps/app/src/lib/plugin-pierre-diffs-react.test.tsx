import {
  DEFAULT_THEMES,
  DiffHunksRenderer,
  parsePatchFiles,
  type RenderDiffOptions,
  type ThemedDiffResult,
} from "@pierre/diffs";
import type { WorkerPoolManager } from "@pierre/diffs/worker";
import { describe, expect, it, vi } from "vitest";

const renderOptions: RenderDiffOptions = {
  theme: DEFAULT_THEMES,
  useTokenTransformer: false,
  tokenizeMaxLineLength: 1_000,
  lineDiffType: "word-alt",
  maxLineDiffLength: 1_000,
};

const highlightedResult: ThemedDiffResult = {
  code: {
    additionLines: [],
    deletionLines: [],
  },
  themeStyles: "",
  baseThemeType: undefined,
};

describe("Pierre diff hydration", () => {
  it("repaints adopted DOM when its pending worker highlight completes", () => {
    const fileDiff = parsePatchFiles(
      "diff --git a/example.ts b/example.ts\n" +
        "--- a/example.ts\n" +
        "+++ b/example.ts\n" +
        "@@ -1 +1 @@\n" +
        "-const answer = 41;\n" +
        "+const answer = 42;\n",
    )[0]?.files[0];
    if (fileDiff === undefined) throw new Error("Expected a parsed file diff");

    const highlightDiffAST = vi.fn();
    const workerPool = {
      getDiffRenderOptions: () => renderOptions,
      getDiffResultCache: () => undefined,
      highlightDiffAST,
      isWorkingPool: () => true,
    } as unknown as WorkerPoolManager;
    const onRenderUpdate = vi.fn();
    const renderer = new DiffHunksRenderer(
      undefined,
      onRenderUpdate,
      workerPool,
    );

    // React Strict Mode replays Pierre's ref callback against the existing
    // custom element. The replacement renderer hydrates that retained DOM
    // instead of rendering a fresh plain AST.
    renderer.hydrate(fileDiff);
    expect(highlightDiffAST).toHaveBeenCalledWith(renderer, fileDiff);

    renderer.onHighlightSuccess(
      fileDiff,
      highlightedResult,
      renderOptions,
    );

    expect(onRenderUpdate).toHaveBeenCalledOnce();
  });
});
