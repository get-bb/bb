#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const USAGE = `Usage: node record.mjs --shots <shot-list.mjs> --out <dir>/<name>
  [--only 2,4] [--chrome <path>] [--ffmpeg <path>] [--cdp <ws-url>] [--keep-frames]

Writes <name>.mp4, <name>-poster.jpg, <name>.txt and <name>.vtt.
--only re-records the listed steps and keeps every other step from the
existing <name>.mp4, using the step timings in <name>.vtt.`;

const { values: args } = parseArgs({
  options: {
    shots: { type: "string" },
    out: { type: "string" },
    only: { type: "string" },
    chrome: { type: "string", default: process.env.CHROME_PATH },
    ffmpeg: { type: "string", default: process.env.FFMPEG_PATH ?? "ffmpeg" },
    cdp: { type: "string" },
    "keep-frames": { type: "boolean", default: false },
    help: { type: "boolean", short: "h" },
  },
});

if (args.help || !args.shots || !args.out) {
  console.log(USAGE);
  process.exit(args.help ? 0 : 2);
}

const list = (await import(pathToFileURL(path.resolve(args.shots)).href))
  .default;
const out = path.resolve(args.out);
const only = args.only
  ? new Set(args.only.split(",").map((step) => Number(step.trim())))
  : null;
const viewport = list.viewport ?? { width: 1280, height: 720 };
const workRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../.tmp/docs-walkthrough",
);
mkdirSync(workRoot, { recursive: true });
const work = mkdtempSync(path.join(workRoot, "recording-"));
process.on("exit", () => {
  if (!args["keep-frames"]) rmSync(work, { recursive: true, force: true });
});
const framesDir = path.join(work, "frames");
mkdirSync(framesDir);
mkdirSync(path.dirname(out), { recursive: true });

function fail(message) {
  console.error(`record: ${message}`);
  process.exit(1);
}

function readCues(file) {
  if (!existsSync(file)) return [];
  const toSeconds = (stamp) => {
    const [h, m, s] = stamp.split(":");
    return Number(h) * 3600 + Number(m) * 60 + Number(s);
  };
  return [
    ...readFileSync(file, "utf8").matchAll(
      /(\d\d:\d\d:\d\d\.\d{3}) --> (\d\d:\d\d:\d\d\.\d{3})/gu,
    ),
  ].map((match) => ({ start: toSeconds(match[1]), end: toSeconds(match[2]) }));
}

const previousCues = readCues(`${out}.vtt`);
if (only) {
  if (!existsSync(`${out}.mp4`)) fail(`--only needs the existing ${out}.mp4`);
  if (previousCues.length !== list.shots.length) {
    fail(
      `${out}.vtt has ${previousCues.length} steps but the shot list has ${list.shots.length}; record every step instead`,
    );
  }
}

async function launchChrome() {
  if (args.cdp) return { ws: args.cdp, stop() {} };
  if (!args.chrome) fail("pass --chrome or set CHROME_PATH");
  const child = spawn(
    args.chrome,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${path.join(work, "profile")}`,
      `--window-size=${viewport.width},${viewport.height}`,
      "--no-sandbox",
      "--no-first-run",
      "--no-default-browser-check",
      "--hide-scrollbars",
      "--force-color-profile=srgb",
      "--font-render-hinting=none",
      ...(list.chromeArgs ?? []),
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  const ws = await new Promise((resolve, reject) => {
    let log = "";
    const timer = setTimeout(
      () => reject(new Error(`Chrome did not start:\n${log}`)),
      20_000,
    );
    child.stderr.on("data", (chunk) => {
      log += chunk;
      const match = /DevTools listening on (ws:\/\/\S+)/u.exec(log);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.once("exit", (code) =>
      reject(new Error(`Chrome exited ${code}\n${log}`)),
    );
  });
  return { ws, stop: () => child.kill("SIGTERM") };
}

function connect(url) {
  const socket = new WebSocket(url);
  let nextId = 1;
  const pending = new Map();
  const listeners = new Set();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
      return;
    }
    for (const listener of listeners) listener(message);
  });
  return new Promise((resolve, reject) => {
    socket.addEventListener("error", reject, { once: true });
    socket.addEventListener("open", () =>
      resolve({
        send(method, params = {}, sessionId) {
          const id = nextId++;
          socket.send(JSON.stringify({ id, method, params, sessionId }));
          return new Promise((res, rej) =>
            pending.set(id, { resolve: res, reject: rej }),
          );
        },
        on(listener) {
          listeners.add(listener);
        },
        close: () => socket.close(),
      }),
    );
  });
}

