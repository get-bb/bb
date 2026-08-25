/**
 * Dual-path parity replay (design: "Regression confidence", A2).
 *
 * A bridge recording (`bridge-kit/bridge-recorder.ts`) is replayed through a
 * bridge process: the recorded `runtime→bridge` lane is driven into the
 * bridge over stdin by this harness, and the recorded provider lanes are
 * played by `replay-provider-child.mjs`, which the bridge spawns in place of
 * its real provider. What the bridge writes back (`bridge→runtime`) is
 * assembled into canonical `ThreadEvent`s and projected into timeline rows.
 * Two bridge versions — the pre-migration worktree and the current one —
 * replay the same recording, and `compareParity` diffs the two runs against an
 * explicit allowlist whose entries name their PR and reason.
 *
 * Provider-agnostic on purpose: the caller names the recording, the bridge
 * process to launch (`resolveProviderBridgeLaunch` builds one from a bridge
 * module path), and — when the bridge spawns a provider child — a
 * `ReplayProviderProfile` that points that child at the replay script. Nothing
 * here knows which providers bb ships; `first-party-replay.ts` holds the
 * first-party profiles and module paths, and `@bb/provider-parity` wires the
 * real assembler and projector for the CLI. Published to plugins through
 * `@get-bb/plugin-sdk/provider-bridge/testing`, so a third-party bridge can
 * record in bb (docs/provider-bridge-protocol.md, "Record mode") and replay
 * its own recordings with the same oracle the first-party bridges use.
 *
 * This module is deliberately free of `@bb/agent-runtime` and `@bb/thread-view`
 * (both depend on this package): the delta assembler and the row projector are
 * injected.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ThreadEvent } from "@bb/domain";
import { readBoundedLines } from "../bridge-kit/bounded-line-reader.js";
import type { BridgeRecordingEntry } from "../bridge-kit/bridge-recorder.js";
import { PROVIDER_BRIDGE_PROTOCOL_VERSION } from "../version.js";
import { THREAD_DELTA_NOTIFICATION_METHOD } from "../thread-delta.js";
import { ThreadEventGrammar } from "../thread-event-grammar.js";
import {
  diffCalibrationStreams,
  normalizeCalibrationEvents,
} from "./calibration-diff.js";
import type { RecordedCellReplay } from "../conformance/recorded.js";
import {
  listRecordedCells,
  readBridgeRecording,
  withCurrentBridgeLane,
  type BridgeRecording,
  type RecordedCell,
} from "./recording.js";

// ---------------------------------------------------------------------------
// Injected collaborators
// ---------------------------------------------------------------------------

/** One stateful assembler: `thread/delta` notifications in, events out. */
export interface ParityAssembler {
  assembleMessage(message: { method?: string; params?: unknown }): ThreadEvent[];
}

export type CreateParityAssembler = (providerId: string) => ParityAssembler;

/** Project canonical events into timeline rows (the server's projection). */
export type ParityRowProjector = (args: {
  events: readonly ThreadEvent[];
  providerId: string;
}) => unknown[];

// ---------------------------------------------------------------------------
// Bridge launch
// ---------------------------------------------------------------------------

/** A bridge process, ready to spawn: the bootstrap, the module, its scope. */
export interface ProviderBridgeLaunch {
  command: string;
  args: string[];
  cwd: string;
  /** Added to the harness's own environment for the bridge process. */
  env: Record<string, string>;
}

export interface ResolveProviderBridgeLaunchOptions {
  /**
   * The bridge module: the file whose `experimental_providerBridge` export the
   * bootstrap runs. Absolute; a built artifact (`host.mjs`) or, with a
   * TypeScript loader among `nodeArgs`, the source file.
   */
  modulePath: string;
  /** The plugin the bridge belongs to (its data and temp directories). */
  pluginId: string;
  /** Working directory of the bridge process; defaults to the caller's. */
  cwd?: string;
  /**
   * The plugin data directory the bootstrap hands the bridge; defaults to a
   * fresh temp directory per launch.
   */
  dataDir?: string;
  /**
   * The provider-bridge bootstrap (`bridge-worker-entry`) that runs the
   * module; defaults to the kit's own — the source entry in a bb checkout,
   * the bundled one in the published SDK.
   */
  bootstrapPath?: string;
  /**
   * Node flags before the bootstrap. Defaults: in a bb checkout (source
   * bootstrap) `--conditions=source` plus the tsx loader; otherwise the tsx
   * loader for a TypeScript module and nothing for a built one.
   */
  nodeArgs?: string[];
}

const SOURCE_BOOTSTRAP = fileURLToPath(new URL("../bridge-worker-entry.ts", import.meta.url));
const BUNDLED_BOOTSTRAP = fileURLToPath(new URL("./provider-bridge-worker-entry.mjs", import.meta.url));

/**
 * The bootstrap this kit ships. From a checkout the protocol package's own
 * TypeScript entry; from the published SDK the bundle built beside this
 * module (`packages/plugin-sdk/scripts/build-runtime.mjs`).
 */
