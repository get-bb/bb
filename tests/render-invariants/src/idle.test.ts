import { describe, expect, it } from "vitest";
import { summarize } from "./render-session.js";
import { useRenderFixture } from "./test-fixture.js";

const IDLE_MS = 10_000;

describe("render invariants", () => {
  const context = useRenderFixture();
  const { inThread } = context;

  it("renders nothing while the app sits idle for 10 s", async () => {
    await inThread(context.fixture.timelineThreadId, async (session) => {
      await session.reset();
      await session.page.waitForTimeout(IDLE_MS);
      const report = await session.report();
      expect(summarize(report.renders)).toEqual([]);
    });
  });
});
