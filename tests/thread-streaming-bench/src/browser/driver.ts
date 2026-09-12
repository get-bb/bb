import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, open, rm, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import {
  CdpCommandError,
  CdpConnection,
  CdpTimeoutError,
  type CdpEventHandler,
} from "./cdp.js";

export const DEFAULT_CHROME_PATH = join(
  homedir(),
  ".cache",
  "ms-playwright",
  "chromium-1228",
  "chrome-linux64",
  "chrome",
);

const BASE_CHROME_ARGS = [
  "--headless=new",
  "--remote-debugging-port=0",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding",
  "--disable-backgrounding-occluded-windows",
  "--disable-extensions",
  "--window-size=1440,900",
];

const NO_SANDBOX_ARG = "--no-sandbox";
const SANDBOX_FAILURE_MARKER = "No usable sandbox";
const STDERR_TAIL_LIMIT = 64 * 1024;
const DEVTOOLS_PORT_TIMEOUT_MS = 30_000;
const CONNECT_TIMEOUT_MS = 10_000;
const SHUTDOWN_STEP_TIMEOUT_MS = 5_000;
const STOP_LOADING_TIMEOUT_MS = 2_000;
const API_REQUEST_MARKER = "/api/v1/";
const TERMINATING_SIGNALS: readonly NodeJS.Signals[] = [
  "SIGINT",
  "SIGTERM",
  "SIGHUP",
];

export const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;
export const CHROME_LAUNCH_ENV = "THREAD_STREAMING_BENCH_CHROME_LAUNCH";

export type LaunchBenchBrowserOptions = {
  chromePath?: string;
  userDataDir: string;
  extraArgs?: string[];
  commandTimeoutMs?: number;
};

export type BrowserVersion = {
  product: string;
  revision: string;
  userAgent: string;
  jsVersion: string;
  protocolVersion: string;
};

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

export type TraceResult = {
  bytes: number;
  dataLossOccurred: boolean;
};

const callFrameSchema = z.looseObject({
  functionName: z.string(),
  scriptId: z.string(),
  url: z.string(),
  lineNumber: z.number(),
  columnNumber: z.number(),
});

const profileNodeSchema = z.looseObject({
  id: z.number(),
  callFrame: callFrameSchema,
  hitCount: z.number().optional(),
  children: z.array(z.number()).optional(),
});

export const cpuProfileSchema = z.looseObject({
  nodes: z.array(profileNodeSchema),
  startTime: z.number(),
  endTime: z.number(),
  samples: z.array(z.number()).optional(),
  timeDeltas: z.array(z.number()).optional(),
});

export type CpuProfile = z.infer<typeof cpuProfileSchema>;

const createTargetResponseSchema = z.object({ targetId: z.string() });
const attachToTargetResponseSchema = z.object({ sessionId: z.string() });
const getTargetsResponseSchema = z.object({
  targetInfos: z.array(z.object({ targetId: z.string(), type: z.string() })),
});
const browserVersionSchema = z.object({
  product: z.string(),
  revision: z.string(),
  userAgent: z.string(),
  jsVersion: z.string(),
  protocolVersion: z.string(),
});
const addScriptResponseSchema = z.object({ identifier: z.string() });
const navigateResponseSchema = z.object({
  frameId: z.string(),
  errorText: z.string().optional(),
});
const remoteObjectSchema = z.object({
  type: z.string(),
  subtype: z.string().optional(),
  value: z.unknown().optional(),
  unserializableValue: z.string().optional(),
  description: z.string().optional(),
});
const evaluateResponseSchema = z.object({
  result: remoteObjectSchema,
  exceptionDetails: z
    .object({
      text: z.string(),
      lineNumber: z.number(),
      columnNumber: z.number(),
      exception: remoteObjectSchema.optional(),
    })
    .optional(),
});
const performanceMetricsResponseSchema = z.object({
  metrics: z.array(z.object({ name: z.string(), value: z.number() })),
});
const profilerStopResponseSchema = z.object({ profile: cpuProfileSchema });
const tracingCompleteSchema = z.object({
  dataLossOccurred: z.boolean(),
  stream: z.string().optional(),
});
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
  requestId: z.string(),
  response: z.object({ opcode: z.number(), payloadData: z.string() }),
});

export class PageEvaluationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PageEvaluationError";
  }
}

