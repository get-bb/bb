/**
 * Per-agent dialects: the vendor side channels of an ACP agent.
 *
 * The ACP wire schema (`wire.ts`) parses only the protocol. What an agent
 * puts beside the protocol is a dialect: grok stamps `_meta["x.ai/tool"]` on
 * every tool event, Cursor reports its sub-agents through a vendor JSON-RPC
 * request (`cursor/task`) that the protocol has no place for. A dialect is a
 * small, per-agent module that reads those channels and answers the few
 * questions the shared translator asks. The shared schema never learns a
 * vendor key, and a dialect never changes what a protocol field means.
 *
 * Version 1 of the protocol has no sub-agent concept at all (`session/fork`
 * is unstable and unrelated), so every delegation an ACP agent reports is
 * vendor-specific and belongs here rather than in the classifier.
 *
 * The dialect is selected per session from the agent's launch command. An
 * agent with no dialect of its own gets the generic one, which answers
 * nothing and leaves every decision to the protocol fields.
 */

import type { DeltaItemShape } from "@bb/provider-bridge-protocol";
import { basename } from "node:path";
import { z } from "zod";
import {
  CURSOR_ACP_MAINTENANCE,
  type AcpMaintenanceDialect,
} from "./bridge/provider-maintenance.js";
import { delegationPresentation } from "./presentation.js";
import type {
  AcpClassifiedToolCall,
  AcpCommandResult,
} from "./tool-classification.js";
import {
  acpToolKindSchema,
  type AcpToolCallUpdateEvent,
  type AcpToolKind,
} from "./wire.js";

/**
 * The programmatic identity of a tool call, when the agent reports one
 * outside the protocol's unstable `name` field: the tool's own name and, for
 * an agent that sends the `kind` late (grok puts it on the first update, a
 * few milliseconds after the `tool_call`), the kind at open, so the opened
 * shape and the closed shape agree.
 */
export interface AcpToolIdentity {
  name?: string;
  kind?: AcpToolKind;
}

/** What a dialect learned about a sub-agent the agent launched. */
export interface AcpDelegationReport {
  /** The tool call the delegation belongs to. */
  toolCallId: string;
  /** The child's provider-native id. */
  childRef: string;
  /** The row headline: what the sub-agent was asked to do. */
  label: string;
  /** A sub-agent type or model the row can name, when the agent says. */
  detail?: string;
}

export interface AcpDialect {
  /** Stable id, for logs and tests. */
  readonly id: string;
  /**
   * The tool identity a tool_call / tool_call_update carries in the agent's
   * side channel, if any. The translator fills an absent protocol `name` and
   * `kind` from it; a protocol value always wins over the dialect's.
   */
  toolIdentity?(event: AcpToolCallUpdateEvent): AcpToolIdentity | undefined;
  /**
   * The agent's own classification of a tool call, when its side channel
   * says something the protocol fields cannot. Returning `undefined` leaves
   * the shared classifier in charge — which is the normal answer.
   */
  classifyToolCall?(
    event: AcpToolCallUpdateEvent,
  ): AcpClassifiedToolCall | undefined;
  /**
   * A command result carried in the agent's non-standard rawOutput shape.
   * Returning `undefined` leaves the shared ACP result parser in charge.
   */
  commandResult?(event: AcpToolCallUpdateEvent): AcpCommandResult | undefined;
  /**
   * A command event with the agent's non-standard result fields normalized
   * into the shared ACP result shapes. The hook runs only after the call has
   * classified as a command; existing shared result fields must win.
   */
  normalizeCommandEvent?(event: AcpToolCallUpdateEvent): AcpToolCallUpdateEvent;
  /**
   * A vendor JSON-RPC request the agent sends to the client. A dialect that
   * answers one returns the JSON-RPC result to reply with (`{}` is a valid
   * acknowledgement) and, optionally, what the request reported. A request
   * no dialect claims stays an unsupported method.
   */
  handleClientRequest?(
    method: string,
    params: unknown,
  ): AcpClientRequestOutcome | undefined;
  /**
   * How bb keeps this agent healthy: sign-in, installation, account and
   * usage. ACP standardizes none of it, so an agent without one reports only
   * whether its executable exists.
   */
  maintenance?: AcpMaintenanceDialect;
}

export interface AcpClientRequestOutcome {
  /** The JSON-RPC result the bridge replies with. */
  result: Record<string, unknown>;
  /** A sub-agent the request reported, if it reported one. */
  delegation?: AcpDelegationReport;
}

/** The dialect of an agent with no side channels bb reads. */
export const GENERIC_ACP_DIALECT: AcpDialect = { id: "acp" };