export function resolveProviderBridgeBootstrapPath(): string {
  if (existsSync(SOURCE_BOOTSTRAP)) return SOURCE_BOOTSTRAP;
  if (existsSync(BUNDLED_BOOTSTRAP)) return BUNDLED_BOOTSTRAP;
  throw new Error(
    `provider-bridge bootstrap not found at ${SOURCE_BOOTSTRAP} or ${BUNDLED_BOOTSTRAP}`,
  );
}

function isTypeScriptPath(path: string): boolean {
  return /\.[cm]?tsx?$/u.test(path);
}

function tsxSpecifier(): string {
  return import.meta.resolve("tsx");
}

function defaultNodeArgs(bootstrapPath: string, modulePath: string): string[] {
  if (isTypeScriptPath(bootstrapPath)) {
    // A checkout: workspace packages resolve to their sources.
    return ["--conditions=source", "--import", tsxSpecifier()];
  }
  return isTypeScriptPath(modulePath) ? ["--import", tsxSpecifier()] : [];
}

/**
 * The process that runs one bridge module through the bootstrap — exactly the
 * shape the runtime spawns, so a replayed bridge sees the argv, stdin framing
 * and signal handling it gets in production.
 */
export function resolveProviderBridgeLaunch(
  options: ResolveProviderBridgeLaunchOptions,
): ProviderBridgeLaunch {
  if (!isAbsolute(options.modulePath)) {
    throw new Error(`bridge module path must be absolute: ${options.modulePath}`);
  }
  const bootstrapPath = options.bootstrapPath ?? resolveProviderBridgeBootstrapPath();
  const dataDir = options.dataDir ?? mkdtempSync(join(tmpdir(), "bb-parity-data-"));
  return {
    command: process.execPath,
    args: [
      ...(options.nodeArgs ?? defaultNodeArgs(bootstrapPath, options.modulePath)),
      bootstrapPath,
      options.modulePath,
      options.pluginId,
      dataDir,
    ],
    cwd: options.cwd ?? process.cwd(),
    env: {},
  };
}

// ---------------------------------------------------------------------------
// Replay profile: how a bridge reaches the replay child
// ---------------------------------------------------------------------------

export type ReplayDialect = "json-rpc" | "claude-cli" | "pi-rpc";

/**
 * How a provider's bridge is pointed at the replay child. Codex reads its
 * app-server command from env, Claude its CLI path from env, pi its RPC
 * command from env (`pi-rpc`: JSON lines plus the extension channel on fds
 * 3/4), and an ACP bridge its agent command from the launch spec inside
 * `thread/start`. A bridge with no provider child (the echo example) needs no
 * profile at all.
 */
export interface ReplayProviderProfile {
  /** The protocol the replay child speaks on its pipe. */
  dialect: ReplayDialect;
  /** Environment the bridge reads the child's command from. */
  env(args: {
    replayCommand: string[];
    wrapperPath: string;
    stateDir: string;
  }): Record<string, string>;
  /** Rewrite a recorded runtime request that carries the child's command. */
  rewriteRuntimeLine?(line: string, args: { replayCommand: string[] }): string;
  /**
   * Provider state a bridge reads outside its provider pipe, seeded before
   * the replay starts (the Claude SDK forks by copying the source session's
   * transcript from disk).
   */
  prepareState?(args: {
    recording: BridgeRecording;
    stateDir: string;
    workspaceDir: string;
  }): void;
}

/** A bridge that spawns no provider, or one whose child command is fixed. */
export const DEFAULT_REPLAY_PROFILE: ReplayProviderProfile = {
  dialect: "json-rpc",
  env: () => ({}),
};

/**
 * A recorded request carries the recording machine's facts a replay must not
 * depend on: the shell PATH in `options.envVars` (a bridge that spawns its
 * provider with it — the Claude SDK looks `node` up on it — would fail
 * here), and the workspace `cwd` (ACP bridges and the Claude SDK spawn the
 * provider inside it; it does not exist on another machine). Point both at
 * this replay's.
 */
function rewriteRecordedMachineFacts(line: string, workspaceDir: string): string {
  if (!line.includes('"PATH"') && !line.includes('"cwd"')) {
    return line;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return line;
  }
  const params = (parsed as { params?: { cwd?: unknown; options?: { envVars?: Record<string, unknown> } } })
    .params;
  if (params === undefined) {
    return line;
  }
  let changed = false;
  const envVars = params.options?.envVars;
  if (envVars !== undefined && typeof envVars.PATH === "string") {
    envVars.PATH = process.env.PATH ?? envVars.PATH;
    changed = true;
  }
  if (typeof params.cwd === "string") {
    params.cwd = workspaceDir;
    changed = true;
  }
  return changed ? JSON.stringify(parsed) : line;
}