const OVERLAY_SOURCE = `(() => {
  if (window.__walkthrough) return;
  const replacements = ${JSON.stringify(list.replacements ?? [])};
  const scrub = (text) => {
    let next = text;
    for (const [from, to] of replacements) {
      next = typeof from === "string" ? next.split(from).join(to) : next.replace(new RegExp(from.re, "gu"), to);
    }
    return next;
  };
  const scrubTree = (root) => {
    if (!replacements.length || !root) return;
    if (root.nodeType === Node.TEXT_NODE) {
      const next = scrub(root.nodeValue);
      if (next !== root.nodeValue) root.nodeValue = next;
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const next = scrub(node.nodeValue);
      if (next !== node.nodeValue) node.nodeValue = next;
    }
    const elements = root.querySelectorAll ? root.querySelectorAll("[title],[placeholder],[aria-label],input,textarea") : [];
    for (const element of elements) {
      for (const name of ["title", "placeholder", "aria-label"]) {
        const value = element.getAttribute(name);
        if (value && scrub(value) !== value) element.setAttribute(name, scrub(value));
      }
      if ("value" in element && typeof element.value === "string" && scrub(element.value) !== element.value) {
        element.value = scrub(element.value);
      }
    }
  };
  const start = () => {
    scrubTree(document.body);
    new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "characterData") scrubTree(record.target);
        for (const node of record.addedNodes) scrubTree(node);
        if (record.type === "attributes") scrubTree(record.target.parentNode ?? record.target);
      }
    }).observe(document.documentElement, {
      subtree: true, childList: true, characterData: true,
      attributes: true, attributeFilter: ["title", "placeholder", "aria-label"],
    });
    const style = document.createElement("style");
    style.textContent = ${JSON.stringify(list.css ?? "")} + \`
      .wt-layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;
        --wt-bg: oklch(1 0 0); --wt-ink: oklch(0.21 0 0); --wt-border: oklch(0.9 0 0);
        --wt-accent: oklch(0.55 0.1 250); --wt-on-accent: oklch(1 0 0);
        font-family: "Inter Variable", "Inter", -apple-system, "Segoe UI", Roboto, sans-serif; }
      .wt-layer[data-scheme="dark"] { --wt-bg: oklch(0.235 0 0); --wt-ink: oklch(0.93 0 0);
        --wt-border: oklch(0.36 0 0); --wt-accent: oklch(0.72 0.09 250); --wt-on-accent: oklch(0.195 0 0); }
      .wt-outline { position: fixed; border: 1px solid var(--wt-accent); border-radius: 8px;
        box-shadow: 0 0 0 3px color-mix(in oklab, var(--wt-accent) 18%, transparent);
        transition: opacity 180ms ease; opacity: 0; }
      .wt-card { position: fixed; display: flex; gap: 10px; align-items: flex-start; max-width: 300px;
        padding: 10px 14px 11px 10px; border: 1px solid var(--wt-border); border-radius: 10px;
        background: var(--wt-bg); color: var(--wt-ink); font-size: 15px; line-height: 22px;
        font-weight: 500; letter-spacing: -0.005em;
        box-shadow: 0 1px 2px oklch(0 0 0 / 0.06), 0 8px 24px oklch(0 0 0 / 0.12);
        transition: opacity 180ms ease, transform 180ms ease; opacity: 0; transform: translateY(4px); }
      .wt-card.wt-on, .wt-outline.wt-on { opacity: 1; transform: none; }
      .wt-step { flex: none; min-width: 22px; height: 22px; padding: 0 6px; border-radius: 999px;
        background: var(--wt-accent); color: var(--wt-on-accent); font-size: 12px; line-height: 22px;
        font-weight: 600; text-align: center; }
      .wt-cursor { position: fixed; left: 0; top: 0; width: 18px; height: 18px;
        transition: transform 420ms cubic-bezier(.3,.7,.2,1); }
    \`;
    document.head.append(style);
    const layer = document.createElement("div");
    layer.className = "wt-layer";
    layer.dataset.scheme = ${JSON.stringify(list.scheme ?? "light")};
    const outline = document.createElement("div");
    outline.className = "wt-outline";
    const card = document.createElement("div");
    card.className = "wt-card";
    const cursor = document.createElement("div");
    cursor.className = "wt-cursor";
    cursor.innerHTML = '<svg width="18" height="18" viewBox="0 0 18 18"><path d="M2 1.5 L2 15 L5.6 11.6 L8 17 L10.4 16 L8.1 10.7 L13 10.7 Z" fill="black" stroke="white" stroke-width="1.2" stroke-linejoin="round"/></svg>';
    cursor.style.transform = "translate(-40px,-40px)";
    layer.append(outline, card, cursor);
    document.body.append(layer);
    let anchor = null;
    const place = () => {
      if (!card.classList.contains("wt-on")) return;
      const rect = anchor?.getBoundingClientRect();
      const width = card.offsetWidth, height = card.offsetHeight;
      const vw = innerWidth, vh = innerHeight, gap = 14, edge = 12;
      let x = (vw - width) / 2, y = vh - height - 24;
      if (rect && rect.width + rect.height > 0) {
        Object.assign(outline.style, { left: rect.left - 4 + "px", top: rect.top - 4 + "px",
          width: rect.width + 8 + "px", height: rect.height + 8 + "px" });
        const midY = Math.min(Math.max(rect.top + rect.height / 2 - height / 2, edge), vh - height - edge);
        const midX = Math.min(Math.max(rect.left + rect.width / 2 - width / 2, edge), vw - width - edge);
        if (rect.right + gap + width + edge <= vw) { x = rect.right + gap; y = midY; }
        else if (rect.left - gap - width >= edge) { x = rect.left - gap - width; y = midY; }
        else if (rect.bottom + gap + height + edge <= vh) { x = midX; y = rect.bottom + gap; }
        else { x = midX; y = Math.max(rect.top - gap - height, edge); }
      }
      card.style.left = x + "px";
      card.style.top = y + "px";
    };
    const tick = () => { place(); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const find = (target) => {
      if (!target) return null;
      if (typeof target === "string") return [...document.querySelectorAll(target)].find(visible) ?? null;
      const within = target.within ? document.querySelector(target.within) : document.body;
      if (!within) return null;
      if (target.selector) {
        const matches = [...within.querySelectorAll(target.selector)].filter(visible);
        return matches[target.nth ?? 0] ?? null;
      }
      const wanted = target.text;
      const matches = [];
      for (const element of within.querySelectorAll("*")) {
        if (layer.contains(element) || !visible(element)) continue;
        const label = element.getAttribute("aria-label");
        const own = (element.innerText ?? "").trim();
        if (label === wanted || own === wanted || (target.contains && own.includes(wanted))) matches.push(element);
      }
      const deepest = matches.filter((element) => !matches.some((other) => other !== element && element.contains(other)));
      const pick = deepest[target.nth ?? 0] ?? null;
      return pick && target.closest ? pick.closest(target.closest) ?? pick : pick;
    };
    window.__walkthrough = {
      find,
      center(target) {
        const element = find(target);
        if (!element) return null;
        element.scrollIntoView({ block: "nearest", inline: "nearest" });
        const rect = element.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      },
      cursor(x, y) { cursor.style.transform = "translate(" + (x - 2) + "px," + (y - 1) + "px)"; },
      show(step, text, target) {
        anchor = find(target);
        card.innerHTML = "";
        const badge = document.createElement("span");
        badge.className = "wt-step";
        badge.textContent = String(step);
        const body = document.createElement("span");
        body.textContent = text;
        card.append(badge, body);
        card.classList.add("wt-on");
        outline.classList.toggle("wt-on", Boolean(anchor));
        place();
        return Boolean(anchor) || !target;
      },
      hide() { card.classList.remove("wt-on"); outline.classList.remove("wt-on"); anchor = null; },
    };
  };
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
})();`;

