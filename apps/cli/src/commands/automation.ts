import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { Command } from "commander";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type {
  Automation,
  AutomationRun,
  CreateAutomationRequest,
  EnvironmentArgs,
  UpdateAutomationRequest,
} from "@bb/server-contract";
import { action } from "../action.js";
import { createCliBbSdk } from "../client.js";
import {
  requireProjectId,
  resolveContextThreadId,
  resolveExplicitIdFlag,
} from "../context-env.js";
import { resolveLocalHostId } from "../daemon.js";
import { renderBorderlessTable } from "../table.js";
import { confirmDestructiveAction, outputJson } from "./helpers.js";
import {
  buildSpawnEnvironment,
  looksLikePath,
} from "./thread/spawn.js";
import { parsePermissionMode } from "./thread/helpers.js";

type CreateAutomationExecution = CreateAutomationRequest["execution"];
type CreateAutomationTrigger = CreateAutomationRequest["trigger"];

interface AutomationListCommandOptions {
  json?: boolean;
  project?: string;
}

interface AutomationCreateCommandOptions {
  json?: boolean;
  project?: string;
  name: string;
  cron?: string;
  timezone?: string;
  at?: string;
  in?: string;
  environment?: string;
  newEnvironment?: string;
  baseBranch?: string;
  disabled?: boolean;
  autoArchive?: boolean;
  // agent mode
  prompt?: string;
  provider?: string;
  model?: string;
  permissionMode?: string;
  targetThread?: string;
  // script mode
  script?: string;
  scriptFile?: string;
  interpreter?: string;
  timeout?: string;
}

interface AutomationShowCommandOptions {
  json?: boolean;
  project?: string;
}

interface AutomationUpdateCommandOptions {
  json?: boolean;
  project?: string;
  name?: string;
  cron?: string;
  timezone?: string;
  at?: string;
  in?: string;
  autoArchive?: boolean;
}

interface AutomationActionCommandOptions {
  json?: boolean;
  project?: string;
}

interface AutomationRunCommandOptions {
  json?: boolean;
  project?: string;
  idempotencyKey?: string;
}

interface AutomationRunsCommandOptions {
  json?: boolean;
  project?: string;
  limit?: string;
  output?: string;
}

interface AutomationDeleteCommandOptions {
  json?: boolean;
  project?: string;
  yes?: boolean;
}

const SCRIPT_INTERPRETERS = ["bash", "sh", "node", "python3"] as const;
type ScriptInterpreter = (typeof SCRIPT_INTERPRETERS)[number];

const DURATION_PATTERN = /^(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/iu;

function resolveAutomationProjectId(flagValue?: string): string {
  return requireProjectId(flagValue);
}

/**
 * Inside a thread (BB_THREAD_ID set) automations are stamped as agent-created
 * and record the creating thread; otherwise they are human-created. The CLI
 * passes these explicitly so behavior is deterministic from the command.
 */
function resolveCreateAttribution(): {
  origin: "agent" | "human";
  createdByThreadId?: string;
} {
  const threadId = resolveContextThreadId();
  if (threadId) {
    return { origin: "agent", createdByThreadId: threadId };
  }
  return { origin: "human" };
}

function parseScriptInterpreter(
  value: string | undefined,
): ScriptInterpreter | undefined {
  if (value === undefined) return undefined;
  if ((SCRIPT_INTERPRETERS as readonly string[]).includes(value)) {
    return value as ScriptInterpreter;
  }
  throw new Error(
    `Invalid interpreter '${value}'. Expected ${SCRIPT_INTERPRETERS.map((v) => `'${v}'`).join(" or ")}.`,
  );
}

// The CLI uploads --script-file content inline, so the original filename (and
// its extension) is lost server-side. Infer the interpreter from the local file
// extension here so a .py/.js script is not silently run with the default bash.
const INTERPRETER_BY_EXTENSION: Record<string, ScriptInterpreter> = {
  ".sh": "bash",
  ".bash": "bash",
  ".js": "node",
  ".mjs": "node",
  ".py": "python3",
};

function inferInterpreterFromPath(
  filePath: string,
): ScriptInterpreter | undefined {
  return INTERPRETER_BY_EXTENSION[extname(filePath).toLowerCase()];
}

function parseTimeoutMs(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("--timeout must be a positive integer number of milliseconds.");
  }
  return parsed;
}