/** The workspace the recording's session ran in: the first recorded `cwd`. */
function recordedWorkspaceDir(recording: BridgeRecording): string | null {
  for (const entry of recording.entries) {
    if (entry.dir !== "runtime→bridge") continue;
    const message = parseWire(entry.line);
    const cwd = (message?.params as { cwd?: unknown } | undefined)?.cwd;
    if (typeof cwd === "string" && cwd.length > 0) return cwd;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

export interface ReplayRecordingOptions {
  recordingDir: string;
  /** The provider the recording belongs to; keys the assembler's ids. */
  providerId: string;
  /** The bridge process to replay through (see `resolveProviderBridgeLaunch`). */
  bridge: ProviderBridgeLaunch;
  /** How the bridge reaches the replay child; `DEFAULT_REPLAY_PROFILE` when omitted. */
  profile?: ReplayProviderProfile;
  createAssembler: CreateParityAssembler;
  /**
   * The assembler that plans the replay's gates from the recorded
   * `bridge→runtime` lane; defaults to `createAssembler`. A re-recording run
   * on a checkout whose grammar no longer accepts the whole recorded lane
   * plans with the recording-time checkout's assembler instead.
   */
  createPlanAssembler?: CreateParityAssembler;
  /**
   * Plan the replay's gates from the cell's current bridge lane
   * (`bridge→runtime.current.ndjson`, see `withCurrentBridgeLane`) when one
   * exists, instead of the recorded lane. The leg whose bridge wrote that
   * lane parses all of it; the recording-time leg parses the recorded lane.
   */
  planFromCurrentLane?: boolean;
  /** Per-wait timeout for a gate or a response. */
  timeoutMs?: number;
  /**
   * The quiet period after which a request is sent even though the bridge
   * has emitted fewer lines than the recording had before it — a divergent
   * bridge pays this once per request instead of stalling. Only a plan from
   * the recorded lane can be short for that reason: a plan from the current
   * lane (`planFromCurrentLane`) was written by this very bridge, so a
   * shortfall there is latency, never divergence, and the request waits for
   * its events up to `timeoutMs` instead — a starved bridge (a loaded CI
   * runner) still has provider lines to read, and a request sent on quiet
   * alone lands before them, at a point the recording never had.
   */
  orderTimeoutMs?: number;
  /** Quiet period after the last request before the bridge is closed. */
  settleMs?: number;
  /**
   * Quiet period a request waits for once the gates are met. The replay child
   * plays every provider line before the request's cursor point a couple of
   * milliseconds apart, so a short silence means the bridge has emitted all
   * that the pre-request stream produces; without it a request the bridge
   * acknowledges at once (a steer) lands at a load-dependent point.
   */
  drainMs?: number;
  /** Mirror the bridge's stderr (and the replay child's logs) here. */
  onStderr?: (text: string) => void;
}

export interface ParityGrammarViolation {
  rule: string;
  reason: string;
  eventType: string;
}

export interface ParityRun {
  providerId: string;
  recordingDir: string;
  /** Raw `bridge→runtime` lines, in order. */
  lines: string[];
  /** When each line arrived, ms since the replay started (diagnostics). */
  lineTimes: number[];
  /**
   * For each line, the recorded `runtime→bridge` entry written last before
   * it arrived (null before any was sent) — where the line sits in the
   * recording's wire order, for a lane re-recorded through this bridge.
   */
  lineAfter: Array<{ run: number; seq: number; ts: number } | null>;
  /** Assembled events, minus the ones the grammar dropped (as the runtime does). */
  events: ThreadEvent[];
  grammarViolations: ParityGrammarViolation[];
  /** Gates that timed out or requests that were never answered. */
  stalls: string[];
  stderr: string;
  exitCode: number | null;
}

interface ParsedWireMessage {
  id?: string | number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

function parseWire(line: string): ParsedWireMessage | null {
  try {
    const parsed: unknown = JSON.parse(line);
    return typeof parsed === "object" && parsed !== null ? (parsed as ParsedWireMessage) : null;
  } catch {
    return null;
  }
}

function isRequest(message: ParsedWireMessage): boolean {
  return message.id !== undefined && typeof message.method === "string";
}

function isResponse(message: ParsedWireMessage): boolean {
  return message.id !== undefined && message.method === undefined;
}

function countTurnBoundaries(events: readonly ThreadEvent[]): { started: number; completed: number } {
  let started = 0;
  let completed = 0;
  for (const event of events) {
    if (event.type === "turn/started") started += 1;
    if (event.type === "turn/completed") completed += 1;
  }
  return { started, completed };
}

interface RuntimeStep {
  entry: BridgeRecordingEntry;
  message: ParsedWireMessage | null;
  /** Turn boundaries the recording had assembled before this line was sent. */
  gate: { started: number; completed: number };
  /** Events the recording had assembled before this line was sent. */
  eventsBefore: number;
}

/**
 * The runtime lane with, per request, the turn boundaries the recorded bridge
 * output had reached when the runtime sent it. Replay sends a request only
 * once the live stream has caught up — the runtime sent `turn/start` #2 after
 * turn #1 settled, and a steer while the turn was open.
 */
function planRuntimeSteps(
  recording: BridgeRecording,
  assembler: ParityAssembler,
): RuntimeStep[] {
  const steps: RuntimeStep[] = [];
  const assembled: ThreadEvent[] = [];
  for (const entry of recording.entries) {
    if (entry.dir === "bridge→runtime") {
      const message = parseWire(entry.line);
      if (message !== null && message.method === THREAD_DELTA_NOTIFICATION_METHOD) {
        try {
          assembled.push(...assembler.assembleMessage(message));
        } catch {
          // A recorded line the current assembler rejects is a parity finding
          // on its own; the gate simply does not count it.
        }
      }
      continue;
    }
    if (entry.dir !== "runtime→bridge") {
      continue;
    }
    steps.push({
      entry,
      message: parseWire(entry.line),
      gate: countTurnBoundaries(assembled),
      eventsBefore: assembled.length,
    });
  }
  return steps;
}

/**
 * The method of the bridge request a recorded runtime response answered.
 * Bridge request ids restart with every bridge process, so the lookup is
 * scoped to the process (`run`) that wrote the response.
 */
function methodOfRecordedBridgeRequest(
  recording: BridgeRecording,
  response: BridgeRecordingEntry,
  id: string | number,
): string | undefined {
  for (const entry of recording.entries) {
    if (entry.dir !== "bridge→runtime" || entry.run !== response.run) continue;
    const message = parseWire(entry.line);
    if (message !== null && isRequest(message) && String(message.id) === String(id)) {
      return message.method;
    }
  }
  return undefined;
}

const REPLAY_CHILD_PATH = fileURLToPath(new URL("./replay-provider-child.mjs", import.meta.url));

/** The id of the harness's own `initialize` request; never part of a recording. */
export const PARITY_INITIALIZE_ID = "parity-initialize";

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

/**
 * Replay one recording through one bridge. Resolves when the bridge exits
 * after the last recorded runtime line has been sent and answered.
 */
export async function replayRecording(options: ReplayRecordingOptions): Promise<ParityRun> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  // Generous on purpose: only a bridge that diverges from the recording ever
  // waits this long, while a slow CI runner must never trip it for a healthy one.
  const orderTimeoutMs = options.orderTimeoutMs ?? 5_000;
  const settleMs = options.settleMs ?? 750;
  const drainMs = options.drainMs ?? 300;
  const providerId = options.providerId;
  const profile = options.profile ?? DEFAULT_REPLAY_PROFILE;
  const recording = readBridgeRecording(options.recordingDir);

  const stateDir = mkdtempSync(join(tmpdir(), "bb-parity-replay-"));
  // The replayed session's workspace: the recording's cwd belongs to the
  // machine that recorded it, and nothing in a replay runs real commands.
  const workspaceDir = mkdtempSync(join(tmpdir(), "bb-parity-ws-"));
  const replayCommand = [
    process.execPath,
    REPLAY_CHILD_PATH,
    "--recording",
    resolve(options.recordingDir),
    "--dialect",
    profile.dialect,
    "--state",
    stateDir,
  ];
  // The Claude bridge insists the CLI override is an executable file, and the
  // Agent SDK runs a `.mjs` through node: an executable ES module satisfies
  // both.
  const cursorPath = join(stateDir, "cursor");
  const setCursor = (position: { run: number; seq: number } | "end"): void => {
    writeFileSync(
      cursorPath,
      position === "end" ? "end" : `${position.run} ${position.seq}`,
    );
  };
  const wrapperPath = join(stateDir, "replay-provider.mjs");
  writeFileSync(
    wrapperPath,
    [
      "#!/usr/bin/env node",
      `process.argv.splice(2, 0, ${JSON.stringify(replayCommand.slice(2)).slice(1, -1)});`,
      `await import(${JSON.stringify(REPLAY_CHILD_PATH)});`,
      "",
    ].join("\n"),
    { mode: 0o755 },
  );

  profile.prepareState?.({ recording, stateDir, workspaceDir });
  const launch = options.bridge;
  const child: ChildProcess = spawn(launch.command, launch.args, {
    cwd: launch.cwd,
    env: {
      ...process.env,
      ...launch.env,
      ...profile.env({ replayCommand, wrapperPath, stateDir }),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  // A bridge that derives paths from the runtime's `cwd` (a command's cwd,
  // a file it reads) names this replay's workspace where the recording
  // names the recorded one. Restore the recorded path in its output, so the
  // replay compares with the recording and a re-recorded lane keeps the
  // recording's paths. The replay workspace is a unique temp path, so the
  // substitution cannot touch anything else.
  const recordedCwd = recordedWorkspaceDir(recording);
  const restoreRecordedWorkspace = (line: string): string =>
    recordedCwd === null || recordedCwd === workspaceDir
      ? line
      : line.split(workspaceDir).join(recordedCwd);

  const initializeId = PARITY_INITIALIZE_ID;
  const startedAt = Date.now();
  const lines: string[] = [];
  const lineTimes: number[] = [];
  const lineAfter: ParityRun["lineAfter"] = [];
  let lastSentRuntimeEntry: { run: number; seq: number; ts: number } | null = null;
  const events: ThreadEvent[] = [];
  const grammarViolations: ParityGrammarViolation[] = [];
  const stalls: string[] = [];
  let stderr = "";
  const grammar = new ThreadEventGrammar();
  const liveAssembler = options.createAssembler(providerId);
  const planAssembler = (options.createPlanAssembler ?? options.createAssembler)(providerId);
  const exactPlan = options.planFromCurrentLane === true;
  const steps = planRuntimeSteps(
    exactPlan ? withCurrentBridgeLane(recording) : recording,
    planAssembler,
  );

  const answeredIds = new Set<string>();
  const pendingBridgeRequests: { id: string | number; method: string }[] = [];
  /** Recorded runtime responses to bridge requests, queued per method. */
  const recordedAnswers = new Map<string, ParsedWireMessage[]>();
  for (const step of steps) {
    if (step.message !== null && isResponse(step.message)) {
      const method =
        methodOfRecordedBridgeRequest(recording, step.entry, step.message.id as string | number) ?? "?";
      const queue = recordedAnswers.get(method) ?? [];
      queue.push(step.message);
      recordedAnswers.set(method, queue);
    }
  }

  let lastOutputAt = Date.now();
  const exited = new Promise<number | null>((resolveExit) => {
    child.on("exit", (code) => resolveExit(code));
  });
  child.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
    options.onStderr?.(chunk);
  });

  function write(line: string): void {
    if (child.stdin?.writable) {
      child.stdin.write(`${line}\n`);
    }
  }

  function answerBridgeRequest(message: ParsedWireMessage): void {
    const method = message.method ?? "?";
    const queue = recordedAnswers.get(method);
    const recorded = queue?.shift();
    if (recorded === undefined) {
      stalls.push(`no recorded answer for bridge request ${method} (${String(message.id)})`);
      write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32000, message: "parity replay: no recorded answer" },
        }),
      );
      return;
    }
    write(JSON.stringify({ ...recorded, id: message.id }));
  }

  readBoundedLines({
    input: child.stdout!,
    onLine: (rawLine) => {
      const line = restoreRecordedWorkspace(rawLine);
      lastOutputAt = Date.now();
      lines.push(line);
      lineTimes.push(lastOutputAt - startedAt);
      lineAfter.push(lastSentRuntimeEntry);
      const message = parseWire(line);
      if (message === null) return;
      if (isResponse(message)) {
        answeredIds.add(String(message.id));
        return;
      }
      if (isRequest(message)) {
        pendingBridgeRequests.push({ id: message.id as string | number, method: message.method! });
        answerBridgeRequest(message);
        return;
      }
      if (message.method === THREAD_DELTA_NOTIFICATION_METHOD) {
        let assembled: ThreadEvent[];
        try {
          assembled = liveAssembler.assembleMessage(message);
        } catch (error) {
          stalls.push(`invalid thread/delta: ${error instanceof Error ? error.message : String(error)}`);
          return;
        }
        for (const event of assembled) {
          const result = grammar.observe(event);
          if (result.kind === "violation") {
            // The runtime drops a violating event at intake; so does parity,
            // so rows match what production projects.
            grammarViolations.push({ rule: result.rule, reason: result.reason, eventType: event.type });
            continue;
          }
          events.push(event);
        }
      }
    },
    onOverflow: (bytes) => {
      stalls.push(`oversized bridge line (${bytes} bytes)`);
    },
  });

  async function waitFor(
    label: string,
    predicate: () => boolean,
    limitMs: number = timeoutMs,
    reportStall = true,
  ): Promise<void> {
    const deadline = Date.now() + limitMs;
    while (!predicate()) {
      if (child.exitCode !== null) {
        stalls.push(`bridge exited while waiting for ${label}`);
        return;
      }
      if (Date.now() > deadline) {
        if (reportStall) stalls.push(`timed out waiting for ${label}`);
        return;
      }
      await sleep(10);
    }
  }

  // Pace the replay child: nothing recorded after the first runtime request
  // plays before that request is sent.
  const firstStep = steps.find((step) => step.message !== null && isRequest(step.message));
  setCursor(firstStep === undefined ? "end" : { run: firstStep.entry.run, seq: firstStep.entry.seq });
  write(
    JSON.stringify({
      jsonrpc: "2.0",
      id: initializeId,
      method: "initialize",
      params: {
        protocolVersion: PROVIDER_BRIDGE_PROTOCOL_VERSION,
        client: { name: "bb-parity", version: "0" },
      },
    }),
  );
  await waitFor("initialize response", () => answeredIds.has(initializeId));

  const sentRequestIds: string[] = [];
  for (const step of steps) {
    if (step.message === null || !isRequest(step.message)) {
      // Responses are replayed on demand when the bridge asks; notifications
      // go straight through.
      if (step.message !== null && !isResponse(step.message)) {
        lastSentRuntimeEntry = { run: step.entry.run, seq: step.entry.seq, ts: step.entry.ts };
        write(step.entry.line);
      }
      continue;
    }
    const request = step.message;
    const method = request.method!;
    await waitFor(
      `earlier requests before ${method}`,
      () => sentRequestIds.every((id) => answeredIds.has(id)),
    );
    await waitFor(
      `${step.gate.started} turn/started and ${step.gate.completed} turn/completed before ${method}`,
      () => {
        const live = countTurnBoundaries(events);
        return live.started >= step.gate.started && live.completed >= step.gate.completed;
      },
    );
    // Land the request at the recorded point of the stream: the replay child
    // plays no provider line recorded after this request until it is sent
    // (the cursor set after the previous send), and the bridge must have
    // assembled as many events as the recording had before it. Events rather
    // than lines, so identity or metadata chatter cannot shift the point.
    // A plan from the current lane is exact for this bridge, so the wait is
    // strict and a timeout is a stall. A plan from the recorded lane is best
    // effort for a divergent bridge — the wait ends once the bridge has been
    // quiet for orderTimeoutMs — and never a stall.
    await waitFor(
      `${step.eventsBefore} events before ${method}`,
      () =>
        events.length >= step.eventsBefore ||
        (!exactPlan && Date.now() - lastOutputAt >= orderTimeoutMs),
      timeoutMs,
      exactPlan,
    );
    await waitFor(
      `the stream to drain before ${method}`,
      () => Date.now() - lastOutputAt >= drainMs,
      timeoutMs,
      false,
    );
    if (child.exitCode !== null) break;
    if (
      method === "thread/stop" &&
      typeof request.params === "object" &&
      request.params !== null &&
      (request.params as { intent?: unknown }).intent === "release"
    ) {
      // The runtime forgets a released thread's grammar state.
      const threadId = (request.params as { threadId?: unknown }).threadId;
      if (typeof threadId === "string") grammar.clearThread(threadId);
    }
    const rewritten = rewriteRecordedMachineFacts(step.entry.line, workspaceDir);
    const line =
      profile.rewriteRuntimeLine === undefined
        ? rewritten
        : profile.rewriteRuntimeLine(rewritten, { replayCommand });
    lastSentRuntimeEntry = { run: step.entry.run, seq: step.entry.seq, ts: step.entry.ts };
    write(line);
    sentRequestIds.push(String(request.id));
    // Release the provider lines up to the next runtime request.
    const nextStep = steps
      .slice(steps.indexOf(step) + 1)
      .find((candidate) => candidate.message !== null && isRequest(candidate.message));
    setCursor(nextStep === undefined ? "end" : { run: nextStep.entry.run, seq: nextStep.entry.seq });
  }
  setCursor("end");
  await waitFor("the last responses", () => sentRequestIds.every((id) => answeredIds.has(id)));
  // Let trailing notifications drain, then close the wire like the runtime.
  await waitFor("the stream to settle", () => Date.now() - lastOutputAt >= settleMs);
  child.stdin?.end();
  const exitCode = await Promise.race([
    exited,
    sleep(timeoutMs).then(() => {
      stalls.push("bridge did not exit after stdin closed; killed");
      child.kill("SIGKILL");
      return null;
    }),
  ]);
  rmSync(stateDir, { recursive: true, force: true });
  rmSync(workspaceDir, { recursive: true, force: true });

  return {
    providerId,
    recordingDir: options.recordingDir,
    lines,
    lineTimes,
    lineAfter,
    events,
    grammarViolations,
    stalls,
    stderr,
    exitCode,
  };
}