type ChromeProcess = {
  child: ChildProcess;
  pid: number;
  launchId: string;
  exited: Promise<void>;
  stderrTail: () => string;
};

type ActiveNetworkCapture = {
  startedAtEpochMs: number;
  requests: Map<string, NetworkRequestRecord>;
  startTimestamps: Map<string, number>;
  webSocketFramesReceived: number;
  webSocketBytesReceived: number;
  unsubscribe: Array<() => void>;
};

function parseUnserializableValue(value: string): number | bigint {
  switch (value) {
    case "NaN":
      return Number.NaN;
    case "Infinity":
      return Number.POSITIVE_INFINITY;
    case "-Infinity":
      return Number.NEGATIVE_INFINITY;
    case "-0":
      return -0;
  }
  if (/^-?\d+n$/.test(value)) {
    return BigInt(value.slice(0, -1));
  }
  throw new PageEvaluationError(
    `Evaluation returned an unsupported unserializable value ${value}`,
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function settlesWithin(
  promise: Promise<unknown>,
  timeoutMs: number,
): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  try {
    return await Promise.race([
      promise.then(
        () => true,
        () => true,
      ),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function errorCode(error: unknown): string | undefined {
  if (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return undefined;
}

function signalProcessGroup(pid: number, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(-pid, signal);
    return true;
  } catch (error) {
    if (errorCode(error) === "ESRCH") {
      return false;
    }
    throw error;
  }
}

const liveChromeGroups = new Set<number>();

function killLiveChromeGroups(): void {
  for (const pid of liveChromeGroups) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      continue;
    }
  }
}

function onTerminatingSignal(signal: NodeJS.Signals): void {
  killLiveChromeGroups();
  liveChromeGroups.clear();
  uninstallProcessHooks();
  if (process.listenerCount(signal) === 0) {
    process.kill(process.pid, signal);
  }
}

function installProcessHooks(): void {
  process.on("exit", killLiveChromeGroups);
  for (const signal of TERMINATING_SIGNALS) {
    process.on(signal, onTerminatingSignal);
  }
}

function uninstallProcessHooks(): void {
  process.off("exit", killLiveChromeGroups);
  for (const signal of TERMINATING_SIGNALS) {
    process.off(signal, onTerminatingSignal);
  }
}

function trackChromeGroup(pid: number): void {
  if (liveChromeGroups.size === 0) {
    installProcessHooks();
  }
  liveChromeGroups.add(pid);
}

function untrackChromeGroup(pid: number): void {
  if (!liveChromeGroups.delete(pid)) {
    return;
  }
  if (liveChromeGroups.size === 0) {
    uninstallProcessHooks();
  }
}

async function resolveChromePath(
  explicit: string | undefined,
): Promise<string> {
  const fromEnv = process.env.CHROME_PATH;
  const candidate =
    explicit ??
    (fromEnv !== undefined && fromEnv !== "" ? fromEnv : DEFAULT_CHROME_PATH);
  try {
    await access(candidate, constants.X_OK);
  } catch {
    throw new Error(
      `Chrome binary is missing or not executable: ${candidate}. Pass chromePath or set CHROME_PATH (default ${DEFAULT_CHROME_PATH}).`,
    );
  }
  return candidate;
}

function spawnChrome(chromePath: string, args: string[]): ChromeProcess {
  const launchId = `${process.pid}-${randomUUID()}`;
  const child = spawn(chromePath, args, {
    detached: true,
    env: { ...process.env, [CHROME_LAUNCH_ENV]: launchId },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let tail = "";
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    tail = (tail + chunk).slice(-STDERR_TAIL_LIMIT);
  });
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.once("error", (error) => {
      tail += `\nspawn error: ${error.message}`;
      resolve();
    });
  });
  if (child.pid === undefined) {
    throw new Error(`Failed to spawn Chrome at ${chromePath}`);
  }
  trackChromeGroup(child.pid);
  return { child, pid: child.pid, launchId, exited, stderrTail: () => tail };
}

function hasExited(chrome: ChromeProcess): boolean {
  return chrome.child.exitCode !== null || chrome.child.signalCode !== null;
}

async function readDevToolsEndpoint(
  userDataDir: string,
  chrome: ChromeProcess,
): Promise<string | { exitedEarly: string }> {
  const portFile = join(userDataDir, "DevToolsActivePort");
  const deadline = Date.now() + DEVTOOLS_PORT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (hasExited(chrome)) {
      await chrome.exited;
      return { exitedEarly: chrome.stderrTail() };
    }
    try {
      const [port, path] = (await readFile(portFile, "utf8")).split("\n");
      if (
        port !== undefined &&
        /^\d+$/.test(port) &&
        path !== undefined &&
        path.startsWith("/devtools/browser/")
      ) {
        return `ws://127.0.0.1:${port}${path}`;
      }
    } catch (error) {
      if (errorCode(error) !== "ENOENT") {
        throw error;
      }
    }
    await delay(50);
  }
  throw new Error(
    `Chrome did not write ${portFile} within ${DEVTOOLS_PORT_TIMEOUT_MS} ms. stderr tail:\n${chrome.stderrTail()}`,
  );
}