function parseRunAt(value: string): number {
  const runAt = Date.parse(value);
  if (!Number.isFinite(runAt)) {
    throw new Error("--at must be a valid date/time, preferably ISO 8601.");
  }
  if (runAt <= Date.now()) {
    throw new Error("--at must be in the future.");
  }
  return runAt;
}

function parseRunIn(value: string): number {
  const match = DURATION_PATTERN.exec(value.trim());
  if (!match) {
    throw new Error("--in must be a duration like 30s, 5m, 2h, or 1d.");
  }
  const amountText = match[1];
  const unitText = match[2];
  if (amountText === undefined || unitText === undefined) {
    throw new Error("--in must be a duration like 30s, 5m, 2h, or 1d.");
  }
  const amount = Number.parseInt(amountText, 10);
  if (amount <= 0) {
    throw new Error("--in must be greater than zero.");
  }
  const unit = unitText.toLowerCase();
  const multiplier =
    unit.startsWith("s")
      ? 1_000
      : unit.startsWith("m")
        ? 60_000
        : unit.startsWith("h")
          ? 60 * 60_000
          : 24 * 60 * 60_000;
  return Date.now() + amount * multiplier;
}

function buildTriggerFromOptions(opts: {
  cron?: string;
  timezone?: string;
  at?: string;
  in?: string;
}): CreateAutomationTrigger {
  const triggerFlags = [
    opts.cron !== undefined,
    opts.at !== undefined,
    opts.in !== undefined,
  ].filter(Boolean).length;
  if (triggerFlags !== 1) {
    throw new Error("Provide exactly one schedule flag: --cron, --at, or --in.");
  }
  if (opts.cron !== undefined) {
    if (!opts.timezone) {
      throw new Error("--cron requires --timezone.");
    }
    return {
      triggerType: "schedule",
      cron: opts.cron,
      timezone: opts.timezone,
    };
  }
  if (opts.timezone !== undefined) {
    throw new Error("--timezone is only used with --cron.");
  }
  if (opts.at !== undefined) {
    return {
      triggerType: "once",
      runAt: parseRunAt(opts.at),
    };
  }
  if (opts.in !== undefined) {
    return {
      triggerType: "once",
      runAt: parseRunIn(opts.in),
    };
  }
  throw new Error("Provide exactly one schedule flag: --cron, --at, or --in.");
}

function resolveAutomationEnvironmentValue(
  flagValue?: string,
): string | undefined {
  const trimmedValue = flagValue?.trim();
  if (!trimmedValue) return undefined;
  if (looksLikePath(trimmedValue)) return trimmedValue;
  return resolveExplicitIdFlag({
    flagName: "--environment flag",
    value: trimmedValue,
  });
}

async function resolveCreateEnvironment(
  opts: AutomationCreateCommandOptions,
  projectId: string,
): Promise<EnvironmentArgs> {
  const environmentValue = resolveAutomationEnvironmentValue(opts.environment);
  const defaultPersonalWorkspace =
    projectId === PERSONAL_PROJECT_ID &&
    !environmentValue &&
    !opts.newEnvironment;
  const needsHostId =
    Boolean(opts.newEnvironment) ||
    (!defaultPersonalWorkspace &&
      (!environmentValue || looksLikePath(environmentValue)));
  const hostId = needsHostId ? await resolveLocalHostId() : null;
  return buildSpawnEnvironment({
    defaultPersonalWorkspace,
    environmentValue,
    newEnvironmentKind: opts.newEnvironment,
    hostId,
    baseBranch: opts.baseBranch,
  });
}

