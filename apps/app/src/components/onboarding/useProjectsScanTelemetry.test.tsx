// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { BbHttpError } from "@bb/sdk/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordTelemetryEvent } from "./onboarding-telemetry";
import { useProjectsScanTelemetry } from "./useProjectsScanTelemetry";

vi.mock("./onboarding-telemetry", () => ({ recordTelemetryEvent: vi.fn() }));

const idle = {
  data: undefined,
  dataUpdatedAt: 0,
  error: null,
  errorUpdatedAt: 0,
};
const base = {
  entry: "first_run",
  step: "projects",
  operation: "scan",
} as const;

function recorded() {
  return vi
    .mocked(recordTelemetryEvent)
    .mock.calls.map(([event]) => event.properties);
}

beforeEach(() => {
  vi.mocked(recordTelemetryEvent).mockClear();
});

afterEach(() => {
  cleanup();
});

describe("projects scan telemetry", () => {
  it("records a timed-out scan with its unreadable folder count", () => {
    renderHook(() =>
      useProjectsScanTelemetry({
        entry: "first_run",
        noHost: false,
        scan: {
          ...idle,
          dataUpdatedAt: 1,
          data: { repos: [], truncated: true, unreadableCount: 2 },
        },
      }),
    );
    expect(recorded()).toEqual([
      {
        ...base,
        outcome: "succeeded",
        item_count: 0,
        timed_out: true,
        unreadable_count: 2,
      },
    ]);
  });

  it.each([
    ["host_unavailable", "host_unavailable"],
    ["command_timeout", "timed_out"],
    ["internal_error", "other"],
  ] as const)("records a %s scan failure as %s", (code, reason) => {
    renderHook(() =>
      useProjectsScanTelemetry({
        entry: "first_run",
        noHost: false,
        scan: {
          ...idle,
          errorUpdatedAt: 1,
          error: new BbHttpError({
            body: null,
            code,
            message: "failed",
            status: 502,
          }),
        },
      }),
    );
    expect(recorded()).toEqual([
      { ...base, outcome: "failed", failure_reason: reason },
    ]);
  });

  it("records a missing machine once while the step stays open", () => {
    const view = renderHook(
      ({ noHost }) =>
        useProjectsScanTelemetry({ entry: "first_run", noHost, scan: idle }),
      { initialProps: { noHost: false } },
    );
    expect(recorded()).toEqual([]);
    view.rerender({ noHost: true });
    view.rerender({ noHost: false });
    view.rerender({ noHost: true });
    expect(recorded()).toEqual([
      { ...base, outcome: "failed", failure_reason: "no_host" },
    ]);
  });
});
