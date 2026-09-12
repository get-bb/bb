import { spawn, type ChildProcess } from "node:child_process";
import { constants, existsSync, readFileSync } from "node:fs";
import { access, mkdir, open, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { waitUntil } from "../backend/api.js";
import { stopProcessGroup } from "../backend/processes.js";
import { CdpConnection, type CdpEventHandler } from "./cdp.js";

const DEFAULT_CHROME_PATH = join(
  homedir(),
  ".cache",
  "ms-playwright",
  "chromium-1228",
  "chrome-linux64",
  "chrome",
);

const CHROME_ARGS = [
  "--headless=new",
  "--remote-debugging-port=0",
  "--no-first-run",
  "--no-default-browser-check",
  "--no-sandbox",
  "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding",
  "--disable-backgrounding-occluded-windows",
  "--disable-extensions",
  "--window-size=1440,900",
];

const STDERR_TAIL_LIMIT = 64 * 1024;
const DEVTOOLS_PORT_TIMEOUT_MS = 30_000;
const SHUTDOWN_STEP_TIMEOUT_MS = 5_000;
const API_REQUEST_MARKER = "/api/v1/";

export type NetworkRequestRecord = {
  requestId: string;
  url: string;
  method: string;
  resourceType: string | null;
  startedAtEpochMs: number;
  outcome: "pending" | "finished" | "failed";
  status: number | null;
  encodedDataLength: number | null;
  durationMs: number | null;
  errorText: string | null;
};

export type NetworkCapture = {
  startedAtEpochMs: number;
  stoppedAtEpochMs: number;
  requests: NetworkRequestRecord[];
  webSocketFramesReceived: number;
  webSocketBytesReceived: number;
};

const cpuProfileSchema = z.looseObject({
  nodes: z.array(
    z.looseObject({
      id: z.number(),
      callFrame: z.looseObject({
        functionName: z.string(),
        url: z.string(),
        lineNumber: z.number(),
        columnNumber: z.number(),
      }),
    }),
  ),
  startTime: z.number(),
  endTime: z.number(),
  samples: z.array(z.number()),
  timeDeltas: z.array(z.number()),
});

export type CpuProfile = z.infer<typeof cpuProfileSchema>;

export const profilerStopResponseSchema = z.object({
  profile: cpuProfileSchema,
});

const createTargetResponseSchema = z.object({ targetId: z.string() });
const attachToTargetResponseSchema = z.object({ sessionId: z.string() });
const getTargetsResponseSchema = z.object({
  targetInfos: z.array(z.object({ targetId: z.string(), type: z.string() })),
});
const browserVersionSchema = z.object({ product: z.string() });
const evaluateResponseSchema = z.object({
  result: z.object({ value: z.unknown().optional() }),
  exceptionDetails: z
    .object({
      text: z.string(),
      lineNumber: z.number(),
      columnNumber: z.number(),
      exception: z.object({ description: z.string().optional() }).optional(),
    })
    .optional(),
});
const performanceMetricsResponseSchema = z.object({
  metrics: z.array(z.object({ name: z.string(), value: z.number() })),
});
const tracingCompleteSchema = z.object({ stream: z.string() });
const ioReadResponseSchema = z.object({
  data: z.string(),
  eof: z.boolean(),
  base64Encoded: z.boolean().optional(),
});
const screenshotResponseSchema = z.object({ data: z.string() });

const requestWillBeSentSchema = z.object({
  requestId: z.string(),
  timestamp: z.number(),
  wallTime: z.number(),
  type: z.string().optional(),
  request: z.object({ url: z.string(), method: z.string() }),
});
const responseReceivedSchema = z.object({
  requestId: z.string(),
  response: z.object({ status: z.number() }),
});
const loadingFinishedSchema = z.object({
  requestId: z.string(),
  timestamp: z.number(),
  encodedDataLength: z.number(),
});
const loadingFailedSchema = z.object({
  requestId: z.string(),
  timestamp: z.number(),
  errorText: z.string(),
});
const webSocketFrameReceivedSchema = z.object({
  response: z.object({ opcode: z.number(), payloadData: z.string() }),
});

async function resolveChromePath(
  explicit: string | undefined,
): Promise<string> {
  const candidate =
    explicit ?? (process.env.CHROME_PATH || DEFAULT_CHROME_PATH);
  try {
    await access(candidate, constants.X_OK);
  } catch {
    throw new Error(
      `Chrome binary is missing or not executable: ${candidate}. Pass chromePath or set CHROME_PATH (default ${DEFAULT_CHROME_PATH}).`,
    );
  }
  return candidate;
}

function readDevToolsEndpoint(
  userDataDir: string,
  child: ChildProcess,
  stderrTail: () => string,
): Promise<string> {
  const portFile = join(userDataDir, "DevToolsActivePort");
  return waitUntil(
    async () => {
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(
          `Chrome exited before DevTools was ready (code ${child.exitCode}, signal ${child.signalCode}). stderr tail:\n${stderrTail()}`,
        );
      }
      if (!existsSync(portFile)) {
        return null;
      }
      const [port, path] = readFileSync(portFile, "utf8").split("\n");
      return port !== undefined &&
        /^\d+$/.test(port) &&
        path?.startsWith("/devtools/browser/") === true
        ? `ws://127.0.0.1:${port}${path}`
        : null;
    },
    `Chrome to write ${portFile}`,
    DEVTOOLS_PORT_TIMEOUT_MS,
    50,
  );
}

