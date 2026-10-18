const page = await browser.getPage("main");
const origin = new URL(page.url()).origin;
if (!page.url().includes("thread--timeline--scrollback")) {
  throw new Error("Open a thread/timeline/Scrollback story first");
}

const frames = (count) =>
  page.evaluate(
    (remaining) =>
      new Promise((resolve) => {
        const step = (left) =>
          left === 0 ? resolve() : requestAnimationFrame(() => step(left - 1));
        step(remaining);
      }),
    count,
  );

async function settle() {
  let previous = -1;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await frames(3);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const requests = await page.evaluate(() =>
      window.__timelineScrollback.olderRequests(),
    );
    if (requests === previous) return;
    previous = requests;
  }
  throw new Error("Older page loads did not settle");
}

function readView() {
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll("[data-timeline-row-id]")];
    let scroller = rows[0]?.parentElement ?? null;
    while (
      scroller &&
      !(
        getComputedStyle(scroller).overflowY === "auto" ||
        getComputedStyle(scroller).overflowY === "scroll"
      )
    ) {
      scroller = scroller.parentElement;
    }
    if (!scroller) throw new Error("Missing timeline scroller");
    const top = scroller.getBoundingClientRect().top;
    return {
      scrollTop: scroller.scrollTop,
      scrollHeight: scroller.scrollHeight,
      clientHeight: scroller.clientHeight,
      rows: rows.map((row) => ({
        id: row.getAttribute("data-timeline-row-id"),
        top: row.getBoundingClientRect().top - top,
      })),
    };
  });
}

function setScrollTop(value) {
  return page.evaluate((next) => {
    let scroller = document.querySelector("[data-timeline-row-id]");
    while (
      scroller &&
      !(
        getComputedStyle(scroller).overflowY === "auto" ||
        getComputedStyle(scroller).overflowY === "scroll"
      )
    ) {
      scroller = scroller.parentElement;
    }
    scroller.scrollTop = next === "bottom" ? scroller.scrollHeight : next;
  }, value);
}

async function expectOrderedSubsequence(label) {
  const view = await readView();
  const all = await page.evaluate(() =>
    window.__timelineScrollback.allRowIds(),
  );
  const ids = view.rows.map((row) => row.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error(`${label}: duplicate rows ${ids.join(",")}`);
  }
  const start = all.indexOf(ids[0]);
  if (start === -1 || ids.some((id, index) => all[start + index] !== id)) {
    throw new Error(`${label}: rows out of order or missing: ${ids.join(",")}`);
  }
  return view;
}

async function expectAnchorHeld(label, anchor) {
  const view = await expectOrderedSubsequence(label);
  const row = view.rows.find((candidate) => candidate.id === anchor.id);
  if (!row) throw new Error(`${label}: anchor ${anchor.id} left the DOM`);
  const drift = Math.abs(row.top - anchor.top);
  console.log(JSON.stringify({ label, anchor: anchor.id, drift }));
  if (drift > 1) {
    throw new Error(`${label}: anchor moved ${drift}px`);
  }
}

async function wheelUpUntilOlderLoads() {
  const before = await page.evaluate(() =>
    window.__timelineScrollback.olderRequests(),
  );
  const viewport = page.viewport();
  await page.mouse.move(viewport.width / 2, viewport.height / 2);
  for (let attempt = 0; attempt < 200; attempt += 1) {
    await page.mouse.wheel({ deltaY: -200 });
    await frames(2);
    const requests = await page.evaluate(() =>
      window.__timelineScrollback.olderRequests(),
    );
    if (requests > before) {
      await settle();
      return;
    }
  }
  throw new Error("Scrolling up loaded nothing");
}

async function walkToStart() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await wheelUpUntilOlderLoads();
    const reachedStart = await page.evaluate(() =>
      window.__timelineScrollback.reachedStart(),
    );
    if (reachedStart) return;
  }
  throw new Error("Never reached the start of the thread");
}

async function runStory(storyId, width) {
  await page.setViewport({ width, height: 800, deviceScaleFactor: 1 });
  await page.goto(`${origin}/?story=${storyId}&mode=preview`, {
    waitUntil: "networkidle0",
  });
  await page.waitForSelector("[data-timeline-row-id]");
  await page.evaluate(() => document.fonts.ready);
  await settle();

  await wheelUpUntilOlderLoads();
  const scrolledBack = await expectOrderedSubsequence(
    `${storyId} scrolled back`,
  );
  const anchor = scrolledBack.rows.find((row) => row.top >= 40);
  if (!anchor) throw new Error(`${storyId}: no anchor row in view`);

  const latestRequestsBefore = await page.evaluate(() =>
    window.__timelineScrollback.latestRequests(),
  );
  const actions = [
    ["stream", 5],
    ["newTurn", 1],
    ["stream", 3],
    ["refetchUnchanged", 1],
  ];
  for (const [action, count] of actions) {
    for (let index = 0; index < count; index += 1) {
      await page.evaluate(
        (name) => window.__timelineScrollback[name](),
        action,
      );
      await frames(3);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
    await expectAnchorHeld(`${storyId} ${action}`, anchor);
  }
  const streamedRequests =
    (await page.evaluate(() => window.__timelineScrollback.latestRequests())) -
    latestRequestsBefore;
  const pushed = storyId.includes("-pushed");
  console.log(JSON.stringify({ storyId, latestRequests: streamedRequests }));
  if (pushed ? streamedRequests !== 1 : streamedRequests !== 10) {
    throw new Error(
      `${storyId}: ${streamedRequests} latest-window requests for 9 updates and one unchanged refetch`,
    );
  }

  await page.evaluate(() => window.__timelineScrollback.renameWithEvent());
  await walkToStart();
  const staleCursorResponses = await page.evaluate(() =>
    window.__timelineScrollback.staleCursorResponses(),
  );
  if (staleCursorResponses !== 1) {
    throw new Error(
      `${storyId}: expected one stale cursor, saw ${staleCursorResponses}`,
    );
  }

  const seen = [];
  await setScrollTop(0);
  for (let attempt = 0; attempt < 200; attempt += 1) {
    await frames(2);
    const view = await readView();
    for (const row of view.rows) {
      if (
        row.top >= -1 &&
        row.top < view.clientHeight &&
        !seen.includes(row.id)
      ) {
        seen.push(row.id);
      }
    }
    if (view.scrollTop + view.clientHeight >= view.scrollHeight - 1) break;
    await setScrollTop(view.scrollTop + view.clientHeight / 2);
  }
  const all = await page.evaluate(() =>
    window.__timelineScrollback.allRowIds(),
  );
  console.log(
    JSON.stringify({ storyId, width, rows: seen.length, expected: all.length }),
  );
  if (seen.join("\n") !== all.join("\n")) {
    throw new Error(
      `${storyId}: walked rows differ\nseen ${seen.join(",")}\nall  ${all.join(",")}`,
    );
  }
}

await runStory("thread--timeline--scrollback--paged-thread", 1280);
await runStory("thread--timeline--scrollback--paged-thread-phone-width", 390);
await runStory("thread--timeline--scrollback--paged-thread-pushed", 1280);
await runStory(
  "thread--timeline--scrollback--paged-thread-pushed-phone-width",
  390,
);
("timeline scrollback held");