/**
 * The events the recorded `bridge→runtime` lane assembles to, without any
 * bridge in the loop: the recording's own view of what the bridge emitted.
 */
export function assembleRecordedEvents(
  recording: BridgeRecording,
  createAssembler: CreateParityAssembler,
  providerId: string,
): { events: ThreadEvent[]; grammarViolations: ParityGrammarViolation[]; invalidDeltas: string[] } {
  const assembler = createAssembler(providerId);
  const grammar = new ThreadEventGrammar();
  const events: ThreadEvent[] = [];
  const grammarViolations: ParityGrammarViolation[] = [];
  const invalidDeltas: string[] = [];
  for (const entry of recording.entries) {
    if (entry.dir === "runtime→bridge") {
      const message = parseWire(entry.line);
      if (
        message !== null &&
        message.method === "thread/stop" &&
        typeof message.params === "object" &&
        message.params !== null &&
        (message.params as { intent?: unknown }).intent === "release"
      ) {
        const threadId = (message.params as { threadId?: unknown }).threadId;
        if (typeof threadId === "string") grammar.clearThread(threadId);
      }
      continue;
    }
    if (entry.dir !== "bridge→runtime") continue;
    const message = parseWire(entry.line);
    if (message === null || message.method !== THREAD_DELTA_NOTIFICATION_METHOD) continue;
    let assembled: ThreadEvent[];
    try {
      assembled = assembler.assembleMessage(message);
    } catch (error) {
      invalidDeltas.push(error instanceof Error ? error.message : String(error));
      continue;
    }
    for (const event of assembled) {
      const result = grammar.observe(event);
      if (result.kind === "violation") {
        grammarViolations.push({ rule: result.rule, reason: result.reason, eventType: event.type });
        continue;
      }
      events.push(event);
    }
  }
  return { events, grammarViolations, invalidDeltas };
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

export interface ParityAllowlistEntry {
  provider: string | "*";
  cell: string | "*";
  layer: "events" | "rows";
  /** A JSON pointer over the normalized list, with `*` and `**` wildcards. */
  path: string;
  pr: string;
  reason: string;
}

export interface ParityLayerDiff {
  onlyInOld: unknown[];
  onlyInNew: unknown[];
}

export interface ParityComparison {
  provider: string;
  cell: string;
  events: ParityLayerDiff;
  rows: ParityLayerDiff;
  /** Grammar drops, compared as `rule:eventType` multisets. */
  grammar: ParityLayerDiff;
  /** Allowlist entries that matched this cell but masked nothing. */
  staleAllowlist: ParityAllowlistEntry[];
  passed: boolean;
}

export interface ParityInputs {
  events: readonly ThreadEvent[];
  rows: readonly unknown[];
  /** Events the grammar dropped; a regression when the lists differ. */
  grammarViolations?: readonly ParityGrammarViolation[];
}

/** Fields that carry wall-clock or per-run facts rather than protocol meaning. */
const TIME_FIELDS = new Set([
  "createdAt",
  "updatedAt",
  "startedAt",
  "completedAt",
  "startedAtMs",
  "completedAtMs",
  "timestamp",
  "ts",
  "resetsAtMs",
  "resetsAt",
  "expiresAt",
]);

function blankTimeFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(blankTimeFields);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = TIME_FIELDS.has(key) && (typeof entry === "number" || typeof entry === "string")
        ? 0
        : blankTimeFields(entry);
    }
    return out;
  }
  return value;
}

