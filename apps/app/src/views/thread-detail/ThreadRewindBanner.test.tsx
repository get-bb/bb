// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ThreadRewindBanner,
  type ThreadRewindBannerProps,
} from "./ThreadRewindBanner";
import type { ThreadRewindEditingSession } from "./useThreadRewindEditing";

function session(
  overrides: Partial<ThreadRewindEditingSession> = {},
): ThreadRewindEditingSession {
  return {
    branchId: "br_1",
    displacedTurnCount: 3,
    idempotencyKey: "rewind:thr_1:br_1:42:turn_1:abc",
    message: null,
    retryable: false,
    revision: 7,
    sourceSequence: 42,
    status: "confirming",
    target: { branchId: "br_1", sourceSequence: 42, turnId: "turn_1" },
    turnId: "turn_1",
    ...overrides,
  };
}

function renderBanner(
  overrides: Partial<ThreadRewindBannerProps> = {},
  sessionOverrides: Partial<ThreadRewindEditingSession> = {},
) {
  const props: ThreadRewindBannerProps = {
    editedText: "Fix the sidebar overflow",
    onCancel: vi.fn(),
    onCommit: vi.fn(),
    onDismiss: vi.fn(),
    onRevalidate: vi.fn(),
    session: session(sessionOverrides),
    ...overrides,
  };
  const utils = render(<ThreadRewindBanner {...props} />);
  return { props, ...utils };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ThreadRewindBanner", () => {
  it("states the consequence and commits from the confirming state", () => {
    const { props } = renderBanner();
    expect(
      screen.getByText("Edit and continue from this message"),
    ).toBeTruthy();
    expect(screen.getByText(/3 later turns/)).toBeTruthy();
    expect(screen.getByText(/Workspace files stay unchanged/)).toBeTruthy();
    expect(screen.getByText("Fix the sidebar overflow")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Rewind & continue" }));
    expect(props.onCommit).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it("explains stale eligibility and re-checks instead of committing", () => {
    const { props } = renderBanner(
      {},
      {
        message: "The thread is running. Wait until it's idle to edit an earlier message.",
        status: "stale",
      },
    );
    expect(
      screen.getByText("This edit can't continue right now"),
    ).toBeTruthy();
    expect(screen.getByText(/The thread is running/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Re-check" }));
    expect(props.onRevalidate).toHaveBeenCalledTimes(1);
    expect(props.onCommit).not.toHaveBeenCalled();
  });

  it("retries a retryable failure and keeps the draft in the composer", () => {
    const { props } = renderBanner(
      {},
      {
        message:
          "The provider could not create the rewound branch. Your edit is preserved below.",
        retryable: true,
        status: "failed",
      },
    );
    expect(screen.getByText("The edit wasn't sent")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(props.onCommit).toHaveBeenCalledTimes(1);
  });

  it("disables retry for non-retryable failures", () => {
    renderBanner(
      {},
      {
        message: "That message is no longer editable.",
        retryable: false,
        status: "failed",
      },
    );
    const retry = screen.getByRole("button", { name: "Try again" });
    expect((retry as HTMLButtonElement).disabled).toBe(true);
  });

  it("dismisses from draft recovery without clearing the composer", () => {
    const { props } = renderBanner(
      {},
      {
        message:
          "The rewound branch is active, but the edited turn wasn't sent. Your edit is preserved in the composer — send it again to continue.",
        status: "draft-recovery",
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(props.onDismiss).toHaveBeenCalledTimes(1);
    expect(props.onCommit).not.toHaveBeenCalled();
  });

  it("shows a busy state while checking and hides cancel while submitting", () => {
    renderBanner({}, { status: "checking" });
    expect(screen.getByText("Checking this message…")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Rewind & continue" }),
    ).toBeNull();

    cleanup();
    renderBanner({}, { status: "submitting" });
    expect(screen.getByText("Rewinding…")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("cancels on Escape while confirming", () => {
    const { props } = renderBanner();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it("does not cancel on Escape while a commit is in flight", () => {
    const { props } = renderBanner({}, { status: "submitting" });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(props.onCancel).not.toHaveBeenCalled();
  });
});
