import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { startBackend } from "../backend/backend.js";
import {
  connectNodeProfiler,
  type NodeProfiler,
} from "../backend/node-profiler.js";
import { collectorSource } from "../browser/collector-source.js";
import {
  readCollectorProgress,
  startCollector,
  stopCollector,
} from "../browser/collector.js";
import { launchBenchBrowser, type BenchPage } from "../browser/driver.js";
import { copyGolden, type Golden } from "../data/golden.js";
import {
  checkpointLatencies,
  diffPerformanceMetrics,
  selectCheckpoints,
  summarizeCpuProfile,
  summarizeFrames,
  summarizeLoafs,
  summarizeLongTasks,
  summarizeNetwork,
  type CheckpointLatencySummary,
  type CpuProfileSummary,
  type FrameSummary,
  type LoafSummary,
  type LongTaskSummary,
  type NetworkSummary,
  type PerformanceMetricsDelta,
} from "../metrics/compute.js";
import {
  parseEmissionLog,
  type EmissionLogEvent,
} from "../metrics/emission-log.js";
import { streamPrompt, type Scenario } from "../scenarios.js";

export type ProfileMode = "none" | "cpu" | "trace";

export interface IterationOptions {
  cpuThrottlingRate: number;
  experiment: {
    injectCss: string | null;
    injectJs: string | null;
    reducedMotion: boolean;
  };
  serverProfile: boolean;
  fixtureText: string;
  golden: Golden;
  iteration: number;
  iterationDir: string;
  log: (message: string) => void;
  profile: ProfileMode;
  repoRoot: string;
  scenario: Scenario;
}

export interface IterationMetrics {
  checkpoints: CheckpointLatencySummary;
  cpuProfile: CpuProfileSummary | null;
  serverCpuProfile: CpuProfileSummary | null;
  daemonCpuMs: number;
  domMutations: { addedNodes: number; removedNodes: number };
  domTextUpdates: number;
  geometry: { rowCount: number; scrollHeight: number; sha256: string };
  finalText: { length: number; sha256: string };
  frames: FrameSummary;
  longTasks: LongTaskSummary;
  loafs: LoafSummary;
  mainThread: PerformanceMetricsDelta;
  network: NetworkSummary;
  retainedHeapDeltaBytes: number;
  pinnedToBottom: {
    maxDistancePx: number | null;
    pinnedFraction: number | null;
    samples: number;
  };
  reactCommits: number;
  serverCpuMs: number;
  streamDurationMs: number;
  windowMs: number;
}

export interface IterationResult {
  iteration: number;
  metrics: IterationMetrics;
  scenario: string;
  threadId: string;
}

const MESSAGE_SELECTOR = "[data-message-column]";
const ROOT_SELECTOR = "main";
const LOAD_TIMEOUT_MS = 180_000;
const SETTLE_AFTER_COMPLETE_MS = 2_000;
const QUIET_WINDOW_MS = 2_000;

const COMPOSER_SELECTOR = '.ProseMirror[contenteditable="true"]';
const SCROLL_BODY_SELECTOR = ".thread-scrollbar";

async function sendViaComposer(page: BenchPage, text: string): Promise<void> {
  const point = await page.evaluate(
    `(() => { const el = document.querySelector(${JSON.stringify(COMPOSER_SELECTOR)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + Math.min(40, r.width / 2), y: r.top + Math.min(12, r.height / 2) }; })()`,
  );
  if (
    point === null ||
    typeof point !== "object" ||
    !("x" in point) ||
    !("y" in point) ||
    typeof point.x !== "number" ||
    typeof point.y !== "number"
  ) {
    throw new Error("Composer editor not found");
  }
  for (const type of ["mousePressed", "mouseReleased"]) {
    await page.send("Input.dispatchMouseEvent", {
      button: "left",
      clickCount: 1,
      type,
      x: point.x,
      y: point.y,
    });
  }
  await page.send("Input.insertText", { text });
  await page.send("Input.dispatchKeyEvent", {
    code: "Enter",
    key: "Enter",
    text: "\r",
    type: "keyDown",
    windowsVirtualKeyCode: 13,
  });
  await page.send("Input.dispatchKeyEvent", {
    code: "Enter",
    key: "Enter",
    type: "keyUp",
    windowsVirtualKeyCode: 13,
  });
}

