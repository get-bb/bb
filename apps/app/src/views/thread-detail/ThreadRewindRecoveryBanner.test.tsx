// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThreadRewindBranchHistoryResponse } from "@bb/server-contract";

const restore = vi.hoisted(() => vi.fn());
const queryState = vi.hoisted(() => ({
  data: undefined as ThreadRewindBranchHistoryResponse | undefined,
  isError: false,
  isLoading: true,
}));

vi.mock("@/hooks/mutations/thread-runtime-mutations", () => ({
  useRestoreThreadRewindBranch: () => ({
    isPending: false,
    mutate: restore,
  }),
}));

vi.mock("@/hooks/queries/thread-queries", () => ({
  useThreadRewindBranchHistory: () => ({
    data: queryState.data,
    isError: queryState.isError,
    isLoading: queryState.isLoading,
  }),
}));

const { ThreadRewindRecoveryBanner } =
  await import("./ThreadRewindRecoveryBanner");

function historyWithBranches(
  activeBranchId: string,
): ThreadRewindBranchHistoryResponse {
  return {
    activeBranchId,
    branches: [
      {
        id: "br_root",
        threadId: "thr_1",
        parentBranchId: null,
        cutoffSequence: 0,
        creationReason: "thread-start",
        lifecycle: "available",
        cleanupStatus: "not-needed",
        createdAt: 1,
        activatedAt: 1,
        deactivatedAt: 10,
        updatedAt: 10,
        active: false,
      },
      {
        id: "br_rewind",
        threadId: "thr_1",
        parentBranchId: "br_root",
        cutoffSequence: 8,
        creationReason: "rewind",
        lifecycle: "active",
        cleanupStatus: "not-needed",
        createdAt: 10,
        activatedAt: 10,
        deactivatedAt: null,
        updatedAt: 10,
        active: true,
      },
    ],
  };
}

afterEach(() => {
  cleanup();
  restore.mockReset();
  queryState.data = undefined;
  queryState.isError = false;
  queryState.isLoading = true;
});

describe("ThreadRewindRecoveryBanner", () => {
  it("renders nothing while branches are loading or on error", () => {
    const { container, rerender } = render(
      <ThreadRewindRecoveryBanner threadId="thr_1" />,
    );
    expect(container.firstChild).toBeNull();

    queryState.isLoading = false;
    queryState.isError = true;
    rerender(<ThreadRewindRecoveryBanner threadId="thr_1" />);
    expect(container.firstChild).toBeNull();
  });

  it("offers a restore control when an earlier branch exists", async () => {
    queryState.isLoading = false;
    queryState.data = historyWithBranches("br_rewind");
    render(<ThreadRewindRecoveryBanner threadId="thr_1" />);

    expect(screen.getByTestId("thread-rewind-banner").textContent).toContain(
      "This conversation was rewound",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Restore previous branch" }),
    );
    expect(restore).toHaveBeenCalledWith({
      branchId: "br_root",
      expectedActiveBranchId: "br_rewind",
      threadId: "thr_1",
    });
  });

  it("renders nothing when only a single branch exists", () => {
    queryState.isLoading = false;
    queryState.data = {
      activeBranchId: "br_root",
      branches: [
        {
          id: "br_root",
          threadId: "thr_1",
          parentBranchId: null,
          cutoffSequence: 0,
          creationReason: "thread-start",
          lifecycle: "active",
          cleanupStatus: "not-needed",
          createdAt: 1,
          activatedAt: 1,
          deactivatedAt: null,
          updatedAt: 1,
          active: true,
        },
      ],
    };
    const { container } = render(
      <ThreadRewindRecoveryBanner threadId="thr_1" />,
    );
    expect(container.firstChild).toBeNull();
  });
});
