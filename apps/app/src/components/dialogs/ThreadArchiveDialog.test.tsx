// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { makeThread } from "@bb/test-helpers/domain-fixtures";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadArchiveDialog } from "./ThreadArchiveDialog";

afterEach(() => {
  cleanup();
});

function renderDialog({
  childThreadCount,
  status = "idle",
}: {
  childThreadCount?: number;
  status?: "idle" | "starting" | "active" | "stopping";
} = {}) {
  const onArchive = vi.fn();
  const onOpenChange = vi.fn();
  const thread = makeThread({ status });
  const view = render(
    <ThreadArchiveDialog
      target={{ thread, childThreadCount }}
      pending={false}
      onOpenChange={onOpenChange}
      onArchive={onArchive}
    />,
  );
  return { onArchive, onOpenChange, thread, view };
}

describe("ThreadArchiveDialog", () => {
  it("announces the cascade with singular and plural child counts", () => {
    const { view } = renderDialog({ childThreadCount: 1 });
    expect(
      screen.getByText(/1 child thread will be archived too\./),
    ).toBeTruthy();

    view.unmount();
    renderDialog({ childThreadCount: 3 });
    expect(
      screen.getByText(/3 child threads will be archived too\./),
    ).toBeTruthy();
  });

  it("omits the cascade sentence when the thread has no children", () => {
    renderDialog();

    expect(screen.queryByText(/will be archived too/)).toBeNull();
    expect(
      screen.getByText(
        "Archived threads stay available and can be unarchived.",
      ),
    ).toBeTruthy();
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

  it("archives only when confirmation is accepted", () => {
    const { onArchive, onOpenChange, thread } = renderDialog({
      childThreadCount: 2,
    });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onArchive).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);

    fireEvent.click(screen.getByRole("button", { name: "Archive thread" }));
    expect(onArchive).toHaveBeenCalledWith({ thread, childThreadCount: 2 });
  });
});
