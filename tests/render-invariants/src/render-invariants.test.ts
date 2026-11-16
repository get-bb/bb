import { chromium, type Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  sendTextMessage,
  updateThread,
} from "../../integration/helpers/api.js";
import { waitForThreadStatus } from "../../integration/helpers/assertions.js";
import { startRenderFixture, type RenderFixture } from "./fixture.js";
import {
  openThread,
  rerendered,
  summarize,
  type RenderSession,
} from "./render-session.js";

const IDLE_MS = 10_000;
const TURN_TIMEOUT_MS = 30_000;
const KEYSTROKE_DELAY_MS = 80;
const COMPOSER = "#thread-detail-follow-up-composer";
const COMPOSER_FORM = `form:has(${COMPOSER})`;
const QUESTION_FORM = "[data-question-form]";
const QUESTION_ANSWER = `${QUESTION_FORM} textarea`;

const pendingInvariant = it.skipIf(
  process.env.BB_RENDER_INVARIANTS_PENDING !== "1",
);

describe("render invariants", () => {
  let fixture: RenderFixture;
  let browser: Browser;

  beforeAll(async () => {
    fixture = await startRenderFixture();
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    await browser?.close();
    await fixture?.cleanup();
  });

  async function inThread(
    threadId: string,
    run: (session: RenderSession) => Promise<void>,
  ): Promise<void> {
    const session = await openThread(browser, fixture.serverUrl, threadId);
    try {
      await run(session);
    } finally {
      await session.close();
    }
  }

  async function typeAfterFirstCharacter(
    session: RenderSession,
    selector: string,
  ): Promise<void> {
    await session.page.click(selector);
    await session.page.keyboard.type("a");
    await session.settle();
    await session.reset();
    await session.page.keyboard.type("bcdefgh", { delay: KEYSTROKE_DELAY_MS });
    await session.settle();
  }

  it("renders nothing while the app sits idle for 10 s", async () => {
    await inThread(fixture.timelineThreadId, async (session) => {
      await session.reset();
      await session.page.waitForTimeout(IDLE_MS);
      const report = await session.report();
      expect(summarize(report.renders)).toEqual([]);
    });
  });

  it("typing an Ask User Question answer renders nothing outside the question form", async () => {
    await inThread(fixture.questionThreadId, async (session) => {
      await session.page
        .locator(`${QUESTION_FORM} button`, { hasText: "Other" })
        .click();
      await typeAfterFirstCharacter(session, QUESTION_ANSWER);
      await expect
        .poll(() => session.page.inputValue(QUESTION_ANSWER))
        .toBe("abcdefgh");
      const report = await session.report({ container: QUESTION_FORM });
      const outside = rerendered(report).filter(
        (render) => !render.insideContainer,
      );
      expect(summarize(outside)).toEqual([]);
    });
  });

  pendingInvariant(
    "typing in the composer renders nothing outside the composer form",
    async () => {
      await inThread(fixture.timelineThreadId, async (session) => {
        await typeAfterFirstCharacter(session, COMPOSER);
        await expect
          .poll(() => session.page.locator(COMPOSER).innerText())
          .toBe("abcdefgh");
        const report = await session.report({ container: COMPOSER_FORM });
        const outside = rerendered(report).filter(
          (render) => !render.insideContainer,
        );
        await session.page.keyboard.press("ControlOrMeta+a");
        await session.page.keyboard.press("Backspace");
        expect(summarize(outside)).toEqual([]);
      });
    },
  );

  it("renaming thread X re-renders no sidebar row but X's", async () => {
    const target = fixture.pushTargetThreadId;
    await inThread(fixture.timelineThreadId, async (session) => {
      const title = `Push target renamed ${Date.now()}`;
      await session.reset();
      await updateThread(fixture.harness.api, target, { title });
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
    const target = fixture.pushTargetThreadId;
    await inThread(fixture.timelineThreadId, async (session) => {
      await session.reset();
      await sendTextMessage(fixture.harness.api, target, {
        text: "delay:300 ping",
      });
      await waitForThreadStatus(
        fixture.harness.api,
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

  pendingInvariant(
    "a streaming push re-renders no finished timeline row",
    async () => {
      const threadId = fixture.timelineThreadId;
      await inThread(threadId, async (session) => {
        const { page } = session;
        const before = await page.evaluate(() =>
          [...document.querySelectorAll("[data-timeline-row-id]")].map((row) =>
            row.getAttribute("data-timeline-row-id"),
          ),
        );
        await sendTextMessage(fixture.harness.api, threadId, {
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
          fixture.harness.api,
          threadId,
          "idle",
          TURN_TIMEOUT_MS,
        );
        expect(
          report.renders.some(
            (render) => render.timelineRowId === streamingRow,
          ),
        ).toBe(true);
        const finishedRows = rerendered(report).filter(
          (render) =>
            render.timelineRowId !== null &&
            render.timelineRowId !== streamingRow,
        );
        expect(summarize(finishedRows)).toEqual([]);
      });
    },
  );
});