async function terminateChrome(chrome: ChromeProcess): Promise<void> {
  if (!hasExited(chrome)) {
    signalProcessGroup(chrome.pid, "SIGTERM");
    if (!(await settlesWithin(chrome.exited, SHUTDOWN_STEP_TIMEOUT_MS))) {
      signalProcessGroup(chrome.pid, "SIGKILL");
      await settlesWithin(chrome.exited, SHUTDOWN_STEP_TIMEOUT_MS);
    }
  }
  await reapProcessGroup(chrome.pid);
  chrome.child.stderr?.destroy();
}

async function reapProcessGroup(pid: number): Promise<void> {
  signalProcessGroup(pid, "SIGKILL");
  const deadline = Date.now() + SHUTDOWN_STEP_TIMEOUT_MS;
  while (signalProcessGroup(pid, 0)) {
    if (Date.now() >= deadline) {
      throw new Error(
        `Chrome process group ${pid} still has members ${SHUTDOWN_STEP_TIMEOUT_MS} ms after SIGKILL`,
      );
    }
    await delay(50);
  }
  untrackChromeGroup(pid);
}

export async function launchBenchBrowser(
  options: LaunchBenchBrowserOptions,
): Promise<BenchBrowser> {
  const chromePath = await resolveChromePath(options.chromePath);
  await mkdir(options.userDataDir, { recursive: true });
  const args = [
    ...BASE_CHROME_ARGS,
    `--user-data-dir=${options.userDataDir}`,
    ...(options.extraArgs ?? []),
  ];
  let sandboxDisabled = args.includes(NO_SANDBOX_ARG);
  let chrome: ChromeProcess;
  let endpoint: string;
  for (;;) {
    await rm(join(options.userDataDir, "DevToolsActivePort"), { force: true });
    const launchArgs =
      sandboxDisabled && !args.includes(NO_SANDBOX_ARG)
        ? [...args, NO_SANDBOX_ARG, "about:blank"]
        : [...args, "about:blank"];
    chrome = spawnChrome(chromePath, launchArgs);
    let result: string | { exitedEarly: string };
    try {
      result = await readDevToolsEndpoint(options.userDataDir, chrome);
    } catch (error) {
      await terminateChrome(chrome);
      throw error;
    }
    if (typeof result === "string") {
      endpoint = result;
      break;
    }
    await reapProcessGroup(chrome.pid);
    if (
      !sandboxDisabled &&
      process.platform === "linux" &&
      result.exitedEarly.includes(SANDBOX_FAILURE_MARKER)
    ) {
      sandboxDisabled = true;
      continue;
    }
    throw new Error(
      `Chrome exited before DevTools was ready (code ${chrome.child.exitCode}, signal ${chrome.child.signalCode}). stderr tail:\n${result.exitedEarly}`,
    );
  }
  const launchedChrome = chrome;
  try {
    const connection = await CdpConnection.connect(endpoint, {
      timeoutMs: CONNECT_TIMEOUT_MS,
      commandTimeoutMs: options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
    });
    const page = await attachNewPage(connection);
    const targets = getTargetsResponseSchema.parse(
      await connection.send("Target.getTargets"),
    );
    for (const target of targets.targetInfos) {
      if (target.type === "page" && target.targetId !== page.targetId) {
        await connection.send("Target.closeTarget", {
          targetId: target.targetId,
        });
      }
    }
    return new BenchBrowser({
      chrome: launchedChrome,
      chromePath,
      connection,
      page,
      sandboxDisabled,
      userDataDir: options.userDataDir,
    });
  } catch (error) {
    await terminateChrome(launchedChrome);
    throw error;
  }
}