const chrome = await launchChrome();
process.on("exit", () => chrome.stop());
const cdp = await connect(chrome.ws);
const { targetId } = args.cdp
  ? {
      targetId: (await cdp.send("Target.getTargets")).targetInfos.find(
        (t) => t.type === "page",
      ).targetId,
    }
  : await cdp.send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await cdp.send("Target.attachToTarget", {
  targetId,
  flatten: true,
});
const send = (method, params) => cdp.send(method, params, sessionId);
const loadWaiters = new Set();

await send("Page.enable");
await send("Runtime.enable");
if (!args.cdp) {
  await send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: false,
  });
}
await send("Emulation.setEmulatedMedia", {
  features: [{ name: "prefers-color-scheme", value: list.scheme ?? "light" }],
});
await send("Page.addScriptToEvaluateOnNewDocument", { source: OVERLAY_SOURCE });

let recording = false;
let clock = 0;
let resumedAt = 0;
let frameIndex = 0;
const frames = [];
const videoTime = () =>
  recording ? clock + (performance.now() - resumedAt) / 1000 : clock;

function addFrame(data) {
  const file = path.join(
    framesDir,
    `f${String(frameIndex++).padStart(6, "0")}.jpg`,
  );
  writeFileSync(file, Buffer.from(data, "base64"));
  frames.push({ file, t: videoTime() });
}

