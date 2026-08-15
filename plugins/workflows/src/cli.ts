import type {
  BbPluginApi,
  PluginCliContext,
  PluginCliResult,
} from "@get-bb/plugin-sdk";
import type { JsonValue } from "./types.js";
import type {
  WorkflowCallInspection,
  WorkflowRunInspectionPage,
  WorkflowService,
} from "./service.js";
import type { WorkflowRunRow } from "./data.js";
import type { WorkflowSourceInput } from "./source-resolution.js";
import { parseStoredWorkflowSettings } from "./settings.js";
import { prepareWorkflowSource } from "./workflow-input.js";

const STATUS_INLINE_RESULT_MAX_BYTES = 8 * 1024;
const STATUS_DISPLAY_TEXT_MAX_BYTES = 1_024;
const STATUS_ERROR_MAX_BYTES = 4 * 1_024;
const LIST_DISPLAY_TEXT_MAX_BYTES = 128;
const LIST_ERROR_MAX_BYTES = 256;
const DEFAULT_HISTORY_LIMIT = 10;
const MAX_HISTORY_LIMIT = 100;
const MAX_LIST_LIMIT = 50;

function success(value: unknown): PluginCliResult {
  return { exitCode: 0, stdout: `${JSON.stringify(value)}\n` };
}

function jsonLines(records: readonly unknown[]): PluginCliResult {
  return {
    exitCode: 0,
    stdout: `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
  };
}

function failure(message: string): PluginCliResult {
  return { exitCode: 1, stderr: `${message}\n` };
}

function requireContext(ctx: PluginCliContext): {
  projectId: string;
  threadId: string;
} {
  if (ctx.projectId === undefined || ctx.threadId === undefined) {
    throw new Error("This command must run inside a BB project thread");
  }
  return { projectId: ctx.projectId, threadId: ctx.threadId };
}

interface ParsedArguments {
  options: ReadonlyMap<string, string>;
  positionals: readonly string[];
}

function parseArguments(
  argv: readonly string[],
  allowedOptions: readonly string[],
  positionalDescription: string | null = null,
): ParsedArguments {
  const allowed = new Set(allowedOptions);
  const options = new Map<string, string>();
  const positionals: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (!argument.startsWith("--")) {
      positionals.push(argument);
      continue;
    }
    if (!allowed.has(argument)) {
      throw new Error(`Unknown option ${argument}`);
    }
    if (options.has(argument)) {
      throw new Error(`${argument} may be provided only once`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${argument} requires a value`);
    }
    options.set(argument, value);
    index += 1;
  }
  if (positionalDescription === null && positionals.length > 0) {
    throw new Error(`Unexpected positional argument ${positionals[0]}`);
  }
  if (positionalDescription !== null && positionals.length !== 1) {
    throw new Error(
      positionals.length === 0
        ? `${positionalDescription} requires a run ID`
        : `${positionalDescription} accepts exactly one run ID`,
    );
  }
  return { options, positionals };
}

function sourceInput(
  options: ReadonlyMap<string, string>,
  cwd: string | undefined,
): WorkflowSourceInput {
  return {
    script: options.get("--script"),
    source: options.get("--source"),
    scriptPath: options.get("--file"),
    scriptPathBase: cwd,
    name: options.get("--name"),
  };
}