async function attachNewPage(connection: CdpConnection): Promise<BenchPage> {
  const { targetId } = createTargetResponseSchema.parse(
    await connection.send("Target.createTarget", { url: "about:blank" }),
  );
  const { sessionId } = attachToTargetResponseSchema.parse(
    await connection.send("Target.attachToTarget", { targetId, flatten: true }),
  );
  const page = new BenchPage(connection, targetId, sessionId);
  await page.send("Inspector.enable");
  await page.send("Page.enable");
  await page.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await page.send("Page.bringToFront");
  return page;
}

export class BenchBrowser {
  readonly pid: number;
  readonly launchId: string;
  readonly chromePath: string;
  readonly userDataDir: string;
  readonly sandboxDisabled: boolean;
  readonly page: BenchPage;
  private readonly chrome: ChromeProcess;
  private readonly connection: CdpConnection;
  private closing: Promise<void> | null = null;

  constructor(args: {
    chrome: ChromeProcess;
    chromePath: string;
    connection: CdpConnection;
    page: BenchPage;
    sandboxDisabled: boolean;
    userDataDir: string;
  }) {
    this.chrome = args.chrome;
    this.pid = args.chrome.pid;
    this.launchId = args.chrome.launchId;
    this.chromePath = args.chromePath;
    this.connection = args.connection;
    this.page = args.page;
    this.sandboxDisabled = args.sandboxDisabled;
    this.userDataDir = args.userDataDir;
  }

  newPage(): Promise<BenchPage> {
    return attachNewPage(this.connection);
  }

  async version(): Promise<BrowserVersion> {
    return browserVersionSchema.parse(
      await this.connection.send("Browser.getVersion"),
    );
  }

  close(): Promise<void> {
    this.closing ??= this.shutdown();
    return this.closing;
  }

  private async shutdown(): Promise<void> {
    if (!this.connection.isClosed) {
      await settlesWithin(
        this.connection.send("Browser.close"),
        SHUTDOWN_STEP_TIMEOUT_MS,
      );
      this.connection.close();
    }
    await settlesWithin(this.chrome.exited, SHUTDOWN_STEP_TIMEOUT_MS);
    await terminateChrome(this.chrome);
  }
}

export class BenchPage {
  readonly targetId: string;
  readonly sessionId: string;
  private readonly connection: CdpConnection;
  private performanceEnabled = false;
  private networkCapture: ActiveNetworkCapture | null = null;

  constructor(connection: CdpConnection, targetId: string, sessionId: string) {
    this.connection = connection;
    this.targetId = targetId;
    this.sessionId = sessionId;
  }

  send(
    method: string,
    params: Record<string, unknown> = {},
    options: { timeoutMs?: number } = {},
  ): Promise<unknown> {
    return this.connection.send(method, params, this.sessionId, options);
  }

  on(event: string, handler: CdpEventHandler): () => void {
    return this.connection.on(event, handler, this.sessionId);
  }