const ROW_ID_FIELDS = [
  "turnId",
  "itemId",
  "id",
  "parentToolCallId",
  "toolCallId",
  "callId",
  "requestId",
  "messageId",
  "rowId",
  "agentId",
  "taskId",
  "backgroundTaskId",
  "sourceItemId",
  "interactionId",
] as const;

export function normalizeParityEvents(events: readonly ThreadEvent[]): unknown[] {
  return blankTimeFields(normalizeCalibrationEvents(events)) as unknown[];
}

export function normalizeParityRows(rows: readonly unknown[]): unknown[] {
  // Rows are plain JSON; the calibration normalizer only needs `events` to be
  // JSON-serializable, so it interns row ids the same way.
  return blankTimeFields(
    normalizeCalibrationEvents(rows as unknown as readonly ThreadEvent[], {
      internedIdFields: ROW_ID_FIELDS,
    }),
  ) as unknown[];
}

function pointerSegments(path: string): string[] {
  return path.split("/").filter((segment) => segment.length > 0);
}

/**
 * Delete every value under a wildcard JSON pointer. Returns how many values
 * the mask removed, so an allowlist entry that touches nothing is reported
 * stale.
 *
 * The root pointer (`/`) empties the whole layer. A pointer cannot describe
 * a change that inserts or removes a list entry (every later index shifts),
 * so an entry that needs this must say in its reason why the layer is not
 * comparable for that cell and what re-records it out of the allowlist.
 */
