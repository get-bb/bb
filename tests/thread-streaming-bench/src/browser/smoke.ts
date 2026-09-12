import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Duplex } from "node:stream";
import { promisify } from "node:util";
import { z } from "zod";
import {
  checkpointLatencies,
  diffPerformanceMetrics,
  selectCheckpoints,
  summarizeCpuProfile,
  summarizeFrames,
  summarizeLoafs,
  summarizeLongTasks,
  summarizeNetwork,
} from "../metrics/compute.js";
import { emissionLogEventSchema } from "../metrics/emission-log.js";
import { startCollector, stopCollector } from "./collector.js";
import { collectorSource } from "./collector-source.js";
import { CdpSessionError } from "./cdp.js";
import {
  CHROME_LAUNCH_ENV,
  launchBenchBrowser,
  PageEvaluationError,
} from "./driver.js";

const execFileAsync = promisify(execFile);
const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const WEBSOCKET_FRAME_COUNT = 12;
const STREAM_CHUNK_CHARS = 48;
const STREAM_INTERVAL_MS = 16;
const BUSY_TASK_MS = 120;
const SMOKE_THREAD_ID = "thr_smoke23456";
const LEFTOVER_POLL_TIMEOUT_MS = 10_000;

type Check = { name: string; ok: boolean; detail: string };

function buildSmokeDocument(): string {
  const topics = [
    "timeline cache",
    "delta assembler",
    "notification hub",
    "markdown renderer",
    "scroll anchor",
    "row virtualizer",
  ];
  const blocks = ["# Smoke streaming document"];
  for (let index = 0; index < 36; index += 1) {
    const topic = topics[index % topics.length] ?? "renderer";
    blocks.push(
      `Paragraph ${index + 1} walks through the ${topic} and explains why streaming chunk ${index + 1} stays cheap to render.`,
    );
    if (index % 9 === 4) {
      blocks.push(
        '```ts\nconst skipped = "code fences never produce checkpoints";\n```',
      );
    }
    if (index % 9 === 7) {
      blocks.push("| column | value |\n| --- | --- |\n| rows | skipped |");
    }
  }
  return blocks.join("\n\n");
}

function buildPage(document: string): string {
  const source = JSON.stringify(document).replaceAll("<", "\\u003c");
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>thread streaming bench smoke</title>
<style>body { font: 14px/1.5 system-ui, sans-serif; margin: 24px; } .message { white-space: pre-wrap; }</style>
</head>
<body>
<div id="root"><div class="message"></div></div>
<script>
window.__smokeCollectorPresentAtParse = typeof window.__bbStreamBench === "object";
window.__smokeEmissions = [];
window.__smokeStream = (options) => new Promise((resolve, reject) => {
  const source = ${source};
  const message = document.querySelector(".message");
  const socket = new WebSocket("ws://" + location.host + "/api/v1/ws");
  let emitted = 0;
  let rendered = 0;
  let busyDone = false;
  fetch("/api/v1/ping").then((response) => response.json()).then((body) => {
    window.__smokeEmissions.push({ event: "start", t: Date.now(), doc: "smoke", docChars: source.length, chunk: options.chunk, interval: options.interval });
    const tick = () => {
      emitted = Math.min(source.length, emitted + options.chunk);
      window.__smokeEmissions.push({ event: "delta", t: Date.now(), chars: emitted });
      if (!busyDone && emitted >= source.length / 2) {
        busyDone = true;
        const until = performance.now() + options.busyMs;
        while (performance.now() < until) {
          Math.sqrt(Math.random());
        }
      }
      if (emitted < source.length) {
        setTimeout(tick, options.interval);
      }
    };
    const render = () => {
      if (rendered !== emitted) {
        message.textContent = source.slice(0, emitted);
        rendered = emitted;
      }
      if (rendered < source.length) {
        requestAnimationFrame(render);
        return;
      }
      window.__smokeEmissions.push({ event: "complete", t: Date.now() });
      socket.close();
      resolve({ ping: body, visibilityState: document.visibilityState });
    };
    setTimeout(tick, options.interval);
    requestAnimationFrame(render);
  }, reject);
});
</script>
</body>
</html>`;
}

function encodeTextFrame(text: string): Buffer {
  const payload = Buffer.from(text, "utf8");
  if (payload.length >= 126) {
    throw new Error("smoke WebSocket frames must be shorter than 126 bytes");
  }
  return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
}

async function startSmokeServer(html: string) {
  const upgradedSockets = new Set<Duplex>();
  const timers = new Set<NodeJS.Timeout>();
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/") {
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": "text/html; charset=utf-8",
      });
      response.end(html);
      return;
    }
    if (url.pathname === "/api/v1/ping") {
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": "application/json",
      });
      response.end(
        JSON.stringify({ ok: true, t: Date.now(), padding: "x".repeat(512) }),
      );
      return;
    }
    if (url.pathname === "/hang") {
      return;
    }
    response.writeHead(404);
    response.end();
  });
  server.on("upgrade", (request, socket) => {
    const key = request.headers["sec-websocket-key"];
    if (request.url !== "/api/v1/ws" || typeof key !== "string") {
      socket.destroy();
      return;
    }
    const accept = createHash("sha1")
      .update(key + WEBSOCKET_GUID)
      .digest("base64");
    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${accept}`,
        "",
        "",
      ].join("\r\n"),
    );
    upgradedSockets.add(socket);
    socket.resume();
    let sent = 0;
    const timer = setInterval(() => {
      if (sent >= WEBSOCKET_FRAME_COUNT || socket.destroyed) {
        clearInterval(timer);
        timers.delete(timer);
        return;
      }
      sent += 1;
      socket.write(
        encodeTextFrame(
          JSON.stringify({ type: "tick", n: sent, note: "héllo" }),
        ),
      );
    }, 20);
    timers.add(timer);
    socket.on("close", () => {
      clearInterval(timer);
      timers.delete(timer);
      upgradedSockets.delete(socket);
    });
    socket.on("error", () => socket.destroy());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("smoke server did not bind a TCP port");
  }
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: async () => {
      for (const timer of timers) {
        clearInterval(timer);
      }
      for (const socket of upgradedSockets) {
        socket.destroy();
      }
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) =>
          error === undefined ? resolve() : reject(error),
        ),
      );
    },
  };
}

