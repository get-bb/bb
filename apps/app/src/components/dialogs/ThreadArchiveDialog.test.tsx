// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { makeThread } from "@bb/test-helpers/domain-fixtures";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadArchiveDialog } from "./ThreadArchiveDialog";

afterEach(() => {
  cleanup();
});

function renderDialog({
  childThreadCount = 1,
  stopsRunningWork = false,
  pending = false,
}: {
  pending?: boolean;
  childThreadCount?: number;
  stopsRunningWork?: boolean;
} = {}) {
  const onArchive = vi.fn();
  const onOpenChange = vi.fn();
  const thread = makeThread({ status: "idle" });
  const view = render(
    <ThreadArchiveDialog
      target={{ threads: [thread], childThreadCount, stopsRunningWork }}
      pending={pending}
      onOpenChange={onOpenChange}
      onArchive={onArchive}
    />,
  );
  return { onArchive, onOpenChange, thread, view };
}

describe("ThreadArchiveDialog", () => {
  it("announces the cascade with singular and plural child counts", () => {
    const { view } = renderDialog({ childThreadCount: 1 });
    expect(screen.getByRole("dialog").textContent).toContain(
      "Its 1 child thread will be archived too.",
    );
    expect(screen.getByText("1 child thread").className).toContain(
      "font-semibold",
    );

    view.unmount();
    renderDialog({ childThreadCount: 3 });
    expect(screen.getByRole("dialog").textContent).toContain(
      "Its 3 child threads will be archived too.",
    );
  });

  it("names the single thread in the title and action", () => {
    renderDialog({ childThreadCount: 3 });

    expect(
      screen.getByRole("heading", { name: "Archive thread?" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Archive" })).toBeTruthy();
  });

  it("warns when the archive will stop work beyond the selected idle thread", () => {
    renderDialog({ stopsRunningWork: true });
    expect(screen.getByText(/This will stop current work\./)).toBeTruthy();
  });

  it("omits the active-work warning for an idle thread", () => {
    renderDialog();
    expect(screen.queryByText(/This will stop current work\./)).toBeNull();
  });

  it("focuses the archive action when opened for keyboard confirmation", () => {
    renderDialog();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Archive" }),
    );
  });

  it("cancels with Escape without archiving", () => {
    const { onArchive, onOpenChange } = renderDialog();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onArchive).not.toHaveBeenCalled();
  });

  it("ignores confirmation while archiving is pending", () => {
    const { onArchive } = renderDialog({ pending: true });
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(onArchive).not.toHaveBeenCalled();
  });

  it("archives only when confirmation is accepted", () => {
    const { onArchive, onOpenChange, thread } = renderDialog({
      childThreadCount: 2,
    });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onArchive).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);

    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(onArchive).toHaveBeenCalledWith({
      threads: [thread],
      childThreadCount: 2,
      stopsRunningWork: false,
    });
  });
});