async function stopChrome(child: ChildProcess): Promise<void> {
  await stopProcessGroup(child.pid, SHUTDOWN_STEP_TIMEOUT_MS);
  child.stderr?.destroy();
}

export async function launchBenchBrowser(options: {
  chromePath?: string;
  userDataDir: string;
}): Promise<BenchBrowser> {
  const chromePath = await resolveChromePath(options.chromePath);
  await mkdir(options.userDataDir, { recursive: true });
  await rm(join(options.userDataDir, "DevToolsActivePort"), { force: true });
  const child = spawn(
    chromePath,
    [...CHROME_ARGS, `--user-data-dir=${options.userDataDir}`, "about:blank"],
    { detached: true, stdio: ["ignore", "ignore", "pipe"] },
  );
  let stderrTail = "";
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL_LIMIT);
  });
  child.once("error", (error) => {
    stderrTail += `\nspawn error: ${error.message}`;
  });
  if (child.pid === undefined) {
    throw new Error(`Failed to spawn Chrome at ${chromePath}`);
  }
  try {
    const connection = await CdpConnection.connect(
      await readDevToolsEndpoint(options.userDataDir, child, () => stderrTail),
    );
    const { targetId } = createTargetResponseSchema.parse(
      await connection.send("Target.createTarget", { url: "about:blank" }),
    );
    const { sessionId } = attachToTargetResponseSchema.parse(
      await connection.send("Target.attachToTarget", {
        targetId,
        flatten: true,
      }),
    );
    const page = new BenchPage(connection, sessionId);
    await page.send("Page.enable");
    await page.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    await page.send("Page.bringToFront");
    const { targetInfos } = getTargetsResponseSchema.parse(
      await connection.send("Target.getTargets"),
    );
    for (const target of targetInfos) {
      if (target.type === "page" && target.targetId !== targetId) {
        await connection.send("Target.closeTarget", {
          targetId: target.targetId,
        });
      }
    }
    return new BenchBrowser(child, connection, page);
  } catch (error) {
    await stopChrome(child);
    throw error;
  }
}

export class BenchBrowser {
  readonly page: BenchPage;
  private readonly child: ChildProcess;
  private readonly connection: CdpConnection;

  constructor(child: ChildProcess, connection: CdpConnection, page: BenchPage) {
    this.child = child;
    this.connection = connection;
    this.page = page;
  }

  async version(): Promise<string> {
    return browserVersionSchema.parse(
      await this.connection.send("Browser.getVersion"),
    ).product;
  }

  async close(): Promise<void> {
    await this.connection
      .send("Browser.close", {}, undefined, {
        timeoutMs: SHUTDOWN_STEP_TIMEOUT_MS,
      })
      .catch(() => undefined);
    this.connection.close();
    await stopChrome(this.child);
  }
}

export class BenchPage {
  private readonly connection: CdpConnection;
  private readonly sessionId: string;
  private performanceEnabled = false;

  constructor(connection: CdpConnection, sessionId: string) {
    this.connection = connection;
    this.sessionId = sessionId;
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return this.connection.send(method, params, this.sessionId);
  }

  private on(event: string, handler: CdpEventHandler): () => void {
    return this.connection.on(event, handler, this.sessionId);
  }

  async setViewport(width: number, height: number): Promise<void> {
    await this.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
  }

  async setCpuThrottlingRate(rate: number): Promise<void> {
    await this.send("Emulation.setCPUThrottlingRate", { rate });
  }

  async addInitScript(source: string): Promise<void> {
    await this.send("Page.addScriptToEvaluateOnNewDocument", { source });
  }

  async evaluate(expression: string): Promise<unknown> {
    const response = evaluateResponseSchema.parse(
      await this.send("Runtime.evaluate", { expression, returnByValue: true }),
    );
    const details = response.exceptionDetails;
    if (details !== undefined) {
      throw new Error(
        `Evaluation failed at ${details.lineNumber + 1}:${details.columnNumber + 1}: ${details.exception?.description ?? details.text}`,
      );
    }
    return response.result.value;
  }

  async performanceMetrics(): Promise<Record<string, number>> {
    if (!this.performanceEnabled) {
      await this.send("Performance.enable", { timeDomain: "timeTicks" });
      this.performanceEnabled = true;
    }
    const { metrics } = performanceMetricsResponseSchema.parse(
      await this.send("Performance.getMetrics"),
    );
    return Object.fromEntries(
      metrics.map((metric) => [metric.name, metric.value]),
    );
  }

  async collectGarbage(): Promise<void> {
    await this.send("HeapProfiler.collectGarbage");
  }

