const page = await browser.getPage("main");
if (!page.url().includes("plugins--composer-actions--narrow-usage-actions")) {
  throw new Error("Open the Narrow usage actions story in preview mode first");
}
await page.waitForSelector("[data-plugin-composer-action]");
await page.evaluate(() => document.fonts.ready);
let sent = Number(
  await page.$eval(
    '[aria-label="Sent messages"]',
    (element) => element.textContent,
  ),
);
for (const variant of ["standard", "wide", "none"]) {
  await page.select('[aria-label="Plugin action fixture"]', variant);
  await page.waitForFunction(
    (expected) =>
      document.querySelectorAll("[data-plugin-composer-action]").length ===
      expected,
    {},
    variant === "standard" ? 3 : variant === "wide" ? 1 : 0,
  );
  for (const [width, height] of [
    [320, 740],
    [360, 740],
    [390, 740],
    [430, 740],
    [740, 360],
    [360, 320],
  ]) {
    await page.setViewport({
      width,
      height,
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 1,
    });
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    const geometry = await page.evaluate(() => {
      const row = document.querySelector("[data-promptbox-action-row]");
      const send = document.querySelector("[data-promptbox-submit-action]");
      const controls = [
        ...document.querySelectorAll(
          "[data-promptbox-action-row] button, [data-plugin-composer-action]",
        ),
      ];
      if (!row || !send) throw new Error("Missing composer controls");
      const rowRect = row.getBoundingClientRect();
      const sendRect = send.getBoundingClientRect();
      return {
        row: rowRect.toJSON(),
        send: sendRect.toJSON(),
        controls: controls.map((element) => ({
          label: element.getAttribute("aria-label") ?? element.textContent,
          rect: element.getBoundingClientRect().toJSON(),
        })),
        hit: send.contains(
          document.elementFromPoint(
            sendRect.x + sendRect.width / 2,
            sendRect.y + sendRect.height / 2,
          ),
        ),
      };
    });
    console.log(JSON.stringify({ variant, width, height, ...geometry }));
    for (const control of geometry.controls) {
      if (
        control.rect.width <= 0 ||
        control.rect.left < geometry.row.left ||
        control.rect.right > geometry.row.right ||
        control.rect.bottom > height
      ) {
        throw new Error(
          `${width}x${height}: control outside composer: ${control.label}`,
        );
      }
    }
    for (const [index, control] of geometry.controls.entries()) {
      for (const other of geometry.controls.slice(index + 1)) {
        if (
          control.rect.left < other.rect.right &&
          control.rect.right > other.rect.left &&
          control.rect.top < other.rect.bottom &&
          control.rect.bottom > other.rect.top
        ) {
          throw new Error(
            `${width}x${height}: controls overlap: ${control.label}, ${other.label}`,
          );
        }
      }
    }
    if (!geometry.hit)
      throw new Error(`${width}x${height}: Send is not tappable`);
    await page.touchscreen.tap(
      geometry.send.x + geometry.send.width / 2,
      geometry.send.y + geometry.send.height / 2,
    );
    sent += 1;
    await page.waitForFunction(
      (expected) =>
        Number(
          document.querySelector('[aria-label="Sent messages"]').textContent,
        ) === expected,
      {},
      sent,
    );
  }
}
console.log(
  "PASS: composer controls stay contained, non-overlapping and tappable",
);
