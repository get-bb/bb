// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThreadHandoffStatus } from "@bb/server-contract";
import { ThreadTakeoverBanner } from "./ThreadTakeoverBanner";

function status(
  overrides: Partial<ThreadHandoffStatus> = {},
): ThreadHandoffStatus {
  return {
    sourceThreadId: "thr_source",
    replacementThreadId: "thr_replacement",
    state: "started",
    sourceArchived: true,
    failure: null,
    ...overrides,
  };
}

describe("ThreadTakeoverBanner", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows a provisioning banner while the replacement is starting", () => {
    render(
      <MemoryRouter>
        <ThreadTakeoverBanner
          projectId="proj_1"
          sourceTitle="Old thread"
          status={status({ state: "provisioning", sourceArchived: false })}
          onRestoreSource={vi.fn()}
          onReturnToSource={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Taking over from Old thread")).toBeTruthy();
  });

  it("lets the user return or retry after a failed takeover", () => {
    const onRetry = vi.fn();
    const onReturnToSource = vi.fn();
    render(
      <MemoryRouter>
        <ThreadTakeoverBanner
          projectId="proj_1"
          sourceTitle="Old thread"
          status={status({
            state: "failed",
            sourceArchived: false,
            failure: {
              code: "provider_start_failed",
              message: "Provider did not accept the replacement turn",
            },
          })}
          onRestoreSource={vi.fn()}
          onRetry={onRetry}
          onReturnToSource={onReturnToSource}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Return to source" }));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onReturnToSource).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("links to the archived source and can restore it", () => {
    const onRestoreSource = vi.fn();
    render(
      <MemoryRouter>
        <ThreadTakeoverBanner
          projectId="proj_1"
          sourceTitle="Old thread"
          status={status()}
          onRestoreSource={onRestoreSource}
          onReturnToSource={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("link", { name: "Old thread" }),
    ).toHaveProperty("href", expect.stringContaining("/projects/proj_1/threads/thr_source"));
    fireEvent.click(screen.getByRole("button", { name: "Restore source thread" }));
    expect(onRestoreSource).toHaveBeenCalledTimes(1);
  });
});