async function listProcesses(): Promise<
  { pid: number; pgid: number; args: string }[]
> {
  const { stdout } = await execFileAsync("ps", ["-eo", "pid=,pgid=,args="], {
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (
      match?.[1] === undefined ||
      match[2] === undefined ||
      match[3] === undefined
    ) {
      return [];
    }
    return [{ pid: Number(match[1]), pgid: Number(match[2]), args: match[3] }];
  });
}

type ProcessEntry = { pid: number; pgid: number; args: string };

async function hasLaunchMarker(pid: number, marker: string): Promise<boolean> {
  try {
    const environ = await readFile(`/proc/${pid}/environ`, "utf8");
    return environ.split("\0").includes(marker);
  } catch {
    return false;
  }
}

async function listLaunchProcesses(launch: {
  pid: number;
  launchId: string;
  userDataDir: string;
}): Promise<{ all: ProcessEntry[]; outsideGroup: ProcessEntry[] }> {
  const marker = `${CHROME_LAUNCH_ENV}=${launch.launchId}`;
  const all: ProcessEntry[] = [];
  for (const entry of await listProcesses()) {
    if (
      entry.pgid === launch.pid ||
      entry.args.includes(launch.userDataDir) ||
      (await hasLaunchMarker(entry.pid, marker))
    ) {
      all.push(entry);
    }
  }
  return {
    all,
    outsideGroup: all.filter((entry) => entry.pgid !== launch.pid),
  };
}

