/**
 * Rendered relationship sweep for the Plugin Guide, driven through Chrome for
 * Testing over CDP against a running bb dev app.
 *
 * This is the placement gate for everything the static tests cannot see:
 * measured badges, engaged rings, transient clearances, scale, and the
 * stage-to-card rhythm. It asserts relationships — contained-in, adjacent-to,
 * identical-box, non-overlapping, bounded — never exact authored pixels, and
 * it discovers annotations from the rendered DOM, then reconciles them
 * against the declared inventory so a missing annotation cannot pass
 * silently.
 *
 * Usage:
 *   QA_ORIGIN=http://localhost:<port> QA_OUTPUT_DIR=/tmp/guide-qa \
 *     node verify-guide-chrome.mjs
 */
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const outputDir = process.env.QA_OUTPUT_DIR;
const candidate = process.env.QA_CANDIDATE ?? "working-tree";
const origin = process.env.QA_ORIGIN ?? "http://localhost:38886";
if (!outputDir) throw new Error("QA_OUTPUT_DIR is required");
await mkdir(outputDir, { recursive: true });

const PAGES = [
  ["app-shell", "The bb app window"],
  ["command-palette", "Command palette"],
  ["composer", "The composer"],
  ["home", "Home page"],
  ["settings", "Plugin settings page"],
  ["extensions", "Plugin page in Extensions"],
  ["headless", "Plugin backend"],
];
const VIEWPORTS = [
  { tag: "mobile", width: 390, height: 844 },
  { tag: "narrow", width: 768, height: 900 },
  { tag: "desktop", width: 1440, height: 900 },
  { tag: "wide", width: 2030, height: 1100 },
];

const chrome = join(
  process.env.HOME,
  ".cache/chrome-for-testing/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
);
const profile = await mkdtemp(join(outputDir, "guide-sweep-cft."));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const browser = spawn(
  chrome,
  [
    "--headless=new",
    "--use-mock-keychain",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--disable-gpu",
    "about:blank",
  ],
  { stdio: "ignore" },
);

