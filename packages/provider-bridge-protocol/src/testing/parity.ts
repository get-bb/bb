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
 * This module is deliberately free of `@bb/agent-runtime` and `@bb/thread-view`
 * (both depend on this package): the delta assembler and the row projector are
 * injected. `@bb/provider-parity` wires the real ones and owns the CLI.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  COMMITTED_RECORDINGS_ROOT,
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

/** Where each first-party bridge lives inside a checkout. */
export const FIRST_PARTY_BRIDGE_MODULES: Readonly<
  Record<string, { modulePath: string; pluginId: string }>
> = {
  codex: {
    modulePath: "plugins/provider-codex/src/bridge/bridge.ts",
    pluginId: "provider-codex",
  },
  "claude-code": {
    modulePath: "plugins/provider-claude-code/src/bridge/bridge.ts",
    pluginId: "provider-claude-code",
  },
  acp: {
    modulePath: "plugins/provider-acp/src/bridge/bridge.ts",
    pluginId: "provider-acp",
  },
  pi: {
    modulePath: "packages/agent-runtime/src/pi/bridge/bridge.ts",
    pluginId: "pi",
  },
};

const BRIDGE_WORKER_ENTRY = "packages/provider-bridge-protocol/src/bridge-worker-entry.ts";

export interface ParityBridgeSpec {
  /** A bb checkout root (the pre-migration worktree, or `.`). */
  checkoutRoot: string;
  providerId: string;
  /** Override the bridge module; defaults to the provider's first-party path. */
  modulePath?: string;
  pluginId?: string;
}

export type ReplayDialect = "json-rpc" | "claude-cli";

/**
 * How a provider's bridge is pointed at the replay child. Codex reads its
 * app-server command from env, Claude its CLI path from env, and an ACP
 * bridge its agent command from the launch spec inside `thread/start`.
 */
export interface ReplayProviderProfile {
  dialect: ReplayDialect;
  bridgeFamily: keyof typeof FIRST_PARTY_BRIDGE_MODULES;
  env(args: {
    replayCommand: string[];
    wrapperPath: string;
    stateDir: string;
  }): Record<string, string>;
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

export class UnreplayableProviderError extends Error {
  constructor(providerId: string, reason: string) {
    super(`provider "${providerId}" cannot be replayed: ${reason}`);
    this.name = "UnreplayableProviderError";
  }
}

export function resolveReplayProfile(providerId: string): ReplayProviderProfile {
  if (providerId === "codex") {
    return {
      dialect: "json-rpc",
      bridgeFamily: "codex",
      env: ({ replayCommand }) => ({
        BB_CODEX_BRIDGE_APP_SERVER_COMMAND: replayCommand[0],
        BB_CODEX_BRIDGE_APP_SERVER_ARGS: JSON.stringify(replayCommand.slice(1)),
      }),
    };
  }
  if (providerId === "claude-code") {
    return {
      dialect: "claude-cli",
      bridgeFamily: "claude-code",
      // The Agent SDK runs a `.mjs` executable through node itself, so the
      // wrapper module (which bakes the replay arguments in) is the "CLI".
      // The config dir is the replay's own: the SDK reads and writes session
      // transcripts under it, and a replay must not touch the user's.
      env: ({ wrapperPath, stateDir }) => ({
        BB_CLAUDE_CODE_EXECUTABLE: wrapperPath,
        CLAUDE_CONFIG_DIR: claudeConfigDir(stateDir),
      }),
      prepareState: seedClaudeForkTranscripts,
    };
  }
  if (providerId.startsWith("acp-")) {
    return {
      dialect: "json-rpc",
      bridgeFamily: "acp",
      env: () => ({}),
      rewriteRuntimeLine: (line, { replayCommand }) =>
        rewriteAcpLaunchSpec(line, replayCommand),
    };
  }
  if (providerId === "pi") {
    throw new UnreplayableProviderError(
      providerId,
      "pi runs its SDK in-process; its recordings capture the SDK boundary and have no provider child to replay",
    );
  }
  throw new UnreplayableProviderError(providerId, "no replay profile");
}

function claudeConfigDir(stateDir: string): string {
  return join(stateDir, "claude-config");
}

/** The Agent SDK's project directory name for a workspace path. */
function claudeProjectDirName(workspaceDir: string): string {
  return workspaceDir.replace(/[^a-zA-Z0-9]/g, "-");
}

/**
 * `forkSession` in the Agent SDK is a local file operation: it reads the
 * source session's transcript from the config dir's project directory and
 * writes the forked copy beside it. The transcript of the recorded source
 * session lives on the machine that recorded it, and its content does not
 * reach the replay (the forked "CLI" is the replay child), so every recorded
 * `thread/fork` gets a minimal transcript for its source session: one user
 * and one assistant entry, the assistant carrying the checkpoint id the fork
 * names, if any.
 */
function seedClaudeForkTranscripts(args: {
  recording: BridgeRecording;
  stateDir: string;
  workspaceDir: string;
}): void {
  const projectDir = join(
    claudeConfigDir(args.stateDir),
    "projects",
    claudeProjectDirName(args.workspaceDir),
  );
  for (const entry of args.recording.entries) {
    if (entry.dir !== "runtime→bridge") continue;
    const message = parseWire(entry.line);
    if (message === null || message.method !== "thread/fork") continue;
    const params = message.params as
      | { sourceProviderThreadId?: unknown; sourceProviderCheckpointId?: unknown }
      | undefined;
    const sessionId = params?.sourceProviderThreadId;
    if (typeof sessionId !== "string") continue;
    const checkpointId =
      typeof params?.sourceProviderCheckpointId === "string"
        ? params.sourceProviderCheckpointId
        : randomUUID();
    const userUuid = randomUUID();
    const timestamp = "2026-01-01T00:00:00.000Z";
    const transcript = [
      {
        type: "user",
        uuid: userUuid,
        parentUuid: null,
        sessionId,
        timestamp,
        cwd: args.workspaceDir,
        message: { role: "user", content: "recorded source session" },
      },
      {
        type: "assistant",
        uuid: checkpointId,
        parentUuid: userUuid,
        sessionId,
        timestamp,
        cwd: args.workspaceDir,
        message: { role: "assistant", content: [{ type: "text", text: "ready" }] },
      },
    ];
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, `${sessionId}.jsonl`),
      `${transcript.map((line) => JSON.stringify(line)).join("\n")}\n`,
    );
  }
}