async function readDistanceFromBottom(page: BenchPage): Promise<number | null> {
  const value = await page.evaluate(
    `(() => { const el = document.querySelector(${JSON.stringify(SCROLL_BODY_SELECTOR)}); return el ? el.scrollHeight - el.clientHeight - el.scrollTop : null; })()`,
  );
  return typeof value === "number" ? value : null;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForApiQuiet(
  page: BenchPage,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastCount = -1;
  let quietSince = Date.now();
  while (Date.now() < deadline) {
    const count = Number(
      await page.evaluate(
        "performance.getEntriesByType('resource').filter((entry) => entry.name.includes('/api/')).length",
      ),
    );
    if (count !== lastCount) {
      lastCount = count;
      quietSince = Date.now();
    } else if (Date.now() - quietSince >= QUIET_WINDOW_MS) {
      return;
    }
    await sleep(250);
  }
}

function geometrySummary(snapshot: string): IterationMetrics["geometry"] {
  const parsed: unknown = JSON.parse(snapshot);
  const rows =
    typeof parsed === "object" &&
    parsed !== null &&
    "rows" in parsed &&
    Array.isArray(parsed.rows)
      ? parsed.rows
      : [];
  const port =
    typeof parsed === "object" &&
    parsed !== null &&
    "port" in parsed &&
    Array.isArray(parsed.port)
      ? parsed.port
      : [];
  const scrollHeight = typeof port[2] === "number" ? port[2] : -1;
  const tables =
    typeof parsed === "object" &&
    parsed !== null &&
    "tables" in parsed &&
    Array.isArray(parsed.tables)
      ? parsed.tables
      : [];
  const sizes = rows.map((row: unknown) =>
    Array.isArray(row) ? row.slice(1) : row,
  );
  return {
    rowCount: rows.length,
    scrollHeight,
    sha256: createHash("sha256")
      .update(JSON.stringify({ port, sizes, tables }))
      .digest("hex"),
  };
}

function readEmission(path: string): EmissionLogEvent[] {
  if (!existsSync(path)) {
    return [];
  }
  const content = readFileSync(path, "utf8");
  const lastNewline = content.lastIndexOf("\n");
  return lastNewline === -1
    ? []
    : parseEmissionLog(content.slice(0, lastNewline + 1));
}

function expectedStreamMs(scenario: Scenario, docChars: number): number {
  return Math.ceil(docChars / scenario.chunkChars) * scenario.intervalMs;
}

export async function runIteration(
  options: IterationOptions,
): Promise<IterationResult> {
  const { golden, iterationDir, scenario } = options;
  const threadId = golden.manifest.threads[scenario.historyProfile];
  if (threadId === undefined) {
    throw new Error(
      `Golden data has no ${scenario.historyProfile} history thread`,
    );
  }
  rmSync(iterationDir, { force: true, recursive: true });
  mkdirSync(iterationDir, { recursive: true });
  const paths = copyGolden(golden, join(iterationDir, "data"));
  const emissionDir = join(iterationDir, "emission");
  mkdirSync(emissionDir, { recursive: true });
  const backend = await startBackend({
    daemonEnv: { BENCH_STREAM_LOG_DIR: emissionDir },
    logLevel: "warn",
    paths,
    repoRoot: options.repoRoot,
    serverNodeArgs: options.serverProfile ? ["--inspect=127.0.0.1:0"] : [],
  });
  let serverProfiler: NodeProfiler | null = null;
  const browser = await launchBenchBrowser({
    userDataDir: join(iterationDir, "chrome"),
  }).catch(async (error: unknown) => {
    await backend.stop();
    throw error;
  });
  try {
    const page = browser.page;
    await page.setViewport(1440, 900);
    await page.addInitScript(collectorSource);
    if (options.experiment.injectCss !== null) {
      await page.addInitScript(
        `document.addEventListener("DOMContentLoaded", () => { const style = document.createElement("style"); style.dataset.benchExperiment = ""; style.textContent = ${JSON.stringify(options.experiment.injectCss)}; document.head.appendChild(style); });`,
      );
    }
    if (options.experiment.injectJs !== null) {
      await page.addInitScript(options.experiment.injectJs);
    }
    if (options.experiment.reducedMotion) {
      await page.send("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-reduced-motion", value: "reduce" }],
      });
    }
    const url = `${backend.serverUrl}/projects/${golden.manifest.projectId}/threads/${threadId}`;
    await page.navigate(url, { timeoutMs: LOAD_TIMEOUT_MS });
    await page.waitForFunction(
      `document.querySelectorAll(${JSON.stringify(MESSAGE_SELECTOR)}).length > 0`,
      { pollMs: 250, timeoutMs: LOAD_TIMEOUT_MS },
    );
    await waitForApiQuiet(page, 60_000);
    if (options.cpuThrottlingRate > 1) {
      await page.setCpuThrottlingRate(options.cpuThrottlingRate);
    }
    const checkpoints = selectCheckpoints(options.fixtureText);
    await page.collectGarbage();
    const perfBefore = await page.performanceMetrics();
    const cpuBefore = backend.cpuMs();
    await page.startNetworkCapture();
    await startCollector(page, {
      checkpoints,
      messageSelector: MESSAGE_SELECTOR,
      rootSelector: ROOT_SELECTOR,
    });
    if (options.profile === "cpu") {
      await page.startCpuProfile({ samplingIntervalUs: 200 });
    }
    if (options.serverProfile) {
      serverProfiler = await connectNodeProfiler(backend.serverStdioLogPath);
      await serverProfiler.start();
    }
    if (options.profile === "trace") {
      await page.startTrace([
        "devtools.timeline",
        "disabled-by-default-devtools.timeline",
        "disabled-by-default-devtools.timeline.frame",
        "blink.user_timing",
        "v8.execute",
        "disabled-by-default-v8.cpu_profiler",
        "disabled-by-default-devtools.timeline.stack",
        "disabled-by-default-devtools.timeline.invalidationTracking",
      ]);
    }
    const windowStart = Date.now();
    await sendViaComposer(page, streamPrompt(scenario));
    const emissionPath = join(emissionDir, `${threadId}.jsonl`);
    const distancesFromBottom: number[] = [];
    const streamBudgetMs =
      expectedStreamMs(scenario, options.fixtureText.length) * 4 + 120_000;
    const streamDeadline = Date.now() + streamBudgetMs;
    let lastProgressLog = 0;
    while (Date.now() < streamDeadline) {
      const events = readEmission(emissionPath);
      if (events.some((event) => event.event === "complete")) {
        break;
      }
      if (events.some((event) => event.event === "start")) {
        const distance = await readDistanceFromBottom(page);
        if (distance !== null) {
          distancesFromBottom.push(distance);
        }
      } else if (Date.now() - windowStart > 60_000) {
        throw new Error("Composer send did not start a stream within 60 s");
      }
      if (Date.now() - lastProgressLog > 10_000) {
        const progress = await readCollectorProgress(page);
        options.log(
          `  streaming: dom ${progress.textLength} chars, checkpoints ${progress.checkpointHits}/${progress.checkpoints}`,
        );
        lastProgressLog = Date.now();
      }
      await sleep(500);
    }
    const emission = readEmission(emissionPath);
    if (!emission.some((event) => event.event === "complete")) {
      throw new Error(
        `Stream did not complete within ${streamBudgetMs} ms (${emissionPath})`,
      );
    }
    await backend.api.waitForThreadStatus(threadId, "idle", 120_000);
    const hitDeadline = Date.now() + 30_000;
    while (Date.now() < hitDeadline) {
      const progress = await readCollectorProgress(page);
      if (progress.checkpointHits >= progress.checkpoints) {
        break;
      }
      await sleep(200);
    }
    await sleep(SETTLE_AFTER_COMPLETE_MS);
    const cpuProfile =
      options.profile === "cpu" ? await page.stopCpuProfile() : null;
    const serverCpuProfile =
      serverProfiler === null ? null : await serverProfiler.stop();
    if (serverCpuProfile !== null) {
      writeFileSync(
        join(iterationDir, "server.cpuprofile"),
        JSON.stringify(serverCpuProfile),
      );
    }
    if (options.profile === "trace") {
      await page.stopTrace(join(iterationDir, "trace.json"));
    }
    const collected = await stopCollector(page);
    const capture = page.stopNetworkCapture();
    const perfAfter = await page.performanceMetrics();
    await page.collectGarbage();
    const heapAfterGc = (await page.performanceMetrics()).JSHeapUsedSize ?? 0;
    const cpuAfter = backend.cpuMs();
    const windowEnd = Date.now();
    if (options.cpuThrottlingRate > 1) {
      await page.setCpuThrottlingRate(1);
    }
    const finalText = String(
      await page.evaluate(
        `(() => { const nodes = document.querySelectorAll(${JSON.stringify(MESSAGE_SELECTOR)}); return nodes[nodes.length - 1]?.textContent ?? ""; })()`,
      ),
    );
    const geometrySnapshot = String(
      await page.evaluate(
        `(() => { const port = document.querySelector(${JSON.stringify(SCROLL_BODY_SELECTOR)}); const rows = [...document.querySelectorAll('[data-timeline-row-list="top-level"] > [data-timeline-row-id]')]; const tables = [...document.querySelectorAll('[data-markdown-preview] table')]; return JSON.stringify({ port: port ? [port.clientWidth, port.clientHeight, port.scrollHeight] : null, rows: rows.map((row) => [row.getAttribute('data-timeline-row-id'), Math.round(row.getBoundingClientRect().width), Math.round(row.getBoundingClientRect().height)]), tables: tables.map((table) => { const box = table.parentElement?.parentElement?.getBoundingClientRect(); return box ? [Math.round(box.width), Math.round(box.left)] : null; }) }); })()`,
      ),
    );
    writeFileSync(join(iterationDir, "geometry.json"), geometrySnapshot);
    await page.screenshot(join(iterationDir, "final.png"));
    if (cpuProfile !== null) {
      writeFileSync(
        join(iterationDir, "renderer.cpuprofile"),
        JSON.stringify(cpuProfile),
      );
    }
    writeFileSync(
      join(iterationDir, "collector.json"),
      JSON.stringify({ capture, collected }, null, 1),
    );
    const startEvent = emission.find((event) => event.event === "start");
    const completeEvent = emission.find((event) => event.event === "complete");
    const metrics: IterationMetrics = {
      checkpoints: checkpointLatencies({
        checkpoints,
        emissionLog: emission,
        fixtureText: options.fixtureText,
        gate: "newline",
        hits: collected.checkpointHits,
      }),
      cpuProfile:
        cpuProfile === null
          ? null
          : summarizeCpuProfile(cpuProfile, { top: 40 }),
      daemonCpuMs: cpuAfter.daemon - cpuBefore.daemon,
      serverCpuProfile:
        serverCpuProfile === null
          ? null
          : summarizeCpuProfile(serverCpuProfile, { top: 60 }),
      domMutations: {
        addedNodes: collected.addedNodes,
        removedNodes: collected.removedNodes,
      },
      domTextUpdates: collected.samples.length,
      geometry: geometrySummary(geometrySnapshot),
      finalText: {
        length: finalText.length,
        sha256: createHash("sha256").update(finalText).digest("hex"),
      },
      frames: summarizeFrames(collected.frames),
      longTasks: summarizeLongTasks(collected.longTasks),
      loafs: summarizeLoafs(collected.loafs, { top: 15 }),
      mainThread: diffPerformanceMetrics(perfBefore, perfAfter),
      network: summarizeNetwork(capture, threadId),
      pinnedToBottom: {
        maxDistancePx:
          distancesFromBottom.length === 0
            ? null
            : Math.max(...distancesFromBottom),
        pinnedFraction:
          distancesFromBottom.length === 0
            ? null
            : distancesFromBottom.filter((distance) => distance <= 4).length /
              distancesFromBottom.length,
        samples: distancesFromBottom.length,
      },
      reactCommits: collected.commits,
      retainedHeapDeltaBytes: heapAfterGc - (perfBefore.JSHeapUsedSize ?? 0),
      serverCpuMs: cpuAfter.server - cpuBefore.server,
      streamDurationMs:
        startEvent !== undefined && completeEvent !== undefined
          ? completeEvent.t - startEvent.t
          : 0,
      windowMs: windowEnd - windowStart,
    };
    return {
      iteration: options.iteration,
      metrics,
      scenario: scenario.name,
      threadId,
    };
  } finally {
    serverProfiler?.close();
    await browser.close();
    await backend.stop();
    rmSync(join(iterationDir, "data"), { force: true, recursive: true });
    rmSync(join(iterationDir, "chrome"), { force: true, recursive: true });
  }
}