try {
  let port = null;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      port = (await readFile(join(profile, "DevToolsActivePort"), "utf8"))
        .split("\n")[0]
        .trim();
      if (port) break;
    } catch {}
    if (browser.exitCode !== null) throw new Error("Chrome exited early");
    await delay(100);
  }
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(
    (response) => response.json(),
  );
  const socket = new WebSocket(
    targets.find((entry) => entry.type === "page").webSocketDebuggerUrl,
  );
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  let sequence = 0;
  const pending = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== undefined && pending.has(message.id)) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      sequence += 1;
      pending.set(sequence, { resolve, reject });
      socket.send(JSON.stringify({ id: sequence, method, params }));
    });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(JSON.stringify(result.exceptionDetails));
    }
    return result.result.value;
  };
  const waitFor = async (expression, label) => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      try {
        if (await evaluate(expression)) return;
      } catch {}
      await delay(100);
    }
    throw new Error(`Timed out waiting for ${label}`);
  };
  const capture = async (name) => {
    const path = `${outputDir}/${name}-${candidate}.png`;
    const result = await send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
    });
    await writeFile(path, Buffer.from(result.data, "base64"));
    return path;
  };
  const click = async (selector) => {
    const clicked = await evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return false;
      element.click();
      return true;
    })()`);
    if (!clicked) throw new Error(`Missing ${selector}`);
    await delay(400);
  };
  const showPage = async (label, groupId) => {
    const clicked = await evaluate(`(() => {
      const button = [...document.querySelectorAll("button")].find(
        (entry) => entry.textContent?.trim() === ${JSON.stringify(label)},
      );
      button?.click();
      return !!button;
    })()`);
    if (!clicked) throw new Error(`Missing page ${label}`);
    await waitFor(
      `!!document.querySelector('[data-map-section=${groupId}]:not([inert])')`,
      label,
    );
    await delay(450);
  };

  await send("Page.enable");
  await send("Runtime.enable");

  const failures = [];
  const record = { candidate, viewports: [] };

  for (const viewport of VIEWPORTS) {
    await send("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: viewport.width < 700,
    });
    await send("Page.navigate", {
      url: `${origin}/plugins/plugin-api-docs/plugin-api/app-shell`,
    });
    await waitFor(
      'document.readyState === "complete" && !!document.querySelector("[data-map-section=app-shell] [data-guide-responsive-strategy]")',
      "Plugin Guide",
    );
    await delay(700);

    const pages = [];
    for (const [groupId, label] of PAGES) {
      await showPage(label, groupId);
      const page = await evaluate(`(() => {
        const slide = document.querySelector('[data-map-section="${groupId}"]');
        const rect = (element) => {
          const value = element?.getBoundingClientRect();
          return value
            ? { left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height }
            : null;
        };
        const frame = slide.querySelector("[data-guide-responsive-strategy]");
        const scale = frame ? Number(frame.dataset.guideScale ?? "1") : 1;
        const scroller = document.querySelector("[data-guide-page-list-scroll]");
        const list = scroller?.firstElementChild;
        const carets = [...document.querySelectorAll('button[aria-label$="surface"]')].map((entry) => rect(entry));
        const badges = [...slide.querySelectorAll("[data-guide-badge]")]
          .filter((entry) => entry.getBoundingClientRect().width > 0)
          .map((entry) => {
            const box = entry.getBoundingClientRect();
            const hit = document.elementFromPoint(
              (box.left + box.right) / 2,
              (box.top + box.bottom) / 2,
            );
            return {
              id: entry.dataset.guideBadge,
              rect: rect(entry),
              hit: entry === hit || entry.contains(hit),
            };
          });
        return {
          scale,
          overflow: {
            document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            scroller: scroller ? scroller.scrollWidth - scroller.clientWidth : 0,
            scrollerIsOnlyOwner: !!scroller && getComputedStyle(scroller).overflowX === "auto",
          },
          caretAdjacency:
            scroller && list && scroller.scrollWidth <= scroller.clientWidth + 1
              ? Math.max(
                  rect(scroller).left - carets[0].right,
                  carets[1].left - rect(scroller).right,
                )
              : null,
          slide: rect(slide),
          badges,
        };
      })()`);

      if (!(page.scale > 0 && page.scale <= 1.2001)) {
        failures.push(`${viewport.tag}/${groupId}: scale ${page.scale} out of bounds`);
      }
      if (page.overflow.document > 1) {
        failures.push(`${viewport.tag}/${groupId}: page overflows horizontally by ${page.overflow.document}px`);
      }
      if (!page.overflow.scrollerIsOnlyOwner) {
        failures.push(`${viewport.tag}/${groupId}: page list is not the horizontal scroll owner`);
      }
      if (page.caretAdjacency !== null && page.caretAdjacency > 8.5) {
        failures.push(`${viewport.tag}/${groupId}: caret ${page.caretAdjacency.toFixed(1)}px from label strip`);
      }
      for (const badge of page.badges) {
        if (!badge.hit) {
          failures.push(`${viewport.tag}/${groupId}: badge ${badge.id} is not hit-testable`);
        }
        if (
          badge.rect.left < page.slide.left - 1 ||
          badge.rect.right > page.slide.right + 1
        ) {
          failures.push(`${viewport.tag}/${groupId}: badge ${badge.id} escapes the slide bounds`);
        }
      }
      pages.push({ groupId, ...page });
    }

    // Inventory reconciliation on the desktop pass: every declared annotation
    // must have rendered somewhere, or coverage silently shrank.
    if (viewport.tag === "desktop") {
      const rendered = new Set(
        pages.flatMap((page) => page.badges.map((badge) => badge.id)),
      );
      const declared = await evaluate(`(() => {
        return [...document.querySelectorAll("[data-map-section] [data-guide-region], [data-map-section] [data-guide-badge]")]
          .map((entry) => entry.dataset.guideRegion ?? entry.dataset.guideBadge);
      })()`);
      for (const id of new Set(declared)) {
        if (!rendered.has(id)) {
          failures.push(`desktop: declared surface ${id} rendered no badge`);
        }
      }
    }

    // Engaged-ring and gap relationships, exercised on the composer page.
    await showPage("The composer", "composer");
    for (const id of ["provider-picker", "composer-plus-menu", "composer-actions", "composer-state"]) {
      await click(`[data-guide-badge="${id}"]`);
      // The stage, reserve, and scale all glide on a 300ms ease when a card
      // re-budgets the height; the gap contract is about the settled state.
      await delay(500);
      const engaged = await evaluate(`(() => {
        const target = document.querySelector('[data-map-section="composer"] [data-guide-target="${id}"]');
        const card = document.querySelector('[role="dialog"]');
        const slide = document.querySelector('[data-map-section="composer"]');
        const frame = slide.querySelector("[data-guide-responsive-strategy]");
        const scale = Number(frame?.dataset.guideScale ?? "1") || 1;
        const ringed = !!target && target.className.includes("ring-surface-selected-border");
        // The card always renders in flow inside the carousel section;
        // the closest() check is defensive, not a real overlay branch.
        const inFlowCard = card?.closest('section[aria-roledescription="carousel"]')
          ? card
          : null;
        const gap = inFlowCard && frame
          ? (inFlowCard.getBoundingClientRect().top - slide.getBoundingClientRect().bottom)
          : null;
        const transient = document.querySelector('[data-guide-transient-for="${id}"]');
        const badges = [...slide.querySelectorAll("[data-guide-badge]")]
          .filter((entry) => entry.getBoundingClientRect().width > 0)
          .map((entry) => ({ id: entry.dataset.guideBadge, box: entry.getBoundingClientRect().toJSON() }));
        return {
          ringed,
          gap,
          scale,
          cardInViewport: inFlowCard
            ? inFlowCard.getBoundingClientRect().bottom <= innerHeight + 1
            : null,
          scrollTop: document.querySelector("[data-guide-stage-viewport]")?.scrollTop ?? 0,
          transient: transient ? transient.getBoundingClientRect().toJSON() : null,
          badges,
        };
      })()`);
      if (!engaged.ringed) {
        failures.push(`${viewport.tag}/composer: engaged ${id} target carries no ring`);
      }
      if (engaged.gap !== null && (engaged.gap < 7 || engaged.gap > 29)) {
        failures.push(`${viewport.tag}/composer: stage-to-card gap ${engaged.gap.toFixed(1)}px outside clamp`);
      }
      // The open card is part of the height budget: it must fit above the
      // fold without scrolling the page chrome away (desktop classes; a
      // compact viewport may float or scroll legitimately).
      if (viewport.width >= 1000) {
        if (engaged.cardInViewport === false) {
          failures.push(`${viewport.tag}/composer: open ${id} card extends past the fold`);
        }
        if (engaged.scrollTop > 1) {
          failures.push(`${viewport.tag}/composer: opening ${id} scrolled the page chrome away (${engaged.scrollTop}px)`);
        }
      }
      if (engaged.transient) {
        for (const badge of engaged.badges) {
          const clear =
            badge.box.right < engaged.transient.left - 4 * engaged.scale ||
            badge.box.left > engaged.transient.right + 4 * engaged.scale ||
            badge.box.bottom < engaged.transient.top - 4 * engaged.scale ||
            badge.box.top > engaged.transient.bottom + 4 * engaged.scale;
          if (!clear) {
            failures.push(`${viewport.tag}/composer: transient for ${id} within 4px of badge ${badge.id}`);
          }
        }
      }
      await click('[role="dialog"] button[aria-label="Close"]');
    }
    record.viewports.push({ ...viewport, pages });
  }

  // Anti-squish gate: at the wide viewport, the app-shell fixture fills its
  // content column instead of floating in margin.
  const wide = record.viewports.find((entry) => entry.tag === "wide");
  const wideShell = wide.pages.find((page) => page.groupId === "app-shell");
  const fill = wideShell.slide.width > 0 ? wideShell.slide.width / wide.width : 0;
  if (fill < 0.6) {
    failures.push(`wide: app-shell slide fills only ${(fill * 100).toFixed(0)}% of the viewport`);
  }

  const screenshot = await capture("guide-sweep-final");
  record.result = failures.length === 0 ? "PASS" : "FAIL";
  record.failures = failures;
  record.screenshot = screenshot;
  await writeFile(
    `${outputDir}/guide-sweep-${candidate}.json`,
    JSON.stringify(record, null, 2),
  );
  console.log(JSON.stringify({ result: record.result, failures }, null, 2));
  if (failures.length > 0) process.exitCode = 1;
  socket.close();
} finally {
  if (browser.exitCode === null) browser.kill("SIGKILL");
  await delay(200);
  if (browser.exitCode === null) browser.kill("SIGKILL");
  await rm(profile, { recursive: true, force: true });
}