export function maskPath(value: unknown, path: string): number {
  const segments = pointerSegments(path);
  if (segments.length === 0) {
    if (!Array.isArray(value)) return 0;
    const removed = value.length;
    value.length = 0;
    return removed;
  }
  let removed = 0;
  const visit = (node: unknown, index: number): void => {
    if (index >= segments.length || node === null || typeof node !== "object") {
      return;
    }
    const segment = segments[index];
    const last = index === segments.length - 1;
    if (segment === "**") {
      // Zero or more levels: try matching the rest here and at every child.
      visit(node, index + 1);
      for (const child of Object.values(node as Record<string, unknown>)) {
        visit(child, index);
      }
      return;
    }
    const keys =
      segment === "*"
        ? Object.keys(node as Record<string, unknown>)
        : Object.hasOwn(node, segment)
          ? [segment]
          : [];
    for (const key of keys) {
      if (last) {
        if (Array.isArray(node)) {
          // Blank rather than splice so sibling indices stay stable.
          (node as unknown[])[Number(key)] = null;
        } else {
          delete (node as Record<string, unknown>)[key];
        }
        removed += 1;
      } else {
        visit((node as Record<string, unknown>)[key], index + 1);
      }
    }
  };
  visit(value, 0);
  return removed;
}

function entryApplies(entry: ParityAllowlistEntry, provider: string, cell: string): boolean {
  return (
    (entry.provider === "*" || entry.provider === provider) &&
    (entry.cell === "*" || entry.cell === cell)
  );
}