  async setViewport(
    width: number,
    height: number,
    deviceScaleFactor = 1,
  ): Promise<void> {
    await this.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor,
      mobile: false,
    });
  }

  async setCpuThrottlingRate(rate: number): Promise<void> {
    await this.send("Emulation.setCPUThrottlingRate", { rate });
  }

  async addInitScript(source: string): Promise<string> {
    const { identifier } = addScriptResponseSchema.parse(
      await this.send("Page.addScriptToEvaluateOnNewDocument", { source }),
    );
    return identifier;
  }

  async navigate(url: string, options: { timeoutMs: number }): Promise<void> {
    const load = this.connection.waitForEvent("Page.loadEventFired", {
      sessionId: this.sessionId,
      timeoutMs: options.timeoutMs,
    });
    try {
      const response = navigateResponseSchema.parse(
        await this.send(
          "Page.navigate",
          { url },
          { timeoutMs: options.timeoutMs },
        ),
      );
      if (response.errorText !== undefined && response.errorText !== "") {
        throw new Error(`Navigation to ${url} failed: ${response.errorText}`);
      }
      await load.promise;
    } catch (error) {
      load.cancel();
      if (error instanceof CdpTimeoutError) {
        await this.send(
          "Page.stopLoading",
          {},
          { timeoutMs: STOP_LOADING_TIMEOUT_MS },
        ).catch(() => undefined);
        throw new Error(
          `Timed out after ${options.timeoutMs} ms navigating to ${url}`,
          { cause: error },
        );
      }
      throw error;
    }
  }

  async evaluate<T = unknown>(
    expression: string,
    options: { awaitPromise?: boolean; timeoutMs?: number } = {},
  ): Promise<T> {
    const response = evaluateResponseSchema.parse(
      await this.send(
        "Runtime.evaluate",
        {
          expression,
          returnByValue: true,
          awaitPromise: options.awaitPromise ?? false,
        },
        options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs },
      ),
    );
    if (response.exceptionDetails !== undefined) {
      const details = response.exceptionDetails;
      const description = details.exception?.description ?? details.text;
      throw new PageEvaluationError(
        `Evaluation failed at ${details.lineNumber + 1}:${details.columnNumber + 1}: ${description}`,
      );
    }
    if (response.result.unserializableValue !== undefined) {
      return parseUnserializableValue(response.result.unserializableValue) as T;
    }
    return response.result.value as T;
  }

  async waitForFunction(
    expression: string,
    options: { timeoutMs: number; pollMs?: number },
  ): Promise<unknown> {
    const pollMs = options.pollMs ?? 100;
    const deadline = Date.now() + options.timeoutMs;
    let lastError: Error | null = null;
    for (;;) {
      try {
        const value = await this.evaluate(expression, {
          awaitPromise: true,
          timeoutMs: Math.max(1, deadline - Date.now()),
        });
        if (value) {
          return value;
        }
      } catch (error) {
        if (
          !(error instanceof CdpCommandError) &&
          !(error instanceof CdpTimeoutError)
        ) {
          throw error;
        }
        lastError = error;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        const suffix =
          lastError === null ? "" : ` (last error: ${lastError.message})`;
        throw new Error(
          `Timed out after ${options.timeoutMs} ms waiting for ${expression}${suffix}`,
          { cause: lastError ?? undefined },
        );
      }
      await delay(Math.min(pollMs, remaining));
    }
  }

  async performanceMetrics(): Promise<Record<string, number>> {
    if (!this.performanceEnabled) {
      await this.send("Performance.enable", { timeDomain: "timeTicks" });
      this.performanceEnabled = true;
    }
    const { metrics } = performanceMetricsResponseSchema.parse(
      await this.send("Performance.getMetrics"),
    );
    const result: Record<string, number> = {};
    for (const metric of metrics) {
      result[metric.name] = metric.value;
    }
    return result;
  }

  async collectGarbage(): Promise<void> {
    await this.send("HeapProfiler.collectGarbage");
  }

  async startNetworkCapture(): Promise<void> {
    if (this.networkCapture !== null) {
      throw new Error("Network capture is already running");
    }
    const capture: ActiveNetworkCapture = {
      startedAtEpochMs: Date.now(),
      requests: new Map(),
      startTimestamps: new Map(),
      webSocketFramesReceived: 0,
      webSocketBytesReceived: 0,
      unsubscribe: [],
    };
    capture.unsubscribe.push(
      this.on("Network.requestWillBeSent", (params) => {
        const event = requestWillBeSentSchema.safeParse(params);
        if (
          !event.success ||
          !event.data.request.url.includes(API_REQUEST_MARKER)
        ) {
          return;
        }
        const existing = capture.requests.get(event.data.requestId);
        if (existing !== undefined) {
          existing.url = event.data.request.url;
          existing.method = event.data.request.method;
          return;
        }
        capture.startTimestamps.set(event.data.requestId, event.data.timestamp);
        capture.requests.set(event.data.requestId, {
          requestId: event.data.requestId,
          url: event.data.request.url,
          method: event.data.request.method,
          resourceType: event.data.type ?? null,
          startedAtEpochMs: event.data.wallTime * 1000,
          outcome: "pending",
          status: null,
          encodedDataLength: null,
          durationMs: null,
          errorText: null,
        });
      }),
      this.on("Network.responseReceived", (params) => {
        const event = responseReceivedSchema.safeParse(params);
        if (!event.success) {
          return;
        }
        const record = capture.requests.get(event.data.requestId);
        if (record !== undefined) {
          record.status = event.data.response.status;
        }
      }),
      this.on("Network.loadingFinished", (params) => {
        const event = loadingFinishedSchema.safeParse(params);
        if (!event.success) {
          return;
        }
        const record = capture.requests.get(event.data.requestId);
        const startTimestamp = capture.startTimestamps.get(
          event.data.requestId,
        );
        if (record !== undefined && startTimestamp !== undefined) {
          record.outcome = "finished";
          record.encodedDataLength = event.data.encodedDataLength;
          record.durationMs = (event.data.timestamp - startTimestamp) * 1000;
        }
      }),
      this.on("Network.loadingFailed", (params) => {
        const event = loadingFailedSchema.safeParse(params);
        if (!event.success) {
          return;
        }
        const record = capture.requests.get(event.data.requestId);
        const startTimestamp = capture.startTimestamps.get(
          event.data.requestId,
        );
        if (record !== undefined && startTimestamp !== undefined) {
          record.outcome = "failed";
          record.errorText = event.data.errorText;
          record.durationMs = (event.data.timestamp - startTimestamp) * 1000;
        }
      }),
      this.on("Network.webSocketFrameReceived", (params) => {
        const event = webSocketFrameReceivedSchema.safeParse(params);
        if (!event.success) {
          return;
        }
        capture.webSocketFramesReceived += 1;
        capture.webSocketBytesReceived += Buffer.byteLength(
          event.data.response.payloadData,
          event.data.response.opcode === 2 ? "base64" : "utf8",
        );
      }),
    );
    this.networkCapture = capture;
    try {
      await this.send("Network.enable");
    } catch (error) {
      this.networkCapture = null;
      for (const unsubscribe of capture.unsubscribe) {
        unsubscribe();
      }
      throw error;
    }
  }

  stopNetworkCapture(): NetworkCapture {
    const capture = this.networkCapture;
    if (capture === null) {
      throw new Error("Network capture is not running");
    }
    this.networkCapture = null;
    for (const unsubscribe of capture.unsubscribe) {
      unsubscribe();
    }
    this.send("Network.disable").catch(() => undefined);
    return {
      startedAtEpochMs: capture.startedAtEpochMs,
      stoppedAtEpochMs: Date.now(),
      requests: [...capture.requests.values()],
      webSocketFramesReceived: capture.webSocketFramesReceived,
      webSocketBytesReceived: capture.webSocketBytesReceived,
    };
  }

  async startCpuProfile(options: {
    samplingIntervalUs: number;
  }): Promise<void> {
    await this.send("Profiler.enable");
    await this.send("Profiler.setSamplingInterval", {
      interval: options.samplingIntervalUs,
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

  async stopTrace(outPath: string): Promise<TraceResult> {
    const complete = this.connection.waitForEvent("Tracing.tracingComplete", {
      sessionId: this.sessionId,
      timeoutMs: 120_000,
    });
    try {
      await this.send("Tracing.end");
    } catch (error) {
      complete.cancel();
      throw error;
    }
    const { dataLossOccurred, stream } = tracingCompleteSchema.parse(
      await complete.promise,
    );
    if (stream === undefined) {
      throw new Error(
        "Tracing.tracingComplete did not include a stream handle",
      );
    }
    await mkdir(dirname(outPath), { recursive: true });
    const file = await open(outPath, "w");
    let bytes = 0;
    try {
      for (;;) {
        const chunk = ioReadResponseSchema.parse(
          await this.send("IO.read", { handle: stream, size: 1024 * 1024 }),
        );
        const buffer = Buffer.from(
          chunk.data,
          chunk.base64Encoded === true ? "base64" : "utf8",
        );
        await file.write(buffer);
        bytes += buffer.length;
        if (chunk.eof) {
          break;
        }
      }
    } finally {
      await file.close();
      await this.send("IO.close", { handle: stream }).catch(() => undefined);
    }
    return { bytes, dataLossOccurred };
  }

  async screenshot(outPath: string): Promise<void> {
    const { data } = screenshotResponseSchema.parse(
      await this.send("Page.captureScreenshot", { format: "png" }),
    );
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, Buffer.from(data, "base64"));
  }

  async close(): Promise<void> {
    await this.connection.send("Target.closeTarget", {
      targetId: this.targetId,
    });
  }
}