  async startNetworkCapture(): Promise<() => NetworkCapture> {
    const startedAtEpochMs = Date.now();
    const requests = new Map<
      string,
      { record: NetworkRequestRecord; startTimestamp: number }
    >();
    let webSocketFramesReceived = 0;
    let webSocketBytesReceived = 0;
    const finish = (
      requestId: string,
      timestamp: number,
      patch: Partial<NetworkRequestRecord>,
    ) => {
      const entry = requests.get(requestId);
      if (entry !== undefined) {
        Object.assign(entry.record, patch, {
          durationMs: (timestamp - entry.startTimestamp) * 1000,
        });
      }
    };
    const unsubscribe = [
      this.on("Network.requestWillBeSent", (params) => {
        const event = requestWillBeSentSchema.safeParse(params);
        if (
          !event.success ||
          !event.data.request.url.includes(API_REQUEST_MARKER)
        ) {
          return;
        }
        const { request, requestId, timestamp, type, wallTime } = event.data;
        const existing = requests.get(requestId);
        if (existing !== undefined) {
          existing.record.url = request.url;
          existing.record.method = request.method;
          return;
        }
        requests.set(requestId, {
          record: {
            requestId,
            url: request.url,
            method: request.method,
            resourceType: type ?? null,
            startedAtEpochMs: wallTime * 1000,
            outcome: "pending",
            status: null,
            encodedDataLength: null,
            durationMs: null,
            errorText: null,
          },
          startTimestamp: timestamp,
        });
      }),
      this.on("Network.responseReceived", (params) => {
        const event = responseReceivedSchema.safeParse(params);
        const entry = event.success
          ? requests.get(event.data.requestId)
          : undefined;
        if (event.success && entry !== undefined) {
          entry.record.status = event.data.response.status;
        }
      }),
      this.on("Network.loadingFinished", (params) => {
        const event = loadingFinishedSchema.safeParse(params);
        if (event.success) {
          finish(event.data.requestId, event.data.timestamp, {
            outcome: "finished",
            encodedDataLength: event.data.encodedDataLength,
          });
        }
      }),
      this.on("Network.loadingFailed", (params) => {
        const event = loadingFailedSchema.safeParse(params);
        if (event.success) {
          finish(event.data.requestId, event.data.timestamp, {
            outcome: "failed",
            errorText: event.data.errorText,
          });
        }
      }),
      this.on("Network.webSocketFrameReceived", (params) => {
        const event = webSocketFrameReceivedSchema.safeParse(params);
        if (!event.success) {
          return;
        }
        webSocketFramesReceived += 1;
        webSocketBytesReceived += Buffer.byteLength(
          event.data.response.payloadData,
          event.data.response.opcode === 2 ? "base64" : "utf8",
        );
      }),
    ];
    await this.send("Network.enable");
    return () => {
      for (const off of unsubscribe) {
        off();
      }
      this.send("Network.disable").catch(() => undefined);
      return {
        startedAtEpochMs,
        stoppedAtEpochMs: Date.now(),
        requests: [...requests.values()].map((entry) => entry.record),
        webSocketFramesReceived,
        webSocketBytesReceived,
      };
    };
  }

  async startCpuProfile(samplingIntervalUs: number): Promise<void> {
    await this.send("Profiler.enable");
    await this.send("Profiler.setSamplingInterval", {
      interval: samplingIntervalUs,
    });
    await this.send("Profiler.start");
  }

  async stopCpuProfile(): Promise<CpuProfile> {
    const { profile } = profilerStopResponseSchema.parse(
      await this.send("Profiler.stop"),
    );
    await this.send("Profiler.disable");
    return profile;
  }

  async startTrace(categories: string[]): Promise<void> {
    await this.send("Tracing.start", {
      transferMode: "ReturnAsStream",
      streamFormat: "json",
      streamCompression: "none",
      traceConfig: {
        includedCategories: categories,
        recordMode: "recordUntilFull",
      },
    });
  }

  async stopTrace(outPath: string): Promise<void> {
    const [complete] = await Promise.all([
      this.connection.waitForEvent(
        "Tracing.tracingComplete",
        this.sessionId,
        120_000,
      ),
      this.send("Tracing.end"),
    ]);
    const { stream } = tracingCompleteSchema.parse(complete);
    const file = await open(outPath, "w");
    try {
      for (;;) {
        const chunk = ioReadResponseSchema.parse(
          await this.send("IO.read", { handle: stream, size: 1024 * 1024 }),
        );
        await file.write(
          Buffer.from(
            chunk.data,
            chunk.base64Encoded === true ? "base64" : "utf8",
          ),
        );
        if (chunk.eof) {
          break;
        }
      }
    } finally {
      await file.close();
      await this.send("IO.close", { handle: stream }).catch(() => undefined);
    }
  }

  async screenshot(outPath: string): Promise<void> {
    const { data } = screenshotResponseSchema.parse(
      await this.send("Page.captureScreenshot", { format: "png" }),
    );
    await writeFile(outPath, Buffer.from(data, "base64"));
  }
}
