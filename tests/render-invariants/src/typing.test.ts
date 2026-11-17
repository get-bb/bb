import { describe, expect, it } from "vitest";
import { rerendered, summarize, type RenderSession } from "./render-session.js";
import { useRenderFixture } from "./test-fixture.js";

const KEYSTROKE_DELAY_MS = 80;
const COMPOSER = "#thread-detail-follow-up-composer";
const COMPOSER_BOX = `[data-composer-box]:has(${COMPOSER})`;
const QUESTION_FORM = "[data-question-form]";
const QUESTION_ANSWER = `${QUESTION_FORM} textarea`;
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

describe("render invariants", () => {
  const context = useRenderFixture();
  const { inThread } = context;

  it("typing an Ask User Question answer renders nothing outside the question form", async () => {
    await inThread(context.fixture.questionThreadId, async (session) => {
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

  it("typing in the composer renders nothing outside the composer box", async () => {
    await inThread(context.fixture.timelineThreadId, async (session) => {
      await typeAfterFirstCharacter(session, COMPOSER);
      await expect
        .poll(() => session.page.locator(COMPOSER).innerText())
        .toBe("abcdefgh");
      const report = await session.report({ container: COMPOSER_BOX });
      const outside = rerendered(report).filter(
        (render) => !render.insideContainer,
      );
      await session.page.keyboard.press("ControlOrMeta+a");
      await session.page.keyboard.press("Backspace");
      expect(summarize(outside)).toEqual([]);
    });
  });
});
