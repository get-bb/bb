import { spawn, type ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  jsonObjectSchema,
  jsonValueSchema,
  type JsonObject,
  type JsonValue,
  type ThreadEvent,
} from "@bb/domain";
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

export interface ParityAssembler {
  assembleMessage(message: {
    method?: string;
    params?: unknown;
  }): ThreadEvent[];
}

export type CreateParityAssembler = (providerId: string) => ParityAssembler;

export type ParityRowProjector = (args: {
  events: readonly ThreadEvent[];
  providerId: string;
}) => unknown[];

export interface ProviderBridgeLaunch {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

export interface ResolveProviderBridgeLaunchOptions {
  modulePath: string;
  pluginId: string;
  cwd?: string;
  dataDir?: string;
  bootstrapPath?: string;
  nodeArgs?: string[];
}

const SOURCE_BOOTSTRAP = fileURLToPath(
  new URL("../bridge-worker-entry.ts", import.meta.url),
);
const BUNDLED_BOOTSTRAP = fileURLToPath(
  new URL("./provider-bridge-worker-entry.mjs", import.meta.url),
);

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
    return ["--conditions=source", "--import", tsxSpecifier()];
  }
  return isTypeScriptPath(modulePath) ? ["--import", tsxSpecifier()] : [];
}

export function resolveProviderBridgeLaunch(
  options: ResolveProviderBridgeLaunchOptions,
): ProviderBridgeLaunch {
  if (!isAbsolute(options.modulePath)) {
    throw new Error(
      `bridge module path must be absolute: ${options.modulePath}`,
    );
  }
  const bootstrapPath =
    options.bootstrapPath ?? resolveProviderBridgeBootstrapPath();
  const dataDir =
    options.dataDir ?? mkdtempSync(join(tmpdir(), "bb-parity-data-"));
  return {
    command: process.execPath,
    args: [
      ...(options.nodeArgs ??
        defaultNodeArgs(bootstrapPath, options.modulePath)),
      bootstrapPath,
      options.modulePath,
      options.pluginId,
      dataDir,
    ],
    cwd: options.cwd ?? process.cwd(),
    env: {},
  };
}

export type ReplayDialect = "json-rpc" | "claude-cli" | "pi-rpc";

export interface ReplayProviderProfile {
  dialect: ReplayDialect;
  env(args: {
    replayCommand: string[];
    wrapperPath: string;
    stateDir: string;
  }): Record<string, string>;
  rewriteRuntimeLine?(line: string, args: { replayCommand: string[] }): string;
  prepareState?(args: {
    recording: BridgeRecording;
    stateDir: string;
    workspaceDir: string;
  }): void;
}

export const DEFAULT_REPLAY_PROFILE: ReplayProviderProfile = {
  dialect: "json-rpc",
  env: () => ({}),
};

function isJsonObjectValue(value: JsonValue | undefined): value is JsonObject {
  return (
    value !== undefined &&
    value !== null &&
    Object(value) === value &&
    !Array.isArray(value)
  );
}

function jsonObjectValue(value: JsonValue | undefined): JsonObject | null {
  return isJsonObjectValue(value) ? value : null;
}

function stringValue(value: JsonValue | undefined): string | null {
  const parsed = z.string().safeParse(value);
  return parsed.success ? parsed.data : null;
}

function numberOrStringValue(
  value: JsonValue | undefined,
): number | string | null {
  const parsed = z.union([z.number(), z.string()]).safeParse(value);
  return parsed.success ? parsed.data : null;
}

function parseJsonObject(line: string): JsonObject | null {
  try {
    return jsonObjectSchema.parse(JSON.parse(line));
  } catch {
    return null;
  }
}

function rewriteRecordedMachineFacts(
  line: string,
  workspaceDir: string,
): string {
  if (!line.includes('"PATH"') && !line.includes('"cwd"')) {
    return line;
  }
  const parsed = parseJsonObject(line);
  if (parsed === null) {
    return line;
  }
  const params = jsonObjectValue(parsed.params);
  if (params === null) return line;
  let changed = false;
  const options = jsonObjectValue(params.options);
  const envVars = jsonObjectValue(options?.envVars);
  const recordedPath = stringValue(envVars?.PATH);
  if (envVars !== null && recordedPath !== null) {
    envVars.PATH = process.env.PATH ?? recordedPath;
    changed = true;
  }
  if (stringValue(params.cwd) !== null) {
    params.cwd = workspaceDir;
    changed = true;
  }
  return changed ? JSON.stringify(parsed) : line;
}

