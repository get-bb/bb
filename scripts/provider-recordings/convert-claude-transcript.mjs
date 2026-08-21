#!/usr/bin/env node
/**
 * Convert a Claude Code session transcript (`~/.claude/projects/<project>/
 * <session>.jsonl` plus its `<session>/subagents/agent-*.jsonl` sidechains)
 * into the Claude Agent SDK message stream the claude-code bridge consumes.
 *
 *   node scripts/provider-recordings/convert-claude-transcript.mjs \
 *     <session.jsonl> <out.ndjson> [--turns A-B] [--manifest <out.json>]
 *
 * A transcript is a persisted conversation: `user`/`assistant` records whose
 * `message` is the API message (tool_use / tool_result blocks included), a
 * few `system` records (api_error, model_refusal_fallback, compact_boundary)
 * and bookkeeping rows (attachment, queue-operation, ai-title, …) the SDK
 * never streams. It has NO `result` messages, no `system/init`, and no
 * `system/task_*` family: turn ends and background-task lifecycle are
 * implicit in the records. This script makes them explicit so the NON-streaming
 * translator paths (assistant tool_use blocks, user tool_result blocks,
 * subagent sidechains, task notifications) can be driven from real sessions:
 *
 *   - every record becomes the SDK envelope of its type (`parent_tool_use_id`
 *     from the subagent's `toolUseId`, `tool_use_result` from the record's
 *     `toolUseResult`), interleaved with the sidechains by timestamp — except
 *     the human's own prompts, which a live stream never echoes (they only
 *     delimit turns here);
 *   - a `result` is SYNTHESIZED when a root assistant message stops with a
 *     non-tool-use stop reason, before the next root prompt, and at EOF;
 *   - `system/task_started`, `task_updated` and `task_notification` are
 *     SYNTHESIZED for Agent calls from the call, its result
 *     (`toolUseResult.status === "async_launched"` ⇒ backgrounded) and the
 *     `<task-notification>` prompt that resumes the parent;
 *   - `system/init` is SYNTHESIZED from the first record (cwd, version, model,
 *     the tool names the session used).
 *
 * Every synthesized message is deterministic from the transcript (ids are
 * counters, timestamps are the neighbouring record's), so a rerun produces the
 * same stream. `--turns A-B` keeps the human-prompt turns A..B (1-based,
 * inclusive) and the sidechains they spawned; task-notification prompts
 * continue the turn they interrupt rather than starting one.
 *
 * The output is one SDK message per line (the `loadSessionFixture` format of
 * the claude-code plugin tests). Redact it with `redact.mjs` before it is
 * committed.
 */
import {
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

function parseArgs(argv) {
  const positional = [];
  let turns = null;
  let manifestPath = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--turns") {
      const match = /^(\d+)-(\d+)$/.exec(argv[i + 1] ?? "");
      if (!match) throw new Error("--turns expects A-B");
      turns = { from: Number(match[1]), to: Number(match[2]) };
      i += 1;
    } else if (arg === "--manifest") {
      manifestPath = argv[i + 1];
      i += 1;
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown flag ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  if (positional.length !== 2) {
    throw new Error(
      "usage: convert-claude-transcript.mjs <session.jsonl> <out.ndjson> [--turns A-B] [--manifest <out.json>]",
    );
  }
  return { input: positional[0], output: positional[1], turns, manifestPath };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

const STREAMED_RECORD_TYPES = new Set(["user", "assistant", "system"]);

function readRecords(path) {
  const records = [];
  let lastTimestamp = 0;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.length === 0) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (
      record === null ||
      typeof record !== "object" ||
      !STREAMED_RECORD_TYPES.has(record.type)
    ) {
      continue;
    }
    const parsed = Date.parse(record.timestamp ?? "");
    const at = Number.isNaN(parsed) ? lastTimestamp : parsed;
    lastTimestamp = at;
    records.push({ record, at });
  }
  return records;
}

function readSubagents(sessionPath) {
  const sessionId = basename(sessionPath, ".jsonl");
  const dir = join(dirname(sessionPath), sessionId, "subagents");
  if (!existsSync(dir)) return [];
  const agents = [];
  for (const name of readdirSync(dir).sort()) {
    const match = /^agent-([A-Za-z0-9]+)\.jsonl$/.exec(name);
    if (!match) continue;
    const agentId = match[1];
    const metaPath = join(dir, `agent-${agentId}.meta.json`);
    const meta = existsSync(metaPath)
      ? JSON.parse(readFileSync(metaPath, "utf8"))
      : {};
    agents.push({
      agentId,
      toolUseId: typeof meta.toolUseId === "string" ? meta.toolUseId : null,
      agentType: typeof meta.agentType === "string" ? meta.agentType : null,
      description:
        typeof meta.description === "string" ? meta.description : null,
      records: readRecords(join(dir, name)),
    });
  }
  return agents;
}