export function compareParity(
  oldRun: ParityInputs,
  newRun: ParityInputs,
  allowlist: readonly ParityAllowlistEntry[],
  scope: { provider: string; cell: string },
): ParityComparison {
  const layers = {
    events: [normalizeParityEvents(oldRun.events), normalizeParityEvents(newRun.events)],
    rows: [normalizeParityRows(oldRun.rows), normalizeParityRows(newRun.rows)],
  } as const;
  const staleAllowlist: ParityAllowlistEntry[] = [];
  for (const entry of allowlist) {
    if (!entryApplies(entry, scope.provider, scope.cell)) continue;
    const [oldSide, newSide] = layers[entry.layer];
    const removed = maskPath(oldSide, entry.path) + maskPath(newSide, entry.path);
    if (removed === 0) {
      staleAllowlist.push(entry);
    }
  }
  const events = diffLayer(layers.events[0], layers.events[1]);
  const rows = diffLayer(layers.rows[0], layers.rows[1]);
  const grammar = diffLayer(
    (oldRun.grammarViolations ?? []).map((violation) => `${violation.rule}:${violation.eventType}`),
    (newRun.grammarViolations ?? []).map((violation) => `${violation.rule}:${violation.eventType}`),
  );
  const clean = (diff: ParityLayerDiff): boolean =>
    diff.onlyInOld.length === 0 && diff.onlyInNew.length === 0;
  return {
    provider: scope.provider,
    cell: scope.cell,
    events,
    rows,
    grammar,
    staleAllowlist,
    passed: clean(events) && clean(rows) && clean(grammar) && staleAllowlist.length === 0,
  };
}

