// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRef } from "react";
import type { DiffCommentDraftTarget } from "@/lib/prompt-draft";
import {
  usePierreLineSelectionActions,
  type PierreDiffCommentOptions,
} from "./PierreLineSelectionActions";

afterEach(() => {
  cleanup();
});

function useTestLineSelectionActions(diffComment: PierreDiffCommentOptions) {
  const containerRef = useRef<HTMLElement>(null);
  return usePierreLineSelectionActions({
    buildSelectionText: () => "selected lines",
    containerRef,
    diffComment,
    enabled: true,
  });
}

describe("usePierreLineSelectionActions", () => {
  it("opens an inline annotation when a line selection ends", () => {
    const onSubmit =
      vi.fn<(comment: string, target: DiffCommentDraftTarget) => void>();
    const { result } = renderHook(() =>
      useTestLineSelectionActions({
        filePath: "src/file.ts",
        onSubmit,
      }),
    );

    act(() => {
      result.current.onLineSelectionStart({ start: 11, end: 11 });
      result.current.onLineSelectionChange({ start: 11, end: 7 });
      result.current.onLineSelectionEnd({ start: 11, end: 7 });
    });

    expect(result.current.commentAnnotation).toEqual({
      lineNumber: 11,
      side: "additions",
    });

    render(result.current.commentInput);
    expect(screen.getByText("Lines 7–11")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Diff comment" })).toBeTruthy();
  });

  it("submits the selected file and ordered line range, then clears the annotation", () => {
    const onSubmit =
      vi.fn<(comment: string, target: DiffCommentDraftTarget) => void>();
    const { result } = renderHook(() =>
      useTestLineSelectionActions({
        filePath: "src/file.ts",
        onSubmit,
      }),
    );

    act(() => {
      result.current.onLineSelectionEnd({ start: 11, end: 7 });
    });
    render(result.current.commentInput);

    fireEvent.change(screen.getByRole("textbox", { name: "Diff comment" }), {
      target: { value: "Use the shared helper." },
    });
    fireEvent.click(screen.getByRole("button", { name: /Comment/ }));

    expect(onSubmit).toHaveBeenCalledWith("Use the shared helper.", {
      filePath: "src/file.ts",
      startLine: 7,
      endLine: 11,
    });
    expect(result.current.commentAnnotation).toBeNull();
    expect(result.current.commentInput).toBeNull();
  });
});