function recordedWorkspaceDir(recording: BridgeRecording): string | null {
  for (const entry of recording.entries) {
    if (entry.dir !== "runtime→bridge") continue;
    const message = parseWire(entry.line);
    const params = jsonObjectValue(message?.params);
    const cwd = stringValue(params?.cwd);
    if (cwd !== null && cwd.length > 0) return cwd;
  }
  return null;
}

export interface ReplayRecordingOptions {
  recordingDir: string;
  providerId: string;
  bridge: ProviderBridgeLaunch;
  profile?: ReplayProviderProfile;
  createAssembler: CreateParityAssembler;
  createPlanAssembler?: CreateParityAssembler;
  planFromCurrentLane?: boolean;
  timeoutMs?: number;
  orderTimeoutMs?: number;
  settleMs?: number;
  drainMs?: number;
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
  lines: string[];
  lineTimes: number[];
  lineAfter: Array<{ run: number; seq: number; ts: number } | null>;
  events: ThreadEvent[];
  grammarViolations: ParityGrammarViolation[];
  stalls: string[];
  stderr: string;
  exitCode: number | null;
}

interface ParsedWireMessage {
  id?: string | number;
  jsonrpc?: string;
  method?: string;
  params?: JsonValue;
  result?: JsonValue;
  error?: JsonValue;
}

type ParsedWireRequest = ParsedWireMessage & {
  id: string | number;
  method: string;
};

type ParsedWireResponse = ParsedWireMessage & {
  id: string | number;
  method?: undefined;
};

function parseWire(line: string): ParsedWireMessage | null {
  const parsed = parseJsonObject(line);
  if (parsed === null) {
    return null;
  }
  const message: ParsedWireMessage = {};
  const id = numberOrStringValue(parsed.id);
  const jsonrpc = stringValue(parsed.jsonrpc);
  const method = stringValue(parsed.method);
  if (id !== null) message.id = id;
  if (jsonrpc !== null) message.jsonrpc = jsonrpc;
  if (method !== null) message.method = method;
  if (parsed.params !== undefined) message.params = parsed.params;
  if (parsed.result !== undefined) message.result = parsed.result;
  if (parsed.error !== undefined) message.error = parsed.error;
  return message;
}

function isRequest(message: ParsedWireMessage): message is ParsedWireRequest {
  return message.id !== undefined && message.method !== undefined;
}

function isResponse(message: ParsedWireMessage): message is ParsedWireResponse {
  return message.id !== undefined && message.method === undefined;
}

interface TurnBoundaries {
  started: number;
  completed: number;
}

function countTurnBoundaries(events: readonly ThreadEvent[]): TurnBoundaries {
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
  gate: { started: number; completed: number };
  eventsBefore: number;
}

