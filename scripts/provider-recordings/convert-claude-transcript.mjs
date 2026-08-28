#!/usr/bin/env node
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

const STREAMED_RECORD_TYPES = new Set(["user", "assistant", "system"]);
const objectTag = Object.prototype.toString;

function readObject(value) {
  return value !== null && objectTag.call(value) === "[object Object]"
    ? value
    : null;
}

function readString(value) {
  return value?.constructor === String ? value : null;
}

function readNumber(value) {
  return value?.constructor === Number ? value : null;
}

function parseJsonRecord(text) {
  try {
    return readObject(JSON.parse(text));
  } catch {
    return null;
  }
}

function readRecords(path) {
  const records = [];
  let lastTimestamp = 0;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.length === 0) continue;
    const record = parseJsonRecord(line);
    if (record === null || !STREAMED_RECORD_TYPES.has(record.type)) continue;
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
      ? (parseJsonRecord(readFileSync(metaPath, "utf8")) ?? {})
      : {};
    agents.push({
      agentId,
      toolUseId: readString(meta.toolUseId),
      agentType: readString(meta.agentType),
      description: readString(meta.description),
      records: readRecords(join(dir, name)),
    });
  }
  return agents;
}

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
    .filter(
      (block) => block?.type === "text" && readString(block.text) !== null,
    )
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
  const text = readString(value);
  if (text !== null) return text;
  if (Array.isArray(value)) {
    return value
      .filter(
        (block) => block?.type === "text" && readString(block.text) !== null,
      )
      .map((block) => block.text)
      .join("\n");
  }
  return "";
}

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
  const numericStatus = readNumber(status);
  if (numericStatus !== null && numericStatus >= 500) return "server_error";
  return "unknown";
}

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

