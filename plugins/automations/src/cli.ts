import { isAbsolute, resolve } from "node:path";
import {
  PluginCliError,
  cliCommand,
  defineCli,
  type BbPluginApi,
  type PluginCliContext,
  type PluginCliResult,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { AutomationService } from "./service.js";
import type {
  AgentEnvironment,
  AgentExecutionUpdate,
  AutomationDetailResponse,
  AutomationReadProblem,
  AutomationReadResult,
  AutomationResponse,
  AutomationRunResponse,
  AutomationScriptInterpreter,
  AutomationScriptWorkingDirectory,
  CreateAutomationInput,
  PermissionMode,
  ReasoningLevel,
  ResolvedCreateAutomationInput,
  ServiceTier,
  UpdateAutomationInput,
} from "./rpc-types.js";
import {
  providerRoutingForEnvironment,
  resolvePermissionMode,
} from "./provider-permissions.js";
import {
  AUTOMATION_RUNS_LIMIT_DEFAULT,
  AUTOMATION_RUNS_LIMIT_MAX,
  AUTOMATION_SCRIPT_MAX_LENGTH,
  AUTOMATION_SCRIPT_TIMEOUT_DEFAULT_MS,
  AUTOMATION_SCRIPT_TIMEOUT_MAX_MS,
} from "./limits.js";
import {
  automationScriptInterpreterSchema,
  permissionModeSchema,
  reasoningLevelSchema,
  serviceTierSchema,
} from "./rpc-types.js";
import { interpreterForPath } from "./script-files.js";
// bb-fork(windows): the printed refresh command must be pasteable on this platform.
import { forkShellQuote } from "./shell-quote.fork.js";

const DURATION_PATTERN =
  /^(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/iu;
const hostListSchema = z.array(
  z
    .object({
      id: z.string().optional(),
      status: z.string().optional(),
      connected: z.boolean().optional(),
    })
    .passthrough(),
);

const DESCRIPTION = `Automations run agent prompts or server-side scripts on a schedule.

Scripts run on the bb server host. New standard-project scripts use the
project source on that host when one exists; Personal and projects without a
server-host source run in the plugin's shared script storage directory.
Existing scripts without a saved policy also run there. Select
automation-storage, project, or an absolute server-host path with
--working-directory. An unavailable selected directory fails the run.`;

const JSON_OPTION = {
  type: "boolean",
  description: "Emit machine-readable JSON",
} as const;

const PROJECT_OPTION = {
  type: "string",
  placeholder: "id",
  description:
    "Required. Project that owns the automation; `bb project list --include-personal --json` lists ids",
} as const;

const AUTOMATION_ID_POSITIONAL = {
  name: "automationId",
  description: "Automation id from `bb automation list`",
  required: true,
} as const;

const SCHEDULE_OPTIONS = {
  cron: {
    type: "string",
    placeholder: "expression",
    description:
      "Five-field cron expression, at most 100 characters; requires --timezone",
  },
  timezone: {
    type: "string",
    placeholder: "iana-timezone",
    description:
      "IANA timezone for --cron, for example America/New_York; only used with --cron",
  },
  at: {
    type: "string",
    placeholder: "datetime",
    description:
      "One-shot run time in the future, preferably ISO 8601 (2026-01-31T09:00:00Z)",
  },
  in: {
    type: "string",
    placeholder: "duration",
    description: "One-shot delay from now: 30s, 5m, 2h, or 1d",
  },
} as const;

const AGENT_OPTIONS = {
  prompt: {
    type: "string",
    placeholder: "text",
    description: "Prompt the agent runs when the automation is due",
  },
  provider: {
    type: "string",
    placeholder: "id",
    description: "Provider id, for example claude or codex",
  },
  model: {
    type: "string",
    placeholder: "model",
    description: "Model id the provider accepts",
  },
  reasoning: {
    type: "enum",
    values: reasoningLevelSchema.options,
    description: "Reasoning level; new automations default to medium",
  },
  "service-tier": {
    type: "enum",
    values: [...serviceTierSchema.options, "none"],
    description: "Service tier; none leaves the automation without one",
  },
  "permission-mode": {
    type: "enum",
    values: permissionModeSchema.options,
    description:
      "Permission mode; defaults to the provider's best of auto then full",
  },
  "target-thread": {
    type: "string",
    placeholder: "thread-id",
    description: "Re-prompt this existing thread instead of spawning one",
  },
  environment: {
    type: "string",
    placeholder: "id-or-path",
    description:
      "Existing environment id, or a workspace path to run in on a connected host",
  },
  "new-environment": {
    type: "enum",
    values: ["worktree"],
    description: "Create a fresh environment of this kind for each run",
  },
  "base-branch": {
    type: "string",
    placeholder: "branch",
    description: "Base branch for --new-environment worktree",
  },
} as const;

const SCRIPT_OPTIONS = {
  script: {
    type: "string",
    placeholder: "inline",
    description: `Inline script body, at most ${AUTOMATION_SCRIPT_MAX_LENGTH} characters`,
  },
  "script-file": {
    type: "string",
    placeholder: "path",
    description:
      "Copy the script from this file; relative paths resolve against the invoking directory",
  },
  host: {
    type: "string",
    placeholder: "name-or-id",
    description:
      "Host holding --script-file; defaults to the thread's environment host, else the server host",
  },
  interpreter: {
    type: "enum",
    values: automationScriptInterpreterSchema.options,
    description:
      "Interpreter for the script; inferred from a --script-file extension when omitted",
  },
  timeout: {
    type: "duration",
    defaultUnit: "ms",
    min: 1,
    max: AUTOMATION_SCRIPT_TIMEOUT_MAX_MS,
    description: `Run timeout; a bare number is milliseconds (default ${AUTOMATION_SCRIPT_TIMEOUT_DEFAULT_MS}, max ${AUTOMATION_SCRIPT_TIMEOUT_MAX_MS})`,
  },
  "env-json": {
    type: "string",
    placeholder: "json",
    description:
      'Script environment variables as a JSON object of string values, for example {"CHANNEL":"qa"}',
  },
  "working-directory": {
    type: "string",
    placeholder: "automation-storage|project|path",
    description:
      "Where the script runs: automation-storage, project, or an absolute path on the bb server host",
  },
} as const;

interface ScheduleOptionValues {
  cron: string | undefined;
  timezone: string | undefined;
  at: string | undefined;
  in: string | undefined;
}

interface AgentOptionValues {
  prompt: string | undefined;
  provider: string | undefined;
  model: string | undefined;
  reasoning: ReasoningLevel | undefined;
  "service-tier": ServiceTier | "none" | undefined;
  "permission-mode": PermissionMode | undefined;
  "target-thread": string | undefined;
  environment: string | undefined;
  "new-environment": "worktree" | undefined;
  "base-branch": string | undefined;
}

interface ScriptOptionValues {
  script: string | undefined;
  "script-file": string | undefined;
  host: string | undefined;
  interpreter: AutomationScriptInterpreter | undefined;
  timeout: number | undefined;
  "env-json": string | undefined;
  "working-directory": string | undefined;
}

type ExecutionOptionValues = AgentOptionValues & ScriptOptionValues;

type UpdateOptionValues = ExecutionOptionValues &
  ScheduleOptionValues & {
    project: string | undefined;
    name: string | undefined;
  };

function cliError(message: string, code: string): PluginCliError {
  return new PluginCliError(message, { code });
}

async function attempt(
  work: () => Promise<PluginCliResult>,
): Promise<PluginCliResult> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof PluginCliError) throw error;
    throw new PluginCliError(
      error instanceof Error ? error.message : String(error),
      { code: "automation_failed" },
    );
  }
}