cdp.on((message) => {
  if (message.sessionId !== sessionId) return;
  if (message.method === "Page.screencastFrame") {
    send("Page.screencastFrameAck", { sessionId: message.params.sessionId });
    if (recording) addFrame(message.params.data);
  }
  if (message.method === "Page.loadEventFired") {
    for (const resolve of loadWaiters) resolve();
    loadWaiters.clear();
  }
});

await send("Page.startScreencast", {
  format: "jpeg",
  quality: 92,
  maxWidth: viewport.width,
  maxHeight: viewport.height,
  everyNthFrame: 1,
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function evaluate(fn, ...values) {
  const expression = `(${fn})(...${JSON.stringify(values)})`;
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description ??
        result.exceptionDetails.text,
    );
  }
  return result.result.value;
}

async function captureFrame() {
  const { data } = await send("Page.captureScreenshot", {
    format: "jpeg",
    quality: 92,
  });
  return data;
}

async function resume() {
  if (recording) return;
  resumedAt = performance.now();
  recording = true;
  addFrame(await captureFrame());
}

function pause() {
  if (!recording) return;
  clock = videoTime();
  recording = false;
}

const page = {
  url: (route = "/") => new URL(route, list.baseUrl).href,
  async goto(route, waitFor) {
    const loaded = new Promise((resolve) => loadWaiters.add(resolve));
    await send("Page.navigate", { url: page.url(route) });
    await Promise.race([loaded, sleep(15_000)]);
    if (waitFor) await page.waitFor(waitFor);
  },
  async waitFor(target, timeout = 20_000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const found = await evaluate(
        (t) => Boolean(window.__walkthrough?.find(t)),
        target,
      ).catch(() => false);
      if (found) return;
      await sleep(150);
    }
    throw new Error(`Timed out waiting for ${JSON.stringify(target)}`);
  },
  async moveTo(target) {
    await page.waitFor(target);
    const point = await evaluate((t) => window.__walkthrough.center(t), target);
    await evaluate(
      (x, y) => window.__walkthrough.cursor(x, y),
      point.x,
      point.y,
    );
    await send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: point.x,
      y: point.y,
    });
    await sleep(recording ? 520 : 0);
    return point;
  },
  async click(target) {
    const { x, y } = await page.moveTo(target);
    for (const type of ["mousePressed", "mouseReleased"]) {
      await send("Input.dispatchMouseEvent", {
        type,
        x,
        y,
        button: "left",
        clickCount: 1,
      });
    }
    await sleep(recording ? 250 : 50);
  },
  async contextClick(target) {
    const { x, y } = await page.moveTo(target);
    for (const type of ["mousePressed", "mouseReleased"]) {
      await send("Input.dispatchMouseEvent", {
        type,
        x,
        y,
        button: "right",
        clickCount: 1,
      });
    }
    await sleep(recording ? 350 : 80);
  },
  async hover(target) {
    await page.moveTo(target);
  },
  exists: (target) =>
    evaluate((t) => Boolean(window.__walkthrough?.find(t)), target).catch(
      () => false,
    ),
  async type(text, delay = 45) {
    for (const char of text) {
      if (char === "\n") await page.press("Enter", { shift: true });
      else await send("Input.insertText", { text: char });
      if (recording) await sleep(delay);
    }
  },
  async press(key, { shift = false, meta = false, ctrl = false } = {}) {
    const codes = {
      Enter: 13,
      Escape: 27,
      Tab: 9,
      ArrowDown: 40,
      ArrowUp: 38,
      Backspace: 8,
    };
    const modifiers = (shift ? 8 : 0) | (meta ? 4 : 0) | (ctrl ? 2 : 0);
    const keyCode = codes[key] ?? key.toUpperCase().charCodeAt(0);
    const base = {
      key,
      code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
      windowsVirtualKeyCode: keyCode,
      modifiers,
    };
    await send("Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      ...base,
      ...(key === "Enter" ? { text: "\r" } : {}),
    });
    if (key === "Enter")
      await send("Input.dispatchKeyEvent", {
        type: "char",
        ...base,
        text: "\r",
      });
    await send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
    await sleep(recording ? 200 : 30);
  },
  async paste(text) {
    await send("Input.insertText", { text });
    await sleep(recording ? 300 : 30);
  },
  path: () => evaluate(() => location.pathname),
  async offCamera(fn) {
    const wasRecording = recording;
    pause();
    try {
      return await fn();
    } finally {
      if (wasRecording) await resume();
    }
  },
  wait: (ms) => sleep(ms),
  evaluate,
};

