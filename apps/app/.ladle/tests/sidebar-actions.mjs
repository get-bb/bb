const page = await browser.getPage("main");
if (!page.url().includes("sidebar--thread-list--action-alignment")) {
  throw new Error("Open the Action alignment story in preview mode first");
}
await page.waitForSelector('[data-sidebar-thread-id="thr_actions_leaf_short"]');
await page.evaluate(() => document.fonts.ready);
if (!(await page.evaluate(() => matchMedia("(hover: hover)").matches))) {
  throw new Error("Use a desktop browser with hover support");
}
const rowIds = [
  "thr_actions_leaf_short",
  "thr_actions_leaf_long",
  "thr_actions_short_collapsed",
  "thr_actions_short_expanded",
  "thr_actions_long_collapsed",
  "thr_actions_long_expanded",
];
const failures = [];
for (const width of [220, 288, 360]) {
  await page.$eval(
    "[data-thread-row-fixture]",
    (element, value) => {
      element.style.width = `${value}px`;
    },
    width,
  );
  let reference;
  for (const id of rowIds) {
    await page.hover(`[data-sidebar-thread-id="${id}"]`);
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    const geometry = await page.evaluate((threadId) => {
      const row = document
        .querySelector(`[data-sidebar-thread-id="${threadId}"]`)
        ?.closest("[data-sidebar-rename-row]");
      if (!row) throw new Error(`Missing row: ${threadId}`);
      const control = (selector) => {
        const element = row.querySelector(selector);
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return {
          x: rect.x,
          right: rect.right,
          width: rect.width,
          pointer: getComputedStyle(element).pointerEvents,
        };
      };
      return {
        archive: control('[aria-label="Archive"]'),
        menu: control('[aria-label="Thread actions"]'),
        arrow: control(
          'button[aria-label^="Expand "],button[aria-label^="Collapse "]',
        ),
      };
    }, id);
    console.log(JSON.stringify({ width, id, ...geometry }));
    const { archive, menu, arrow } = geometry;
    if (
      !archive ||
      !menu ||
      archive.width <= 0 ||
      menu.width <= 0 ||
      archive.pointer !== "auto"
    ) {
      throw new Error(`${width}px ${id}: hover actions are unavailable`);
    }
    reference ??= geometry;
    if (
      Math.abs(archive.x - reference.archive.x) > 0.1 ||
      Math.abs(menu.x - reference.menu.x) > 0.1
    ) {
      failures.push(
        `${width}px ${id}: Archive/menu columns differ from the leaf`,
      );
    }
    const parent = !id.includes("_leaf_");
    if (
      parent !== (arrow !== null) ||
      (arrow && (arrow.width <= 0 || arrow.right > archive.x)) ||
      archive.right > menu.x
    ) {
      failures.push(
        `${width}px ${id}: expected arrow, quick actions, then overflow`,
      );
    }
  }
}
if (failures.length) throw new Error(failures.join("\n"));
console.log(
  "PASS: parent and leaf actions align at 220, 288 and 360px; disclosure precedes quick actions and overflow",
);