function jsonOutput(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function requireProjectId(
  value: string | undefined,
  ctx: Pick<PluginCliContext, "projectId">,
): string {
  if (value !== undefined && value !== "") return value;
  const known = ctx.projectId;
  throw new PluginCliError("missing required option --project", {
    code: "missing_required",
    hint:
      known === undefined
        ? "Pass --project <id>; `bb project list --include-personal --json` lists project ids."
        : `This thread's project is ${known}; re-run with --project ${known}`,
  });
}

function requireOptionValue(name: string, value: string): string {
  if (value === "") {
    throw cliError(
      `Missing required option --${name} <value>.`,
      "missing_required",
    );
  }
  return value;
}

function parseRunAt(value: string): number {
  const runAt = Date.parse(value);
  if (!Number.isFinite(runAt)) {
    throw cliError(
      "--at must be a valid date/time, preferably ISO 8601.",
      "invalid_value",
    );
  }
  if (runAt <= Date.now()) {
    throw cliError("--at must be in the future.", "invalid_value");
  }
  return runAt;
}

function parseRunIn(value: string): number {
  const match = DURATION_PATTERN.exec(value.trim());
  if (!match) {
    throw cliError(
      "--in must be a duration like 30s, 5m, 2h, or 1d.",
      "invalid_value",
    );
  }
  const amount = Number.parseInt(match[1] ?? "", 10);
  if (amount <= 0) {
    throw cliError("--in must be greater than zero.", "invalid_value");
  }
  const unit = (match[2] ?? "").toLowerCase();
  const multiplier = unit.startsWith("s")
    ? 1_000
    : unit.startsWith("m")
      ? 60_000
      : unit.startsWith("h")
        ? 60 * 60_000
        : 24 * 60 * 60_000;
  return Date.now() + amount * multiplier;
}

function buildTrigger(
  options: ScheduleOptionValues,
): CreateAutomationInput["trigger"] {
  const { cron, at, in: runIn, timezone } = options;
  const triggerFlags = [cron, at, runIn].filter(
    (value) => value !== undefined,
  ).length;
  if (triggerFlags !== 1) {
    throw cliError(
      "Provide exactly one schedule flag: --cron, --at, or --in.",
      "missing_required",
    );
  }
  if (cron !== undefined) {
    if (!timezone)
      throw cliError("--cron requires --timezone.", "missing_required");
    return { triggerType: "schedule", cron, timezone };
  }
  if (timezone !== undefined) {
    throw cliError(
      "--timezone is only used with --cron.",
      "unexpected_argument",
    );
  }
  if (at !== undefined) return { triggerType: "once", runAt: parseRunAt(at) };
  if (runIn !== undefined) {
    return { triggerType: "once", runAt: parseRunIn(runIn) };
  }
  throw cliError(
    "Provide exactly one schedule flag: --cron, --at, or --in.",
    "missing_required",
  );
}

function parseScriptWorkingDirectory(
  raw: string,
): AutomationScriptWorkingDirectory {
  const value = requireOptionValue("working-directory", raw);
  if (value === "automation-storage" || value === "project") {
    return { type: value };
  }
  if (isAbsolute(value)) return { type: "path", path: value };
  throw cliError(
    "Invalid --working-directory. Expected automation-storage, project, or an absolute path on the bb server host.",
    "invalid_value",
  );
}

function validateAgentTargetOptions(options: AgentOptionValues): void {
  const targetThread = options["target-thread"];
  const environment = options.environment;
  const newEnvironment = options["new-environment"];
  if (targetThread !== undefined) {
    requireOptionValue("target-thread", targetThread);
  }
  if (environment !== undefined) requireOptionValue("environment", environment);
  const provided = [targetThread, environment, newEnvironment].filter(
    (value) => value !== undefined,
  );
  if (provided.length > 1) {
    throw cliError(
      "Cannot combine target options: --target-thread, --environment, and --new-environment.",
      "unexpected_argument",
    );
  }
  if (
    options["base-branch"] !== undefined &&
    options["new-environment"] === undefined
  ) {
    throw cliError(
      "--base-branch requires --new-environment worktree.",
      "missing_required",
    );
  }
}

function parseScriptEnv(
  value: string | undefined,
): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  let decoded: unknown;
  try {
    decoded = JSON.parse(value);
  } catch {
    throw cliError(
      "--env-json must be a JSON object of string values.",
      "invalid_value",
    );
  }
  const parsed = z.record(z.string(), z.string()).safeParse(decoded);
  if (!parsed.success) {
    throw cliError(
      "--env-json must be a JSON object of string values.",
      "invalid_value",
    );
  }
  return parsed.data;
}