async function buildCreateExecution(
  opts: AutomationCreateCommandOptions,
): Promise<CreateAutomationExecution> {
  const hasAgentFlags = Boolean(opts.prompt);
  const hasScriptFlags = Boolean(opts.script || opts.scriptFile);

  if (hasAgentFlags && hasScriptFlags) {
    throw new Error(
      "Provide either agent flags (--prompt) or script flags (--script/--script-file), not both.",
    );
  }
  if (!hasAgentFlags && !hasScriptFlags) {
    throw new Error(
      "Provide an execution mode: agent (--prompt --provider --model) or script (--script-file <path> or --script <inline>).",
    );
  }

  if (hasAgentFlags) {
    if (!opts.provider || !opts.model) {
      throw new Error(
        "Agent automations require --provider and --model alongside --prompt.",
      );
    }
    const permissionMode = parsePermissionMode(opts.permissionMode) ?? "readonly";
    return {
      mode: "agent",
      prompt: opts.prompt as string,
      providerId: opts.provider,
      model: opts.model,
      permissionMode,
      ...(opts.targetThread ? { targetThreadId: opts.targetThread } : {}),
    };
  }

  const explicitInterpreter = parseScriptInterpreter(opts.interpreter);
  const timeoutMs = parseTimeoutMs(opts.timeout);
  if (opts.script && opts.scriptFile) {
    throw new Error("Provide exactly one of --script or --script-file.");
  }
  // --script-file reads the file's content and uploads it inline; the server
  // writes it under the automation's script dir. Because the original filename
  // is dropped, infer the interpreter from the file extension when not given so
  // the server does not default a .py/.js script to bash.
  const script = opts.scriptFile
    ? await readFile(opts.scriptFile, "utf8")
    : (opts.script as string);
  const interpreter =
    explicitInterpreter ??
    (opts.scriptFile ? inferInterpreterFromPath(opts.scriptFile) : undefined);
  return {
    mode: "script",
    script,
    ...(interpreter ? { interpreter } : {}),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  };
}

function buildUpdateRequest(
  opts: AutomationUpdateCommandOptions,
): UpdateAutomationRequest {
  const request: UpdateAutomationRequest = {};
  if (opts.name !== undefined) request.name = opts.name;
  if (
    opts.cron !== undefined ||
    opts.timezone !== undefined ||
    opts.at !== undefined ||
    opts.in !== undefined
  ) {
    request.trigger = buildTriggerFromOptions(opts);
  }
  if (opts.autoArchive !== undefined) request.autoArchive = opts.autoArchive;
  if (Object.keys(request).length === 0) {
    throw new Error(
      "No changes requested. Provide --name, --cron + --timezone, --at, --in, and/or --auto-archive.",
    );
  }
  return request;
}