function rewriteAcpLaunchSpec(line: string, replayCommand: string[]): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return line;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return line;
  }
  const message = parsed as { params?: { options?: { providerOptions?: Record<string, unknown> } } };
  const providerOptions = message.params?.options?.providerOptions;
  const spec = providerOptions?.acpLaunchSpec;
  if (providerOptions === undefined || typeof spec !== "object" || spec === null) {
    return line;
  }
  // The replay child is the whole agent: no model CLI to probe, no model flag
  // to splice into its argv (`modelCli` would have the bridge run
  // `node --list-models` and insert `--model` before the script path).
  const { modelCli: _modelCli, ...rest } = spec as Record<string, unknown>;
  providerOptions.acpLaunchSpec = {
    ...rest,
    command: replayCommand[0],
    args: replayCommand.slice(1),
    env: {},
  };
  return JSON.stringify(parsed);
}

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

function tsxSpecifier(): string {
  return import.meta.resolve("tsx");
}

export function resolveBridgeLaunch(spec: ParityBridgeSpec): {
  command: string;
  args: string[];
  cwd: string;
} {
  const checkoutRoot = resolve(spec.checkoutRoot);
  const profile = resolveReplayProfile(spec.providerId);
  const defaults = FIRST_PARTY_BRIDGE_MODULES[profile.bridgeFamily];
  const modulePath = spec.modulePath ?? defaults.modulePath;
  const pluginId = spec.pluginId ?? defaults.pluginId;
  const dataDir = mkdtempSync(join(tmpdir(), "bb-parity-data-"));
  return {
    command: process.execPath,
    args: [
      "--conditions=source",
      "--import",
      tsxSpecifier(),
      join(checkoutRoot, BRIDGE_WORKER_ENTRY),
      isAbsolute(modulePath) ? modulePath : join(checkoutRoot, modulePath),
      pluginId,
      dataDir,
    ],
    cwd: checkoutRoot,
  };
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

export interface ReplayRecordingOptions {
  recordingDir: string;
  bridge: ParityBridgeSpec;
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
   * bridge pays this once per request instead of stalling.
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
  const providerId = options.bridge.providerId;
  const profile = resolveReplayProfile(providerId);
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
  const launch = resolveBridgeLaunch(options.bridge);
  const child: ChildProcess = spawn(launch.command, launch.args, {
    cwd: launch.cwd,
    env: {
      ...process.env,
      ...profile.env({ replayCommand, wrapperPath, stateDir }),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const initializeId = "parity-initialize";
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
  const steps = planRuntimeSteps(
    options.planFromCurrentLane === true ? withCurrentBridgeLane(recording) : recording,
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
    onLine: (line) => {
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
    // Best effort for a divergent bridge — the wait ends once the bridge has
    // been quiet for orderTimeoutMs — and never a stall.
    await waitFor(
      `${step.eventsBefore} events before ${method}`,
      () =>
        events.length >= step.eventsBefore ||
        Date.now() - lastOutputAt >= orderTimeoutMs,
      timeoutMs,
      false,
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
 */
export function maskPath(value: unknown, path: string): number {
  const segments = pointerSegments(path);
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
  /** Which recorded providers this bridge serves (`acp` serves `acp-*`). */
  servesProvider: (providerId: string) => boolean;
  /** Cell names to replay; defaults to every committed cell of those providers. */
  cells?: readonly string[];
  /** The checkout whose bridge replays; defaults to the recordings' own. */
  checkoutRoot?: string;
  recordingsRoot?: string;
  createAssembler: CreateParityAssembler;
  timeoutMs?: number;
  onStderr?: (text: string) => void;
}

/**
 * Replay this bridge's recorded cells for `checkRecordedCellReplay`: each
 * cell through the bridge of the checkout, with the recording's own assembled
 * events beside the replay's. Cells run concurrently — each is its own bridge
 * process with its own replay state.
 */
export async function replayRecordedCells(
  options: ReplayRecordedCellsOptions,
): Promise<RecordedCellReplay[]> {
  const recordingsRoot = options.recordingsRoot ?? COMMITTED_RECORDINGS_ROOT;
  const checkoutRoot = options.checkoutRoot ?? resolve(recordingsRoot, "../../..");
  const cells = listRecordedCells(recordingsRoot).filter(
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
      const run = await replayRecording({
        recordingDir: cell.dir,
        bridge: { checkoutRoot, providerId: cell.provider },
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
