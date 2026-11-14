import { threadEventSchema, type ThreadEvent } from "@bb/domain";
import { z } from "zod";
import { BRIDGE_JSON_RPC_ERRORS } from "../errors.js";
import { BRIDGE_INBOUND_REQUEST_METHODS } from "../bridge-requests.js";
import { BRIDGE_NOTIFICATION_METHODS } from "../notifications.js";
import type { ConformanceCheckResult } from "../conformance/types.js";

export type ProviderInputEntry =
  | { ts: number; kind: "spawn"; argv: string[]; env: Record<string, string> }
  | { ts: number; kind: "line"; line: string }
  | { ts: number; kind: "stdin-end" }
  | { ts: number; kind: "signal" | "exit"; signal: string };

export interface ProviderProcessInputs {
  pid: number;
  entries: ProviderInputEntry[];
}

export function parseProviderProcessInputs(
  value: unknown,
): ProviderProcessInputs {
  const entry = z.discriminatedUnion("kind", [
    z.object({
      ts: z.number(),
      kind: z.literal("spawn"),
      argv: z.array(z.string()),
      env: z.record(z.string(), z.string()),
    }),
    z.object({ ts: z.number(), kind: z.literal("line"), line: z.string() }),
    z.object({ ts: z.number(), kind: z.literal("stdin-end") }),
    z.object({
      ts: z.number(),
      kind: z.enum(["signal", "exit"]),
      signal: z.string(),
    }),
  ]);
  return z.object({ pid: z.number(), entries: z.array(entry) }).parse(value);
}

export interface RecordedScenarioEntry {
  dir: string;
  line: string;
}

