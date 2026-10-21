import { afterEach, describe, expect, it, vi } from "vitest";
import { LAPSED_RESUME_SUGGESTION } from "@bb/server-contract";
import {
  recordLapsedResumeDismissed,
  recordLapsedResumeShown,
} from "./lapsed-resume-telemetry";

const mocks = vi.hoisted(() => ({
  surface: vi.fn(() => "web"),
  record: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("@/lib/app-surface", () => ({ getAppSurface: mocks.surface }));
vi.mock("@/lib/sdk", () => ({
  sdk: { system: { experimental_recordTelemetryEvent: mocks.record } },
}));

afterEach(() => {
  mocks.surface.mockReturnValue("web");
  mocks.record.mockClear();
});

describe("lapsed resume telemetry", () => {
  it.each(["web", "desktop"])(
    "sends only approved anonymous fields on %s",
    (surface) => {
      mocks.surface.mockReturnValue(surface);
      const id = "872fd7b3-03e9-4d72-86ee-7907fcf07429";
      recordLapsedResumeShown(id);
      recordLapsedResumeDismissed(id);
      expect(mocks.record.mock.calls).toEqual([
        [
          {
            name: "suggestion_shown",
            properties: {
              ...LAPSED_RESUME_SUGGESTION,
              suggestion_analytics_id: id,
            },
          },
        ],
        [
          {
            name: "suggestion_dismissed",
            properties: {
              surface: LAPSED_RESUME_SUGGESTION.surface,
              kind: LAPSED_RESUME_SUGGESTION.kind,
              suggestion_analytics_id: id,
              dismiss: "not_now",
            },
          },
        ],
      ]);
    },
  );

  it("sends no analytics from native mobile", () => {
    mocks.surface.mockReturnValue("mobile");
    recordLapsedResumeShown("872fd7b3-03e9-4d72-86ee-7907fcf07429");
    recordLapsedResumeDismissed("872fd7b3-03e9-4d72-86ee-7907fcf07429");
    expect(mocks.record).not.toHaveBeenCalled();
  });
});
