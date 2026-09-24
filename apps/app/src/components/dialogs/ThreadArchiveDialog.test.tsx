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
      screen.getByText(/1 child thread will be archived with this thread\./),
    ).toBeTruthy();

    view.unmount();
    renderDialog({ childThreadCount: 3 });
    expect(
      screen.getByText(/3 child threads will be archived with this thread\./),
    ).toBeTruthy();
  });

  it("names the total number of threads in the title and action", () => {
    renderDialog({ childThreadCount: 3 });

    expect(
      screen.getByRole("heading", { name: "Archive 4 threads?" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Archive 4 threads" }),
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

    fireEvent.click(screen.getByRole("button", { name: "Archive 3 threads" }));
    expect(onArchive).toHaveBeenCalledWith({ thread, childThreadCount: 2 });
  });
});