// ---------------------------------------------------------------------------
// grok (`grok agent stdio`)
// ---------------------------------------------------------------------------

/**
 * grok stamps `_meta["x.ai/tool"]` on every tool event: the tool's
 * programmatic name (`run_terminal_command`, `read_file`), its kind, a label,
 * and a read-only flag. The `tool_call` itself carries no `kind` and the
 * model's tool name as its title; the first `tool_call_update` adds the kind
 * and a human title.
 */
const grokToolMetaSchema = z
  .object({
    "x.ai/tool": z
      .object({
        name: z.string().optional(),
        kind: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();

function grokToolIdentity(
  event: AcpToolCallUpdateEvent,
): AcpToolIdentity | undefined {
  const meta = grokToolMetaSchema.safeParse(event["_meta"]);
  if (!meta.success) {
    return undefined;
  }
  const tool = meta.data["x.ai/tool"];
  const kind = acpToolKindSchema.safeParse(tool.kind);
  return {
    ...(tool.name !== undefined && tool.name.length > 0
      ? { name: tool.name }
      : {}),
    ...(kind.success ? { kind: kind.data } : {}),
  };
}

/** grok's sub-agent tool and the argument that describes the work. */
const GROK_SPAWN_SUBAGENT_TOOL = "spawn_subagent";
const grokSpawnSubagentInputSchema = z
  .object({
    description: z.string().optional(),
    prompt: z.string().optional(),
    subagent_type: z.string().optional(),
  })
  .passthrough();

/**
 * grok runs sub-agents through a `spawn_subagent` tool call (with
 * `get_command_or_subagent_output` and `kill_command_or_subagent` beside it).
 * The protocol reports it as an ordinary tool call, so only the dialect can
 * know it is delegated work.
 */
function grokClassifyToolCall(
  event: AcpToolCallUpdateEvent,
): AcpClassifiedToolCall | undefined {
  if (grokToolIdentity(event)?.name !== GROK_SPAWN_SUBAGENT_TOOL) {
    return undefined;
  }
  const parsed = grokSpawnSubagentInputSchema.safeParse(event.rawInput);
  const input = parsed.success ? parsed.data : undefined;
  const label = input?.description ?? input?.prompt ?? event.title ?? "Subagent";
  const shape: DeltaItemShape = {
    type: "delegation",
    // grok reports no child session id, so the tool call is the child ref:
    // it is what its output and kill calls name.
    childRef: event.toolCallId,
    label,
    background: false,
  };
  return {
    item: shape,
    presentation: delegationPresentation({
      label,
      ...(input?.subagent_type === undefined
        ? {}
        : { detail: input.subagent_type }),
    }),
  };
}

export const GROK_ACP_DIALECT: AcpDialect = {
  id: "grok",
  toolIdentity: grokToolIdentity,
  classifyToolCall: grokClassifyToolCall,
};

// ---------------------------------------------------------------------------
// cursor-agent (`cursor-agent acp`)
// ---------------------------------------------------------------------------

/** Cursor's own name for the tool behind a sub-agent call. */
const CURSOR_TASK_TOOL = "task";
const cursorTaskRawInputSchema = z
  .object({ _toolName: z.string().optional() })
  .passthrough();

const CURSOR_TASK_METHOD = "cursor/task";
const cursorTaskParamsSchema = z
  .object({
    toolCallId: z.string(),
    description: z.string().optional(),
    prompt: z.string().optional(),
    agentId: z.string().optional(),
    model: z.string().optional(),
  })
  .passthrough();

/**
 * Cursor announces a sub-agent as a `kind: "other"` tool call whose rawInput
 * names the tool (`{_toolName: "task"}`) and whose title is the constant
 * "Task: Subagent task". The description, prompt, child agent id and duration
 * arrive later, on the vendor `cursor/task` request.
 */
function cursorClassifyToolCall(
  event: AcpToolCallUpdateEvent,
): AcpClassifiedToolCall | undefined {
  const parsed = cursorTaskRawInputSchema.safeParse(event.rawInput);
  if (!parsed.success || parsed.data._toolName !== CURSOR_TASK_TOOL) {
    return undefined;
  }
  const label = event.title ?? "Subagent task";
  const shape: DeltaItemShape = {
    type: "delegation",
    childRef: event.toolCallId,
    label,
    background: false,
  };
  return {
    item: shape,
    presentation: delegationPresentation({ label }),
  };
}

/**
 * `cursor/task` is Cursor's sub-agent report. bb answered it `-32601`
 * ("unsupported method"), which is a protocol error for a request the agent
 * is entitled to send; an empty result acknowledges it. Cursor sends it once
 * the sub-agent has finished, so the report names the child and what it was
 * asked to do.
 */
function cursorHandleClientRequest(
  method: string,
  params: unknown,
): AcpClientRequestOutcome | undefined {
  if (method !== CURSOR_TASK_METHOD) {
    return undefined;
  }
  const parsed = cursorTaskParamsSchema.safeParse(params);
  if (!parsed.success) {
    return { result: {} };
  }
  const task = parsed.data;
  const label = task.description ?? task.prompt;
  if (label === undefined) {
    return { result: {} };
  }
  return {
    result: {},
    delegation: {
      toolCallId: task.toolCallId,
      childRef: task.agentId ?? task.toolCallId,
      label,
      ...(task.model === undefined ? {} : { detail: `model ${task.model}` }),
    },
  };
}

export const CURSOR_ACP_DIALECT: AcpDialect = {
  id: "cursor",
  classifyToolCall: cursorClassifyToolCall,
  handleClientRequest: cursorHandleClientRequest,
  maintenance: CURSOR_ACP_MAINTENANCE,
};

// ---------------------------------------------------------------------------
// omp (`omp acp`)
// ---------------------------------------------------------------------------

/**
 * omp forwards its Bash AgentToolResult as rawOutput. Foreground successes
 * omit `details.exitCode`, while failures carry the non-zero value. The text
 * block includes renderer notices derived from those details. Background
 * launches also close as completed, so both of omp's async markers must keep
 * them out of foreground result normalization.
 */
const ompBashRawInputSchema = z
  .object({
    command: z.string(),
    async: z.boolean().optional(),
  })
  .passthrough();

const ompBashRawOutputSchema = z
  .object({
    content: z.array(
      z
        .object({
          type: z.literal("text"),
          text: z.string(),
        })
        .passthrough(),
    ),
    details: z
      .object({
        exitCode: z.number().int().optional(),
        wallTimeMs: z.number().nonnegative().optional(),
        timedOut: z.boolean().optional(),
        signal: z.unknown().optional(),
        async: z.unknown().optional(),
      })
      .passthrough(),
    // If an OMP version emits generic ACP result fields, the shared parser
    // owns those exit/output/timeout/signal semantics.
    exitCode: z.number().int().nullable().optional(),
    exit_code: z.number().int().nullable().optional(),
    stdout: z.string().optional(),
    stderr: z.string().optional(),
    output_for_prompt: z.string().optional(),
    signal: z.string().nullable().optional(),
    timed_out: z.boolean().optional(),
  })
  .passthrough();

function stripOmpTrailingNotice(text: string, notice: string): string {
  const suffix = `\n\n${notice}`;
  return text.endsWith(suffix) ? text.slice(0, -suffix.length) : text;
}

function ompCommandResult(
  event: AcpToolCallUpdateEvent,
): AcpCommandResult | undefined {
  if (event.kind !== "execute") {
    return undefined;
  }
  const parsedInput = ompBashRawInputSchema.safeParse(event.rawInput);
  const parsedOutput = ompBashRawOutputSchema.safeParse(event.rawOutput);
  if (
    !parsedInput.success ||
    parsedInput.data.command.trim().length === 0 ||
    !parsedOutput.success
  ) {
    return undefined;
  }
  const rawOutput = parsedOutput.data;
  const details = rawOutput.details;
  const hasGenericCommandResult =
    rawOutput.exitCode !== undefined ||
    rawOutput.exit_code !== undefined ||
    rawOutput.stdout !== undefined ||
    rawOutput.stderr !== undefined ||
    rawOutput.output_for_prompt !== undefined ||
    (rawOutput.signal !== undefined && rawOutput.signal !== null) ||
    rawOutput.timed_out === true;
  if (
    parsedInput.data.async === true ||
    details.async !== undefined ||
    hasGenericCommandResult
  ) {
    return undefined;
  }
  if (details.exitCode === undefined && details.wallTimeMs === undefined) {
    return undefined;
  }

  let output = rawOutput.content.map((block) => block.text).join("\n");
  if (details.exitCode !== undefined) {
    output = stripOmpTrailingNotice(
      output,
      `Command exited with code ${String(details.exitCode)}`,
    );
  }
  if (details.wallTimeMs !== undefined) {
    output = stripOmpTrailingNotice(
      output,
      `Wall time: ${(details.wallTimeMs / 1_000).toFixed(2)} seconds`,
    );
  }

  const isCompletedForegroundBash =
    event.status === "completed" &&
    details.timedOut !== true &&
    (details.signal === undefined || details.signal === null);
  const exitCode =
    details.exitCode ?? (isCompletedForegroundBash ? 0 : undefined);
  return {
    ...(exitCode === undefined ? {} : { exitCode }),
    ...(output.length === 0 ? {} : { output }),
  };
}

export const OMP_ACP_DIALECT: AcpDialect = {
  id: "omp",
  commandResult: ompCommandResult,
};

// ---------------------------------------------------------------------------
// opencode (`opencode acp`)
// ---------------------------------------------------------------------------

/**
 * OpenCode reports command output twice on its AgentToolResult envelope and
 * puts the process exit code in metadata. The shared ACP parser deliberately
 * does not claim these generic-looking vendor fields for every agent.
 */
const openCodeCommandRawOutputSchema = z
  .object({
    output: z.unknown().optional(),
    metadata: z
      .object({
        exit: z.number().int().nullable().optional(),
        output: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

function normalizeOpenCodeCommandEvent(
  event: AcpToolCallUpdateEvent,
): AcpToolCallUpdateEvent {
  const parsed = openCodeCommandRawOutputSchema.safeParse(event.rawOutput);
  if (!parsed.success) {
    return event;
  }
  const rawOutput = parsed.data;
  const output =
    typeof rawOutput.output === "string"
      ? rawOutput.output
      : rawOutput.metadata?.output;
  const hasSharedOutput =
    rawOutput["stdout"] !== undefined ||
    rawOutput["stderr"] !== undefined ||
    rawOutput["output_for_prompt"] !== undefined;
  const hasSharedExitCode =
    rawOutput["exitCode"] !== undefined || rawOutput["exit_code"] !== undefined;
  const exitCode = rawOutput.metadata?.exit ?? undefined;
  if (
    (output === undefined || hasSharedOutput) &&
    (exitCode === undefined || hasSharedExitCode)
  ) {
    return event;
  }
  return {
    ...event,
    rawOutput: {
      ...rawOutput,
      ...(output === undefined || hasSharedOutput ? {} : { stdout: output }),
      ...(exitCode === undefined || hasSharedExitCode ? {} : { exitCode }),
    },
  };
}

export const OPENCODE_ACP_DIALECT: AcpDialect = {
  id: "opencode",
  normalizeCommandEvent: normalizeOpenCodeCommandEvent,
};

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/**
 * Every dialect the bridge can select, by id: the ones this kit ships. A
 * plugin cannot register its own yet — the registry's shape is still open
 * (docs/api_to_audit.md) — so the table is fixed at module load.
 */
const DIALECTS_BY_ID: ReadonlyMap<string, AcpDialect> = new Map([
  [CURSOR_ACP_DIALECT.id, CURSOR_ACP_DIALECT],
  [GROK_ACP_DIALECT.id, GROK_ACP_DIALECT],
  [OMP_ACP_DIALECT.id, OMP_ACP_DIALECT],
  [OPENCODE_ACP_DIALECT.id, OPENCODE_ACP_DIALECT],
]);

/** The executable name each dialect's agent is normally launched as. */
const DIALECT_IDS_BY_COMMAND: Readonly<Record<string, string>> = {
  "cursor-agent": CURSOR_ACP_DIALECT.id,
  grok: GROK_ACP_DIALECT.id,
  omp: OMP_ACP_DIALECT.id,
  opencode: OPENCODE_ACP_DIALECT.id,
};

/**
 * The dialect for an agent launch. The registration names it (the ACP plugin
 * puts `acpDialect` in its bridge options, and a third-party plugin may name
 * one of these ids for an agent it registers); a registration that names none
 * falls back to the launch executable's base name, so a user-configured
 * `grok` instance gets grok's dialect without declaring anything. Everything
 * else is generic, which answers nothing.
 *
 * Keying on the registration rather than on a bb provider id is deliberate:
 * the ACP plugin owns several providers and the same agent can be registered
 * under any id, so the dialect must not be a provider-id table.
 */
export function resolveAcpDialect(launch: {
  dialectId?: string | undefined;
  command: string;
}): AcpDialect {
  if (launch.dialectId !== undefined) {
    return DIALECTS_BY_ID.get(launch.dialectId) ?? GENERIC_ACP_DIALECT;
  }
  const byCommand = DIALECT_IDS_BY_COMMAND[basename(launch.command)];
  return byCommand === undefined
    ? GENERIC_ACP_DIALECT
    : (DIALECTS_BY_ID.get(byCommand) ?? GENERIC_ACP_DIALECT);
}
