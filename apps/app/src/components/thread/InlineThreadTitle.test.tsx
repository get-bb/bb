// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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
  resetKey = "thr_test",
  title,
}: {
  onCommit: (nextTitle: string) => Promise<void>;
  resetKey?: string;
  title: string;
}) {
  const { editor, isEditing, startEditing } = useInlineThreadTitle({
    onCommit,
    resetKey,
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
    const onCommit = vi.fn(async () => {});
    render(<InlineTitleHarness onCommit={onCommit} title="Old name" />);

    fireEvent.doubleClick(screen.getByRole("button", { name: "Old name" }));
    const input = screen.getByRole("textbox", { name: "Thread name" });
    fireEvent.change(input, { target: { value: "New name" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("New name");
  });

  it("keeps the new name in the editor until the save settles", async () => {
    let finishSave = () => {};
    const onCommit = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve;
        }),
    );
    render(<InlineTitleHarness onCommit={onCommit} title="Old name" />);

    fireEvent.doubleClick(screen.getByRole("button", { name: "Old name" }));
    const input = screen.getByRole("textbox", { name: "Thread name" });
    fireEvent.change(input, { target: { value: "New name" } });
    fireEvent.blur(input);

    expect(screen.queryByRole("button", { name: "Old name" })).toBeNull();
    expect(input).toHaveProperty("value", "New name");
    expect(input).toHaveProperty("readOnly", true);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.getByRole("textbox", { name: "Thread name" })).toBe(input);

    finishSave();
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "Thread name" })).toBeNull(),
    );
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("keeps the draft open with an error when the save fails", async () => {
    const onCommit = vi
      .fn<(nextTitle: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(undefined);
    render(<InlineTitleHarness onCommit={onCommit} title="Old name" />);

    fireEvent.doubleClick(screen.getByRole("button", { name: "Old name" }));
    const input = screen.getByRole("textbox", { name: "Thread name" });
    fireEvent.change(input, { target: { value: "New name" } });
    fireEvent.keyDown(input, { key: "Enter" });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Could not save the name. Try again.");
    expect(input).toHaveProperty("value", "New name");
    expect(input).toHaveProperty("readOnly", false);

    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "Thread name" })).toBeNull(),
    );
    expect(onCommit).toHaveBeenCalledTimes(2);
  });

  it("does not commit when the draft is empty", () => {
    const onCommit = vi.fn(async () => {});
    render(<InlineTitleHarness onCommit={onCommit} title="Old name" />);

    fireEvent.doubleClick(screen.getByRole("button", { name: "Old name" }));
    const input = screen.getByRole("textbox", { name: "Thread name" });
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.blur(input);

    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Old name" })).not.toBeNull();
  });

  it("cancels an open edit when the thread identity changes", () => {
    const firstCommit = vi.fn(async () => {});
    const secondCommit = vi.fn(async () => {});
    const { rerender } = render(
      <InlineTitleHarness onCommit={firstCommit} title="Old name" />,
    );

    fireEvent.doubleClick(screen.getByRole("button", { name: "Old name" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Thread name" }), {
      target: { value: "Draft name" },
    });

    rerender(
      <InlineTitleHarness
        onCommit={secondCommit}
        resetKey="thr_other"
        title="Other thread"
      />,
    );

    expect(screen.queryByRole("textbox", { name: "Thread name" })).toBeNull();
    expect(screen.getByRole("button", { name: "Other thread" })).not.toBeNull();
    expect(firstCommit).not.toHaveBeenCalled();
    expect(secondCommit).not.toHaveBeenCalled();
  });
});
