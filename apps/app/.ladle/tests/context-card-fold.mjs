const page = await browser.getPage("main");
const url = new URL(page.url());
if (
  !url.searchParams
    .get("story")
    ?.startsWith("thread-context-card--fold-policy--")
) {
  throw new Error(
    "Open a Thread context card/Fold policy story in preview mode first",
  );
}
const failures = [];
const expect = (label, actual, expected) => {
  if (actual !== expected) {
    failures.push(`${label}: expected ${expected}, got ${actual}`);
  }
};

const openStory = async (name) => {
  url.searchParams.set("mode", "preview");
  url.searchParams.set("story", `thread-context-card--fold-policy--${name}`);
  await page.goto(url.toString());
  await page.waitForSelector("[data-fold-fixture-fill]");
  await page.evaluate(() => document.fonts.ready);
};
const frames = () =>
  page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );

const readSections = () =>
  page.evaluate(() => {
    const px = (value) => Math.round(Number.parseFloat(value) * 100) / 100;
    return [
      ...document.querySelectorAll("section[data-thread-context-card-section]"),
    ].map((element) => {
      const style = getComputedStyle(element);
      const toggle = element.querySelector("button[aria-expanded]");
      const body = document.getElementById(
        toggle.getAttribute("aria-controls"),
      );
      return {
        title: element.getAttribute("aria-label"),
        display: style.display,
        marginTop: px(style.marginTop),
        paddingTop: px(style.paddingTop),
        borderTopWidth: px(style.borderTopWidth),
        borderTopStyle: style.borderTopStyle,
        expanded: toggle.getAttribute("aria-expanded"),
        bodyDisplay: getComputedStyle(body).display,
      };
    });
  });

const readEmptyMessage = () =>
  page.evaluate(() => {
    const element = document.querySelector("[data-thread-context-card-empty]");
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    const card = element.closest("[data-thread-context-card]");
    return {
      display: getComputedStyle(element).display,
      visible: rect.width > 0 && rect.height > 0,
      text: element.textContent,
      cardHidden: card ? card.hasAttribute("hidden") : null,
    };
  });

const expectSection = (stage, sections, title, expectation) => {
  const section = sections.find((entry) => entry.title === title);
  if (!section) {
    failures.push(`${stage}: ${title}: section missing`);
    return;
  }
  const label = `${stage}: ${title}`;
  expect(`${label} expanded`, section.expanded, "false");
  expect(`${label} body display`, section.bodyDisplay, "none");
  if (expectation === "empty") {
    expect(`${label} display`, section.display, "none");
    return;
  }
  expect(`${label} display`, section.display, "block");
  const divider = expectation === "divider";
  expect(`${label} margin-top`, section.marginTop, divider ? 8 : 0);
  expect(`${label} padding-top`, section.paddingTop, divider ? 8 : 0);
  expect(`${label} border-top-width`, section.borderTopWidth, divider ? 1 : 0);
  if (divider) {
    expect(`${label} border-top-style`, section.borderTopStyle, "solid");
  }
};

await openStory("mixed-bodies");
await page.waitForSelector("section[data-thread-context-card-section]");
await frames();
const mixedTitles = [
  "Empty first",
  "Toggled",
  "Populated",
  "Empty middle",
  "Populated last",
];
const checkMixed = async (stage, expected) => {
  const sections = await readSections();
  console.log(JSON.stringify({ stage, sections }));
  expect(`${stage}: section count`, sections.length, mixedTitles.length);
  for (const [index, title] of mixedTitles.entries()) {
    expectSection(stage, sections, title, expected[index]);
  }
  const message = await readEmptyMessage();
  expect(`${stage}: empty message display`, message?.display, "none");
  expect(`${stage}: empty message visible`, message?.visible, false);
};

await checkMixed("initial", ["empty", "empty", "plain", "empty", "divider"]);

await page.click("[data-fold-fixture-fill]");
await frames();
await checkMixed("body filled while closed", [
  "empty",
  "plain",
  "divider",
  "empty",
  "divider",
]);

await page.click("[data-fold-fixture-fill]");
await frames();
await checkMixed("body emptied while closed", [
  "empty",
  "empty",
  "plain",
  "empty",
  "divider",
]);

await page.click('section[aria-label="Populated"] button[aria-expanded]');
await frames();
const opened = (await readSections()).find(
  (entry) => entry.title === "Populated",
);
expect("opened section: expanded", opened?.expanded, "true");
expect("opened section: body display", opened?.bodyDisplay, "block");
expect("opened section: display", opened?.display, "block");

await openStory("all-bodies-empty");
await frames();
let message = await readEmptyMessage();
if (message?.cardHidden) {
  await page.click('button[aria-label="Pin thread context"]');
  await frames();
  message = await readEmptyMessage();
}
console.log(JSON.stringify({ stage: "all bodies empty", message }));
expect("all empty: empty message display", message?.display, "flex");
expect("all empty: empty message visible", message?.visible, true);
expect(
  "all empty: empty message text",
  message?.text?.startsWith("Nothing to show yet"),
  true,
);
expect("all empty: card hidden", message?.cardHidden, false);
const emptySections = await readSections();
expect("all empty: section count", emptySections.length, 2);
for (const section of emptySections) {
  expect(`all empty: ${section.title} display`, section.display, "none");
}

if (failures.length) throw new Error(failures.join("\n"));
console.log(
  "PASS: empty sections stay hidden, dividers sit only between visible sections, and the empty message shows when every body is empty, closed or open",
);