async function waitForLaunchProcessesToExit(launch: {
  pid: number;
  launchId: string;
  userDataDir: string;
}): Promise<{ leftovers: ProcessEntry[]; waitedMs: number }> {
  const startedAt = Date.now();
  for (;;) {
    const { all } = await listLaunchProcesses(launch);
    const waitedMs = Date.now() - startedAt;
    if (all.length === 0 || waitedMs >= LEFTOVER_POLL_TIMEOUT_MS) {
      return { leftovers: all, waitedMs };
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

async function reserveClosedPort(): Promise<number> {
  const probe = createNetServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const address = probe.address();
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  if (address === null || typeof address === "string") {
    throw new Error("port probe did not bind a TCP port");
  }
  return address.port;
}

function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

const smokeStreamResultSchema = z.object({
  ping: z.object({ ok: z.literal(true) }),
  visibilityState: z.string(),
});

async function main(): Promise<void> {
  const keepArtifacts = process.argv.includes("--keep");
  const workDir = await mkdtemp(
    join(tmpdir(), "thread-streaming-bench-smoke-"),
  );
  const userDataDir = join(workDir, "chrome-profile");
  const document = buildSmokeDocument();
  const checkpoints = selectCheckpoints(document);
  const server = await startSmokeServer(buildPage(document));
  const checks: Check[] = [];
  const check = (name: string, ok: boolean, detail: unknown) => {
    checks.push({
      name,
      ok,
      detail: typeof detail === "string" ? detail : JSON.stringify(detail),
    });
  };

  let launch: { pid: number; launchId: string; userDataDir: string } | null =
    null;
  let summary: Record<string, unknown> = {};
  try {
    const launchStartedAt = Date.now();
    const browser = await launchBenchBrowser({ userDataDir });
    const launchMs = Date.now() - launchStartedAt;
    const pid = browser.pid;
    launch = { pid, launchId: browser.launchId, userDataDir };
    try {
      const version = await browser.version();
      const running = await listProcesses();
      const groupMembers = running.filter((entry) => entry.pgid === pid);
      const profileProcesses = running.filter((entry) =>
        entry.args.includes(userDataDir),
      );
      const launchProcesses = await listLaunchProcesses(launch);
      check(
        "chrome launched headless with a process group",
        groupMembers.length >= 2 &&
          groupMembers.every((member) =>
            launchProcesses.all.some((entry) => entry.pid === member.pid),
          ),
        {
          pid,
          groupMembers: groupMembers.length,
          profileProcesses: profileProcesses.length,
          launchProcesses: launchProcesses.all.length,
          outsideGroup: launchProcesses.outsideGroup.map((entry) => ({
            pid: entry.pid,
            pgid: entry.pgid,
            command: entry.args.split(" ")[0],
          })),
          sandboxDisabled: browser.sandboxDisabled,
        },
      );

      const page = browser.page;
      await page.setViewport(1440, 900);
      await page.setCpuThrottlingRate(1);
      await page.addInitScript(collectorSource);
      await page.navigate(server.url, { timeoutMs: 15_000 });
      const presentAtParse = await page.evaluate<unknown>(
        "window.__smokeCollectorPresentAtParse",
      );
      check(
        "init script installed before page scripts",
        presentAtParse === true,
        { presentAtParse },
      );

      await page.collectGarbage();
      const metricsBefore = await page.performanceMetrics();
      await page.startNetworkCapture();
      await page.startCpuProfile({ samplingIntervalUs: 200 });
      await page.startTrace(["devtools.timeline", "blink.user_timing"]);
      await startCollector(page, {
        messageSelector: ".message",
        rootSelector: "#root",
        checkpoints,
      });
      const streamDone = page.evaluate<unknown>(
        `window.__smokeStream(${JSON.stringify({ chunk: STREAM_CHUNK_CHARS, interval: STREAM_INTERVAL_MS, busyMs: BUSY_TASK_MS })})`,
        { awaitPromise: true },
      );
      streamDone.catch(() => undefined);
      await page.waitForFunction(
        `window.__bbStreamBench.progress().checkpointHits === ${checkpoints.length}`,
        { timeoutMs: 30_000, pollMs: 100 },
      );
      const streamResult = smokeStreamResultSchema.parse(await streamDone);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const collected = await stopCollector(page);
      const profile = await page.stopCpuProfile();
      const tracePath = join(workDir, "trace.json");
      const trace = await page.stopTrace(tracePath);
      const capture = page.stopNetworkCapture();
      const metricsAfter = await page.performanceMetrics();
      const screenshotPath = join(workDir, "smoke.png");
      await page.screenshot(screenshotPath);
      const screenshotBytes = (await stat(screenshotPath)).size;

      const evaluationError = await rejectionOf(
        page.evaluate("(() => { throw new Error('smoke boom'); })()"),
      );
      check(
        "evaluate surfaces page exceptions",
        evaluationError instanceof PageEvaluationError &&
          evaluationError.message.includes("smoke boom"),
        String(evaluationError),
      );
      const failFastStartedAt = Date.now();
      const failFastError = await rejectionOf(
        page.waitForFunction("window.__smokeMissing.value", {
          timeoutMs: 10_000,
        }),
      );
      check(
        "waitForFunction fails fast on page exceptions",
        failFastError instanceof PageEvaluationError &&
          Date.now() - failFastStartedAt < 2_000,
        String(failFastError),
      );
      const timeoutError = await rejectionOf(
        page.waitForFunction("false", { timeoutMs: 300, pollMs: 50 }),
      );
      check(
        "waitForFunction times out",
        timeoutError instanceof Error &&
          timeoutError.message.includes("Timed out after 300 ms"),
        String(timeoutError),
      );
      const secondPage = await browser.newPage();
      const refusedPort = await reserveClosedPort();
      const navigationError = await rejectionOf(
        secondPage.navigate(`http://127.0.0.1:${refusedPort}/`, {
          timeoutMs: 10_000,
        }),
      );
      check(
        "navigate rejects failed navigations on a second page",
        navigationError instanceof Error &&
          navigationError.message.includes("net::ERR_"),
        String(navigationError),
      );
      const hangStartedAt = Date.now();
      const hangError = await rejectionOf(
        secondPage.navigate(`${server.url}hang`, { timeoutMs: 1_000 }),
      );
      const hangMs = Date.now() - hangStartedAt;
      check(
        "navigate enforces its timeout when the server never responds",
        hangError instanceof Error &&
          hangError.message.includes("Timed out after 1000 ms navigating") &&
          hangMs < 3_000,
        { hangMs, error: String(hangError) },
      );
      await secondPage.navigate(server.url, { timeoutMs: 10_000 });
      const neverStartedAt = Date.now();
      const neverError = await rejectionOf(
        secondPage.waitForFunction("new Promise(() => {})", {
          timeoutMs: 500,
        }),
      );
      const neverMs = Date.now() - neverStartedAt;
      const afterNever = await secondPage.evaluate<unknown>("1 + 1");
      check(
        "waitForFunction enforces its timeout on a never-settling promise",
        neverError instanceof Error &&
          neverError.message.includes("Timed out after 500 ms") &&
          neverMs < 2_000 &&
          afterNever === 2,
        { neverMs, afterNever, error: String(neverError) },
      );
      const unserializable = [
        await secondPage.evaluate<unknown>("NaN"),
        await secondPage.evaluate<unknown>("-0"),
        await secondPage.evaluate<unknown>("-Infinity"),
        await secondPage.evaluate<unknown>("10n"),
      ];
      check(
        "evaluate maps unserializable primitives",
        Number.isNaN(unserializable[0]) &&
          Object.is(unserializable[1], -0) &&
          unserializable[2] === Number.NEGATIVE_INFINITY &&
          unserializable[3] === 10n,
        String(unserializable),
      );
      const pendingAtCrash = rejectionOf(
        secondPage.evaluate("new Promise(() => {})", { awaitPromise: true }),
      );
      const crashSend = rejectionOf(secondPage.send("Page.crash"));
      const crashStartedAt = Date.now();
      const crashError = await pendingAtCrash;
      const crashMs = Date.now() - crashStartedAt;
      const afterCrashError = await rejectionOf(secondPage.evaluate("1"));
      check(
        "a renderer crash rejects pending and later page commands",
        crashError instanceof CdpSessionError &&
          afterCrashError instanceof CdpSessionError &&
          (await crashSend) instanceof CdpSessionError &&
          crashMs < 5_000,
        {
          crashMs,
          pending: String(crashError),
          after: String(afterCrashError),
        },
      );
      await secondPage.close();
      const emissions = z
        .array(emissionLogEventSchema)
        .parse(await page.evaluate<unknown>("window.__smokeEmissions"));

      const frames = summarizeFrames(collected.frames);
      const loafs = summarizeLoafs(collected.loafs, { top: 3 });
      const longTasks = summarizeLongTasks(collected.longTasks);
      const performanceDelta = diffPerformanceMetrics(
        metricsBefore,
        metricsAfter,
      );
      const latency = checkpointLatencies({
        fixtureText: document,
        checkpoints,
        emissionLog: emissions,
        hits: collected.checkpointHits,
      });
      const network = summarizeNetwork(capture, SMOKE_THREAD_ID);
      const cpu = summarizeCpuProfile(profile, { top: 3 });
      const pingRequests = capture.requests.filter((request) =>
        request.url.endsWith("/api/v1/ping"),
      );

      check("frames recorded", frames.count > 30, frames);
      check(
        "no React commits on a non-React page",
        collected.commits === 0 && collected.reactHookInstalled,
        {
          commits: collected.commits,
          reactHookInstalled: collected.reactHookInstalled,
        },
      );
      check(
        "every checkpoint hit",
        checkpoints.length >= 20 &&
          collected.checkpointHits.length === checkpoints.length,
        {
          checkpoints: checkpoints.length,
          hits: collected.checkpointHits.length,
        },
      );
      check(
        "latency join produced non-negative latencies",
        latency.hitCount === checkpoints.length &&
          latency.checkpoints.every(
            (row) => row.latencyMs !== null && row.latencyMs >= 0,
          ),
        {
          p50: latency.p50LatencyMs,
          p95: latency.p95LatencyMs,
          max: latency.maxLatencyMs,
        },
      );
      check(
        "busy task surfaced as latency, long task and LoAF",
        (latency.maxLatencyMs ?? 0) >= BUSY_TASK_MS * 0.8 &&
          longTasks.count >= 1 &&
          loafs.count >= 1,
        {
          maxLatencyMs: latency.maxLatencyMs,
          longTasks,
          loafCount: loafs.count,
          topScripts: loafs.topScripts,
        },
      );
      check(
        "performance metric deltas",
        performanceDelta.taskDurationMs > 0 &&
          performanceDelta.scriptDurationMs > 0 &&
          performanceDelta.layoutCount > 0 &&
          performanceDelta.recalcStyleCount > 0,
        performanceDelta,
      );
      check(
        "network capture of /api/v1/ping",
        pingRequests.length === 1 &&
          pingRequests[0]?.status === 200 &&
          (pingRequests[0]?.encodedDataLength ?? 0) > 0 &&
          pingRequests[0]?.durationMs !== null,
        pingRequests,
      );
      check(
        "WebSocket frames captured by CDP and the collector",
        capture.webSocketFramesReceived === WEBSOCKET_FRAME_COUNT &&
          collected.wsMessages === WEBSOCKET_FRAME_COUNT &&
          capture.webSocketBytesReceived === collected.wsBytes,
        {
          cdpFrames: capture.webSocketFramesReceived,
          cdpBytes: capture.webSocketBytesReceived,
          collectorMessages: collected.wsMessages,
          collectorBytes: collected.wsBytes,
        },
      );
      check(
        "collector resource observer saw /api/ fetch",
        collected.resources.length >= 1,
        collected.resources,
      );
      check(
        "CPU profile captured",
        profile.nodes.length > 1 && cpu.sampleCount > 0,
        {
          nodes: profile.nodes.length,
          durationMs: cpu.durationMs,
          samples: cpu.sampleCount,
          top: cpu.top,
        },
      );
      check("trace written", trace.bytes > 1000, trace);
      check("screenshot written", screenshotBytes > 1000, { screenshotBytes });
      check(
        "page stayed visible",
        streamResult.visibilityState === "visible",
        streamResult,
      );

      summary = {
        chrome: version.product,
        launchMs,
        processes: {
          pid,
          groupMembers: groupMembers.length,
          profileProcesses: profileProcesses.length,
          launchProcesses: launchProcesses.all.length,
          outsideGroup: launchProcesses.outsideGroup.length,
          sandboxDisabled: browser.sandboxDisabled,
        },
        checkpoints: checkpoints.length,
        frames,
        commits: collected.commits,
        textSamples: collected.samples.length,
        latency: {
          hitCount: latency.hitCount,
          p50LatencyMs: latency.p50LatencyMs,
          p95LatencyMs: latency.p95LatencyMs,
          maxLatencyMs: latency.maxLatencyMs,
        },
        longTasks,
        loafs,
        performanceDelta,
        network,
        cpu,
        trace,
        artifacts: keepArtifacts
          ? { workDir, tracePath, screenshotPath }
          : "removed (pass --keep to retain)",
      };
    } finally {
      await browser.close();
    }
  } finally {
    await server.close();
  }

  if (launch !== null) {
    const { leftovers, waitedMs } = await waitForLaunchProcessesToExit(launch);
    check(
      "no leftover chrome processes after close, including helpers outside the group",
      leftovers.length === 0,
      { waitedMs, leftovers },
    );
    summary.leftoverWaitMs = waitedMs;
  }
  if (!keepArtifacts) {
    await rm(workDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
  }

  console.log(JSON.stringify(summary, null, 2));
  for (const entry of checks) {
    console.log(
      `${entry.ok ? "PASS" : "FAIL"} ${entry.name}${entry.ok ? "" : `: ${entry.detail}`}`,
    );
  }
  if (checks.some((entry) => !entry.ok)) {
    process.exitCode = 1;
  }
}

await main();
