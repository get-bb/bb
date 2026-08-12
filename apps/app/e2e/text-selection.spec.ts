import { expect, test } from "@playwright/test";

const storyUrl =
  "/?story=foundation--selection-policy--policy&mode=preview&theme=dark";

test.beforeEach(async ({ page }) => {
  await page.goto(storyUrl);
  await expect(page.getByTestId("main-message")).toBeVisible();
});

test("dragging from the main timeline gutter selects message text", async ({
  page,
}) => {
  const timeline = page.getByTestId("main-message-row").locator("..");
  const message = page.getByTestId("main-message");
  const timelineBox = await timeline.boundingBox();
  const messageBox = await message.boundingBox();

  expect(timelineBox).not.toBeNull();
  expect(messageBox).not.toBeNull();
  if (timelineBox === null || messageBox === null) return;

  await page.mouse.move(
    timelineBox.x + 16,
    messageBox.y + messageBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    messageBox.x + messageBox.width - 4,
    messageBox.y + messageBox.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();

  const selectedText = await page.evaluate(
    () => window.getSelection()?.toString() ?? "",
  );
  expect(selectedText).toContain("Main timeline message");
});

test("dragging across message rows selects multiple messages", async ({
  page,
}) => {
  const first = page.getByTestId("main-message");
  const second = page.getByTestId("second-main-message");
  const firstBox = await first.boundingBox();
  const secondBox = await second.boundingBox();

  expect(firstBox).not.toBeNull();
  expect(secondBox).not.toBeNull();
  if (firstBox === null || secondBox === null) return;

  await page.mouse.move(firstBox.x + 2, firstBox.y + firstBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    secondBox.x + secondBox.width - 2,
    secondBox.y + secondBox.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();

  const selectedText = await page.evaluate(
    () => window.getSelection()?.toString() ?? "",
  );
  expect(selectedText).toContain("Main timeline message");
  expect(selectedText).toContain("Second main timeline message");
});

test("Select All in the main timeline selects only the conversation", async ({
  page,
}) => {
  await page.getByTestId("main-message").click();
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+A" : "Control+A",
  );

  const selectedText = await page.evaluate(
    () => window.getSelection()?.toString() ?? "",
  );
  expect(selectedText).toContain("Main timeline message");
  expect(selectedText).toContain("Second main timeline message");
  expect(selectedText).toContain("Markdown details summary");
  expect(selectedText).toContain("Markdown task label");
  expect(selectedText).not.toContain("Side chat message");
  expect(selectedText).not.toContain("Composer draft");
  expect(selectedText).not.toContain("Sidebar chrome");
  expect(selectedText).not.toContain("Message action");

  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+C" : "Control+C",
  );
  const copiedText = await page.evaluate(() => navigator.clipboard.readText());
  expect(copiedText).toBe(selectedText);
});

test("Select All from the sidebar does not select app chrome or content", async ({
  page,
}) => {
  await page.getByTestId("sidebar").click({ position: { x: 16, y: 240 } });
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+A" : "Control+A",
  );

  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ""))
    .toBe("");
});

test("Select All in the composer preserves native editor selection", async ({
  page,
}) => {
  await page.getByTestId("composer").click();
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+A" : "Control+A",
  );
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+C" : "Control+C",
  );

  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe("Composer draft");
});

test("keyboard focus remains on controls inside selectable content", async ({
  page,
}) => {
  const action = page.getByTestId("message-action");
  await action.focus();
  await expect(action).toBeFocused();

  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+A" : "Control+A",
  );
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ""))
    .toBe("");
});

test("Select All on an opted-in diagnostic selects only its value", async ({
  page,
}) => {
  await page.getByTestId("diagnostic-value").click();
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+A" : "Control+A",
  );

  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ""))
    .toBe("Workspace: /tmp/selection-qa");
});
