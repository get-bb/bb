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
      const measure = (element) => {
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return {
          x: rect.x,
          right: rect.right,
          width: rect.width,
          center: rect.x + rect.width / 2,
          pointer: getComputedStyle(element).pointerEvents,
        };
      };
      const control = (selector) => measure(row.querySelector(selector));
      const arrow = row.querySelector(
        'button[aria-label^="Expand "],button[aria-label^="Collapse "]',
      );
      const rowRect = row.getBoundingClientRect();
      return {
        rowLeft: rowRect.x,
        rowRight: rowRect.right,
        title: control(".bb-thread-title"),
        archive: control('[aria-label="Archive"]'),
        menu: control('[aria-label="Thread actions"]'),
        arrow: measure(arrow),
        guide:
          arrow?.getAttribute("aria-expanded") === "true"
            ? measure(
                row.parentElement?.querySelector(
                  ":scope > div.relative > span.bg-border-hairline",
                ),
              )
            : null,
      };
    }, id);
    console.log(JSON.stringify({ width, id, ...geometry }));
    const { rowLeft, rowRight, title, archive, menu, arrow, guide } = geometry;
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
    if (arrow && (arrow.x < rowLeft || arrow.right > rowRight)) {
      failures.push(`${width}px ${id}: the arrow sticks out of its row`);
    }
    if (arrow && arrow.right > title.x) {
      failures.push(`${width}px ${id}: the arrow does not lead the title`);
    }
    if (Math.abs(title.x - reference.title.x) > 0.5) {
      failures.push(
        `${width}px ${id}: the title does not line up with the leaf's`,
      );
    }
    if (
      id.endsWith("_expanded") &&
      (!guide || Math.abs(guide.center - arrow.center) > 0.5)
    ) {
      failures.push(`${width}px ${id}: the sub-thread guide misses the arrow`);
    }
  }
}
if (failures.length) throw new Error(failures.join("\n"));
console.log(
  "PASS: parent and leaf actions align at 220, 288 and 360px; the disclosure leads the title inside its row, titles line up, and sub-thread guides run through the disclosure",
);