const cues = [];
let posterData = null;
let currentStep = "setup";

try {
  if (list.setup) await list.setup(page);

  for (const [index, shot] of list.shots.entries()) {
    currentStep = `step ${index + 1}`;
    const step = index + 1;
    const record = !only || only.has(step);
    if (shot.before) await shot.before(page);
    const start = videoTime();
    if (record) await resume();
    const showCaption = async (target) => {
      const resolved = typeof target === "function" ? await target() : target;
      const shown = await evaluate(
        (s, text, t) => window.__walkthrough.show(s, text, t),
        step,
        shot.caption,
        resolved ?? null,
      );
      if (!shown)
        console.warn(
          `step ${step}: anchor ${JSON.stringify(resolved)} not found`,
        );
    };
    await showCaption(shot.anchor);
    if (recording) await sleep(shot.lead ?? 900);
    if (shot.run) await shot.run(page);
    if (shot.after) await showCaption(shot.after);
    if (recording) await sleep(shot.hold ?? 2200);
    if (list.poster?.step === step) posterData = await captureFrame();
    await evaluate(() => window.__walkthrough.hide());
    if (recording) await sleep(200);
    pause();
    cues.push({ start, end: videoTime(), record });
  }
} catch (error) {
  const failure = path.join(workRoot, "failure.jpg");
  try {
    writeFileSync(failure, Buffer.from(await captureFrame(), "base64"));
    console.error(
      `record: ${currentStep} failed; the page at that moment is ${failure}`,
    );
  } catch {}
  console.error(error);
  process.exit(1);
}

await send("Page.stopScreencast");
cdp.close();
chrome.stop();

function stamp(seconds) {
  const ms = Math.round(seconds * 1000);
  const h = String(Math.floor(ms / 3_600_000)).padStart(2, "0");
  const m = String(Math.floor(ms / 60_000) % 60).padStart(2, "0");
  const s = String(Math.floor(ms / 1000) % 60).padStart(2, "0");
  return `${h}:${m}:${s}.${String(ms % 1000).padStart(3, "0")}`;
}

function ffmpeg(ffArgs) {
  const result = spawnSync(
    args.ffmpeg,
    ["-hide_banner", "-loglevel", "error", "-y", ...ffArgs],
    {
      stdio: "inherit",
    },
  );
  if (result.status !== 0) fail(`ffmpeg ${ffArgs.join(" ")} failed`);
}