export interface RecordedScenarioReplay {
  provider: string;
  cell: string;
  recording: readonly RecordedScenarioEntry[];
  bridgeLines: readonly string[];
  events: readonly ThreadEvent[];
  grammarViolations: readonly {
    rule: string;
    reason: string;
    eventType: string;
  }[];
  providerInputs: readonly ProviderProcessInputs[];
  divergence: readonly string[];
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function parseJson(line: string): Json | undefined {
  try {
    return JSON.parse(line) as Json;
  } catch {
    return undefined;
  }
}

function isObject(value: Json | undefined): value is { [key: string]: Json } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringLeaves(value: Json | undefined, into: string[] = []): string[] {
  if (typeof value === "string") into.push(value);
  else if (Array.isArray(value))
    for (const item of value) stringLeaves(item, into);
  else if (isObject(value))
    for (const item of Object.values(value)) stringLeaves(item, into);
  return into;
}

function result(
  id: string,
  title: string,
  detail: string | null,
): ConformanceCheckResult {
  return detail === null
    ? { id, title, status: "pass", detail: "" }
    : { id, title, status: "fail", detail };
}

function skipped(
  id: string,
  title: string,
  detail: string,
): ConformanceCheckResult {
  return { id, title, status: "skipped", detail };
}

interface Settings {
  model: string;
  reasoningLevel: string;
  permissionMode: string;
  env: Record<string, string>;
}

interface Dispatch {
  method: "turn/start" | "turn/steer";
  id: string;
  clientRequestId: string;
  text: string;
  settings: Settings;
  recordedIndex: number;
}

interface RuntimeScript {
  threadStart: Settings | null;
  dispatches: Dispatch[];
}

const executionOptionsSchema = (): z.ZodType<Settings> =>
  z
    .object({
      model: z.string(),
      reasoningLevel: z.string(),
      permissionMode: z.string(),
      envVars: z.record(z.string(), z.string()).default({}),
    })
    .transform(({ envVars, ...rest }) => ({ ...rest, env: envVars }));

function readRuntimeScript(
  recording: readonly RecordedScenarioEntry[],
): RuntimeScript {
  const options = executionOptionsSchema();
  const request = z.object({
    id: z.union([z.string(), z.number()]),
    method: z.string(),
    params: z.object({ options: z.unknown() }).passthrough(),
  });
  const turnParams = z.object({
    clientRequestId: z.string(),
    input: z.array(z.object({ type: z.string(), text: z.string().optional() })),
  });
  let threadStart: Settings | null = null;
  const dispatches: Dispatch[] = [];
  for (const [index, entry] of recording.entries()) {
    if (entry.dir !== "runtime→bridge") continue;
    const parsed = request.safeParse(parseJson(entry.line));
    if (!parsed.success) continue;
    const { method, params, id } = parsed.data;
    if (method === "thread/start") {
      threadStart = options.parse(params.options);
      continue;
    }
    if (method !== "turn/start" && method !== "turn/steer") continue;
    const turn = turnParams.parse(params);
    dispatches.push({
      method,
      id: String(id),
      clientRequestId: turn.clientRequestId,
      text: turn.input
        .flatMap((item) => (item.text === undefined ? [] : [item.text]))
        .join("\n"),
      settings: options.parse(params.options),
      recordedIndex: index,
    });
  }
  return { threadStart, dispatches };
}

interface ProviderLine {
  process: ProviderProcessInputs;
  index: number;
  ts: number;
  json: Json | undefined;
}

function providerLines(
  inputs: readonly ProviderProcessInputs[],
): ProviderLine[] {
  const lines: ProviderLine[] = [];
  for (const process of inputs) {
    for (const [index, entry] of process.entries.entries()) {
      if (entry.kind !== "line") continue;
      lines.push({ process, index, ts: entry.ts, json: parseJson(entry.line) });
    }
  }
  return lines.sort((left, right) => left.ts - right.ts);
}

function carriesPrompt(line: ProviderLine, text: string): boolean {
  return stringLeaves(line.json).some((leaf) => leaf.includes(text));
}

function findPrompt(
  lines: readonly ProviderLine[],
  text: string,
  after: ProviderLine | null,
): ProviderLine | null {
  return (
    lines.find(
      (line) =>
        (after === null ||
          line.ts > after.ts ||
          (line.ts === after.ts &&
            line.process === after.process &&
            line.index > after.index)) &&
        carriesPrompt(line, text),
    ) ?? null
  );
}

interface DeliveryWindow {
  lines: Json[];
  spawn: { argv: string[]; env: Record<string, string> } | null;
}

function deliveryWindow(
  previous: ProviderLine | null,
  prompt: ProviderLine,
): DeliveryWindow {
  const { process } = prompt;
  const sameProcess = previous !== null && previous.process === process;
  const first = sameProcess ? previous.index + 1 : 0;
  const lines: Json[] = [];
  let spawn: DeliveryWindow["spawn"] = null;
  for (const [index, entry] of process.entries.entries()) {
    if (index > prompt.index) break;
    if (entry.kind === "spawn" && !sameProcess) {
      spawn = { argv: entry.argv, env: entry.env };
    }
    if (index < first || entry.kind !== "line") continue;
    const json = parseJson(entry.line);
    if (json !== undefined) lines.push(json);
  }
  return { lines, spawn };
}

function argvValues(argv: readonly string[]): string[] {
  return argv.flatMap((token) => {
    const equals = token.indexOf("=");
    return equals > 0 && token.startsWith("-")
      ? [token, token.slice(equals + 1)]
      : [token];
  });
}

function windowHasValue(window: DeliveryWindow, value: string): boolean {
  return (
    window.lines.some((line) => stringLeaves(line).includes(value)) ||
    (window.spawn !== null && argvValues(window.spawn.argv).includes(value))
  );
}

function windowHasModel(window: DeliveryWindow, model: string): boolean {
  const slash = model.indexOf("/");
  return (
    windowHasValue(window, model) ||
    (slash > 0 &&
      windowHasValue(window, model.slice(0, slash)) &&
      windowHasValue(window, model.slice(slash + 1)))
  );
}

const PROVIDER_PERMISSION_VALUES: Readonly<
  Record<string, Readonly<Record<string, readonly string[]>>>
> = {
  codex: {
    full: ["danger-full-access", "dangerFullAccess"],
    "accept-edits": ["workspace-write", "workspaceWrite"],
    auto: ["workspace-write", "workspaceWrite"],
  },
  "claude-code": {
    full: ["bypassPermissions"],
    "accept-edits": ["acceptEdits"],
  },
};

interface ApprovalRouting {
  commands: Set<string>;
  routedCommands: Set<string>;
}

function acpExecuteToolCallId(message: Json | undefined): string | null {
  if (!isObject(message) || !isObject(message.params)) return null;
  const toolCall =
    message.method === "session/request_permission"
      ? message.params.toolCall
      : message.method === "session/update" &&
          isObject(message.params.update) &&
          message.params.update.sessionUpdate === "tool_call"
        ? message.params.update
        : undefined;
  return isObject(toolCall) &&
    toolCall.kind === "execute" &&
    typeof toolCall.toolCallId === "string"
    ? toolCall.toolCallId
    : null;
}

function acpCommandApprovals(
  replay: RecordedScenarioReplay,
  dispatch: Dispatch,
  next: Dispatch | undefined,
): ApprovalRouting {
  const commands = new Set<string>();
  const end = next?.recordedIndex ?? replay.recording.length;
  for (const entry of replay.recording.slice(dispatch.recordedIndex, end)) {
    if (entry.dir !== "provider→bridge") continue;
    const toolCallId = acpExecuteToolCallId(parseJson(entry.line));
    if (toolCallId !== null) commands.add(toolCallId);
  }
  const routedCommands = new Set<string>();
  for (const line of replay.bridgeLines) {
    const message = parseJson(line);
    if (
      !isObject(message) ||
      message.method !== BRIDGE_INBOUND_REQUEST_METHODS.interactionRequest
    )
      continue;
    for (const leaf of stringLeaves(message.params)) {
      if (commands.has(leaf)) routedCommands.add(leaf);
    }
  }
  return { commands, routedCommands };
}

type SettingDimension = "model" | "reasoning" | "env" | "permission";

function changedDimensions(
  before: Settings,
  after: Settings,
): Array<{ dimension: SettingDimension; values: string[] }> {
  const changes: Array<{ dimension: SettingDimension; values: string[] }> = [];
  if (before.model !== after.model)
    changes.push({ dimension: "model", values: [after.model] });
  if (before.reasoningLevel !== after.reasoningLevel)
    changes.push({ dimension: "reasoning", values: [after.reasoningLevel] });
  const envValues = Object.entries(after.env)
    .filter(([name, value]) => value !== "" && before.env[name] !== value)
    .map(([, value]) => value);
  if (envValues.length > 0)
    changes.push({ dimension: "env", values: envValues });
  if (before.permissionMode !== after.permissionMode)
    changes.push({ dimension: "permission", values: [after.permissionMode] });
  return changes;
}

function providerFamily(provider: string): string {
  return provider.startsWith("acp-") ? "acp" : provider;
}

function checkSettingsReachProvider(
  replay: RecordedScenarioReplay,
): ConformanceCheckResult[] {
  const prefix = `scenario/${replay.cell}`;
  const script = readRuntimeScript(replay.recording);
  const lines = providerLines(replay.providerInputs);
  const results: ConformanceCheckResult[] = [];
  let previousSettings = script.threadStart;
  let previousPrompt: ProviderLine | null = null;
  for (const [index, dispatch] of script.dispatches.entries()) {
    const prompt = findPrompt(lines, dispatch.text, previousPrompt);
    const steer = dispatch.method === "turn/steer";
    const changes = (
      previousSettings === null
        ? []
        : changedDimensions(previousSettings, dispatch.settings)
    ).filter((change) => !steer || change.dimension === "permission");
    const via = steer ? "steer" : "follow-up";
    for (const { dimension, values } of changes) {
      const id = `${prefix}/${dimension}-reaches-provider`;
      const title = `a ${dimension} change sent with a ${via} reaches the provider before it works on that prompt`;
      if (prompt === null) {
        results.push(
          result(id, title, `the provider never received the ${via} prompt`),
        );
        continue;
      }
      const window = deliveryWindow(previousPrompt, prompt);
      if (dimension === "env") {
        const missing = values.filter(
          (value) =>
            !windowHasValue(window, value) &&
            !(
              window.spawn !== null &&
              Object.values(window.spawn.env).includes(value)
            ),
        );
        results.push(
          result(
            id,
            title,
            missing.length === 0
              ? null
              : `the provider got the ${via} prompt without the changed environment value(s) ${missing.join(", ")}`,
          ),
        );
        continue;
      }
      if (dimension !== "permission") {
        const delivered =
          dimension === "model"
            ? windowHasModel(window, values[0]!)
            : windowHasValue(window, values[0]!);
        results.push(
          result(
            id,
            title,
            delivered
              ? null
              : `the provider got the ${via} prompt without being told ${dimension} ${values[0]}`,
          ),
        );
        continue;
      }
      const family = providerFamily(replay.provider);
      if (family === "acp") {
        const routing = acpCommandApprovals(
          replay,
          dispatch,
          script.dispatches[index + 1],
        );
        if (routing.commands.size === 0) {
          results.push(
            skipped(id, title, "the agent ran no command after the change"),
          );
          continue;
        }
        const unrouted = [...routing.commands].filter(
          (toolCallId) => !routing.routedCommands.has(toolCallId),
        );
        results.push(
          result(
            id,
            title,
            unrouted.length === 0
              ? null
              : `under ${values[0]} the agent ran command(s) ${unrouted.join(", ")} without the user approving them`,
          ),
        );
        continue;
      }
      const markers = PROVIDER_PERMISSION_VALUES[family]?.[values[0]!];
      if (markers === undefined) {
        results.push(
          skipped(
            id,
            title,
            `no provider vocabulary for ${values[0]} on ${family}`,
          ),
        );
        continue;
      }
      results.push(
        result(
          id,
          title,
          markers.some((marker) => windowHasValue(window, marker))
            ? null
            : `the provider got the ${via} prompt without being told permission mode ${values[0]} (${markers.join(" or ")})`,
        ),
      );
    }
    previousSettings = dispatch.settings;
    if (prompt !== null) previousPrompt = prompt;
  }
  return results;
}

interface BridgeResponse {
  result?: Json;
  error?: { code: number; data: Json | undefined };
}

function bridgeResponses(
  lines: readonly string[],
): Map<string, BridgeResponse> {
  const responses = new Map<string, BridgeResponse>();
  for (const line of lines) {
    const message = parseJson(line);
    if (!isObject(message) || "method" in message || !("id" in message))
      continue;
    const error = message.error;
    responses.set(
      String(message.id),
      isObject(error)
        ? {
            error: {
              code: typeof error.code === "number" ? error.code : 0,
              data: error.data,
            },
          }
        : { result: message.result ?? null },
    );
  }
  return responses;
}

function isStaleSteerError(error: {
  code: number;
  data: Json | undefined;
}): boolean {
  if (error.code === BRIDGE_JSON_RPC_ERRORS.NO_ACTIVE_TURN) return true;
  const recovery = isObject(error.data) ? error.data.recovery : undefined;
  return isObject(recovery) && recovery.kind === "staleTurn";
}

function checkInputRules(
  replay: RecordedScenarioReplay,
): ConformanceCheckResult[] {
  const prefix = `scenario/${replay.cell}`;
  const script = readRuntimeScript(replay.recording);
  const responses = bridgeResponses(replay.bridgeLines);
  const results: ConformanceCheckResult[] = [];

  const steerProblems = script.dispatches
    .filter((dispatch) => dispatch.method === "turn/steer")
    .flatMap((dispatch) => {
      const error = responses.get(dispatch.id)?.error;
      return error === undefined || isStaleSteerError(error)
        ? []
        : [
            `steer ${dispatch.clientRequestId} failed with ${error.code} instead of the stale-turn contract (NO_ACTIVE_TURN or a staleTurn recovery hint)`,
          ];
    });
  if (script.dispatches.some((dispatch) => dispatch.method === "turn/steer")) {
    results.push(
      result(
        `${prefix}/missed-steer-is-stale`,
        "a steer whose turn already ended is rejected as stale, so the runtime can start or retarget a turn",
        steerProblems.length === 0 ? null : steerProblems.join("; "),
      ),
    );
  }

  const acceptedCounts = new Map<string, number>();
  for (const event of replay.events) {
    if (event.type !== "turn/input/accepted") continue;
    acceptedCounts.set(
      event.clientRequestId,
      (acceptedCounts.get(event.clientRequestId) ?? 0) + 1,
    );
  }
  const acceptedProblems: string[] = [];
  for (const clientRequestId of new Set(
    script.dispatches.map((dispatch) => dispatch.clientRequestId),
  )) {
    const succeeded = script.dispatches.some(
      (dispatch) =>
        dispatch.clientRequestId === clientRequestId &&
        responses.get(dispatch.id)?.result !== undefined,
    );
    const accepted = acceptedCounts.get(clientRequestId) ?? 0;
    if (accepted !== (succeeded ? 1 : 0)) {
      acceptedProblems.push(
        `${clientRequestId} was accepted ${accepted} time(s) after ${succeeded ? "a successful" : "only failed"} dispatch`,
      );
    }
  }
  results.push(
    result(
      `${prefix}/each-message-accepted-once`,
      "every message the bridge took is accepted exactly once, and a rejected one never",
      acceptedProblems.length === 0 ? null : acceptedProblems.join("; "),
    ),
  );

  const turnsWithInput = new Set<string>();
  const startedTurns: string[] = [];
  for (const event of replay.events) {
    if (event.type === "turn/input/accepted" && event.scope.kind === "turn")
      turnsWithInput.add(event.scope.turnId);
    if (event.type === "turn/started" && event.scope.kind === "turn")
      startedTurns.push(event.scope.turnId);
  }
  const orphanTurns = startedTurns.filter(
    (turnId) => !turnsWithInput.has(turnId),
  );
  results.push(
    result(
      `${prefix}/turns-carry-input`,
      "every turn carries the message that started it: no reply lands in a turn of its own",
      orphanTurns.length === 0
        ? null
        : `turn(s) ${orphanTurns.join(", ")} opened without accepted input`,
    ),
  );

  const completed = new Set<string>();
  for (const event of replay.events) {
    if (event.type === "turn/completed" && event.scope.kind === "turn")
      completed.add(event.scope.turnId);
  }
  const unsettled = startedTurns.filter((turnId) => !completed.has(turnId));
  results.push(
    result(
      `${prefix}/every-turn-settles`,
      "every turn that started reaches a terminal state",
      unsettled.length === 0
        ? null
        : `turn(s) ${unsettled.join(", ")} never completed`,
    ),
  );
  return results;
}

function checkProviderExit(
  replay: RecordedScenarioReplay,
): ConformanceCheckResult[] {
  const prefix = `scenario/${replay.cell}`;
  const script = readRuntimeScript(replay.recording);
  const responses = bridgeResponses(replay.bridgeLines);
  const exitAt = replay.providerInputs
    .flatMap((process) => process.entries)
    .find((entry) => entry.kind === "exit")?.ts;
  const results: ConformanceCheckResult[] = [];
  if (exitAt === undefined) {
    return [
      result(
        `${prefix}/provider-died`,
        "the replayed provider process died where the recorded one did",
        "the replay never reached the recorded exit point",
      ),
    ];
  }
  const lines = providerLines(replay.providerInputs);
  const after = script.dispatches.filter((dispatch) => {
    const prompt = findPrompt(lines, dispatch.text, null);
    return prompt === null || prompt.ts > exitAt;
  });
  const problems = after.flatMap((dispatch) => {
    const response = responses.get(dispatch.id);
    if (response?.error !== undefined)
      return [
        `${dispatch.method} ${dispatch.clientRequestId} failed with ${response.error.code}`,
      ];
    if (findPrompt(lines, dispatch.text, null) === null)
      return [
        `${dispatch.method} ${dispatch.clientRequestId} never reached a provider`,
      ];
    return [];
  });
  results.push(
    result(
      `${prefix}/next-turn-runs`,
      "after the provider process dies, the next message is taken and reaches a new provider process",
      after.length === 0
        ? "no message was sent after the exit"
        : problems.length === 0
          ? null
          : problems.join("; "),
    ),
  );

  let sessionBeforeExit: string | null = null;
  let contextLossAnnounced = false;
  for (const line of replay.bridgeLines) {
    const message = parseJson(line);
    if (!isObject(message) || !isObject(message.params)) continue;
    if (
      message.method === BRIDGE_NOTIFICATION_METHODS.sessionReplaced &&
      message.params.contextLost === true
    ) {
      contextLossAnnounced = true;
    }
  }
  for (const line of replay.bridgeLines) {
    const message = parseJson(line);
    if (!isObject(message) || !isObject(message.params)) continue;
    const deltas = Array.isArray(message.params.deltas)
      ? message.params.deltas.filter(isObject)
      : [];
    for (const delta of deltas) {
      if (
        delta.kind === "thread.identity" &&
        typeof delta.providerThreadId === "string"
      )
        sessionBeforeExit = delta.providerThreadId;
    }
    if (deltas.some((delta) => delta.kind === "turn.boundary")) break;
    if (
      message.method === BRIDGE_NOTIFICATION_METHODS.threadIdentity &&
      typeof message.params.providerThreadId === "string"
    ) {
      sessionBeforeExit = message.params.providerThreadId;
    }
  }
  const replacements = replay.providerInputs.filter((process) => {
    const spawn = process.entries[0];
    return spawn?.kind === "spawn" && spawn.ts >= exitAt;
  });
  const resumed =
    sessionBeforeExit !== null &&
    replacements.some((process) =>
      process.entries.some((entry) =>
        entry.kind === "spawn"
          ? entry.argv.some((token) => token.includes(sessionBeforeExit!))
          : entry.kind === "line" && entry.line.includes(sessionBeforeExit!),
      ),
    );
  results.push(
    result(
      `${prefix}/conversation-survives`,
      "the provider process that replaces the dead one resumes the same conversation, or the bridge says context was lost",
      sessionBeforeExit === null
        ? "the bridge never announced a provider session"
        : resumed || contextLossAnnounced
          ? null
          : `no replacement provider process was given session ${sessionBeforeExit}, and no context loss was announced`,
    ),
  );
  return results;
}

export const RECORDED_SCENARIO_CELLS = [
  "settings-follow-up",
  "settings-steer",
  "steer-race",
  "provider-exit",
] as const;

function checkEventRules(
  replay: RecordedScenarioReplay,
): ConformanceCheckResult[] {
  const prefix = `scenario/${replay.cell}`;
  const invalid = replay.events.flatMap((event, index) => {
    const parsed = threadEventSchema.safeParse(event);
    return parsed.success
      ? []
      : [
          `event ${index} (${event.type}): ${parsed.error.issues[0]?.message ?? "invalid"}`,
        ];
  });
  return [
    result(
      `${prefix}/events-schema-valid`,
      "every assembled event is a valid ThreadEvent",
      invalid.length === 0 ? null : invalid.join("; "),
    ),
    result(
      `${prefix}/grammar`,
      "the event stream breaks no thread-event grammar rule",
      replay.grammarViolations.length === 0
        ? null
        : replay.grammarViolations
            .map(
              (violation) =>
                `${violation.rule} on ${violation.eventType}: ${violation.reason}`,
            )
            .join("; "),
    ),
  ];
}

const OUTPUT_DEPENDENT_RULES = new Set([
  "each-message-accepted-once",
  "turns-carry-input",
  "every-turn-settles",
  "missed-steer-is-stale",
  "next-turn-runs",
  "provider-died",
]);

function judgeableAfterDivergence(check: ConformanceCheckResult): boolean {
  const rule = check.id.split("/").at(-1) ?? "";
  return (
    !OUTPUT_DEPENDENT_RULES.has(rule) &&
    !check.detail.includes("never received")
  );
}

export function checkRecordedScenarioReplay(
  replay: RecordedScenarioReplay,
): ConformanceCheckResult[] {
  const results = [...checkEventRules(replay), ...checkInputRules(replay)];
  if (
    replay.cell === "settings-follow-up" ||
    replay.cell === "settings-steer"
  ) {
    results.push(...checkSettingsReachProvider(replay));
  }
  if (replay.cell === "provider-exit") {
    results.push(...checkProviderExit(replay));
  }
  if (replay.divergence.length === 0) return results;
  return results.map((check) =>
    check.status !== "fail" || judgeableAfterDivergence(check)
      ? check
      : skipped(
          check.id,
          check.title,
          `the bridge no longer talks to the provider the way the recording did (${replay.divergence[0]}), so this rule cannot be judged; re-record the cell (was: ${check.detail})`,
        ),
  );
}