function convert(sessionPath, options) {
  const sessionId = basename(sessionPath, ".jsonl");
  const main = readRecords(sessionPath);
  const agents = readSubagents(sessionPath);
  if (main.length === 0) {
    throw new Error(`${sessionPath}: no user/assistant/system records`);
  }

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
    if (readObject(result) === null) continue;
    for (const block of toolResultBlocks(record)) {
      const agentId = readString(result.agentId);
      if (agentId !== null) {
        agentIdByToolUseId.set(block.tool_use_id, agentId);
      }
      if (result.status === "async_launched" || result.isAsync === true) {
        backgroundedToolUseIds.add(block.tool_use_id);
      }
    }
  }

  const agentCallByToolUseId = new Map();
  for (const { record } of main) {
    if (record.type !== "assistant") continue;
    for (const block of toolUseBlocks(record)) {
      if (block.name === "Agent" || block.name === "Task") {
        agentCallByToolUseId.set(block.id, block.input ?? {});
      }
    }
  }

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
  let previousRoot = null;
  for (const entry of merged) {
    if (entry.lane !== 0 || entry.record.type !== "assistant") continue;
    entry.continuesInNextRootAssistant = false;
    if (
      previousRoot !== null &&
      readString(entry.record.message?.id) !== null &&
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
    const recordModel = readString(record.message?.model);
    if (model === null && recordModel !== null) {
      model = recordModel;
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
    const resultMessage = {
      type: "result",
      subtype: failed ? "error_during_execution" : "success",
      is_error: failed,
      duration_ms: Math.max(0, at - turnStartedAt),
      duration_api_ms: Math.max(0, at - turnStartedAt),
      num_turns: turnAssistantCount,
      result: text,
      session_id: sessionId,
      total_cost_usd: 0,
      usage: { ...usage },
      permission_denials: [],
      uuid: syntheticUuid(),
    };
    if (failed) resultMessage.errors = [text];
    if (turnOrigin !== null) resultMessage.origin = turnOrigin;
    emit(resultMessage, { synthetic: true });
    turnOpen = false;
  };
  const addUsage = (messageUsage) => {
    const parsedUsage = readObject(messageUsage);
    if (parsedUsage === null) return;
    for (const key of Object.keys(usage)) {
      const amount = readNumber(parsedUsage[key]);
      if (amount !== null) usage[key] += amount;
    }
  };

  const settledTaskIds = new Set();
  const emitTaskStarted = (toolUseId, backgrounded) => {
    const taskId = agentIdByToolUseId.get(toolUseId);
    if (taskId === undefined) return null;
    const call = agentCallByToolUseId.get(toolUseId) ?? {};
    const agent = agentByToolUseId.get(toolUseId);
    const description =
      readString(call.description) ?? agent?.description ?? "";
    const subagentType =
      readString(call.subagent_type) ?? agent?.agentType ?? "general-purpose";
    const prompt = readString(call.prompt);
    const taskMessage = {
      type: "system",
      subtype: "task_started",
      task_id: taskId,
      tool_use_id: toolUseId,
      description,
      subagent_type: subagentType,
      is_backgrounded: backgrounded,
      spawn_depth: 1,
      task_type: "local_agent",
      uuid: syntheticUuid(),
      session_id: sessionId,
    };
    if (prompt !== null) taskMessage.prompt = prompt;
    emit(taskMessage, { synthetic: true });
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
    const uuid = readString(record.uuid) ?? syntheticUuid();
    const timestamp = readString(record.timestamp);

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
        const content = readString(record.content);
        const fallbackMessage = {
          type: "system",
          subtype: record.subtype,
          original_model: record.originalModel,
          fallback_model: record.fallbackModel,
          uuid,
          session_id: sessionId,
        };
        if (content !== null) fallbackMessage.content = content;
        emit(fallbackMessage);
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
      const assistantMessage = {
        type: "assistant",
        message: record.message,
        parent_tool_use_id: parentToolUseId,
        session_id: sessionId,
        uuid,
      };
      const requestId = readString(record.requestId);
      if (requestId !== null) assistantMessage.request_id = requestId;
      if (timestamp !== null) assistantMessage.timestamp = timestamp;
      emit(assistantMessage);
      if (agent === null) {
        for (const block of toolUseBlocks(record)) {
          if (block.name === "Agent" || block.name === "Task") {
            emitTaskStarted(block.id, backgroundedToolUseIds.has(block.id));
          }
        }
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

    const results = toolResultBlocks(record);
    if (results.length === 0) {
      if (agent !== null) {
        const subagentMessage = {
          type: "user",
          message: record.message,
          parent_tool_use_id: parentToolUseId,
          session_id: sessionId,
          uuid,
        };
        if (timestamp !== null) subagentMessage.timestamp = timestamp;
        if (agent.agentType !== null)
          subagentMessage.subagent_type = agent.agentType;
        if (agent.description !== null)
          subagentMessage.task_description = agent.description;
        emit(subagentMessage);
        continue;
      }
      const notification = isTaskNotificationPrompt(record)
        ? parseTaskNotification(textOf(record.message?.content))
        : null;
      if (!isRootPrompt(record)) {
      } else if (notification !== null) {
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
        closeTurn(at);
        openTurn(at, null);
        continue;
      }
      const userMessage = {
        type: "user",
        message: record.message,
        parent_tool_use_id: null,
        session_id: sessionId,
        uuid,
      };
      if (timestamp !== null) userMessage.timestamp = timestamp;
      emit(userMessage);
      continue;
    }

    if (agent === null) {
      for (const block of results) {
        if (
          agentCallByToolUseId.has(block.tool_use_id) &&
          !backgroundedToolUseIds.has(block.tool_use_id)
        ) {
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
    const toolResultMessage = {
      type: "user",
      message: record.message,
      parent_tool_use_id: parentToolUseId,
      session_id: sessionId,
      uuid,
    };
    if (timestamp !== null) toolResultMessage.timestamp = timestamp;
    if (record.toolUseResult !== undefined) {
      toolResultMessage.tool_use_result = record.toolUseResult;
    }
    emit(toolResultMessage);
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