function looksLikePath(value: string): boolean {
  return value.includes("/") || value.startsWith(".") || value.startsWith("~");
}

async function resolveConnectedHostId(
  bb: Pick<BbPluginApi, "sdk">,
): Promise<string> {
  const hosts = hostListSchema.parse(await bb.sdk.hosts.list());
  const host =
    hosts.find((candidate) => candidate.connected === true) ??
    hosts.find((candidate) => candidate.status === "connected") ??
    hosts[0];
  if (!host?.id) {
    throw cliError("No connected host is available.", "no_connected_host");
  }
  return host.id;
}

async function buildAgentEnvironment(
  bb: Pick<BbPluginApi, "sdk">,
  options: AgentOptionValues,
): Promise<AgentEnvironment> {
  const environment = options.environment?.trim();
  const newEnvironment = options["new-environment"];
  const baseBranch = options["base-branch"]?.trim();
  if (environment && newEnvironment) {
    throw cliError(
      "Cannot combine --environment with --new-environment.",
      "unexpected_argument",
    );
  }
  if (newEnvironment) {
    return {
      type: "host",
      hostId: await resolveConnectedHostId(bb),
      workspace: {
        type: "managed-worktree",
        baseBranch: baseBranch
          ? { kind: "named", name: baseBranch }
          : { kind: "default" },
      },
    };
  }
  if (!environment) return { type: "project-default" };
  if (looksLikePath(environment)) {
    return {
      type: "host",
      hostId: await resolveConnectedHostId(bb),
      workspace: { type: "unmanaged", path: environment },
    };
  }
  return { type: "reuse", environmentId: environment };
}

