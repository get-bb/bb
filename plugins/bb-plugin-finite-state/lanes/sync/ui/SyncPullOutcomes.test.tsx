// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SyncPullOutcomes } from "./SyncPullOutcomes.js";

describe("SyncPullOutcomes", () => {
  it("renders published, failed, and quarantined results without a silent partial", () => {
    const onPull = vi.fn();
    render(
      <SyncPullOutcomes
        disabled={false}
        error={null}
        onPull={onPull}
        pulling={false}
        report={{
          kinds: {
            finding: {
              status: "failed",
              generationId: "finding-generation",
              acceptedAt: null,
              fetched: 3,
              baseRows: 0,
              quarantined: 3,
              reasons: [{ code: "FINDING_ALL_ROWS_QUARANTINED", count: 3 }],
            },
            requirement: {
              status: "published",
              generationId: "requirement-generation",
              acceptedAt: "2026-08-14T17:00:00.000Z",
              fetched: 12,
              baseRows: 12,
              quarantined: 0,
              reasons: [],
            },
            threat: {
              status: "failed",
              generationId: null,
              acceptedAt: null,
              fetched: 0,
              baseRows: 0,
              quarantined: 0,
              reasons: [{ code: "AS_PROJECT_SELECTION_REQUIRED", count: 1 }],
            },
          },
          workingFastForwarded: false,
          divergence: [],
        }}
      />,
    );

    expect(screen.getByText("1 published · 2 failed")).toBeTruthy();
    expect(
      screen.getByText("3 fetched · 0 published · 3 quarantined"),
    ).toBeTruthy();
    expect(screen.getByText("FINDING_ALL_ROWS_QUARANTINED=3")).toBeTruthy();
    expect(screen.getByText("AS_PROJECT_SELECTION_REQUIRED=1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pull remote kinds" }));
    expect(onPull).toHaveBeenCalledOnce();
  });

  it("keeps a request failure visible outside empty-state rendering", () => {
    render(
      <SyncPullOutcomes
        disabled={false}
        error="invalid_output: installed contract is stale"
        onPull={vi.fn()}
        pulling={false}
        report={null}
      />,
    );

    expect(screen.getByRole("alert").textContent).toContain(
      "invalid_output: installed contract is stale",
    );
  });
});
