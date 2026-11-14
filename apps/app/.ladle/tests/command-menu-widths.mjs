const page = await browser.getPage("main");
if (!page.url().includes("plugins--composer--mentions--command-widths")) {
  throw new Error("Open the Command widths story in preview mode first");
}
await page.waitForSelector("button[title]");
await page.evaluate(() => document.fonts.ready);
const rows = [
  { name: "moss-skills:moss-formulas-variables", hint: "<note-path> [--fix]" },
  {
    name: "project-super-long-command-name-for-regression-coverage",
    hint: "<very-long-argument-placeholder>",
  },
  {
    name: "code-review",
    hint: "[low|medium|high|xhigh|max] [--fix] [--comment] [<pr#>|<branch>|<path>] [--max-findings <n>|all]",
  },
];
const samples = await page.evaluate((rows) => {
  const leaf = (root, text) =>
    [...root.querySelectorAll("span")].find(
      (element) =>
        element.childElementCount === 0 && element.textContent === text,
    );
  const measure = (element) => {
    const rect = element.getBoundingClientRect();
    const text = document.createRange();
    text.selectNodeContents(element);
    const textWidth = text.getBoundingClientRect().width;
    return {
      width: rect.width,
      textWidth,
      right: rect.right,
      truncated: textWidth > rect.width + 0.01,
    };
  };
  return [...document.querySelectorAll(".overflow-y-auto")].map((scroller) => {
    const buttons = [...scroller.querySelectorAll("button[title]")];
    return {
      menuWidth: scroller.getBoundingClientRect().width,
      menuScrollsSideways: scroller.scrollWidth > scroller.clientWidth,
      rows: rows.map((row) => {
        const button = buttons.find((candidate) => leaf(candidate, row.name));
        if (!button) throw new Error(`Missing command row: ${row.name}`);
        const style = getComputedStyle(button);
        return {
          name: row.name,
          overflows: button.scrollWidth > button.clientWidth,
          contentRight:
            button.getBoundingClientRect().right -
            Number.parseFloat(style.paddingRight),
          command: measure(leaf(button, row.name)),
          description: measure(leaf(button, button.title)),
          hint: measure(leaf(button, row.hint)),
        };
      }),
    };
  });
}, rows);
if (samples.length === 0) throw new Error("No command menus rendered");
for (const sample of samples) {
  console.log(JSON.stringify(sample));
  const width = Math.round(sample.menuWidth);
  if (sample.menuScrollsSideways) {
    throw new Error(`${width}px: menu scrolls horizontally`);
  }
  for (const row of sample.rows) {
    const label = `${width}px ${row.name}`;
    if (row.overflows) throw new Error(`${label}: row overflows`);
    for (const part of ["command", "description", "hint"]) {
      if (row[part].width >= 1 && row[part].right > row.contentRight + 0.5) {
        throw new Error(`${label}: ${part} extends past the row`);
      }
    }
    if (row.command.width < 1) throw new Error(`${label}: name is hidden`);
    if (
      row.command.truncated &&
      (row.description.width >= 1 || row.hint.width >= 1)
    ) {
      throw new Error(
        `${label}: name truncates before the description and hint`,
      );
    }
    if (row.hint.truncated && row.description.width >= 1) {
      throw new Error(
        `${label}: argument hint truncates before the description`,
      );
    }
  }
}
console.log(
  "PASS: command names stay visible; descriptions, then argument hints, truncate inside the menu",
);
