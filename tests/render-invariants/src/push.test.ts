import { describe, expect, it } from "vitest";
import {
  sendTextMessage,
  updateThread,
} from "../../integration/helpers/api.js";
import { waitForThreadStatus } from "../../integration/helpers/assertions.js";
import { rerendered, summarize } from "./render-session.js";
import { useRenderFixture } from "./test-fixture.js";

const TURN_TIMEOUT_MS = 30_000;

describe("render invariants", () => {
  const context = useRenderFixture();
  const { inThread } = context;

  it("renaming thread X re-renders no sidebar row but X's", async () => {
    const target = context.fixture.pushTargetThreadId;
    await inThread(context.fixture.timelineThreadId, async (session) => {
      const title = `Push target renamed ${Date.now()}`;
      await session.reset();
      await updateThread(context.fixture.harness.api, target, { title });
      await session.page.waitForSelector(
        `a[data-sidebar-thread-id="${target}"][aria-label*="${title}"]`,
      );
      await session.settle();
      const report = await session.report();
      expect(
        report.renders.some((render) => render.sidebarThreadId === target),
      ).toBe(true);
      const otherRows = rerendered(report).filter(
        (render) =>
          render.sidebarThreadId !== null && render.sidebarThreadId !== target,
      );
      expect(summarize(otherRows)).toEqual([]);
    });
  });

  it("a turn in thread X re-renders no sidebar row but X's", async () => {
    const target = context.fixture.pushTargetThreadId;
    await inThread(context.fixture.timelineThreadId, async (session) => {
      await session.reset();
      await sendTextMessage(context.fixture.harness.api, target, {
        text: "delay:300 ping",
      });
      await waitForThreadStatus(
        context.fixture.harness.api,
        target,
        "idle",
        TURN_TIMEOUT_MS,
      );
      await session.settle();
      const report = await session.report();
      expect(
        report.renders.some((render) => render.sidebarThreadId === target),
      ).toBe(true);
      const otherRows = rerendered(report).filter(
        (render) =>
          render.sidebarThreadId !== null && render.sidebarThreadId !== target,
      );
      expect(summarize(otherRows)).toEqual([]);
    });
  });

  it("a streaming push re-renders no finished timeline row", async () => {
    const threadId = context.fixture.timelineThreadId;
    await inThread(threadId, async (session) => {
      const { page } = session;
      const before = await page.evaluate(() =>
        [...document.querySelectorAll("[data-timeline-row-id]")].map((row) =>
          row.getAttribute("data-timeline-row-id"),
        ),
      );
      await sendTextMessage(context.fixture.harness.api, threadId, {
        text: "stream:40:150",
      });
      const streamingRowWith = (text: string) =>
        page.waitForFunction(
          ([known, needle]) =>
            [...document.querySelectorAll("[data-timeline-row-id]")]
              .find(
                (row) =>
                  !known.includes(row.getAttribute("data-timeline-row-id")) &&
                  row.textContent?.includes(needle),
              )
              ?.getAttribute("data-timeline-row-id") ?? null,
          [before, text] as const,
          { timeout: TURN_TIMEOUT_MS },
        );
      const streamingRow = await (
        await streamingRowWith("Streamed chunk 3.")
      ).jsonValue();
      await session.reset();
      await streamingRowWith("Streamed chunk 30.");
      const report = await session.report();
      await waitForThreadStatus(
        context.fixture.harness.api,
        threadId,
        "idle",
        TURN_TIMEOUT_MS,
      );
      expect(
        report.renders.some((render) => render.timelineRowId === streamingRow),
      ).toBe(true);
      const finishedRows = rerendered(report).filter(
        (render) =>
          render.timelineRowId !== null &&
          render.timelineRowId !== streamingRow,
      );
      expect(summarize(finishedRows)).toEqual([]);
    });
  });
});