// ---------------------------------------------------------------------------
// Record helpers
// ---------------------------------------------------------------------------

function contentBlocks(record) {
  const content = record.message?.content;
  return Array.isArray(content) ? content : [];
}

function toolUseBlocks(record) {
  return contentBlocks(record).filter((block) => block?.type === "tool_use");
}

function toolResultBlocks(record) {
  return contentBlocks(record).filter((block) => block?.type === "tool_result");
}

/**
 * A root prompt opens a turn. `isMeta` user records are context a tool
 * injected mid-turn (a Skill's instructions, a local-command caveat) and
 * stream as plain user messages without turn semantics.
 */
function isRootPrompt(record) {
  return (
    record.type === "user" &&
    record.isSidechain !== true &&
    record.isMeta !== true &&
    toolResultBlocks(record).length === 0
  );
}

function isTaskNotificationPrompt(record) {
  return isRootPrompt(record) && record.origin?.kind === "task-notification";
}

function assistantText(record) {
  return contentBlocks(record)
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");
}

function isApiErrorAssistant(record) {
  return (
    record.isApiErrorMessage === true ||
    record.error !== undefined ||
    record.apiErrorStatus !== undefined
  );
}

function textOf(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .filter(
        (block) => block?.type === "text" && typeof block.text === "string",
      )
      .map((block) => block.text)
      .join("\n");
  }
  return "";
}

/** `<task-notification>` prompt fields (the parent's resume after a background agent settles). */
function parseTaskNotification(text) {
  const field = (name) => {
    const match = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(text);
    return match ? match[1].trim() : "";
  };
  const taskId = field("task-id");
  if (taskId.length === 0) return null;
  const status = field("status");
  return {
    taskId,
    toolUseId: field("tool-use-id"),
    outputFile: field("output-file"),
    status:
      status === "completed" || status === "failed" || status === "stopped"
        ? status
        : "completed",
    summary: field("summary"),
    result: field("result"),
  };
}

function apiErrorCode(status) {
  if (status === 401 || status === 403) return "authentication_failed";
  if (status === 429) return "rate_limit";
  if (status === 400) return "invalid_request";
  if (status === 404) return "model_not_found";
  if (typeof status === "number" && status >= 500) return "server_error";
  return "unknown";
}

// ---------------------------------------------------------------------------
// Turn slicing
// ---------------------------------------------------------------------------

/**
 * Human-prompt turn index per root record (1-based). A task-notification
 * prompt continues the turn it interrupts. Records before the first prompt
 * belong to turn 1.
 */
function assignTurns(records) {
  let turn = 0;
  const turnByIndex = [];
  for (const { record } of records) {
    if (isRootPrompt(record) && !isTaskNotificationPrompt(record)) {
      turn += 1;
    }
    turnByIndex.push(Math.max(turn, 1));
  }
  return { turnByIndex, turnCount: Math.max(turn, 1) };
}

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

