// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { makeThread } from "@bb/test-helpers/domain-fixtures";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThreadArchiveWorktree } from "@bb/server-contract";
import { ThreadArchiveDialog } from "./ThreadArchiveDialog";

afterEach(() => {
  cleanup();
});

function renderDialog({
  childThreadCount = 1,
  status = "idle",
  pending = false,
  worktrees = [],
}: {
  pending?: boolean;
  worktrees?: ThreadArchiveWorktree[];
  childThreadCount?: number;
  status?: "idle" | "starting" | "active" | "stopping";
} = {}) {
  const onArchive = vi.fn();
  const onOpenChange = vi.fn();
  const thread = makeThread({ status });
  const view = render(
    <ThreadArchiveDialog
      target={{ thread, childThreadCount, worktrees }}
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
      "The thread under it will be archived too.",
    );
    expect(screen.getByText("thread").className).toContain("font-semibold");

    view.unmount();
    renderDialog({ childThreadCount: 3 });
    expect(screen.getByRole("dialog").textContent).toContain(
      "The 3 threads under it will be archived too.",
    );
  });

  it("only offers keeping when the worktree cannot be checked", () => {
    const { onArchive } = renderDialog({
      worktrees: [
        {
          environmentId: "env_offline",
          threadId: "thr_offline",
          path: "/offline/repo",
          state: "unavailable",
        },
      ],
    });
    expect(
      screen.queryByRole("button", { name: "Commit and push first" }),
    ).toBeNull();
    expect(
      screen.getByText(
        "bb couldn't check this worktree for unsaved changes, so it will be kept.",
      ),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Keep worktree and archive" }),
    );
    expect(onArchive).toHaveBeenCalledWith(expect.anything(), "keep");
  });

  it("names the single thread in the title and action", () => {
    renderDialog({ childThreadCount: 3 });

    expect(
      screen.getByRole("heading", { name: "Archive thread?" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Archive" })).toBeTruthy();
  });

  it.each(["starting", "active", "stopping"] as const)(
    "warns that current work will stop for a %s thread",
    (status) => {
      renderDialog({ status });
      expect(screen.getByText(/This will stop current work\./)).toBeTruthy();
    },
  );

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
    expect(onArchive).toHaveBeenCalledWith(
      { thread, childThreadCount: 2, worktrees: [] },
      "auto",
    );
  });
});