const scriptFileHostListSchema = z.array(
  z.object({ id: z.string().min(1), name: z.string().min(1) }).passthrough(),
);
const threadEnvironmentHostSchema = z
  .object({
    environment: z
      .object({ hostId: z.string().min(1) })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

async function resolveScriptFileHostId(
  bb: Pick<BbPluginApi, "sdk">,
  ctx: Pick<PluginCliContext, "threadId">,
  override: string | undefined,
): Promise<string | undefined> {
  if (override !== undefined) {
    const query = override.trim();
    if (query.length === 0) {
      throw cliError("--host requires a name or id.", "invalid_value");
    }
    const hosts = scriptFileHostListSchema.parse(await bb.sdk.hosts.list());
    const idMatch = hosts.find((host) => host.id === query);
    if (idMatch) return idMatch.id;
    const nameMatches = hosts.filter(
      (host) => host.name.toLocaleLowerCase() === query.toLocaleLowerCase(),
    );
    if (nameMatches.length === 1) return nameMatches[0]!.id;
    if (nameMatches.length > 1) {
      throw cliError(
        `Host name "${query}" is ambiguous; pass one of these ids: ${nameMatches
          .map((host) => host.id)
          .join(", ")}`,
        "invalid_value",
      );
    }
    throw cliError(
      `Unknown host "${query}"; run \`bb machine list\` to list hosts.`,
      "invalid_value",
    );
  }
  if (ctx.threadId === undefined) return undefined;
  const thread = threadEnvironmentHostSchema.parse(
    await bb.sdk.threads.get({
      threadId: ctx.threadId,
      include: "environment",
    }),
  );
  if (!thread.environment) {
    throw cliError(
      `Thread ${ctx.threadId} has no environment, so the --script-file host cannot be resolved; pass --host <name-or-id>.`,
      "invalid_value",
    );
  }
  return thread.environment.hostId;
}

type ScriptFileSource = {
  path: string;
  hostId: string | undefined;
  content: string;
};

async function loadScriptFileSource(
  bb: Pick<BbPluginApi, "sdk">,
  options: ScriptOptionValues,
  ctx: Pick<PluginCliContext, "cwd" | "threadId">,
): Promise<ScriptFileSource | undefined> {
  const scriptFile = options["script-file"];
  const hostOverride = options.host;
  if (scriptFile === undefined) {
    if (hostOverride !== undefined) {
      throw cliError("--host requires --script-file.", "missing_required");
    }
    return undefined;
  }
  let path: string;
  if (isAbsolute(scriptFile)) {
    path = scriptFile;
  } else {
    if (ctx.cwd === undefined || !isAbsolute(ctx.cwd)) {
      throw cliError(
        "Relative --script-file paths need the invoking CLI cwd; pass an absolute path.",
        "invalid_value",
      );
    }
    path = resolve(ctx.cwd, scriptFile);
  }
  const hostId = await resolveScriptFileHostId(bb, ctx, hostOverride);
  const file = await bb.sdk.files.read({
    ...(hostId !== undefined ? { hostId } : {}),
    path,
  });
  if (file.contentEncoding !== "utf8") {
    throw cliError(`--script-file is not UTF-8 text: ${path}`, "invalid_value");
  }
  return { path, hostId, content: file.content };
}

type BuiltExecution = {
  execution: ResolvedCreateAutomationInput["execution"];
  scriptSource?: ScriptFileSource;
};

async function buildExecution(
  bb: Pick<BbPluginApi, "sdk">,
  options: ExecutionOptionValues,
  ctx: Pick<PluginCliContext, "cwd" | "threadId">,
): Promise<BuiltExecution> {
  const prompt = options.prompt;
  const script = options.script;
  const scriptFile = options["script-file"];
  const hasAgent = prompt !== undefined;
  const hasScript = script !== undefined || scriptFile !== undefined;
  if (hasAgent && hasScript) {
    throw cliError(
      "Provide either agent flags (--prompt) or script flags (--script/--script-file), not both.",
      "unexpected_argument",
    );
  }
  if (
    hasAgent &&
    (options.interpreter !== undefined ||
      options.timeout !== undefined ||
      options["env-json"] !== undefined ||
      options["working-directory"] !== undefined)
  ) {
    throw cliError(
      "Agent automations do not accept --interpreter, --timeout, --env-json, or --working-directory.",
      "unexpected_argument",
    );
  }
  if (!hasAgent && !hasScript) {
    throw cliError(
      "Provide an execution mode: agent (--prompt --provider --model) or script (--script-file <path> or --script <inline>).",
      "missing_required",
    );
  }
  if (hasAgent) {
    const provider = options.provider;
    const model = options.model;
    if (!provider || !model) {
      throw cliError(
        "Agent automations require --provider and --model alongside --prompt.",
        "missing_required",
      );
    }
    validateAgentTargetOptions(options);
    const environment = await buildAgentEnvironment(bb, options);
    const serviceTier = options["service-tier"];
    return {
      execution: {
        mode: "agent",
        prompt,
        providerId: provider,
        model,
        reasoningLevel: options.reasoning ?? "medium",
        ...(serviceTier === undefined || serviceTier === "none"
          ? {}
          : { serviceTier }),
        permissionMode: await resolvePermissionMode(
          bb,
          provider,
          options["permission-mode"],
          providerRoutingForEnvironment(environment),
        ),
        environment,
        ...(options["target-thread"]
          ? { targetThreadId: options["target-thread"] }
          : {}),
      },
    };
  }
  if (
    options.provider !== undefined ||
    options.model !== undefined ||
    options.reasoning !== undefined ||
    options["service-tier"] !== undefined ||
    options["permission-mode"] !== undefined ||
    options["target-thread"] !== undefined ||
    options.environment !== undefined ||
    options["new-environment"] !== undefined ||
    options["base-branch"] !== undefined
  ) {
    throw cliError(
      "Script automations do not accept agent execution flags.",
      "unexpected_argument",
    );
  }
  if (script !== undefined && scriptFile !== undefined) {
    throw cliError(
      "Provide exactly one of --script or --script-file.",
      "unexpected_argument",
    );
  }
  const timeoutMs = options.timeout;
  const env = parseScriptEnv(options["env-json"]);
  const workingDirectoryOption = options["working-directory"];
  const workingDirectory =
    workingDirectoryOption === undefined
      ? undefined
      : parseScriptWorkingDirectory(workingDirectoryOption);
  const scriptSource = await loadScriptFileSource(bb, options, ctx);
  const content = scriptSource ? scriptSource.content : script;
  if (!content) throw cliError("Missing script content.", "invalid_value");
  const interpreter =
    options.interpreter ??
    (scriptSource ? interpreterForPath(scriptSource.path) : undefined);
  return {
    execution: {
      mode: "script",
      script: content,
      ...(scriptSource ? { scriptFile: scriptSource.path } : {}),
      ...(interpreter ? { interpreter } : {}),
      ...(workingDirectory ? { workingDirectory } : {}),
      timeoutMs: timeoutMs ?? AUTOMATION_SCRIPT_TIMEOUT_DEFAULT_MS,
      ...(env ? { env } : {}),
    },
    ...(scriptSource ? { scriptSource } : {}),
  };
}

const COMPLETE_EXECUTION_OPTION_NAMES = [
  "script",
  "script-file",
  "interpreter",
  "timeout",
  "env-json",
] as const;

async function buildAgentExecutionUpdate(
  bb: Pick<BbPluginApi, "sdk">,
  options: AgentOptionValues,
): Promise<AgentExecutionUpdate | undefined> {
  const agentOptionNames = [
    options.prompt,
    options.provider,
    options.model,
    options.reasoning,
    options["service-tier"],
    options["permission-mode"],
    options["target-thread"],
    options.environment,
    options["new-environment"],
    options["base-branch"],
  ];
  if (!agentOptionNames.some((value) => value !== undefined)) return undefined;

  validateAgentTargetOptions(options);
  const update: AgentExecutionUpdate = {};
  if (options.prompt !== undefined) {
    update.prompt = requireOptionValue("prompt", options.prompt);
  }
  if (options.provider !== undefined) {
    update.providerId = requireOptionValue("provider", options.provider);
  }
  if (options.model !== undefined) {
    update.model = requireOptionValue("model", options.model);
  }
  if (options.reasoning !== undefined) {
    update.reasoningLevel = options.reasoning;
  }
  const serviceTier = options["service-tier"];
  if (serviceTier !== undefined) {
    update.serviceTier = serviceTier === "none" ? null : serviceTier;
  }
  if (options["permission-mode"] !== undefined) {
    update.permissionMode = options["permission-mode"];
  }
  if (options["target-thread"] !== undefined) {
    update.target = {
      type: "target-thread",
      threadId: requireOptionValue("target-thread", options["target-thread"]),
    };
  } else if (
    options.environment !== undefined ||
    options["new-environment"] !== undefined
  ) {
    update.target = {
      type: "environment",
      environment: await buildAgentEnvironment(bb, options),
    };
  }
  return update;
}

async function buildUpdateRequest(
  bb: Pick<BbPluginApi, "sdk">,
  options: UpdateOptionValues,
  automationId: string,
  ctx: Pick<PluginCliContext, "cwd" | "projectId" | "threadId">,
): Promise<{
  request: UpdateAutomationInput;
  scriptSource?: ScriptFileSource;
}> {
  const projectId = requireProjectId(options.project, ctx);
  const request: UpdateAutomationInput = { projectId, automationId };
  if (options.name !== undefined) request.name = options.name;
  if (
    options.cron !== undefined ||
    options.timezone !== undefined ||
    options.at !== undefined ||
    options.in !== undefined
  ) {
    request.trigger = buildTrigger(options);
  }
  let scriptSource: ScriptFileSource | undefined;
  const replacesAgentExecution =
    options.prompt !== undefined &&
    options.provider !== undefined &&
    options.model !== undefined;
  if (
    replacesAgentExecution ||
    COMPLETE_EXECUTION_OPTION_NAMES.some((name) => options[name] !== undefined)
  ) {
    const built = await buildExecution(bb, options, ctx);
    request.execution = built.execution;
    scriptSource = built.scriptSource;
  } else {
    const agentUpdate = await buildAgentExecutionUpdate(bb, options);
    if (agentUpdate !== undefined) {
      request.agent = agentUpdate;
    }
  }
  const workingDirectoryOption = options["working-directory"];
  if (request.agent !== undefined && workingDirectoryOption !== undefined) {
    throw cliError(
      "Cannot combine agent execution flags with --working-directory.",
      "unexpected_argument",
    );
  }
  if (
    request.execution === undefined &&
    request.agent === undefined &&
    workingDirectoryOption !== undefined
  ) {
    request.script = {
      workingDirectory: parseScriptWorkingDirectory(workingDirectoryOption),
    };
  }
  if (
    request.name === undefined &&
    request.trigger === undefined &&
    request.execution === undefined &&
    request.agent === undefined &&
    request.script === undefined
  ) {
    throw cliError(
      "No changes requested. Provide --name, schedule flags, a complete agent/script execution, or partial agent/script update flags.",
      "missing_required",
    );
  }
  return { request, ...(scriptSource ? { scriptSource } : {}) };
}

function formatTimestamp(value: number | null): string {
  return value === null ? "-" : new Date(value).toLocaleString();
}

function formatAutomationTrigger(automation: AutomationResponse): string {
  if (automation.trigger.triggerType === "once") {
    return `once at ${formatTimestamp(automation.trigger.runAt)}`;
  }
  return `${automation.trigger.cron} (${automation.trigger.timezone})`;
}

type PrintableAutomation =
  | AutomationDetailResponse
  | Extract<AutomationReadProblem, { problem: "missing-agent-prompt" }>;

function printAutomation(
  automation: PrintableAutomation,
  status?: string,
): string {
  const lines = [
    "",
    `  ID:        ${automation.id}`,
    `  Name:      ${automation.name}`,
    ...(status === undefined ? [] : [`  Status:    ${status}`]),
    `  Enabled:   ${automation.enabled ? "yes" : "no"}`,
    `  Mode:      ${automation.execution.mode}`,
    `  Schedule:  ${formatAutomationTrigger(automation)}`,
    `  Next run:  ${formatTimestamp(automation.nextRunAt)}`,
    `  Last run:  ${formatTimestamp(automation.lastRunAt)}`,
    `  Runs:      ${automation.runCount}`,
    `  Origin:    ${automation.origin}`,
  ];
  if (
    automation.execution.mode === "script" &&
    automation.execution.storedScriptPath !== undefined
  ) {
    lines.push(`  Script:    ${automation.execution.storedScriptPath}`);
  }
  if (automation.execution.mode === "script") {
    lines.push(
      `  Working dir: ${automation.execution.resolvedWorkingDirectory ?? "unavailable"}`,
    );
  }
  if (automation.execution.mode === "agent") {
    lines.push(
      `  Provider:  ${automation.execution.providerId}`,
      `  Model:     ${automation.execution.model}`,
      `  Reasoning: ${automation.execution.reasoningLevel}`,
      `  Tier:      ${automation.execution.serviceTier ?? "-"}`,
      `  Permission: ${automation.execution.permissionMode}`,
    );
  }
  if (automation.lastError) lines.push(`  Error:     ${automation.lastError}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function shellQuote(value: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/u.test(value)
    ? value
    : `'${value.replaceAll("'", "'\\''")}'`;
}

function refreshScriptFileCommand(
  automation: AutomationDetailResponse,
  source: ScriptFileSource,
): string {
  if (automation.execution.mode !== "script") return "";
  const argv = [
    "bb",
    "automation",
    "update",
    automation.id,
    "--project",
    automation.projectId,
    "--script-file",
    source.path,
  ];
  if (source.hostId !== undefined) argv.push("--host", source.hostId);
  if (automation.execution.interpreter !== undefined) {
    argv.push("--interpreter", automation.execution.interpreter);
  }
  const workingDirectory = automation.execution.workingDirectory;
  argv.push(
    "--working-directory",
    workingDirectory.type === "path"
      ? workingDirectory.path
      : workingDirectory.type,
  );
  argv.push("--timeout", String(automation.execution.timeoutMs));
  if (automation.execution.env !== undefined) {
    argv.push("--env-json", JSON.stringify(automation.execution.env));
  }
  return argv.map((value) => forkShellQuote(value, shellQuote)).join(" ");
}

function printScriptFileSnapshotNote(
  automation: AutomationDetailResponse,
  source: ScriptFileSource | undefined,
): string {
  if (
    source === undefined ||
    automation.execution.mode !== "script" ||
    automation.execution.storedScriptPath === undefined
  ) {
    return "";
  }
  return [
    `Copied ${source.path}${source.hostId !== undefined ? ` (host ${source.hostId})` : ""}`,
    `    to ${automation.execution.storedScriptPath}`,
    "The automation runs this stored copy, a snapshot of the source file.",
    "Edits to the source file do not apply until you run:",
    `  ${refreshScriptFileCommand(automation, source)}`,
    "",
  ].join("\n");
}

function table(head: string[], rows: string[][]): string {
  const widths = head.map((label, index) =>
    Math.max(label.length, ...rows.map((row) => row[index]?.length ?? 0)),
  );
  const format = (row: string[]) =>
    row
      .map((cell, index) => cell.padEnd(widths[index] ?? 0))
      .join("  ")
      .trimEnd();
  return ["", format(head), ...rows.map(format), ""].join("\n") + "\n";
}

function printAutomationProblem(automation: AutomationReadProblem): string {
  if (automation.problem === "missing-agent-prompt") {
    return printAutomation(automation, "Prompt required");
  }
  return (
    [
      "",
      `  ID:        ${automation.id}`,
      `  Name:      ${automation.name}`,
      "  Status:    Invalid data",
      "",
    ].join("\n") + "\n"
  );
}

function printAutomationTable(automations: AutomationReadResult[]): string {
  return table(
    ["ID", "Name", "Status", "On", "Schedule", "Next run", "Runs", "Origin"],
    automations.map((automation) =>
      "problem" in automation
        ? automation.problem === "missing-agent-prompt"
          ? [
              automation.id,
              automation.name,
              "Prompt required",
              automation.enabled ? "yes" : "no",
              formatAutomationTrigger(automation),
              formatTimestamp(automation.nextRunAt),
              String(automation.runCount),
              automation.origin,
            ]
          : [
              automation.id,
              automation.name,
              "Invalid data",
              "-",
              "-",
              "-",
              "-",
              "-",
            ]
        : [
            automation.id,
            automation.name,
            "-",
            automation.enabled ? "yes" : "no",
            formatAutomationTrigger(automation),
            formatTimestamp(automation.nextRunAt),
            String(automation.runCount),
            automation.origin,
          ],
    ),
  );
}

function printRunTable(runs: AutomationRunResponse[]): string {
  return table(
    ["ID", "Status", "Started", "Thread/Exit", "Detail"],
    runs.map((run) => [
      run.id,
      run.status,
      formatTimestamp(run.startedAt),
      run.threadId ?? (run.exitCode === null ? "-" : `exit ${run.exitCode}`),
      run.skipReason ?? run.error ?? "-",
    ]),
  );
}

export function registerAutomationCli(args: {
  bb: Pick<BbPluginApi, "cli" | "sdk">;
  service: AutomationService;
}): void {
  const { bb, service } = args;
  bb.cli.register(
    defineCli({
      name: "automation",
      summary: "Inspect and manage automations (scheduled agent/script runs)",
      description: DESCRIPTION,
      root: cliCommand({
        summary: "Show the automation commands",
        run: (input) => ({ exitCode: 0, stdout: input.help }),
      }),
      commands: {
        list: cliCommand({
          summary: "List automations for a project",
          options: { project: PROJECT_OPTION, json: JSON_OPTION },
          run: (input, ctx) =>
            attempt(async () => {
              const result = service.list({
                projectId: requireProjectId(input.options.project, ctx),
              });
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? jsonOutput(result)
                  : result.length === 0
                    ? "No automations found\n"
                    : printAutomationTable(result),
              };
            }),
        }),
        create: cliCommand({
          summary: "Create an automation",
          description:
            "Pick exactly one schedule flag and one execution mode: agent (--prompt --provider --model) or script (--script or --script-file).",
          options: {
            project: PROJECT_OPTION,
            name: {
              type: "string",
              placeholder: "name",
              required: true,
              description: "Display name, at most 200 characters",
            },
            disabled: {
              type: "boolean",
              description: "Create the automation paused",
            },
            ...SCHEDULE_OPTIONS,
            ...AGENT_OPTIONS,
            ...SCRIPT_OPTIONS,
            json: JSON_OPTION,
          },
          constraints: [
            { kind: "exactly-one", options: ["cron", "at", "in"] },
            { kind: "requires", option: "cron", needs: ["timezone"] },
            { kind: "requires", option: "timezone", needs: ["cron"] },
          ],
          run: (input, ctx) =>
            attempt(async () => {
              const projectId = requireProjectId(input.options.project, ctx);
              const { execution, scriptSource } = await buildExecution(
                bb,
                input.options,
                ctx,
              );
              const request: ResolvedCreateAutomationInput = {
                projectId,
                name: input.options.name,
                enabled: !input.options.disabled,
                trigger: buildTrigger(input.options),
                execution,
                origin: ctx.threadId ? "agent" : "human",
                ...(ctx.threadId ? { createdByThreadId: ctx.threadId } : {}),
              };
              const created = await service.create(request);
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? jsonOutput(created)
                  : `Automation created: ${created.id}\n${printAutomation(created)}${printScriptFileSnapshotNote(created, scriptSource)}`,
              };
            }),
        }),
        show: cliCommand({
          summary: "Show automation details",
          positionals: [AUTOMATION_ID_POSITIONAL],
          options: { project: PROJECT_OPTION, json: JSON_OPTION },
          run: (input, ctx) =>
            attempt(async () => {
              const found = await service.get({
                projectId: requireProjectId(input.options.project, ctx),
                automationId: input.positionals.automationId,
              });
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? jsonOutput(found)
                  : "problem" in found
                    ? printAutomationProblem(found)
                    : printAutomation(found),
              };
            }),
        }),
        update: cliCommand({
          summary: "Update automation configuration",
          description:
            "Replace the execution with a complete agent (--prompt --provider --model) or script (--script/--script-file), or patch an existing agent with any subset of its flags.",
          positionals: [AUTOMATION_ID_POSITIONAL],
          options: {
            project: PROJECT_OPTION,
            name: {
              type: "string",
              placeholder: "name",
              description: "Replacement display name, at most 200 characters",
            },
            ...SCHEDULE_OPTIONS,
            ...AGENT_OPTIONS,
            ...SCRIPT_OPTIONS,
            json: JSON_OPTION,
          },
          constraints: [
            { kind: "at-most-one", options: ["cron", "at", "in"] },
            { kind: "requires", option: "cron", needs: ["timezone"] },
            { kind: "requires", option: "timezone", needs: ["cron"] },
          ],
          run: (input, ctx) =>
            attempt(async () => {
              const { request, scriptSource } = await buildUpdateRequest(
                bb,
                input.options,
                input.positionals.automationId,
                ctx,
              );
              const updated = await service.update(request);
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? jsonOutput(updated)
                  : `Automation ${updated.id} updated\n${printAutomation(updated)}${printScriptFileSnapshotNote(updated, scriptSource)}`,
              };
            }),
        }),
        pause: cliCommand({
          summary: "Pause an automation",
          positionals: [AUTOMATION_ID_POSITIONAL],
          options: { project: PROJECT_OPTION, json: JSON_OPTION },
          run: (input, ctx) =>
            attempt(async () => {
              const updated = service.pause({
                projectId: requireProjectId(input.options.project, ctx),
                automationId: input.positionals.automationId,
              });
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? jsonOutput(updated)
                  : `Automation ${updated.id} paused\n`,
              };
            }),
        }),
        resume: cliCommand({
          summary: "Resume an automation",
          positionals: [AUTOMATION_ID_POSITIONAL],
          options: { project: PROJECT_OPTION, json: JSON_OPTION },
          run: (input, ctx) =>
            attempt(async () => {
              const updated = service.resume({
                projectId: requireProjectId(input.options.project, ctx),
                automationId: input.positionals.automationId,
              });
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? jsonOutput(updated)
                  : `Automation ${updated.id} resumed\n`,
              };
            }),
        }),
        run: cliCommand({
          summary: "Run an automation now",
          positionals: [AUTOMATION_ID_POSITIONAL],
          options: {
            project: PROJECT_OPTION,
            "idempotency-key": {
              type: "string",
              placeholder: "key",
              description:
                "Reuse the run started by an earlier call with this key, at most 200 characters",
            },
            json: JSON_OPTION,
          },
          run: (input, ctx) =>
            attempt(async () => {
              const idempotencyKey = input.options["idempotency-key"];
              const result = await service.run({
                projectId: requireProjectId(input.options.project, ctx),
                automationId: input.positionals.automationId,
                ...(idempotencyKey ? { idempotencyKey } : {}),
              });
              const threadLine = result.run.threadId
                ? `Thread: ${result.run.threadId}\n`
                : "";
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? jsonOutput(result)
                  : `Run started: ${result.run.id}\n${threadLine}`,
              };
            }),
        }),
        runs: cliCommand({
          summary: "List automation runs",
          positionals: [AUTOMATION_ID_POSITIONAL],
          options: {
            project: PROJECT_OPTION,
            limit: {
              type: "integer",
              min: 1,
              max: AUTOMATION_RUNS_LIMIT_MAX,
              default: AUTOMATION_RUNS_LIMIT_DEFAULT,
              description: "How many recent runs to read",
            },
            output: {
              type: "string",
              placeholder: "runId",
              description:
                "Print only this run's captured output; it must be inside --limit",
            },
            json: JSON_OPTION,
          },
          run: (input, ctx) =>
            attempt(async () => {
              const result = service.runs({
                projectId: requireProjectId(input.options.project, ctx),
                automationId: input.positionals.automationId,
                limit: input.options.limit,
              });
              const outputRunId = input.options.output;
              if (outputRunId) {
                const run = result.runs.find(
                  (candidate) => candidate.id === outputRunId,
                );
                if (!run) {
                  throw cliError(
                    `Run ${outputRunId} not found in returned runs. Increase --limit if it is older.`,
                    "not_found",
                  );
                }
                return {
                  exitCode: 0,
                  stdout: input.options.json
                    ? jsonOutput(run)
                    : `${run.output ?? ""}\n`,
                };
              }
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? jsonOutput(result)
                  : result.runs.length === 0
                    ? "No runs found\n"
                    : printRunTable(result.runs),
              };
            }),
        }),
        delete: cliCommand({
          summary: "Delete an automation",
          positionals: [AUTOMATION_ID_POSITIONAL],
          options: {
            project: PROJECT_OPTION,
            yes: {
              type: "boolean",
              description: "Required. Confirms the automation is deleted",
            },
            json: JSON_OPTION,
          },
          run: (input, ctx) =>
            attempt(async () => {
              if (!input.options.yes) {
                throw cliError(
                  "Deletion requires --yes when run through the plugin CLI.",
                  "missing_required",
                );
              }
              const projectId = requireProjectId(input.options.project, ctx);
              const automationId = input.positionals.automationId;
              await service.delete({ projectId, automationId });
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? jsonOutput({ ok: true, id: automationId })
                  : `Automation ${automationId} deleted\n`,
              };
            }),
        }),
      },
    }),
  );
}
