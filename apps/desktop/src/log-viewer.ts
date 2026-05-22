import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readdir, stat } from "node:fs/promises";
import { watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import {
  LOG_VIEWER_VISIBLE_LINE_LIMIT,
  type LogViewerComponent,
  type LogViewerLine,
} from "./log-viewer-contract.js";

export const LOG_VIEWER_IPC_BATCH_INTERVAL_MS = 50;
export const LOG_VIEWER_IPC_BATCH_LINE_LIMIT = 250;

const LOG_VIEWER_INITIAL_TAIL_LINES = 400;
const LOG_VIEWER_ROTATION_POLL_INTERVAL_MS = 2_000;
const LOG_VIEWER_COMPONENTS: LogViewerComponent[] = ["server", "host-daemon"];

export interface CreateLogViewerViewUrlArgs {
  logDir: string;
}

export interface ResolveCurrentLogFileArgs {
  component: LogViewerComponent;
  logDir: string;
}

export interface CreateLogTailerArgs {
  logDir: string;
  onLines(lines: LogViewerLine[]): void;
}

export interface LogTailer {
  processIds(): number[];
  start(): Promise<void>;
  stop(): void;
}

export interface CreateLogLineBufferArgs {
  flushIntervalMs: number;
  flushLineCount: number;
  maxLines: number;
  onFlush(lines: LogViewerLine[]): void;
}

export interface LogLineBuffer {
  append(lines: LogViewerLine[]): void;
  clear(): void;
  flush(): void;
  lines(): LogViewerLine[];
  stop(): void;
}

interface EscapeHtmlArgs {
  value: string;
}

interface ParseLogFileCandidateArgs {
  component: LogViewerComponent;
  fileName: string;
}

interface LogFileCandidate {
  fileName: string;
  sequence: number;
  timestampMs: number;
}

interface TailProcess {
  childProcess: ChildProcess;
  filePath: string;
}

interface ComponentTailState {
  component: LogViewerComponent;
  currentFilePath: string | null;
  pendingText: string;
  tailProcess: TailProcess | null;
}

interface RestartTailProcessArgs {
  filePath: string;
  state: ComponentTailState;
}

interface StopTailProcessArgs {
  state: ComponentTailState;
}

interface HandleTailChunkArgs {
  chunk: string;
  state: ComponentTailState;
}

interface EmitSystemLineArgs {
  text: string;
}

interface EmitComponentLinesArgs {
  component: LogViewerComponent;
  lines: string[];
}

interface CreateComponentTailStateArgs {
  component: LogViewerComponent;
}

interface ScheduleBufferFlushArgs {
  buffer: LogLineBufferState;
}

interface LogLineBufferState {
  flushTimer: NodeJS.Timeout | null;
  pendingLines: LogViewerLine[];
  visibleLines: LogViewerLine[];
}

function escapeHtml(args: EscapeHtmlArgs): string {
  return args.value.replace(/[&<>"']/gu, (character) => {
    if (character === "&") {
      return "&amp;";
    }
    if (character === "<") {
      return "&lt;";
    }
    if (character === ">") {
      return "&gt;";
    }
    if (character === '"') {
      return "&quot;";
    }
    return "&#39;";
  });
}

export function createLogLineBuffer(
  args: CreateLogLineBufferArgs,
): LogLineBuffer {
  const state: LogLineBufferState = {
    flushTimer: null,
    pendingLines: [],
    visibleLines: [],
  };

  function clearFlushTimer(): void {
    if (state.flushTimer === null) {
      return;
    }
    clearTimeout(state.flushTimer);
    state.flushTimer = null;
  }

  function flush(): void {
    clearFlushTimer();
    if (state.pendingLines.length === 0) {
      return;
    }

    const pendingLines = state.pendingLines;
    state.pendingLines = [];
    args.onFlush(pendingLines);
  }

  function scheduleBufferFlush(
    scheduleArgs: ScheduleBufferFlushArgs,
  ): void {
    if (scheduleArgs.buffer.flushTimer !== null) {
      return;
    }
    scheduleArgs.buffer.flushTimer = setTimeout(() => {
      scheduleArgs.buffer.flushTimer = null;
      flush();
    }, args.flushIntervalMs);
  }

  return {
    append(lines) {
      if (lines.length === 0) {
        return;
      }

      state.visibleLines.push(...lines);
      if (state.visibleLines.length > args.maxLines) {
        state.visibleLines.splice(
          0,
          state.visibleLines.length - args.maxLines,
        );
      }

      state.pendingLines.push(...lines);
      if (state.pendingLines.length >= args.flushLineCount) {
        flush();
        return;
      }
      scheduleBufferFlush({ buffer: state });
    },
    clear() {
      clearFlushTimer();
      state.pendingLines = [];
      state.visibleLines = [];
    },
    flush,
    lines() {
      return [...state.visibleLines];
    },
    stop() {
      flush();
      clearFlushTimer();
    },
  };
}

export function createLogViewerViewUrl(args: CreateLogViewerViewUrlArgs): string {
  const escapedLogDir = escapeHtml({ value: args.logDir });
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Server & Daemon Logs</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    * {
      box-sizing: border-box;
    }

    body {
      background: Canvas;
      color: CanvasText;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      height: 100vh;
      margin: 0;
    }

    header {
      align-items: center;
      border-bottom: 1px solid color-mix(in srgb, CanvasText 14%, transparent);
      display: grid;
      gap: 12px;
      grid-template-columns: minmax(0, 1fr) auto;
      padding: 16px 18px 12px;
    }

    h1 {
      font-size: 15px;
      font-weight: 600;
      letter-spacing: 0;
      line-height: 1.25;
      margin: 0 0 4px;
    }

    .path {
      color: color-mix(in srgb, CanvasText 60%, transparent);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px;
      line-height: 1.35;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .actions {
      align-items: center;
      display: flex;
      gap: 8px;
    }

    button {
      appearance: none;
      background: color-mix(in srgb, CanvasText 7%, transparent);
      border: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
      border-radius: 6px;
      color: CanvasText;
      cursor: default;
      font: inherit;
      font-size: 12px;
      line-height: 1;
      padding: 8px 10px;
    }

    button:active {
      background: color-mix(in srgb, CanvasText 13%, transparent);
    }

    label {
      align-items: center;
      color: color-mix(in srgb, CanvasText 72%, transparent);
      display: inline-flex;
      font-size: 12px;
      gap: 6px;
      white-space: nowrap;
    }

    input {
      margin: 0;
    }

    main {
      min-height: 0;
      padding: 12px;
    }

    pre {
      background: color-mix(in srgb, CanvasText 5%, transparent);
      border: 1px solid color-mix(in srgb, CanvasText 12%, transparent);
      border-radius: 8px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
      height: 100%;
      line-height: 1.45;
      margin: 0;
      overflow: auto;
      padding: 12px;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .status {
      color: color-mix(in srgb, CanvasText 64%, transparent);
      font-size: 12px;
      min-width: 58px;
      text-align: right;
      white-space: nowrap;
    }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>Server & Daemon Logs</h1>
      <div class="path" title="${escapedLogDir}">${escapedLogDir}</div>
    </div>
    <div class="actions">
      <label><input id="autoscroll" type="checkbox" checked> Auto-scroll</label>
      <button id="copy" type="button">Copy Logs</button>
      <button id="open" type="button">Open Logs Folder</button>
      <button id="clear" type="button">Clear</button>
      <div id="status" class="status">0 lines</div>
    </div>
  </header>
  <main>
    <pre id="log" aria-live="polite"></pre>
  </main>
  <script>
    const maxLines = ${LOG_VIEWER_VISIBLE_LINE_LIMIT};
    const api = window.bbLogViewer;
    const autoscroll = document.getElementById("autoscroll");
    const clearButton = document.getElementById("clear");
    const copyButton = document.getElementById("copy");
    const logElement = document.getElementById("log");
    const openButton = document.getElementById("open");
    const statusElement = document.getElementById("status");
    const lines = [];

    function shouldStickToBottom() {
      return autoscroll.checked &&
        logElement.scrollTop + logElement.clientHeight >= logElement.scrollHeight - 24;
    }

    function render(stickToBottom) {
      logElement.textContent = lines.join("\\n");
      statusElement.textContent = String(lines.length) + " lines";
      if (stickToBottom) {
        logElement.scrollTop = logElement.scrollHeight;
      }
    }

    function appendEntries(entries) {
      const stickToBottom = shouldStickToBottom();
      for (const entry of entries) {
        lines.push(entry.text);
      }
      if (lines.length > maxLines) {
        lines.splice(0, lines.length - maxLines);
      }
      render(stickToBottom);
    }

    api.onSnapshot((event) => {
      lines.splice(0, lines.length);
      appendEntries(event.lines);
    });

    api.onAppend((event) => {
      appendEntries(event.lines);
    });

    clearButton.addEventListener("click", () => {
      lines.splice(0, lines.length);
      render(true);
    });

    copyButton.addEventListener("click", async () => {
      await api.copyLogs({ text: lines.join("\\n") });
      const previousLabel = copyButton.textContent;
      copyButton.textContent = "Copied";
      setTimeout(() => {
        copyButton.textContent = previousLabel;
      }, 900);
    });

    openButton.addEventListener("click", async () => {
      await api.openLogsFolder();
    });
  </script>
</body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function parseLogFileCandidate(
  args: ParseLogFileCandidateArgs,
): LogFileCandidate | null {
  const exactFileName = `${args.component}.log`;
  if (args.fileName === exactFileName) {
    return {
      fileName: args.fileName,
      sequence: 0,
      timestampMs: 0,
    };
  }

  const prefix = `${args.component}.`;
  const suffix = ".log";
  if (!args.fileName.startsWith(prefix) || !args.fileName.endsWith(suffix)) {
    return null;
  }

  const rawSequence = args.fileName.slice(
    prefix.length,
    args.fileName.length - suffix.length,
  );
  const sequence = /^\d+$/u.test(rawSequence) ? Number(rawSequence) : 0;
  return {
    fileName: args.fileName,
    sequence,
    timestampMs: 0,
  };
}

export async function resolveCurrentLogFile(
  args: ResolveCurrentLogFileArgs,
): Promise<string | null> {
  let entries: string[];
  try {
    entries = await readdir(args.logDir);
  } catch {
    return null;
  }

  const candidates: LogFileCandidate[] = [];
  for (const entry of entries) {
    const candidate = parseLogFileCandidate({
      component: args.component,
      fileName: entry,
    });
    if (candidate === null) {
      continue;
    }

    try {
      const fileStats = await stat(join(args.logDir, candidate.fileName));
      if (!fileStats.isFile()) {
        continue;
      }
      candidates.push({
        fileName: candidate.fileName,
        sequence: candidate.sequence,
        timestampMs: Math.max(
          fileStats.birthtimeMs,
          fileStats.ctimeMs,
          fileStats.mtimeMs,
        ),
      });
    } catch {}
  }

  candidates.sort((left, right) => {
    if (left.timestampMs !== right.timestampMs) {
      return right.timestampMs - left.timestampMs;
    }
    if (left.sequence !== right.sequence) {
      return right.sequence - left.sequence;
    }
    return right.fileName.localeCompare(left.fileName);
  });

  const candidate = candidates[0];
  return candidate === undefined ? null : join(args.logDir, candidate.fileName);
}

function createComponentTailState(
  args: CreateComponentTailStateArgs,
): ComponentTailState {
  return {
    component: args.component,
    currentFilePath: null,
    pendingText: "",
    tailProcess: null,
  };
}

export function createLogTailer(args: CreateLogTailerArgs): LogTailer {
  const componentStates = LOG_VIEWER_COMPONENTS.map((component) =>
    createComponentTailState({ component }),
  );
  let directoryWatcher: FSWatcher | null = null;
  let pollTimer: NodeJS.Timeout | null = null;
  let refreshInProgress = false;
  let refreshAgain = false;
  let stopped = false;

  function emitSystemLine(emitArgs: EmitSystemLineArgs): void {
    args.onLines([{ source: "system", text: `[system] ${emitArgs.text}` }]);
  }

  function emitComponentLines(emitArgs: EmitComponentLinesArgs): void {
    args.onLines(
      emitArgs.lines
        .filter((line) => line.length > 0)
        .map((line) => ({
          source: emitArgs.component,
          text: `[${emitArgs.component}] ${line}`,
        })),
    );
  }

  function handleTailChunk(handleArgs: HandleTailChunkArgs): void {
    const combinedText = `${handleArgs.state.pendingText}${handleArgs.chunk}`;
    const lines = combinedText.split(/\r?\n/u);
    if (combinedText.endsWith("\n") || combinedText.endsWith("\r")) {
      handleArgs.state.pendingText = "";
      emitComponentLines({
        component: handleArgs.state.component,
        lines,
      });
      return;
    }

    handleArgs.state.pendingText = lines.pop() ?? "";
    emitComponentLines({
      component: handleArgs.state.component,
      lines,
    });
  }

  function stopTailProcess(stopArgs: StopTailProcessArgs): void {
    const tailProcess = stopArgs.state.tailProcess;
    stopArgs.state.tailProcess = null;
    stopArgs.state.currentFilePath = null;
    stopArgs.state.pendingText = "";
    if (tailProcess === null) {
      return;
    }
    tailProcess.childProcess.kill("SIGTERM");
  }

  function restartTailProcess(restartArgs: RestartTailProcessArgs): void {
    stopTailProcess({ state: restartArgs.state });
    restartArgs.state.currentFilePath = restartArgs.filePath;

    const childProcess = spawn(
      "tail",
      [
        "-n",
        String(LOG_VIEWER_INITIAL_TAIL_LINES),
        "-F",
        restartArgs.filePath,
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const tailProcess: TailProcess = {
      childProcess,
      filePath: restartArgs.filePath,
    };
    restartArgs.state.tailProcess = tailProcess;

    if (childProcess.stdout !== null) {
      childProcess.stdout.setEncoding("utf8");
      childProcess.stdout.on("data", (chunk: string) => {
        handleTailChunk({ chunk, state: restartArgs.state });
      });
    }

    if (childProcess.stderr !== null) {
      childProcess.stderr.setEncoding("utf8");
      childProcess.stderr.on("data", (chunk: string) => {
        const text = chunk.trim();
        if (text.length > 0) {
          emitSystemLine({
            text: `${restartArgs.state.component} tail: ${text}`,
          });
        }
      });
    }

    childProcess.once("error", (error) => {
      emitSystemLine({
        text: `${restartArgs.state.component} tail failed: ${error.message}`,
      });
    });

    childProcess.once("exit", (code, signal) => {
      if (stopped || restartArgs.state.tailProcess !== tailProcess) {
        return;
      }
      restartArgs.state.tailProcess = null;
      emitSystemLine({
        text: `${restartArgs.state.component} tail stopped with ${
          code === null ? `signal ${signal ?? "unknown"}` : `exit code ${code}`
        }`,
      });
    });
  }

  async function refreshTailProcesses(): Promise<void> {
    if (stopped) {
      return;
    }

    for (const state of componentStates) {
      const currentFilePath = await resolveCurrentLogFile({
        component: state.component,
        logDir: args.logDir,
      });
      if (currentFilePath === null) {
        if (state.currentFilePath !== null) {
          stopTailProcess({ state });
        }
        continue;
      }
      if (currentFilePath !== state.currentFilePath) {
        restartTailProcess({
          filePath: currentFilePath,
          state,
        });
      }
    }
  }

  function scheduleRefresh(): void {
    if (stopped) {
      return;
    }
    if (refreshInProgress) {
      refreshAgain = true;
      return;
    }

    refreshInProgress = true;
    void refreshTailProcesses()
      .catch((error) => {
        const message =
          error instanceof Error ? error.message : String(error);
        emitSystemLine({ text: `log refresh failed: ${message}` });
      })
      .finally(() => {
        refreshInProgress = false;
        if (refreshAgain) {
          refreshAgain = false;
          scheduleRefresh();
        }
      });
  }

  return {
    processIds() {
      return componentStates.flatMap((state) => {
        const pid = state.tailProcess?.childProcess.pid;
        return pid === undefined ? [] : [pid];
      });
    },
    async start() {
      stopped = false;
      await mkdir(args.logDir, { recursive: true });
      directoryWatcher = watch(args.logDir, () => {
        scheduleRefresh();
      });
      pollTimer = setInterval(
        scheduleRefresh,
        LOG_VIEWER_ROTATION_POLL_INTERVAL_MS,
      );
      await refreshTailProcesses();
    },
    stop() {
      stopped = true;
      directoryWatcher?.close();
      directoryWatcher = null;
      if (pollTimer !== null) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      for (const state of componentStates) {
        stopTailProcess({ state });
      }
    },
  };
}