export function registerAutomationCommands(
  program: Command,
  getUrl: () => string,
): void {
  const automation = program
    .command("automation")
    .description("Inspect and manage automations (scheduled agent/script runs)");

  automation
    .command("list")
    .description("List automations for a project")
    .requiredOption(
      "--project <id>",
      "Project ID",
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: AutomationListCommandOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const projectId = resolveAutomationProjectId(opts.project);
        const automations = await sdk.automations.list({ projectId });
        if (outputJson(opts, automations)) return;
        if (automations.length === 0) {
          console.log("No automations found");
          return;
        }
        printAutomationTable(automations);
      }),
    );

  automation
    .command("create")
    .description("Create an automation (agent or script mode)")
    .requiredOption("--name <name>", "Automation name")
    .option("--cron <expr>", "Recurring 5-field cron expression")
    .option("--timezone <tz>", "IANA timezone for --cron, e.g. America/New_York")
    .option("--at <datetime>", "One-shot run time, preferably ISO 8601")
    .option("--in <duration>", "One-shot delay, e.g. 30s, 5m, 2h, 1d")
    .requiredOption(
      "--project <id>",
      "Project ID",
    )
    .option(
      "--environment <id-or-path>",
      "Existing environment ID or unmanaged workspace path",
    )
    .option(
      "--new-environment <kind>",
      "Create a new managed environment of the given kind (worktree)",
    )
    .option(
      "--base-branch <branch>",
      "Base branch for new managed worktrees. Omit to let bb choose the project's default worktree base.",
    )
    .option("--disabled", "Create the automation paused")
    .option("--auto-archive", "Auto-archive the spawned thread when it completes")
    .option("--prompt <prompt>", "Agent mode: prompt to run when due")
    .option("--provider <id>", "Agent mode: provider ID")
    .option("--model <model>", "Agent mode: model ID")
    .option(
      "--permission-mode <mode>",
      "Agent mode: permission mode (full, workspace-write, readonly). Defaults to readonly.",
    )
    .option(
      "--target-thread <id>",
      "Agent mode: reuse/re-prompt an existing thread instead of spawning a new one",
    )
    .option("--script <inline>", "Script mode: inline script content")
    .option("--script-file <path>", "Script mode: read script content from a file")
    .option(
      "--interpreter <name>",
      "Script mode: interpreter (bash, sh, node, python3). Defaults by extension.",
    )
    .option("--timeout <ms>", "Script mode: timeout in milliseconds")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: AutomationCreateCommandOptions) => {
        const projectId = resolveAutomationProjectId(opts.project);
        const execution = await buildCreateExecution(opts);
        const environment = await resolveCreateEnvironment(opts, projectId);
        const request: CreateAutomationRequest = {
          name: opts.name,
          trigger: buildTriggerFromOptions(opts),
          execution,
          environment,
          ...resolveCreateAttribution(),
          ...(opts.disabled ? { enabled: false } : {}),
          ...(opts.autoArchive ? { autoArchive: true } : {}),
        };
        const sdk = createCliBbSdk(getUrl());
        const created = await sdk.automations.create({ projectId, ...request });
        if (outputJson(opts, created)) return;
        console.log(`Automation created: ${created.id}`);
        printAutomation(created);
      }),
    );

  automation
    .command("show <automationId>")
    .description("Show automation details")
    .requiredOption(
      "--project <id>",
      "Project ID",
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (automationId: string, opts: AutomationShowCommandOptions) => {
          const sdk = createCliBbSdk(getUrl());
          const projectId = resolveAutomationProjectId(opts.project);
          const found = await sdk.automations.get({ projectId, automationId });
          if (outputJson(opts, found)) return;
          printAutomation(found);
        },
      ),
    );

  automation
    .command("update <automationId>")
    .description("Update an automation's configuration")
    .requiredOption(
      "--project <id>",
      "Project ID",
    )
    .option("--name <name>", "Set the automation name")
    .option("--cron <expr>", "Set the cron expression (requires --timezone)")
    .option("--timezone <tz>", "Set the timezone (requires --cron)")
    .option("--at <datetime>", "Set a one-shot run time")
    .option("--in <duration>", "Set a one-shot delay, e.g. 30s, 5m, 2h, 1d")
    .option("--auto-archive", "Enable auto-archive of the spawned thread")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (automationId: string, opts: AutomationUpdateCommandOptions) => {
          const request = buildUpdateRequest(opts);
          const sdk = createCliBbSdk(getUrl());
          const projectId = resolveAutomationProjectId(opts.project);
          const updated = await sdk.automations.update({
            projectId,
            automationId,
            ...request,
          });
          if (outputJson(opts, updated)) return;
          console.log(`Automation ${updated.id} updated`);
          printAutomation(updated);
        },
      ),
    );

  automation
    .command("pause <automationId>")
    .description("Pause an automation")
    .requiredOption(
      "--project <id>",
      "Project ID",
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (automationId: string, opts: AutomationActionCommandOptions) => {
          const sdk = createCliBbSdk(getUrl());
          const projectId = resolveAutomationProjectId(opts.project);
          const paused = await sdk.automations.pause({ projectId, automationId });
          if (outputJson(opts, paused)) return;
          console.log(`Automation ${paused.id} paused`);
        },
      ),
    );

  automation
    .command("resume <automationId>")
    .description("Resume a paused automation")
    .requiredOption(
      "--project <id>",
      "Project ID",
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (automationId: string, opts: AutomationActionCommandOptions) => {
          const sdk = createCliBbSdk(getUrl());
          const projectId = resolveAutomationProjectId(opts.project);
          const resumed = await sdk.automations.resume({
            projectId,
            automationId,
          });
          if (outputJson(opts, resumed)) return;
          console.log(`Automation ${resumed.id} resumed`);
        },
      ),
    );

  automation
    .command("run <automationId>")
    .description("Run an automation now (manual trigger)")
    .requiredOption(
      "--project <id>",
      "Project ID",
    )
    .option("--idempotency-key <key>", "Dedup key for replayable run-now")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (automationId: string, opts: AutomationRunCommandOptions) => {
          const sdk = createCliBbSdk(getUrl());
          const projectId = resolveAutomationProjectId(opts.project);
          const result = await sdk.automations.run({
            projectId,
            automationId,
            ...(opts.idempotencyKey
              ? { idempotencyKey: opts.idempotencyKey }
              : {}),
          });
          if (outputJson(opts, result)) return;
          console.log(`Run started: ${result.run.id}`);
          if (result.run.threadId) {
            console.log(`Thread: ${result.run.threadId}`);
          }
        },
      ),
    );

  automation
    .command("runs <automationId>")
    .description("List recent runs for an automation")
    .requiredOption(
      "--project <id>",
      "Project ID",
    )
    .option("--limit <count>", "Maximum number of runs to return")
    .option("--output <runId>", "Print captured stdout for a script run")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (automationId: string, opts: AutomationRunsCommandOptions) => {
          const sdk = createCliBbSdk(getUrl());
          const projectId = resolveAutomationProjectId(opts.project);
          const limit = opts.limit ? Number.parseInt(opts.limit, 10) : undefined;
          if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
            throw new Error("--limit must be a positive integer.");
          }
          const result = await sdk.automations.runs({
            projectId,
            automationId,
            ...(limit === undefined ? {} : { limit }),
          });
          if (opts.output) {
            const run = result.runs.find(
              (candidate) => candidate.id === opts.output,
            );
            if (!run) {
              throw new Error(
                `Run ${opts.output} not found in the returned runs. Increase --limit if it is older.`,
              );
            }
            if (outputJson(opts, run)) return;
            console.log(run.output ?? "");
            return;
          }
          if (outputJson(opts, result)) return;
          if (result.runs.length === 0) {
            console.log("No runs found");
            return;
          }
          printRunTable(result.runs);
        },
      ),
    );

  automation
    .command("delete <automationId>")
    .description("Delete an automation and its run history")
    .requiredOption(
      "--project <id>",
      "Project ID",
    )
    .option("--yes", "Skip confirmation prompt")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (automationId: string, opts: AutomationDeleteCommandOptions) => {
          if (!opts.yes) {
            const confirmed = await confirmDestructiveAction(
              `Delete automation ${automationId} and its run history?`,
            );
            if (!confirmed) {
              console.log("Aborted.");
              return;
            }
          }
          const sdk = createCliBbSdk(getUrl());
          const projectId = resolveAutomationProjectId(opts.project);
          await sdk.automations.delete({ projectId, automationId });
          if (outputJson(opts, { ok: true, id: automationId })) return;
          console.log(`Automation ${automationId} deleted`);
        },
      ),
    );
}

