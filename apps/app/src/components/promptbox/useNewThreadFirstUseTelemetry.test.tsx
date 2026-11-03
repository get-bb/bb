// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordTelemetryEvent } from "@/components/onboarding/onboarding-telemetry";
import {
  NEW_THREAD_COMPOSER_SETTLE_TIMEOUT_MS,
  resetNewThreadFirstUseTelemetryForTest,
  useNewThreadFirstUseTelemetry,
  type NewThreadComposerBlocker,
} from "./useNewThreadFirstUseTelemetry";

vi.mock("@/components/onboarding/onboarding-telemetry", () => ({
  recordTelemetryEvent: vi.fn(),
}));

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  resetNewThreadFirstUseTelemetryForTest();
});

interface Props {
  enabled?: boolean;
  blocker: NewThreadComposerBlocker;
  providerId?: string;
  hasDraft?: boolean;
}

function renderComposer(initialProps: Props) {
  return renderHook(
    ({ enabled = true, blocker, providerId = "codex", hasDraft = false }) =>
      useNewThreadFirstUseTelemetry({
        enabled,
        blocker,
        providerId,
        hasDraft,
      }),
    { initialProps },
  );
}

function recorded() {
  return vi.mocked(recordTelemetryEvent).mock.calls.map(([event]) => event);
}

describe("new thread first-use telemetry", () => {
  it("reports the composer once per app session after its readiness settles", () => {
    const view = renderComposer({ blocker: "pending" });
    expect(recorded()).toEqual([]);

    view.rerender({ blocker: "sign_in" });
    view.rerender({ blocker: "none" });
    view.unmount();
    renderComposer({ blocker: "none" });

    expect(recorded()).toEqual([
      {
        name: "new_thread_composer_shown",
        properties: { blocker: "sign_in", resource_id: "codex" },
      },
    ]);
  });

  it("reports a composer that never settles as pending", () => {
    renderComposer({ blocker: "pending", providerId: "" });
    act(() => {
      vi.advanceTimersByTime(NEW_THREAD_COMPOSER_SETTLE_TIMEOUT_MS);
    });

    expect(recorded()).toEqual([
      { name: "new_thread_composer_shown", properties: { blocker: "pending" } },
    ]);
  });

  it("reports the first draft once, after the composer, with the readiness at that moment", () => {
    const view = renderComposer({ blocker: "pending" });
    view.rerender({ blocker: "pending", hasDraft: true });
    view.rerender({ blocker: "none", hasDraft: false });
    view.rerender({ blocker: "none", hasDraft: true });
    view.unmount();
    const next = renderComposer({ blocker: "none" });
    next.rerender({ blocker: "none", hasDraft: true });

    expect(recorded()).toEqual([
      {
        name: "new_thread_composer_shown",
        properties: { blocker: "pending", resource_id: "codex" },
      },
      {
        name: "new_thread_draft_started",
        properties: { blocker: "pending", resource_id: "codex" },
      },
    ]);
  });

  it("does not count a draft restored when the composer opens", () => {
    const view = renderComposer({ blocker: "none", hasDraft: true });
    view.rerender({ blocker: "none", hasDraft: true });

    expect(recorded()).toEqual([
      {
        name: "new_thread_composer_shown",
        properties: { blocker: "none", resource_id: "codex" },
      },
    ]);
  });

  it("ignores composers outside the new thread page", () => {
    const view = renderComposer({ enabled: false, blocker: "none" });
    view.rerender({ enabled: false, blocker: "none", hasDraft: true });
    act(() => {
      vi.advanceTimersByTime(NEW_THREAD_COMPOSER_SETTLE_TIMEOUT_MS);
    });

    expect(recorded()).toEqual([]);
  });
});