function planRuntimeSteps(
  recording: BridgeRecording,
  assembler: ParityAssembler,
): RuntimeStep[] {
  const steps: RuntimeStep[] = [];
  const assembled: ThreadEvent[] = [];
  for (const entry of recording.entries) {
    if (entry.dir === "bridge→runtime") {
      const message = parseWire(entry.line);
      if (
        message !== null &&
        message.method === THREAD_DELTA_NOTIFICATION_METHOD
      ) {
        try {
          assembled.push(...assembler.assembleMessage(message));
        } catch {}
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

function methodOfRecordedBridgeRequest(
  recording: BridgeRecording,
  response: BridgeRecordingEntry,
  id: string | number,
): string | undefined {
  for (const entry of recording.entries) {
    if (entry.dir !== "bridge→runtime" || entry.run !== response.run) continue;
    const message = parseWire(entry.line);
    if (
      message !== null &&
      isRequest(message) &&
      String(message.id) === String(id)
    ) {
      return message.method;
    }
  }
  return undefined;
}

const REPLAY_CHILD_PATH = fileURLToPath(
  new URL("./replay-provider-child.mjs", import.meta.url),
);

export const PARITY_INITIALIZE_ID = "parity-initialize";

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

export async function replayRecording(
  options: ReplayRecordingOptions,
): Promise<ParityRun> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const orderTimeoutMs = options.orderTimeoutMs ?? 5_000;
  const settleMs = options.settleMs ?? 750;
  const drainMs = options.drainMs ?? 300;
  const providerId = options.providerId;
  const profile = options.profile ?? DEFAULT_REPLAY_PROFILE;
  const recording = readBridgeRecording(options.recordingDir);

  const stateDir = mkdtempSync(join(tmpdir(), "bb-parity-replay-"));
  const workspaceDir = realpathSync(
    mkdtempSync(join(tmpdir(), "bb-parity-ws-")),
  );
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
  let lastSentRuntimeEntry: { run: number; seq: number; ts: number } | null =
    null;
  const events: ThreadEvent[] = [];
  const grammarViolations: ParityGrammarViolation[] = [];
  const stalls: string[] = [];
  let stderr = "";
  const grammar = new ThreadEventGrammar();
  const liveAssembler = options.createAssembler(providerId);
  const planAssembler = (
    options.createPlanAssembler ?? options.createAssembler
  )(providerId);
  const exactPlan = options.planFromCurrentLane === true;
  const planRecording = exactPlan
    ? withCurrentBridgeLane(recording)
    : recording;
  const steps = planRuntimeSteps(planRecording, planAssembler);
  const plannedEventCount = exactPlan
    ? assembleRecordedEvents(
        planRecording,
        options.createPlanAssembler ?? options.createAssembler,
        providerId,
      ).events.length
    : null;

  const answeredIds = new Set<string>();
  const pendingBridgeRequests: { id: string | number; method: string }[] = [];
  const recordedAnswers = new Map<string, ParsedWireMessage[]>();
  for (const step of steps) {
    if (step.message !== null && isResponse(step.message)) {
      const method =
        methodOfRecordedBridgeRequest(recording, step.entry, step.message.id) ??
        "?";
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
      stalls.push(
        `no recorded answer for bridge request ${method} (${String(message.id)})`,
      );
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
        pendingBridgeRequests.push({
          id: message.id,
          method: message.method,
        });
        answerBridgeRequest(message);
        return;
      }
      if (message.method === THREAD_DELTA_NOTIFICATION_METHOD) {
        let assembled: ThreadEvent[];
        try {
          assembled = liveAssembler.assembleMessage(message);
        } catch (error) {
          stalls.push(
            `invalid thread/delta: ${error instanceof Error ? error.message : String(error)}`,
          );
          return;
        }
        for (const event of assembled) {
          const result = grammar.observe(event);
          if (result.kind === "violation") {
            grammarViolations.push({
              rule: result.rule,
              reason: result.reason,
              eventType: event.type,
            });
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

  const firstStep = steps.find(
    (step) => step.message !== null && isRequest(step.message),
  );
  setCursor(
    firstStep === undefined
      ? "end"
      : { run: firstStep.entry.run, seq: firstStep.entry.seq },
  );
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
      if (step.message !== null && !isResponse(step.message)) {
        lastSentRuntimeEntry = {
          run: step.entry.run,
          seq: step.entry.seq,
          ts: step.entry.ts,
        };
        write(step.entry.line);
      }
      continue;
    }
    const request = step.message;
    const method = request.method!;
    await waitFor(`earlier requests before ${method}`, () =>
      sentRequestIds.every((id) => answeredIds.has(id)),
    );
    await waitFor(
      `${step.gate.started} turn/started and ${step.gate.completed} turn/completed before ${method}`,
      () => {
        const live = countTurnBoundaries(events);
        return (
          live.started >= step.gate.started &&
          live.completed >= step.gate.completed
        );
      },
    );
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
      stringValue(jsonObjectValue(request.params)?.intent) === "release"
    ) {
      const threadId = stringValue(jsonObjectValue(request.params)?.threadId);
      if (threadId !== null) grammar.clearThread(threadId);
    }
    const rewritten = rewriteRecordedMachineFacts(
      step.entry.line,
      workspaceDir,
    );
    const line =
      profile.rewriteRuntimeLine === undefined
        ? rewritten
        : profile.rewriteRuntimeLine(rewritten, { replayCommand });
    lastSentRuntimeEntry = {
      run: step.entry.run,
      seq: step.entry.seq,
      ts: step.entry.ts,
    };
    write(line);
    sentRequestIds.push(String(request.id));
    const nextStep = steps
      .slice(steps.indexOf(step) + 1)
      .find(
        (candidate) =>
          candidate.message !== null && isRequest(candidate.message),
      );
    setCursor(
      nextStep === undefined
        ? "end"
        : { run: nextStep.entry.run, seq: nextStep.entry.seq },
    );
  }
  setCursor("end");
  await waitFor("the last responses", () =>
    sentRequestIds.every((id) => answeredIds.has(id)),
  );
  if (plannedEventCount !== null) {
    await waitFor(
      `all ${plannedEventCount} planned events before closing the bridge`,
      () => events.length >= plannedEventCount,
    );
  }
  await waitFor(
    "the stream to settle",
    () => Date.now() - lastOutputAt >= settleMs,
  );
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

interface AssembledRecordedEvents {
  events: ThreadEvent[];
  grammarViolations: ParityGrammarViolation[];
  invalidDeltas: string[];
}

export function assembleRecordedEvents(
  recording: BridgeRecording,
  createAssembler: CreateParityAssembler,
  providerId: string,
): AssembledRecordedEvents {
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
        stringValue(jsonObjectValue(message.params)?.intent) === "release"
      ) {
        const threadId = stringValue(jsonObjectValue(message.params)?.threadId);
        if (threadId !== null) grammar.clearThread(threadId);
      }
      continue;
    }
    if (entry.dir !== "bridge→runtime") continue;
    const message = parseWire(entry.line);
    if (message === null || message.method !== THREAD_DELTA_NOTIFICATION_METHOD)
      continue;
    let assembled: ThreadEvent[];
    try {
      assembled = assembler.assembleMessage(message);
    } catch (error) {
      invalidDeltas.push(
        error instanceof Error ? error.message : String(error),
      );
      continue;
    }
    for (const event of assembled) {
      const result = grammar.observe(event);
      if (result.kind === "violation") {
        grammarViolations.push({
          rule: result.rule,
          reason: result.reason,
          eventType: event.type,
        });
        continue;
      }
      events.push(event);
    }
  }
  return { events, grammarViolations, invalidDeltas };
}

export interface ParityAllowlistEntry {
  provider: string | "*";
  cell: string | "*";
  layer: "events" | "rows";
  path: string;
  pr: string;
  reason: string;
}

export interface ParityLayerDiff {
  onlyInOld: JsonValue[];
  onlyInNew: JsonValue[];
}

export interface ParityComparison {
  provider: string;
  cell: string;
  events: ParityLayerDiff;
  rows: ParityLayerDiff;
  grammar: ParityLayerDiff;
  staleAllowlist: ParityAllowlistEntry[];
  passed: boolean;
}

export interface ParityInputs {
  events: readonly ThreadEvent[];
  rows: readonly unknown[];
  grammarViolations?: readonly ParityGrammarViolation[];
}

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

const numberOrStringSchema = z.union([z.number(), z.string()]);
const jsonValueArraySchema = z.array(jsonValueSchema);

function blankTimeFields(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(blankTimeFields);
  }
  const object = jsonObjectValue(value);
  if (object !== null) {
    const out: JsonObject = {};
    for (const [key, entry] of Object.entries(object)) {
      const shouldBlank =
        TIME_FIELDS.has(key) && numberOrStringSchema.safeParse(entry).success;
      out[key] = shouldBlank ? 0 : blankTimeFields(entry);
    }
    return out;
  }
  return value;
}

function normalizeParityValues(
  values: readonly JsonValue[],
  internedIdFields: readonly string[],
): JsonValue[] {
  const assigned = new Map<string, string>();
  const idFields = new Set(internedIdFields);
  const normalize = (value: JsonValue): JsonValue => {
    if (Array.isArray(value)) return value.map(normalize);
    const object = jsonObjectValue(value);
    if (object === null) return value;
    const normalized: JsonObject = {};
    for (const [key, entry] of Object.entries(object)) {
      if (key === "providerCheckpointId") continue;
      if (key === "threadId" || key === "providerThreadId") {
        normalized[key] = entry === null ? null : "";
        continue;
      }
      const stringEntry = stringValue(entry);
      if (idFields.has(key) && stringEntry !== null) {
        const existing = assigned.get(stringEntry);
        if (existing !== undefined) {
          normalized[key] = existing;
        } else {
          const token = `#${assigned.size + 1}`;
          assigned.set(stringEntry, token);
          normalized[key] = token;
        }
        continue;
      }
      normalized[key] = normalize(entry);
    }
    return normalized;
  };
  return values.map(normalize);
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

export function normalizeParityEvents(
  events: readonly ThreadEvent[],
): JsonValue[] {
  const normalized = jsonValueArraySchema.parse(
    normalizeCalibrationEvents(events),
  );
  return jsonValueArraySchema.parse(blankTimeFields(normalized));
}

export function normalizeParityRows(rows: readonly unknown[]): JsonValue[] {
  const parsedRows = jsonValueArraySchema.parse(rows);
  const normalized = normalizeParityValues(parsedRows, ROW_ID_FIELDS);
  return jsonValueArraySchema.parse(blankTimeFields(normalized));
}

function pointerSegments(path: string): string[] {
  return path.split("/").filter((segment) => segment.length > 0);
}

export function maskPath(value: JsonValue, path: string): number {
  const segments = pointerSegments(path);
  if (segments.length === 0) {
    if (!Array.isArray(value)) return 0;
    const removed = value.length;
    value.length = 0;
    return removed;
  }
  let removed = 0;
  const visit = (node: JsonValue, index: number): void => {
    if (index >= segments.length) {
      return;
    }
    const container = Array.isArray(node) ? node : jsonObjectValue(node);
    if (container === null) return;
    const segment = segments[index];
    const last = index === segments.length - 1;
    if (segment === "**") {
      visit(node, index + 1);
      for (const child of Object.values(container)) {
        visit(child, index);
      }
      return;
    }
    const keys =
      segment === "*"
        ? Object.keys(container)
        : Object.hasOwn(container, segment)
          ? [segment]
          : [];
    for (const key of keys) {
      if (last) {
        if (Array.isArray(container)) {
          container[Number(key)] = null;
        } else {
          delete container[key];
        }
        removed += 1;
      } else {
        const child = Array.isArray(container)
          ? container[Number(key)]
          : container[key];
        if (child !== undefined) visit(child, index + 1);
      }
    }
  };
  visit(value, 0);
  return removed;
}

function entryApplies(
  entry: ParityAllowlistEntry,
  provider: string,
  cell: string,
): boolean {
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
    events: [
      normalizeParityEvents(oldRun.events),
      normalizeParityEvents(newRun.events),
    ],
    rows: [normalizeParityRows(oldRun.rows), normalizeParityRows(newRun.rows)],
  } as const;
  const staleAllowlist: ParityAllowlistEntry[] = [];
  for (const entry of allowlist) {
    if (!entryApplies(entry, scope.provider, scope.cell)) continue;
    const [oldSide, newSide] = layers[entry.layer];
    const removed =
      maskPath(oldSide, entry.path) + maskPath(newSide, entry.path);
    if (removed === 0) {
      staleAllowlist.push(entry);
    }
  }
  const events = diffLayer(layers.events[0], layers.events[1]);
  const rows = diffLayer(layers.rows[0], layers.rows[1]);
  const grammar = diffLayer(
    (oldRun.grammarViolations ?? []).map(
      (violation) => `${violation.rule}:${violation.eventType}`,
    ),
    (newRun.grammarViolations ?? []).map(
      (violation) => `${violation.rule}:${violation.eventType}`,
    ),
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
    passed:
      clean(events) &&
      clean(rows) &&
      clean(grammar) &&
      staleAllowlist.length === 0,
  };
}

function diffLayer(
  oldSide: readonly unknown[],
  newSide: readonly unknown[],
): ParityLayerDiff {
  const diff = diffCalibrationStreams(oldSide, newSide);
  return {
    onlyInOld: jsonValueArraySchema.parse(diff.onlyInLegacy),
    onlyInNew: jsonValueArraySchema.parse(diff.onlyInBridge),
  };
}

export function describeParityValue(value: JsonValue): string {
  const record = jsonObjectValue(value);
  if (record === null) {
    return String(value);
  }
  const type = stringValue(record.type) ?? stringValue(record.kind) ?? "?";
  const item = record.item;
  const itemRecord = jsonObjectValue(item);
  const itemType = stringValue(itemRecord?.type);
  const suffix = itemType === null ? "" : `:${itemType}`;
  return `${type}${suffix} ${JSON.stringify(value).slice(0, 160)}`;
}

export interface ReplayRecordedCellsOptions {
  recordingsRoot: string;
  servesProvider: (providerId: string) => boolean;
  cells?: readonly string[];
  bridge: (cell: RecordedCell) => {
    launch: ProviderBridgeLaunch;
    profile?: ReplayProviderProfile;
  };
  createAssembler: CreateParityAssembler;
  timeoutMs?: number;
  onStderr?: (text: string) => void;
}

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
      const recorded = assembleRecordedEvents(
        withCurrentBridgeLane(readBridgeRecording(cell.dir)),
        options.createAssembler,
        cell.provider,
      );
      const bridge = options.bridge(cell);
      const replayOptions: ReplayRecordingOptions = {
        recordingDir: cell.dir,
        providerId: cell.provider,
        bridge: bridge.launch,
        createAssembler: options.createAssembler,
        planFromCurrentLane: true,
      };
      if (bridge.profile !== undefined) replayOptions.profile = bridge.profile;
      if (options.timeoutMs !== undefined) {
        replayOptions.timeoutMs = options.timeoutMs;
      }
      if (options.onStderr !== undefined) {
        replayOptions.onStderr = options.onStderr;
      }
      const run = await replayRecording(replayOptions);
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