function convert(sessionPath, options) {
  const sessionId = basename(sessionPath, ".jsonl");
  const main = readRecords(sessionPath);
  const agents = readSubagents(sessionPath);
  if (main.length === 0) {
    throw new Error(`${sessionPath}: no user/assistant/system records`);
  }

  // Agent call id ↔ agent id, from the subagent metadata and the Agent tool
  // results (`toolUseResult.agentId`), so synthesized task messages name the
  // same task id the sidechain carries.
  const agentIdByToolUseId = new Map();
  const agentByToolUseId = new Map();
  for (const agent of agents) {
    if (agent.toolUseId !== null) {
      agentIdByToolUseId.set(agent.toolUseId, agent.agentId);
      agentByToolUseId.set(agent.toolUseId, agent);
    }
  }
  const backgroundedToolUseIds = new Set();
  for (const { record } of main) {
    if (record.type !== "user") continue;
    const result = record.toolUseResult;
    if (result === null || typeof result !== "object") continue;
    for (const block of toolResultBlocks(record)) {
      if (typeof result.agentId === "string") {
        agentIdByToolUseId.set(block.tool_use_id, result.agentId);
      }
      if (result.status === "async_launched" || result.isAsync === true) {
        backgroundedToolUseIds.add(block.tool_use_id);
      }
    }
  }

  // Agent call metadata (subagent type, description) by call id.
  const agentCallByToolUseId = new Map();
  for (const { record } of main) {
    if (record.type !== "assistant") continue;
    for (const block of toolUseBlocks(record)) {
      if (block.name === "Agent" || block.name === "Task") {
        agentCallByToolUseId.set(block.id, block.input ?? {});
      }
    }
  }

  // Slice by human-prompt turn.
  const { turnByIndex, turnCount } = assignTurns(main);
  const from = options.turns?.from ?? 1;
  const to = options.turns?.to ?? turnCount;
  if (from < 1 || to < from || from > turnCount) {
    throw new Error(
      `--turns ${from}-${to} is outside the session's ${turnCount} turn(s)`,
    );
  }
  const selected = main.filter(
    (_, index) => turnByIndex[index] >= from && turnByIndex[index] <= to,
  );
  const selectedToolUseIds = new Set();
  for (const { record } of selected) {
    for (const block of toolUseBlocks(record)) selectedToolUseIds.add(block.id);
  }

  // Merge the sidechains whose spawning call is in the window, by timestamp
  // (stable: main before sidechain at equal instants, file order otherwise).
  const merged = selected.map((entry, order) => ({
    ...entry,
    order,
    lane: 0,
    agent: null,
  }));
  let skippedSidechainRecords = 0;
  for (const agent of agents) {
    if (agent.toolUseId === null || !selectedToolUseIds.has(agent.toolUseId)) {
      skippedSidechainRecords += agent.records.length;
      continue;
    }
    agent.records.forEach((entry, order) => {
      merged.push({ ...entry, order, lane: 1, agent });
    });
  }
  merged.sort((a, b) => a.at - b.at || a.lane - b.lane || a.order - b.order);
  // Per-block records of one root assistant message: only the last closes.
  let previousRoot = null;
  for (const entry of merged) {
    if (entry.lane !== 0 || entry.record.type !== "assistant") continue;
    entry.continuesInNextRootAssistant = false;
    if (
      previousRoot !== null &&
      typeof entry.record.message?.id === "string" &&
      previousRoot.record.message?.id === entry.record.message.id
    ) {
      previousRoot.continuesInNextRootAssistant = true;
    }
    previousRoot = entry;
  }

  const first = main[0].record;
  const out = [];
  const counts = new Map();
  const synthesized = new Map();
  let syntheticIds = 0;
  const syntheticUuid = () => {
    syntheticIds += 1;
    return `00000000-0000-4000-8000-${String(syntheticIds).padStart(12, "0")}`;
  };
  const emit = (message, { synthetic = false } = {}) => {
    const key =
      message.type === "system" || message.type === "result"
        ? `${message.type}/${message.subtype}`
        : message.type;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (synthetic) synthesized.set(key, (synthesized.get(key) ?? 0) + 1);
    out.push(message);
  };

  const toolNames = new Set();
  let model = null;
  for (const { record } of merged) {
    if (record.type !== "assistant") continue;
    if (model === null && typeof record.message?.model === "string") {
      model = record.message.model;
    }
    for (const block of toolUseBlocks(record)) toolNames.add(block.name);
  }

  emit(
    {
      type: "system",
      subtype: "init",
      cwd: first.cwd ?? "",
      session_id: sessionId,
      tools: [...toolNames].sort(),
      mcp_servers: [],
      model: model ?? "unknown",
      permissionMode: first.permissionMode ?? "default",
      slash_commands: [],
      apiKeySource: "none",
      claude_code_version: first.version ?? "unknown",
      output_style: "default",
      agents: [],
      skills: [],
      plugins: [],
      uuid: syntheticUuid(),
    },
    { synthetic: true },
  );

  // Per-turn state for result synthesis.
  let turnOpen = false;
  let turnStartedAt = 0;
  let turnOrigin = null;
  let turnAssistantCount = 0;
  let lastRootAssistant = null;
  let lastAt = main[0].at;
  const usage = {
    input_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    output_tokens: 0,
  };
  const resetUsage = () => {
    for (const key of Object.keys(usage)) usage[key] = 0;
  };
  const openTurn = (at, origin) => {
    if (turnOpen) return;
    turnOpen = true;
    turnStartedAt = at;
    turnOrigin = origin;
    turnAssistantCount = 0;
    lastRootAssistant = null;
    resetUsage();
  };
  const closeTurn = (at) => {
    if (!turnOpen) return;
    const failed =
      lastRootAssistant !== null && isApiErrorAssistant(lastRootAssistant);
    const text =
      lastRootAssistant === null ? "" : assistantText(lastRootAssistant);
    emit(
      {
        type: "result",
        subtype: failed ? "error_during_execution" : "success",
        is_error: failed,
        duration_ms: Math.max(0, at - turnStartedAt),
        duration_api_ms: Math.max(0, at - turnStartedAt),
        num_turns: turnAssistantCount,
        result: text,
        ...(failed ? { errors: [text] } : {}),
        session_id: sessionId,
        total_cost_usd: 0,
        usage: { ...usage },
        permission_denials: [],
        ...(turnOrigin === null ? {} : { origin: turnOrigin }),
        uuid: syntheticUuid(),
      },
      { synthetic: true },
    );
    turnOpen = false;
  };
  const addUsage = (messageUsage) => {
    if (messageUsage === null || typeof messageUsage !== "object") return;
    for (const key of Object.keys(usage)) {
      if (typeof messageUsage[key] === "number")
        usage[key] += messageUsage[key];
    }
  };

  const settledTaskIds = new Set();
  const emitTaskStarted = (toolUseId, backgrounded) => {
    const taskId = agentIdByToolUseId.get(toolUseId);
    if (taskId === undefined) return null;
    const call = agentCallByToolUseId.get(toolUseId) ?? {};
    const agent = agentByToolUseId.get(toolUseId);
    emit(
      {
        type: "system",
        subtype: "task_started",
        task_id: taskId,
        tool_use_id: toolUseId,
        description:
          typeof call.description === "string"
            ? call.description
            : (agent?.description ?? ""),
        subagent_type:
          typeof call.subagent_type === "string"
            ? call.subagent_type
            : (agent?.agentType ?? "general-purpose"),
        is_backgrounded: backgrounded,
        spawn_depth: 1,
        task_type: "local_agent",
        ...(typeof call.prompt === "string" ? { prompt: call.prompt } : {}),
        uuid: syntheticUuid(),
        session_id: sessionId,
      },
      { synthetic: true },
    );
    return taskId;
  };
  const emitTaskSettled = (taskId, toolUseId, status, summary, outputFile) => {
    if (settledTaskIds.has(taskId)) return;
    settledTaskIds.add(taskId);
    emit(
      {
        type: "system",
        subtype: "task_updated",
        task_id: taskId,
        patch: { status: status === "completed" ? "completed" : "failed" },
        uuid: syntheticUuid(),
        session_id: sessionId,
      },
      { synthetic: true },
    );
    emit(
      {
        type: "system",
        subtype: "task_notification",
        task_id: taskId,
        tool_use_id: toolUseId,
        status,
        output_file: outputFile,
        summary,
        uuid: syntheticUuid(),
        session_id: sessionId,
      },
      { synthetic: true },
    );
  };

  for (const entry of merged) {
    const { record, at, agent } = entry;
    lastAt = at;
    const parentToolUseId = agent === null ? null : agent.toolUseId;
    const uuid =
      typeof record.uuid === "string" ? record.uuid : syntheticUuid();
    const timestamp =
      typeof record.timestamp === "string" ? record.timestamp : undefined;

    if (record.type === "system") {
      if (record.subtype === "api_error" && record.source === "request_retry") {
        openTurn(at, null);
        emit({
          type: "system",
          subtype: "api_retry",
          attempt: record.retryAttempt ?? 1,
          max_retries: record.maxRetries ?? 1,
          retry_delay_ms: record.retryInMs ?? 0,
          error_status: record.error?.status ?? null,
          error: apiErrorCode(record.error?.status),
          uuid,
          session_id: sessionId,
        });
      } else if (
        record.subtype === "model_refusal_fallback" ||
        record.subtype === "model_fallback"
      ) {
        emit({
          type: "system",
          subtype: record.subtype,
          original_model: record.originalModel,
          fallback_model: record.fallbackModel,
          ...(typeof record.content === "string"
            ? { content: record.content }
            : {}),
          uuid,
          session_id: sessionId,
        });
      } else if (record.subtype === "compact_boundary") {
        emit({
          type: "system",
          subtype: "compact_boundary",
          compact_metadata: {
            trigger: record.compactMetadata?.trigger ?? "auto",
            pre_tokens: record.compactMetadata?.preTokens ?? 0,
          },
          uuid,
          session_id: sessionId,
        });
      }
      continue;
    }

    if (record.type === "assistant") {
      if (agent === null) {
        openTurn(at, null);
        turnAssistantCount += 1;
        lastRootAssistant = record;
        addUsage(record.message?.usage);
      }
      emit({
        type: "assistant",
        message: record.message,
        parent_tool_use_id: parentToolUseId,
        ...(typeof record.requestId === "string"
          ? { request_id: record.requestId }
          : {}),
        session_id: sessionId,
        uuid,
        ...(timestamp === undefined ? {} : { timestamp }),
      });
      if (agent === null) {
        for (const block of toolUseBlocks(record)) {
          if (block.name === "Agent" || block.name === "Task") {
            emitTaskStarted(block.id, backgroundedToolUseIds.has(block.id));
          }
        }
        // The transcript writes one record per content block and stamps the
        // message's final stop reason on each of them; the turn ends once,
        // after the message's last block.
        const stopReason = record.message?.stop_reason;
        if (
          (stopReason === "end_turn" ||
            stopReason === "stop_sequence" ||
            stopReason === "max_tokens") &&
          !entry.continuesInNextRootAssistant
        ) {
          closeTurn(at);
        }
      }
      continue;
    }

    // user
    const results = toolResultBlocks(record);
    if (results.length === 0) {
      if (agent !== null) {
        // The subagent's prompt, as the SDK surfaces it under the call.
        emit({
          type: "user",
          message: record.message,
          parent_tool_use_id: parentToolUseId,
          session_id: sessionId,
          uuid,
          ...(timestamp === undefined ? {} : { timestamp }),
          ...(agent.agentType === null
            ? {}
            : { subagent_type: agent.agentType }),
          ...(agent.description === null
            ? {}
            : { task_description: agent.description }),
        });
        continue;
      }
      const notification = isTaskNotificationPrompt(record)
        ? parseTaskNotification(textOf(record.message?.content))
        : null;
      if (!isRootPrompt(record)) {
        // Injected context (isMeta): no turn transition.
      } else if (notification !== null) {
        // The background agent settled: its task lifecycle closes before the
        // parent is resumed, and the resuming segment's result says so.
        closeTurn(at);
        emitTaskSettled(
          notification.taskId,
          notification.toolUseId,
          notification.status,
          notification.summary,
          notification.outputFile,
        );
        openTurn(at, { kind: "task-notification" });
      } else {
        // The human's prompt is the SDK's INPUT: a live stream never echoes
        // it. It only moves the turn; the CLI-injected user messages
        // (task notifications, isMeta context) do stream and are emitted.
        closeTurn(at);
        openTurn(at, null);
        continue;
      }
      emit({
        type: "user",
        message: record.message,
        parent_tool_use_id: null,
        session_id: sessionId,
        uuid,
        ...(timestamp === undefined ? {} : { timestamp }),
      });
      continue;
    }

    if (agent === null) {
      for (const block of results) {
        if (
          agentCallByToolUseId.has(block.tool_use_id) &&
          !backgroundedToolUseIds.has(block.tool_use_id)
        ) {
          // A foreground agent settles before its call's result lands; a
          // backgrounded one settles at the <task-notification> prompt.
          const taskId = agentIdByToolUseId.get(block.tool_use_id);
          if (taskId !== undefined) {
            emitTaskSettled(
              taskId,
              block.tool_use_id,
              block.is_error === true ? "failed" : "completed",
              textOf(block.content).split("\n")[0] ?? "",
              "",
            );
          }
        }
      }
    }
    emit({
      type: "user",
      message: record.message,
      parent_tool_use_id: parentToolUseId,
      session_id: sessionId,
      uuid,
      ...(timestamp === undefined ? {} : { timestamp }),
      ...(record.toolUseResult === undefined
        ? {}
        : { tool_use_result: record.toolUseResult }),
    });
  }
  closeTurn(lastAt);

  return {
    messages: out,
    manifest: {
      sessionId,
      turns: { from, to, of: turnCount },
      records: {
        main: selected.length,
        sidechain: merged.length - selected.length,
        skippedSidechain: skippedSidechainRecords,
      },
      tools: [...toolNames].sort(),
      messages: Object.fromEntries([...counts.entries()].sort()),
      synthesized: Object.fromEntries([...synthesized.entries()].sort()),
    },
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const { messages, manifest } = convert(options.input, options);
  mkdirSync(dirname(options.output), { recursive: true });
  writeFileSync(
    options.output,
    `${messages.map((message) => JSON.stringify(message)).join("\n")}\n`,
  );
  if (options.manifestPath !== null) {
    mkdirSync(dirname(options.manifestPath), { recursive: true });
    writeFileSync(
      options.manifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
  }
  console.log(JSON.stringify(manifest));
}

main();