const ENCODE = [
  "-vf",
  `fps=30,scale=${viewport.width}:${viewport.height}:flags=lanczos,format=yuv420p`,
  "-c:v",
  "libx264",
  "-preset",
  "slow",
  "-crf",
  String(list.crf ?? 27),
  "-tune",
  "animation",
  "-an",
];

function encodeFrames(from, to, file) {
  const selected = frames.filter(
    (frame) => frame.t >= from - 1e-6 && frame.t < to,
  );
  if (selected.length === 0) fail(`no frames between ${from}s and ${to}s`);
  const lines = [];
  for (const [i, frame] of selected.entries()) {
    const next = selected[i + 1]?.t ?? to;
    lines.push(
      `file '${frame.file}'`,
      `duration ${Math.max(next - frame.t, 1 / 30).toFixed(4)}`,
    );
  }
  lines.push(`file '${selected.at(-1).file}'`);
  const listFile = `${file}.txt`;
  writeFileSync(listFile, `${lines.join("\n")}\n`);
  ffmpeg(["-f", "concat", "-safe", "0", "-i", listFile, ...ENCODE, file]);
}

const segments = [];
const finalCues = [];
let cursor = 0;
for (const [index, cue] of cues.entries()) {
  const file = path.join(work, `segment-${index + 1}.mp4`);
  if (cue.record) {
    encodeFrames(cue.start, cue.end, file);
  } else {
    const old = previousCues[index];
    ffmpeg([
      "-ss",
      old.start.toFixed(3),
      "-to",
      old.end.toFixed(3),
      "-i",
      `${out}.mp4`,
      ...ENCODE,
      file,
    ]);
  }
  const probe = spawnSync(args.ffmpeg, ["-hide_banner", "-i", file], {
    encoding: "utf8",
  });
  const match = /Duration: (\d+):(\d+):([\d.]+)/u.exec(probe.stderr);
  const length = match
    ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
    : cue.end - cue.start;
  finalCues.push({ start: cursor, end: cursor + length });
  cursor += length;
  segments.push(file);
}

const concatList = path.join(work, "segments.txt");
writeFileSync(concatList, segments.map((file) => `file '${file}'`).join("\n"));
const nextVideo = path.join(work, "video.mp4");
ffmpeg([
  "-f",
  "concat",
  "-safe",
  "0",
  "-i",
  concatList,
  "-c",
  "copy",
  "-movflags",
  "+faststart",
  nextVideo,
]);
writeFileSync(`${out}.mp4`, readFileSync(nextVideo));

if (posterData) {
  writeFileSync(
    path.join(work, "poster.jpg"),
    Buffer.from(posterData, "base64"),
  );
  ffmpeg([
    "-i",
    path.join(work, "poster.jpg"),
    "-q:v",
    "3",
    `${out}-poster.jpg`,
  ]);
} else if (!only || !existsSync(`${out}-poster.jpg`)) {
  const at = finalCues[Math.min(1, finalCues.length - 1)].end - 0.5;
  ffmpeg([
    "-ss",
    at.toFixed(3),
    "-i",
    `${out}.mp4`,
    "-frames:v",
    "1",
    "-q:v",
    "3",
    `${out}-poster.jpg`,
  ]);
}

const captions = list.shots.map(
  (shot, index) => `${index + 1}. ${shot.caption}`,
);
writeFileSync(`${out}.txt`, `${list.title}\n\n${captions.join("\n")}\n`);
writeFileSync(
  `${out}.vtt`,
  `WEBVTT\n\n${finalCues
    .map(
      (cue, index) =>
        `${index + 1}\n${stamp(cue.start)} --> ${stamp(cue.end)}\n${captions[index]}`,
    )
    .join("\n\n")}\n`,
);

if (args["keep-frames"]) console.log(`frames kept in ${work}`);
else rmSync(work, { recursive: true, force: true });

const size = statSync(`${out}.mp4`).size;
console.log(
  `${out}.mp4  ${cursor.toFixed(1)} s  ${(size / 1024 / 1024).toFixed(2)} MB  ${list.shots.length} steps${only ? ` (re-recorded ${[...only].join(", ")})` : ""}`,
);
