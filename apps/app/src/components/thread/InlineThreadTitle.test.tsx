// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveInlineThreadTitleCommit,
  useInlineThreadTitle,
} from "./InlineThreadTitle";

afterEach(() => {
  cleanup();
});

function InlineTitleHarness({
  onCommit,
  title,
}: {
  onCommit: (nextTitle: string) => void;
  title: string;
}) {
  const { editor, isEditing, startEditing } = useInlineThreadTitle({
    onCommit,
    title,
  });

  return (
    <div>
      {isEditing ? (
        editor
      ) : (
        <button type="button" onDoubleClick={startEditing}>
          {title}
        </button>
      )}
    </div>
  );
}

describe("resolveInlineThreadTitleCommit", () => {
  it("commits a trimmed new title", () => {
    expect(
      resolveInlineThreadTitleCommit({
        currentTitle: "Old name",
        nextTitle: "  New name  ",
      }),
    ).toEqual({ kind: "commit", title: "New name" });
  });

  it("cancels an empty or unchanged title", () => {
    expect(
      resolveInlineThreadTitleCommit({
        currentTitle: "Same name",
        nextTitle: "   ",
      }),
    ).toEqual({ kind: "cancel" });
    expect(
      resolveInlineThreadTitleCommit({
        currentTitle: "Same name",
        nextTitle: " Same name ",
      }),
    ).toEqual({ kind: "cancel" });
  });
});

describe("useInlineThreadTitle", () => {
  it("commits a changed title on blur and ignores a second close", () => {
    const onCommit = vi.fn();
    render(<InlineTitleHarness onCommit={onCommit} title="Old name" />);

    fireEvent.doubleClick(screen.getByRole("button", { name: "Old name" }));
    const input = screen.getByRole("textbox", { name: "Thread name" });
    fireEvent.change(input, { target: { value: "New name" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("New name");
  });

  it("does not commit when the draft is empty", () => {
    const onCommit = vi.fn();
    render(<InlineTitleHarness onCommit={onCommit} title="Old name" />);

    fireEvent.doubleClick(screen.getByRole("button", { name: "Old name" }));
    const input = screen.getByRole("textbox", { name: "Thread name" });
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.blur(input);

    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Old name" })).not.toBeNull();
  });
});
