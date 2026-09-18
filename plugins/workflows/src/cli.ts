import {
  experimental_CliError,
  experimental_cliCommand,
  experimental_defineCli,
  type BbPluginApi,
  type PluginCliContext,
  type PluginCliResult,
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
import { utf8Prefix } from "./utf8.js";
import { prepareWorkflowSource } from "./workflow-input.js";

const STATUS_INLINE_RESULT_MAX_BYTES = 8 * 1024;
const STATUS_DISPLAY_TEXT_MAX_BYTES = 1_024;
const STATUS_ERROR_MAX_BYTES = 4 * 1_024;
const LIST_DISPLAY_TEXT_MAX_BYTES = 128;
const LIST_ERROR_MAX_BYTES = 256;
const DEFAULT_HISTORY_LIMIT = 10;
const MAX_HISTORY_LIMIT = 100;
const DEFAULT_LIST_LIMIT = 20;
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

async function guarded(
  run: () => Promise<PluginCliResult>,
): Promise<PluginCliResult> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof experimental_CliError) throw error;
    throw new experimental_CliError(
      error instanceof Error ? error.message : String(error),
    );
  }
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

function sourceInput(
  options: {
    script: string | undefined;
    file: string | undefined;
    name: string | undefined;
  },
  cwd: string | undefined,
): WorkflowSourceInput {
  return {
    script: options.script,
    scriptPath: options.file,
    scriptPathBase: cwd,
    name: options.name,
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

function parseStoredJson(value: string, description: string): JsonValue {
  try {
    return JSON.parse(value) as JsonValue;
  } catch (error) {
    throw new Error(
      `Persisted ${description} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function boundedText(
  value: string | null,
  maximumBytes: number,
): {
  value: string | null;
  truncated: boolean;
} {
  return value === null || Buffer.byteLength(value, "utf8") <= maximumBytes
    ? { value, truncated: false }
    : { value: `${utf8Prefix(value, maximumBytes - 3)}…`, truncated: true };
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

const JSON_OPTION_DESCRIPTION =
  "Report failures as a JSON envelope on stdout; command output is always JSON";
const RUN_ID_POSITIONAL = {
  name: "run-id",
  description: "Workflow run ID returned by bb workflows run",
  required: true,
} as const;
const SOURCE_OPTIONS = {
  script: {
    type: "string",
    placeholder: "javascript",
    aliases: ["source"],
    description:
      "Inline workflow source starting with `export const meta = { name, description, phases }`",
  },
  file: {
    type: "string",
    placeholder: "path",
    aliases: ["script-file", "path"],
    description:
      "Workflow file inside the origin workspace; relative paths resolve from the CLI working directory",
  },
  name: {
    type: "string",
    placeholder: "name",
    aliases: ["workflow"],
    description:
      "Named workflow under .bb/workflows/<name>.js; lowercase kebab-case, at most 64 characters",
  },
} as const;
const SOURCE_CONSTRAINT = {
  kind: "exactly-one",
  options: ["script", "file", "name"],
} as const;

export function registerWorkflowCli(
  bb: BbPluginApi,
  service: WorkflowService,
): void {
  bb.cli.register(
    experimental_defineCli({
      name: "workflows",
      summary: "Run and inspect durable BB workflows",
      description:
        "Workflows run in the background: start one, then poll the compact status summary and read bounded JSONL history pages.",
      commands: {
        run: experimental_cliCommand({
          summary: "Start a workflow and return immediately",
          constraints: [SOURCE_CONSTRAINT],
          options: {
            ...SOURCE_OPTIONS,
            args: {
              type: "string",
              placeholder: "json",
              description:
                "JSON value exposed to the script as the global `args`, verbatim",
            },
            resume: {
              type: "string",
              placeholder: "run-id",
              description:
                "Reuse the recorded results of a previous run for calls that match",
            },
            json: { type: "boolean", description: JSON_OPTION_DESCRIPTION },
          },
          run(input, ctx) {
            return guarded(async () => {
              const context = requireContext(ctx);
              const prepared = await prepareWorkflowSource(
                bb,
                context,
                sourceInput(input.options, ctx.cwd),
              );
              const run = await service.start({
                projectId: context.projectId,
                originThreadId: context.threadId,
                source: prepared.source,
                args: parseJsonOption(input.options.args),
                resumedFromRunId: input.options.resume ?? null,
              });
              return success({
                runId: run.id,
                name: run.name,
                status: run.status,
              });
            });
          },
        }),
        validate: experimental_cliCommand({
          summary: "Validate workflow source and literal model selections",
          constraints: [SOURCE_CONSTRAINT],
          options: {
            ...SOURCE_OPTIONS,
            json: { type: "boolean", description: JSON_OPTION_DESCRIPTION },
          },
          run(input, ctx) {
            return guarded(async () => {
              const context = requireContext(ctx);
              const prepared = await prepareWorkflowSource(
                bb,
                context,
                sourceInput(input.options, ctx.cwd),
              );
              return success({
                ...prepared.validation,
                origin: prepared.origin,
              });
            });
          },
        }),
        status: experimental_cliCommand({
          summary: "Show a compact workflow run summary",
          positionals: [RUN_ID_POSITIONAL],
          options: {
            json: { type: "boolean", description: JSON_OPTION_DESCRIPTION },
          },
          run(input, ctx) {
            return guarded(async () => {
              const context = requireContext(ctx);
              const runId = input.positionals["run-id"];
              const page = service.inspectPage(runId, -1, 1);
              if (page === null || page.run.projectId !== context.projectId) {
                throw new Error(`Unknown workflow run ${runId}`);
              }
              return success(statusSummary(page));
            });
          },
        }),
        history: experimental_cliCommand({
          summary: "Read one JSONL page of workflow run and call history",
          positionals: [RUN_ID_POSITIONAL],
          options: {
            cursor: {
              type: "integer",
              min: 0,
              max: Number.MAX_SAFE_INTEGER,
              default: 0,
              placeholder: "call-index",
              description:
                "First call index to include; use a page record's nextCursor to continue",
            },
            limit: {
              type: "integer",
              min: 1,
              max: MAX_HISTORY_LIMIT,
              default: DEFAULT_HISTORY_LIMIT,
              description: "How many calls to include in this page",
            },
            json: { type: "boolean", description: JSON_OPTION_DESCRIPTION },
          },
          run(input, ctx) {
            return guarded(async () => {
              const runId = input.positionals["run-id"];
              const { cursor, limit } = input.options;
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
            });
          },
        }),
        list: experimental_cliCommand({
          summary: "List recent project workflow runs",
          options: {
            limit: {
              type: "integer",
              min: 1,
              max: MAX_LIST_LIMIT,
              default: DEFAULT_LIST_LIMIT,
              description: "How many recent runs to list, newest first",
            },
            json: { type: "boolean", description: JSON_OPTION_DESCRIPTION },
          },
          run(input, ctx) {
            return guarded(async () => {
              const context = requireContext(ctx);
              return success(
                service
                  .list(context.projectId, input.options.limit)
                  .map(listRunSummary),
              );
            });
          },
        }),
        stop: experimental_cliCommand({
          summary: "Cancel a workflow run",
          positionals: [RUN_ID_POSITIONAL],
          options: {
            json: { type: "boolean", description: JSON_OPTION_DESCRIPTION },
          },
          run(input, ctx) {
            return guarded(async () => {
              const context = requireContext(ctx);
              const runId = input.positionals["run-id"];
              const run = service.get(runId);
              if (run === null || run.projectId !== context.projectId) {
                throw new Error(`Unknown workflow run ${runId}`);
              }
              return success({ runId, stopped: await service.stop(runId) });
            });
          },
        }),
      },
    }),
  );
}