function parseJsonOption(value: string | undefined): JsonValue {
  if (value === undefined) return null;
  try {
    return JSON.parse(value) as JsonValue;
  } catch (error) {
    throw new Error(
      `--args must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function parseIntegerOption(
  options: ReadonlyMap<string, string>,
  name: string,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number {
  const raw = options.get(name);
  if (raw !== undefined && !/^(0|[1-9]\d*)$/.test(raw)) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  const value = raw === undefined ? defaultValue : Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function parseStoredJson(value: string, description: string): JsonValue {
  try {
    return JSON.parse(value) as JsonValue;
  } catch (error) {
    throw new Error(
      `Persisted ${description} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function utf8CodePointBytes(value: string): number {
  const codePoint = value.codePointAt(0)!;
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

function boundedText(
  value: string | null,
  maximumBytes: number,
): {
  value: string | null;
  truncated: boolean;
} {
  if (value === null) return { value, truncated: false };
  const characters: string[] = [];
  let bytes = 0;
  for (const character of value) {
    const characterBytes = utf8CodePointBytes(character);
    if (bytes + characterBytes > maximumBytes) {
      const prefixBudget = maximumBytes - utf8CodePointBytes("…");
      while (bytes > prefixBudget) {
        bytes -= utf8CodePointBytes(characters.pop()!);
      }
      return { value: `${characters.join("")}…`, truncated: true };
    }
    characters.push(character);
    bytes += characterBytes;
  }
  return { value, truncated: false };
}

function inlineRunResult(run: WorkflowRunRow): {
  available: boolean;
  omitted: boolean;
  value: JsonValue;
} {
  if (run.resultJson === null) {
    return { available: false, omitted: false, value: null };
  }
  if (
    new TextEncoder().encode(run.resultJson).byteLength >
    STATUS_INLINE_RESULT_MAX_BYTES
  ) {
    return { available: true, omitted: true, value: null };
  }
  return {
    available: true,
    omitted: false,
    value: parseStoredJson(run.resultJson, "workflow result"),
  };
}

function statusSummary(page: WorkflowRunInspectionPage) {
  const { run, callCounts } = page;
  const result = inlineRunResult(run);
  const name = boundedText(run.name, STATUS_DISPLAY_TEXT_MAX_BYTES);
  const phase = boundedText(run.phase, STATUS_DISPLAY_TEXT_MAX_BYTES);
  const originProvider = boundedText(
    run.originProvider,
    STATUS_DISPLAY_TEXT_MAX_BYTES,
  );
  const originModel = boundedText(
    run.originModel,
    STATUS_DISPLAY_TEXT_MAX_BYTES,
  );
  const originReasoningLevel = boundedText(
    run.originReasoningLevel,
    STATUS_DISPLAY_TEXT_MAX_BYTES,
  );
  const originPermissionMode = boundedText(
    run.originPermissionMode,
    STATUS_DISPLAY_TEXT_MAX_BYTES,
  );
  const error = boundedText(run.error, STATUS_ERROR_MAX_BYTES);
  const notificationError = boundedText(
    run.notificationError,
    STATUS_ERROR_MAX_BYTES,
  );
  return {
    id: run.id,
    projectId: run.projectId,
    originThreadId: run.originThreadId,
    environmentId: run.environmentId,
    originProvider: originProvider.value,
    originProviderTruncated: originProvider.truncated,
    originModel: originModel.value,
    originModelTruncated: originModel.truncated,
    originReasoningLevel: originReasoningLevel.value,
    originReasoningLevelTruncated: originReasoningLevel.truncated,
    originPermissionMode: originPermissionMode.value,
    originPermissionModeTruncated: originPermissionMode.truncated,
    name: name.value,
    nameTruncated: name.truncated,
    sourceHash: run.sourceHash,
    sourceBytes: new TextEncoder().encode(run.source).byteLength,
    settings: parseStoredWorkflowSettings(
      parseStoredJson(run.settingsJson, "workflow settings"),
    ),
    status: run.status,
    phase: phase.value,
    phaseTruncated: phase.truncated,
    resumedFromRunId: run.resumedFromRunId,
    result: result.value,
    resultAvailable: result.available,
    resultOmitted: result.omitted,
    error: error.value,
    errorTruncated: error.truncated,
    calls: callCounts,
    notification: {
      outcome: run.notificationOutcome,
      attemptCount: run.notificationAttemptCount,
      nextAttemptAt: run.notificationNextAttemptAt,
      error: notificationError.value,
      errorTruncated: notificationError.truncated,
    },
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    history: {
      format: "jsonl",
      pageUsage: `bb workflows history ${run.id} --cursor 0 --limit ${DEFAULT_HISTORY_LIMIT}`,
      fileUsage: `mkdir -p "$BB_THREAD_STORAGE/workflows" && bb workflows history ${run.id} --cursor 0 --limit ${DEFAULT_HISTORY_LIMIT} > "$BB_THREAD_STORAGE/workflows/${run.id}.jsonl"`,
    },
  };
}

function listRunSummary(run: WorkflowRunRow) {
  const name = boundedText(run.name, LIST_DISPLAY_TEXT_MAX_BYTES);
  const phase = boundedText(run.phase, LIST_DISPLAY_TEXT_MAX_BYTES);
  const error = boundedText(run.error, LIST_ERROR_MAX_BYTES);
  return {
    id: run.id,
    originThreadId: run.originThreadId,
    environmentId: run.environmentId,
    name: name.value,
    nameTruncated: name.truncated,
    status: run.status,
    phase: phase.value,
    phaseTruncated: phase.truncated,
    resumedFromRunId: run.resumedFromRunId,
    resultAvailable: run.resultJson !== null,
    error: error.value,
    errorTruncated: error.truncated,
    notificationOutcome: run.notificationOutcome,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  };
}

function runLogRecord(run: WorkflowRunRow, exportedAt: number) {
  const { argsJson, settingsJson, resultJson, ...fields } = run;
  return {
    type: "run",
    logVersion: 1,
    exportedAt,
    ...fields,
    args: parseStoredJson(argsJson, "workflow args"),
    settings: parseStoredWorkflowSettings(
      parseStoredJson(settingsJson, "workflow settings"),
    ),
    resultAvailable: resultJson !== null,
    result:
      resultJson === null
        ? null
        : parseStoredJson(resultJson, "workflow result"),
  };
}

function runReferenceLogRecord(run: WorkflowRunRow, exportedAt: number) {
  return {
    type: "run-reference",
    logVersion: 1,
    exportedAt,
    id: run.id,
    name: run.name,
    status: run.status,
    phase: run.phase,
  };
}

function callLogRecord(call: WorkflowCallInspection, exportedAt: number) {
  const { optionsJson, resultJson, ...fields } = call;
  void optionsJson;
  return {
    type: "call",
    logVersion: 1,
    exportedAt,
    ...fields,
    label: call.options.title,
    phase: call.options.phase,
    resultAvailable: resultJson !== null,
    result:
      resultJson === null
        ? null
        : parseStoredJson(resultJson, "workflow call result"),
  };
}

export function registerWorkflowCli(
  bb: BbPluginApi,
  service: WorkflowService,
): void {
  bb.cli.register({
    name: "workflows",
    summary: "Run and inspect durable BB workflows",
    commands: [
      {
        name: "run",
        summary: "Start a workflow and return immediately",
        usage:
          "bb workflows run (--script '<javascript>'|--file <path>|--name <name>) [--args '<json>'] [--resume <run-id>]",
      },
      {
        name: "validate",
        summary: "Validate workflow source and literal model selections",
        usage:
          "bb workflows validate (--script '<javascript>'|--file <path>|--name <name>)",
      },
      {
        name: "status",
        summary: "Show a compact workflow run summary",
        usage: "bb workflows status <run-id>",
      },
      {
        name: "history",
        summary: "Read one JSONL page of workflow run and call history",
        usage:
          "bb workflows history <run-id> [--cursor <call-index>] [--limit <1-100>]",
      },
      {
        name: "list",
        summary: "List recent project workflow runs",
        usage: "bb workflows list [--limit <1-50>]",
      },
      {
        name: "stop",
        summary: "Cancel a workflow run",
        usage: "bb workflows stop <run-id>",
      },
    ],
    async run(argv, ctx) {
      try {
        const command = argv[0];
        if (command === "run") {
          const { options } = parseArguments(argv.slice(1), [
            "--script",
            "--source",
            "--file",
            "--name",
            "--args",
            "--resume",
          ]);
          const context = requireContext(ctx);
          const prepared = await prepareWorkflowSource(
            bb,
            context,
            sourceInput(options, ctx.cwd),
          );
          const run = await service.start({
            projectId: context.projectId,
            originThreadId: context.threadId,
            source: prepared.source,
            args: parseJsonOption(options.get("--args")),
            resumedFromRunId: options.get("--resume") ?? null,
          });
          return success({ runId: run.id, name: run.name, status: run.status });
        }
        if (command === "validate") {
          const { options } = parseArguments(argv.slice(1), [
            "--script",
            "--source",
            "--file",
            "--name",
          ]);
          const context = requireContext(ctx);
          const prepared = await prepareWorkflowSource(
            bb,
            context,
            sourceInput(options, ctx.cwd),
          );
          return success({
            ...prepared.validation,
            origin: prepared.origin,
          });
        }
        if (command === "status") {
          const { positionals } = parseArguments(argv.slice(1), [], "status");
          const context = requireContext(ctx);
          const runId = positionals[0]!;
          const page = service.inspectPage(runId, -1, 1);
          if (page === null || page.run.projectId !== context.projectId) {
            throw new Error(`Unknown workflow run ${runId}`);
          }
          return success(statusSummary(page));
        }
        if (command === "history") {
          const { options, positionals } = parseArguments(
            argv.slice(1),
            ["--cursor", "--limit"],
            "history",
          );
          const runId = positionals[0]!;
          const cursor = parseIntegerOption(
            options,
            "--cursor",
            0,
            0,
            Number.MAX_SAFE_INTEGER,
          );
          const limit = parseIntegerOption(
            options,
            "--limit",
            DEFAULT_HISTORY_LIMIT,
            1,
            MAX_HISTORY_LIMIT,
          );
          const context = requireContext(ctx);
          const page = service.inspectPage(runId, cursor - 1, limit + 1);
          if (page === null || page.run.projectId !== context.projectId) {
            throw new Error(`Unknown workflow run ${runId}`);
          }
          const exportedAt = Date.now();
          const calls = page.calls.slice(0, limit);
          const hasMore = page.calls.length > limit;
          const nextCursor = hasMore ? calls.at(-1)!.callIndex + 1 : null;
          return jsonLines([
            cursor === 0
              ? runLogRecord(page.run, exportedAt)
              : runReferenceLogRecord(page.run, exportedAt),
            ...calls.map((call) => callLogRecord(call, exportedAt)),
            {
              type: "page",
              logVersion: 1,
              runId,
              cursor,
              limit,
              returned: calls.length,
              totalCalls: page.callCounts.total,
              hasMore,
              nextCursor,
              exportedAt,
            },
          ]);
        }
        if (command === "list") {
          const { options } = parseArguments(argv.slice(1), ["--limit"]);
          const limit = parseIntegerOption(
            options,
            "--limit",
            20,
            1,
            MAX_LIST_LIMIT,
          );
          const context = requireContext(ctx);
          return success(
            service.list(context.projectId, limit).map(listRunSummary),
          );
        }
        if (command === "stop") {
          const { positionals } = parseArguments(argv.slice(1), [], "stop");
          const context = requireContext(ctx);
          const runId = positionals[0]!;
          const run = service.get(runId);
          if (run === null || run.projectId !== context.projectId) {
            throw new Error(`Unknown workflow run ${runId}`);
          }
          return success({ runId, stopped: await service.stop(runId) });
        }
        return failure(
          "Usage: bb workflows <run|validate|status|history|list|stop> [options]",
        );
      } catch (error) {
        return failure(error instanceof Error ? error.message : String(error));
      }
    },
  });
}