function formatTimestamp(value: number | null): string {
  return value === null ? "-" : new Date(value).toLocaleString();
}

function formatAutomationTrigger(automation: Automation): string {
  if (automation.trigger.triggerType === "once") {
    return `once at ${formatTimestamp(automation.trigger.runAt)}`;
  }
  return `${automation.trigger.cron} (${automation.trigger.timezone})`;
}

function printAutomation(automation: Automation): void {
  console.log("");
  console.log(`  ID:        ${automation.id}`);
  console.log(`  Name:      ${automation.name}`);
  console.log(`  Enabled:   ${automation.enabled ? "yes" : "no"}`);
  console.log(`  Mode:      ${automation.execution.mode}`);
  console.log(`  Schedule:  ${formatAutomationTrigger(automation)}`);
  console.log(`  Next run:  ${formatTimestamp(automation.nextRunAt)}`);
  console.log(`  Last run:  ${formatTimestamp(automation.lastRunAt)}`);
  console.log(`  Runs:      ${automation.runCount}`);
  console.log(`  Origin:    ${automation.origin}`);
  if (automation.lastError) {
    console.log(`  Error:     ${automation.lastError}`);
  }
  console.log("");
}

function printAutomationTable(automations: Automation[]): void {
  const rows = automations.map((automation) => [
    automation.id,
    automation.name,
    automation.enabled ? "yes" : "no",
    formatAutomationTrigger(automation),
    formatTimestamp(automation.nextRunAt),
    String(automation.runCount),
    automation.origin,
  ]);
  const head = ["ID", "Name", "On", "Schedule", "Next run", "Runs", "Origin"];
  const colWidths = head.map((label, index) =>
    Math.max(label.length, ...rows.map((row) => row[index].length)),
  );
  const table = renderBorderlessTable(
    { head, colWidths, trimTrailingWhitespace: true },
    rows,
  );
  console.log("");
  console.log(table);
  console.log("");
}

function printRunTable(runs: AutomationRun[]): void {
  const rows = runs.map((run) => [
    run.id,
    run.status,
    formatTimestamp(run.startedAt),
    run.threadId ?? (run.exitCode === null ? "-" : `exit ${run.exitCode}`),
    run.skipReason ?? run.error ?? "-",
  ]);
  const head = ["ID", "Status", "Started", "Thread/Exit", "Detail"];
  const colWidths = head.map((label, index) =>
    Math.max(label.length, ...rows.map((row) => row[index].length)),
  );
  const table = renderBorderlessTable(
    { head, colWidths, trimTrailingWhitespace: true },
    rows,
  );
  console.log("");
  console.log(table);
  console.log("");
}
