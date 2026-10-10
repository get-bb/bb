import { describe, expect, it } from "vitest";
import {
  resolveThreadTimelineSurface,
  type ThreadTimelineSurfaceOptions,
} from "../../../src/services/threads/timeline.js";
import { withTestThread } from "../../helpers/timeline-cache-fixture.js";

const surfaceOptions: ThreadTimelineSurfaceOptions = {
  completedTurnDisplay: "collapse",
  includeClearedContextHistory: false,
  includeDiagnosticOperations: false,
  maxInlineOutputChars: 4_000,
  planCommand: null,
};

describe("resolveThreadTimelineSurface", () => {
  it("keys the response cache on the plan command without changing the cursor surface", () => {
    withTestThread(({ db, thread }) => {
      const withoutPlan = resolveThreadTimelineSurface(
        db,
        thread,
        surfaceOptions,
      );
      const withPlan = resolveThreadTimelineSurface(db, thread, {
        ...surfaceOptions,
        planCommand: { trigger: "/", name: "plan", trailingText: " " },
      });
      expect(withPlan.cursorKey).toBe(withoutPlan.cursorKey);
      expect(withPlan.cacheKey).not.toBe(withoutPlan.cacheKey);
    });
  });
});
