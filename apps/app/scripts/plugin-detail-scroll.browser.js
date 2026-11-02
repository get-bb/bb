const page = await browser.getPage("main");
const origin = await page.evaluate(() => location.origin);
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) {
  throw new Error("Open an isolated local source app before running this test");
}

const results = [];
for (const scenario of [
  {
    path: "/plugins/bb--git?view=installed",
    title: "Git",
    readyText: "Capabilities",
  },
  {
    path: "/plugins/provider-claude-code?view=installed&configure=provider-claude-code",
    title: "Claude Code provider",
    readyText: "Approvals in Full Access",
  },
]) {
  await page.goto(`${origin}${scenario.path}`);
  await page.evaluate(async ({ title, readyText }) => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const panel = document.querySelector("aside:has(h1)");
      if (
        panel?.querySelector("h1")?.textContent === title &&
        panel.textContent.includes(readyText)
      ) {
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Plugin content did not become ready: ${title}`);
  }, scenario);
  const result = await page.evaluate(() => {
    const panel = document.querySelector("aside:has(h1)");
    const scroller = Array.from(panel.querySelectorAll("div")).find(
      (element) => getComputedStyle(element).overflowY === "auto",
    );
    if (!scroller) throw new Error("Plugin scroll container is missing");
    scroller.scrollTop = scroller.scrollHeight;
    const bounds = scroller.getBoundingClientRect();
    const panelBounds = panel.getBoundingClientRect();
    return {
      clientHeight: scroller.clientHeight,
      scrollHeight: scroller.scrollHeight,
      scrollTop: scroller.scrollTop,
      contained:
        bounds.top >= panelBounds.top &&
        bounds.bottom <= panelBounds.bottom + 1,
      reachedEnd:
        Math.abs(
          scroller.scrollTop + scroller.clientHeight - scroller.scrollHeight,
        ) <= 1,
    };
  });
  results.push({ path: scenario.path, ...result });
}
console.log(JSON.stringify(results, null, 2));
if (
  results.some(
    (result) =>
      !result.contained ||
      result.scrollTop <= 0 ||
      result.scrollHeight <= result.clientHeight ||
      !result.reachedEnd,
  )
) {
  throw new Error(
    "Plugin details and configuration must scroll inside the right panel",
  );
}