function diffLayer(oldSide: readonly unknown[], newSide: readonly unknown[]): ParityLayerDiff {
  const diff = diffCalibrationStreams(oldSide, newSide);
  return { onlyInOld: diff.onlyInLegacy, onlyInNew: diff.onlyInBridge };
}

/** Compact rendering for CLI output and test failures. */
export function describeParityValue(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return String(value);
  }
  const record = value as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : typeof record.kind === "string" ? record.kind : "?";
  const item = record.item;
  const suffix =
    item !== null && typeof item === "object" && "type" in item
      ? `:${String((item as { type: unknown }).type)}`
      : "";
  return `${type}${suffix} ${JSON.stringify(value).slice(0, 160)}`;
}

// ---------------------------------------------------------------------------
// Recorded-traffic conformance input
// ---------------------------------------------------------------------------

export interface ReplayRecordedCellsOptions {
  /** The `<provider>/<cell>` tree to read (see `listRecordedCells`). */
  recordingsRoot: string;
  /** Which recorded providers this bridge serves (`acp` serves `acp-*`). */
  servesProvider: (providerId: string) => boolean;
  /** Cell names to replay; defaults to every cell of those providers. */
  cells?: readonly string[];
  /** The bridge process and replay profile for one cell's provider. */
  bridge: (cell: RecordedCell) => { launch: ProviderBridgeLaunch; profile?: ReplayProviderProfile };
  createAssembler: CreateParityAssembler;
  timeoutMs?: number;
  onStderr?: (text: string) => void;
}

/**
 * Replay a bridge's recorded cells for `checkRecordedCellReplay`: each cell
 * through the bridge the caller launches, with the recording's own assembled
 * events beside the replay's. Cells run concurrently — each is its own bridge
 * process with its own replay state.
 */
export async function replayRecordedCells(
  options: ReplayRecordedCellsOptions,
): Promise<RecordedCellReplay[]> {
  const cells = listRecordedCells(options.recordingsRoot).filter(
    (cell: RecordedCell) =>
      options.servesProvider(cell.provider) &&
      (options.cells === undefined || options.cells.includes(cell.cell)) &&
      readBridgeRecording(cell.dir).manifest?.scope !== "process",
  );
  return Promise.all(
    cells.map(async (cell): Promise<RecordedCellReplay> => {
      // The expectation is this checkout's current bridge lane when a bridge
      // change wrote one (`pnpm rerecord`), else the recorded lane; the
      // replay paces itself from the same lane.
      const recorded = assembleRecordedEvents(
        withCurrentBridgeLane(readBridgeRecording(cell.dir)),
        options.createAssembler,
        cell.provider,
      );
      const bridge = options.bridge(cell);
      const run = await replayRecording({
        recordingDir: cell.dir,
        providerId: cell.provider,
        bridge: bridge.launch,
        ...(bridge.profile === undefined ? {} : { profile: bridge.profile }),
        createAssembler: options.createAssembler,
        planFromCurrentLane: true,
        ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
        ...(options.onStderr !== undefined ? { onStderr: options.onStderr } : {}),
      });
      return {
        provider: cell.provider,
        cell: cell.cell,
        events: run.events,
        recordedEvents: recorded.events,
        stalls: run.stalls,
      };
    }),
  );
}
