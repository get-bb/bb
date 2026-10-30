import { isAbsolute, resolve } from "node:path";
import {
  PluginCliError,
  cliCommand,
  defineCli,
  type BbPluginApi,
  type JsonValue,
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
  ProviderEnvironment,
  ReasoningLevel,
  ResolvedCreateAutomationInput,
  ScriptExecutionUpdate,
  SessionOptionSelections,
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
  providerEnvironmentSchema,
  reasoningLevelSchema,
} from "./rpc-types.js";
import { interpreterForPath } from "./script-files.js";

const DURATION_PATTERN =
  /^(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/iu;
const PROJECT_DEFAULT_ENVIRONMENT = "project-default";
const COMPOSITION_MACHINE_SELECTOR_ERROR =
  "This environment provider chooses its own new machine; omit machine selectors.";
const AGENT_HOST_ERROR =
  "--host names the host that holds --script-file; choose where an agent automation runs with --machine.";

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
    description: "Provider id, for example claude-code or codex",
  },
  model: {
    type: "string",
    placeholder: "model",
    description: "Model id the provider accepts",
  },
  reasoning: {
    type: "string",
    placeholder: "level",
    description:
      "Reasoning level id the model lists, for example low, medium, or high; new automations default to medium",
  },
  "service-tier": {
    type: "string",
    placeholder: "tier",
    description:
      "Service tier id the provider lists for the model, such as default or fast",
  },
  "clear-service-tier": {
    type: "boolean",
    description: "Leave the automation without a service tier",
  },
  "permission-mode": {
    type: "enum",
    values: permissionModeSchema.options,
    description:
      "Permission mode; defaults to the provider's best of auto then full",
  },
  option: {
    type: "string",
    placeholder: "key=value",
    repeatable: true,
    description:
      "Choose a value for an option the provider's model lists (see bb provider models); use true or false for an on/off option; on update, replaces every stored option",
  },
  "target-thread": {
    type: "string",
    placeholder: "thread-id",
    description: "Re-prompt this existing thread instead of spawning one",
  },
  environment: {
    type: "string",
    placeholder: "project-default|id|path",
    description:
      "Where each run's new thread works: project-default, an existing environment id, or a workspace path on --machine",
  },
  "new-environment": {
    type: "enum",
    values: ["worktree"],
    description:
      "Create a fresh environment of this kind for each run, on --machine",
  },
  "base-branch": {
    type: "string",
    placeholder: "branch",
    description: "Base branch for --new-environment worktree",
  },
  "environment-provider": {
    type: "string",
    placeholder: "id",
    description:
      "Run each new thread in this environment provider; `bb environment providers --project <id>` lists them",
  },
  "environment-inputs": {
    type: "string",
    placeholder: "json",
    description:
      "JSON inputs for an --environment-provider that declares them, such as a Worktree base branch (`bb environment providers --json` shows the schema)",
  },
  machine: {
    type: "string",
    placeholder: "id-or-name",
    description:
      "Persistent machine for a workspace path, --new-environment, or --environment-provider; defaults to the invoking thread's machine, or the server's outside a thread or from a temporary machine. Alone, runs work in the project's checkout on that machine; on update, it replaces the stored environment",
  },
  "new-machine": {
    type: "string",
    placeholder: "machine-provider-id",
    description:
      "Create each run's thread on a new machine from this machine provider; requires --environment-provider",
  },
  "machine-inputs": {
    type: "string",
    placeholder: "json",
    description:
      "Persisted non-secret inputs for --new-machine or a composed --environment-provider; store credentials in plugin settings",
  },
} as const;

const CLEAR_OPTIONS_OPTION = {
  type: "boolean",
  description: "Remove the stored options; cannot combine with --option",
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
      "Interpreter for the script; a new script infers it from the --script-file extension when omitted, and an update keeps the current one",
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
  "service-tier": string | undefined;
  "clear-service-tier": boolean | undefined;
  "permission-mode": PermissionMode | undefined;
  option: string[];
  "clear-options": boolean;
  "target-thread": string | undefined;
  environment: string | undefined;
  "new-environment": "worktree" | undefined;
  "base-branch": string | undefined;
  "environment-provider": string | undefined;
  "environment-inputs": string | undefined;
  machine: string | undefined;
  "new-machine": string | undefined;
  "machine-inputs": string | undefined;
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
  if (options["clear-service-tier"] && options["service-tier"] !== undefined) {
    throw cliError(
      "Cannot combine --service-tier and --clear-service-tier.",
      "unexpected_argument",
    );
  }
  if (options["clear-options"] && options.option.length > 0) {
    throw cliError(
      "Cannot combine --option and --clear-options.",
      "unexpected_argument",
    );
  }
  const targetThread = options["target-thread"];
  const environment = options.environment?.trim();
  const newEnvironment = options["new-environment"];
  const environmentProvider = options["environment-provider"];
  const machine = options.machine;
  const newMachine = options["new-machine"];
  if (targetThread !== undefined) {
    requireOptionValue("target-thread", targetThread);
  }
  if (environment !== undefined) requireOptionValue("environment", environment);
  if (environmentProvider !== undefined) {
    requireOptionValue("environment-provider", environmentProvider.trim());
  }
  if (machine !== undefined) requireOptionValue("machine", machine.trim());
  if (newMachine !== undefined) {
    requireOptionValue("new-machine", newMachine.trim());
  }
  if (
    environmentProvider !== undefined &&
    (environment !== undefined || newEnvironment !== undefined)
  ) {
    throw cliError(
      "Cannot combine --environment-provider with --environment or --new-environment.",
      "unexpected_argument",
    );
  }
  const provided = [
    targetThread,
    environment,
    newEnvironment,
    environmentProvider,
  ].filter((value) => value !== undefined);
  if (provided.length > 1) {
    throw cliError(
      "Cannot combine target options: --target-thread, --environment, --new-environment, and --environment-provider.",
      "unexpected_argument",
    );
  }
  if (options["base-branch"] !== undefined && newEnvironment === undefined) {
    throw environmentProvider === undefined
      ? cliError(
          "--base-branch requires --new-environment worktree.",
          "missing_required",
        )
      : cliError(
          "--base-branch requires --new-environment worktree; an --environment-provider takes its branch through --environment-inputs.",
          "unexpected_argument",
        );
  }
  if (
    options["environment-inputs"] !== undefined &&
    environmentProvider === undefined &&
    newMachine === undefined
  ) {
    throw cliError(
      "--environment-inputs requires --environment-provider <id>.",
      "missing_required",
    );
  }
  if (machine !== undefined && newMachine !== undefined) {
    throw cliError(
      "Cannot combine --new-machine with --machine.",
      "unexpected_argument",
    );
  }
  if (
    options["machine-inputs"] !== undefined &&
    newMachine === undefined &&
    environmentProvider === undefined
  ) {
    throw cliError(
      "--machine-inputs requires --new-machine <provider-id> or a composed --environment-provider.",
      "missing_required",
    );
  }
  if (machine !== undefined && targetThread !== undefined) {
    throw cliError(
      "Cannot combine --machine with --target-thread; that thread already selects its machine.",
      "unexpected_argument",
    );
  }
  if (machine !== undefined && environment === PROJECT_DEFAULT_ENVIRONMENT) {
    throw cliError(
      "Cannot combine --machine with --environment project-default; the project's default environment selects its machine.",
      "unexpected_argument",
    );
  }
  if (
    machine !== undefined &&
    environment !== undefined &&
    !looksLikePath(environment)
  ) {
    throw cliError(
      "Cannot combine --machine with an existing environment ID; that environment already selects its machine.",
      "unexpected_argument",
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
  return (
    value.includes("/") ||
    value.includes("\\") ||
    /^[A-Za-z]:/u.test(value) ||
    value.startsWith(".") ||
    value.startsWith("~")
  );
}

type InputsFlag = "--environment-inputs" | "--machine-inputs";

function parseJsonFlag(
  value: string | undefined,
  flag: InputsFlag,
): JsonValue | null {
  if (value === undefined) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(value);
  } catch {
    throw cliError(`${flag} must be valid JSON.`, "invalid_value");
  }
  return providerEnvironmentSchema.shape.inputs.parse(decoded);
}

function fillDeclaredInputs(args: {
  inputs: JsonValue | null;
  declared: boolean;
  acceptsEmptyInputs: boolean;
  owner: string;
  flag: InputsFlag;
  schemaCommand: string;
}): JsonValue | null {
  if (args.declared && args.inputs === null) {
    if (args.acceptsEmptyInputs) return {};
    throw cliError(
      `${args.owner} needs ${args.flag} <json>; \`${args.schemaCommand}\` shows its schema.`,
      "missing_required",
    );
  }
  if (!args.declared && args.inputs !== null) {
    throw cliError(
      `${args.owner} takes no ${args.flag}.`,
      "unexpected_argument",
    );
  }
  return args.inputs;
}

function parseSessionOptions(
  assignments: readonly string[],
): SessionOptionSelections | undefined {
  if (assignments.length === 0) return undefined;
  const selections: SessionOptionSelections = {};
  for (const assignment of assignments) {
    const separator = assignment.indexOf("=");
    const optionId = separator === -1 ? "" : assignment.slice(0, separator);
    const raw = assignment.slice(separator + 1);
    if (optionId === "" || raw === "") {
      throw cliError(
        `Invalid --option '${assignment}'. Expected <option-id>=<value>.`,
        "invalid_value",
      );
    }
    selections[optionId] =
      raw === "true" ? true : raw === "false" ? false : raw;
  }
  return selections;
}

type MachineList = Awaited<ReturnType<BbPluginApi["sdk"]["hosts"]["list"]>>;
type EnvironmentProviderEntry = Awaited<
  ReturnType<BbPluginApi["sdk"]["environments"]["listProviders"]>
>[number];
type NewMachineSelection = Extract<
  NonNullable<ProviderEnvironment["machine"]>,
  { type: "new" }
>;

function describeMachines(machines: MachineList): string {
  if (machines.length === 0) return "none";
  return machines
    .map((machine) => `${machine.name} (${machine.id})`)
    .join(", ");
}

async function resolveMachineHostId(
  bb: Pick<BbPluginApi, "sdk">,
  target: string,
): Promise<string> {
  const machines = await bb.sdk.hosts.list({ includeCreating: true });
  const query = target.trim();
  const nameMatches = machines.filter((machine) => machine.name === query);
  const match =
    machines.find((machine) => machine.id === query) ??
    (nameMatches.length === 1 ? nameMatches[0] : undefined);
  if (match === undefined && nameMatches.length > 1) {
    throw cliError(
      `Machine name '${query}' is ambiguous. Matches: ${describeMachines(nameMatches)}.`,
      "invalid_value",
    );
  }
  if (match === undefined) {
    throw cliError(
      `Machine '${query}' was not found. Available machines: ${describeMachines(machines)}.`,
      "invalid_value",
    );
  }
  if (match.type !== "persistent") {
    throw cliError(
      `Machine '${query}' is temporary, and every run would fail once it is removed. Persistent machines: ${describeMachines(machines.filter((machine) => machine.type === "persistent"))}.`,
      "invalid_value",
    );
  }
  return match.id;
}

async function resolveNewMachine(
  bb: Pick<BbPluginApi, "sdk">,
  options: AgentOptionValues,
): Promise<NewMachineSelection | null> {
  const requested = options["new-machine"]?.trim();
  if (requested === undefined) return null;
  const provider = (await bb.sdk.hosts.experimental_listProviders()).find(
    (candidate) => candidate.id === requested,
  );
  if (provider === undefined) {
    throw cliError(`Unknown machine provider '${requested}'.`, "invalid_value");
  }
  return {
    type: "new",
    machineProviderId: provider.id,
    inputs: fillDeclaredInputs({
      inputs: parseJsonFlag(options["machine-inputs"], "--machine-inputs"),
      declared: provider.inputs !== null,
      acceptsEmptyInputs: provider.acceptsEmptyInputs,
      owner: `The '${provider.id}' machine provider`,
      flag: "--machine-inputs",
      schemaCommand: "bb machine providers --json",
    }),
  };
}

async function requireProviderRunsOnMachine(
  bb: Pick<BbPluginApi, "sdk">,
  provider: EnvironmentProviderEntry,
  hostId: string,
): Promise<void> {
  const listed = Object.hasOwn(provider.machineAvailability, hostId);
  const availability = provider.machineAvailability[hostId] ?? null;
  if (listed && availability?.status !== "unavailable") return;
  const machines = await bb.sdk.hosts.list({ includeCreating: true });
  const machineLabel = (id: string) => {
    const machine = machines.find((candidate) => candidate.id === id);
    return machine === undefined ? id : `${machine.name} (${machine.id})`;
  };
  if (availability?.status === "unavailable") {
    throw cliError(
      `The '${provider.id}' environment provider is unavailable on ${machineLabel(hostId)}: ${availability.message}`,
      "invalid_value",
    );
  }
  const runnable = Object.entries(provider.machineAvailability)
    .filter(([, candidate]) => candidate?.status !== "unavailable")
    .map(([id]) => machineLabel(id));
  throw cliError(
    `The '${provider.id}' environment provider cannot run on ${machineLabel(hostId)} for this project. Machines it can run on: ${runnable.length === 0 ? "none" : runnable.join(", ")}.`,
    "invalid_value",
  );
}

async function buildProviderEnvironment(
  bb: Pick<BbPluginApi, "sdk">,
  args: {
    options: AgentOptionValues;
    ctx: Pick<PluginCliContext, "threadId">;
    projectId: string;
    environmentProviderId: string;
    newMachine: NewMachineSelection | null;
  },
): Promise<ProviderEnvironment> {
  const { options } = args;
  const providers = await bb.sdk.environments.listProviders({
    projectId: args.projectId,
  });
  const provider = providers.find(
    (candidate) => candidate.id === args.environmentProviderId,
  );
  if (provider === undefined) {
    const available = providers.map((candidate) => candidate.id).join(", ");
    throw cliError(
      `Unknown environment provider '${args.environmentProviderId}'.${available ? ` Available: ${available}.` : ""}`,
      "invalid_value",
    );
  }
  const inputs = fillDeclaredInputs({
    inputs: parseJsonFlag(
      options["environment-inputs"],
      "--environment-inputs",
    ),
    declared: provider.inputs !== null,
    acceptsEmptyInputs: provider.acceptsEmptyInputs,
    owner: `The '${provider.id}' environment provider`,
    flag: "--environment-inputs",
    schemaCommand: "bb environment providers --json",
  });
  if (provider.machineProviderId !== null) {
    if (args.newMachine !== null || options.machine !== undefined) {
      throw cliError(COMPOSITION_MACHINE_SELECTOR_ERROR, "unexpected_argument");
    }
    const machineSchema = provider.machineInputs ?? null;
    const machineInputs = fillDeclaredInputs({
      inputs: parseJsonFlag(options["machine-inputs"], "--machine-inputs"),
      declared: machineSchema !== null,
      acceptsEmptyInputs: provider.machineAcceptsEmptyInputs === true,
      owner: `The '${provider.machineProviderId}' machine provider`,
      flag: "--machine-inputs",
      schemaCommand: "bb environment providers --json",
    });
    if (machineSchema === null) {
      return { type: "provider", environmentProviderId: provider.id, inputs };
    }
    return {
      type: "provider",
      environmentProviderId: provider.id,
      machine: {
        type: "new",
        machineProviderId: provider.machineProviderId,
        inputs: machineInputs,
      },
      inputs,
    };
  }
  if (options["machine-inputs"] !== undefined && args.newMachine === null) {
    throw cliError(
      "--machine-inputs requires --new-machine <provider-id> or a composed --environment-provider.",
      "missing_required",
    );
  }
  if (args.newMachine !== null) {
    return {
      type: "provider",
      environmentProviderId: provider.id,
      machine: args.newMachine,
      inputs,
    };
  }
  const hostId =
    options.machine === undefined
      ? await resolveAgentEnvironmentHostId(bb, args.ctx)
      : await resolveMachineHostId(bb, options.machine);
  await requireProviderRunsOnMachine(bb, provider, hostId);
  return {
    type: "provider",
    environmentProviderId: provider.id,
    machine: { type: "existing", hostId },
    inputs,
  };
}

function hasEnvironmentFlag(options: AgentOptionValues): boolean {
  return [
    options.environment,
    options["new-environment"],
    options["environment-provider"],
    options["environment-inputs"],
    options.machine,
    options["new-machine"],
    options["machine-inputs"],
  ].some((value) => value !== undefined);
}

async function buildAgentEnvironment(
  bb: Pick<BbPluginApi, "sdk">,
  options: AgentOptionValues,
  ctx: Pick<PluginCliContext, "threadId">,
  projectId: string,
): Promise<AgentEnvironment> {
  const newMachine = await resolveNewMachine(bb, options);
  const environmentProvider = options["environment-provider"]?.trim();
  if (newMachine !== null && environmentProvider === undefined) {
    throw cliError(
      `The '${newMachine.machineProviderId}' machine provider requires an environment provider; combine --new-machine with --environment-provider <id>.`,
      "missing_required",
    );
  }
  if (environmentProvider !== undefined) {
    return buildProviderEnvironment(bb, {
      options,
      ctx,
      projectId,
      environmentProviderId: environmentProvider,
      newMachine,
    });
  }
  const environment = options.environment?.trim();
  const machine = options.machine;
  const resolveHostId = () =>
    machine === undefined
      ? resolveAgentEnvironmentHostId(bb, ctx)
      : resolveMachineHostId(bb, machine);
  if (options["new-environment"]) {
    const baseBranch = options["base-branch"]?.trim();
    return {
      type: "host",
      hostId: await resolveHostId(),
      workspace: {
        type: "managed-worktree",
        baseBranch: baseBranch
          ? { kind: "named", name: baseBranch }
          : { kind: "default" },
      },
    };
  }
  if (environment === PROJECT_DEFAULT_ENVIRONMENT) {
    return { type: "project-default" };
  }
  if (environment !== undefined && looksLikePath(environment)) {
    return {
      type: "host",
      hostId: await resolveHostId(),
      workspace: { type: "unmanaged", path: environment },
    };
  }
  if (environment !== undefined) {
    return { type: "reuse", environmentId: environment };
  }
  if (machine !== undefined) {
    const project = await bb.sdk.projects.get({ projectId });
    return {
      type: "host",
      hostId: await resolveMachineHostId(bb, machine),
      workspace:
        project.kind === "personal"
          ? { type: "personal" }
          : { type: "unmanaged", path: null },
    };
  }
  return { type: "project-default" };
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

async function resolveAgentEnvironmentHostId(
  bb: Pick<BbPluginApi, "sdk">,
  ctx: Pick<PluginCliContext, "threadId">,
): Promise<string> {
  if (ctx.threadId !== undefined) {
    const thread = threadEnvironmentHostSchema.parse(
      await bb.sdk.threads.get({
        threadId: ctx.threadId,
        include: "environment",
      }),
    );
    if (thread.environment) {
      const host = await bb.sdk.hosts.get({
        hostId: thread.environment.hostId,
      });
      if (host.type === "persistent") return host.id;
    }
  }
  const { primaryHostId } = await bb.sdk.system.config();
  if (primaryHostId === null) {
    throw cliError(
      "The bb server has no primary host to run this environment on.",
      "no_primary_host",
    );
  }
  return primaryHostId;
}

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
  projectId: string,
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
  if (hasAgent && options.host !== undefined) {
    throw cliError(AGENT_HOST_ERROR, "unexpected_argument");
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
    const sessionOptions = parseSessionOptions(options.option);
    const environment = await buildAgentEnvironment(
      bb,
      options,
      ctx,
      projectId,
    );
    const serviceTier = options["service-tier"];
    return {
      execution: {
        mode: "agent",
        prompt,
        providerId: provider,
        model,
        reasoningLevel: options.reasoning ?? "medium",
        ...(serviceTier === undefined ? {} : { serviceTier }),
        permissionMode: await resolvePermissionMode(
          bb,
          provider,
          options["permission-mode"],
          providerRoutingForEnvironment(environment),
        ),
        ...(sessionOptions === undefined ? {} : { sessionOptions }),
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
    options["clear-service-tier"] === true ||
    options["permission-mode"] !== undefined ||
    options.option.length > 0 ||
    options["clear-options"] ||
    options["target-thread"] !== undefined ||
    hasEnvironmentFlag(options) ||
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

const SCRIPT_UPDATE_OPTION_NAMES = [
  "script",
  "script-file",
  "host",
  "interpreter",
  "timeout",
  "env-json",
  "working-directory",
] as const;

function hasAgentOptions(options: AgentOptionValues): boolean {
  return (
    [
      options.prompt,
      options.provider,
      options.model,
      options.reasoning,
      options["service-tier"],
      options["clear-service-tier"] || undefined,
      options["permission-mode"],
      options.option.length > 0 ? options.option : undefined,
      options["clear-options"] || undefined,
      options["target-thread"],
      options["base-branch"],
    ].some((value) => value !== undefined) || hasEnvironmentFlag(options)
  );
}

async function buildScriptExecutionUpdate(
  bb: Pick<BbPluginApi, "sdk">,
  options: ScriptOptionValues,
  ctx: Pick<PluginCliContext, "cwd" | "threadId">,
): Promise<{ update: ScriptExecutionUpdate; scriptSource?: ScriptFileSource }> {
  if (options.script !== undefined && options["script-file"] !== undefined) {
    throw cliError(
      "Provide exactly one of --script or --script-file.",
      "unexpected_argument",
    );
  }
  const env = parseScriptEnv(options["env-json"]);
  const workingDirectoryOption = options["working-directory"];
  const scriptSource = await loadScriptFileSource(bb, options, ctx);
  const update: ScriptExecutionUpdate = {};
  if (scriptSource !== undefined) {
    update.script = scriptSource.content;
    update.scriptFile = scriptSource.path;
  } else if (options.script !== undefined) {
    update.script = options.script;
  }
  if (update.script === "") {
    throw cliError("Missing script content.", "invalid_value");
  }
  if (options.interpreter !== undefined) {
    update.interpreter = options.interpreter;
  }
  if (options.timeout !== undefined) update.timeoutMs = options.timeout;
  if (env !== undefined) update.env = env;
  if (workingDirectoryOption !== undefined) {
    update.workingDirectory = parseScriptWorkingDirectory(
      workingDirectoryOption,
    );
  }
  return { update, ...(scriptSource ? { scriptSource } : {}) };
}

async function buildAgentExecutionUpdate(
  bb: Pick<BbPluginApi, "sdk">,
  options: AgentOptionValues,
  ctx: Pick<PluginCliContext, "threadId">,
  projectId: string,
): Promise<AgentExecutionUpdate | undefined> {
  if (!hasAgentOptions(options)) return undefined;

  validateAgentTargetOptions(options);
  const sessionOptions = parseSessionOptions(options.option);
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
  if (options["clear-service-tier"]) {
    update.serviceTier = null;
  } else if (serviceTier !== undefined) {
    update.serviceTier = serviceTier;
  }
  if (options["permission-mode"] !== undefined) {
    update.permissionMode = options["permission-mode"];
  }
  if (options["clear-options"]) {
    update.sessionOptions = null;
  } else if (sessionOptions !== undefined) {
    update.sessionOptions = sessionOptions;
  }
  if (options["target-thread"] !== undefined) {
    update.target = {
      type: "target-thread",
      threadId: requireOptionValue("target-thread", options["target-thread"]),
    };
  } else if (hasEnvironmentFlag(options)) {
    update.target = {
      type: "environment",
      environment: await buildAgentEnvironment(bb, options, ctx, projectId),
    };
  }
  return update;
}

async function buildUpdateRequest(
  bb: Pick<BbPluginApi, "sdk">,
  service: Pick<AutomationService, "get">,
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
  const hasScriptOptions = SCRIPT_UPDATE_OPTION_NAMES.some(
    (name) => options[name] !== undefined,
  );
  if (replacesAgentExecution) {
    const built = await buildExecution(bb, options, ctx, projectId);
    request.execution = built.execution;
  } else if (hasScriptOptions) {
    if (hasAgentOptions(options)) {
      throw cliError(
        options.host === undefined
          ? "Cannot combine agent execution flags with script flags."
          : AGENT_HOST_ERROR,
        "unexpected_argument",
      );
    }
    const current = await service.get({ projectId, automationId });
    if ("execution" in current && current.execution.mode === "agent") {
      const built = await buildExecution(bb, options, ctx, projectId);
      request.execution = built.execution;
      scriptSource = built.scriptSource;
    } else {
      const built = await buildScriptExecutionUpdate(bb, options, ctx);
      request.script = built.update;
      scriptSource = built.scriptSource;
    }
  } else {
    const agentUpdate = await buildAgentExecutionUpdate(
      bb,
      options,
      ctx,
      projectId,
    );
    if (agentUpdate !== undefined) {
      request.agent = agentUpdate;
    }
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

interface EnvironmentLabels {
  providers: ReadonlyMap<string, { displayName: string; composition: boolean }>;
  machines: ReadonlyMap<string, string>;
}

type AgentExecutionTarget = Pick<
  Extract<AutomationResponse["execution"], { mode: "agent" }>,
  "environment" | "targetThreadId"
>;

const PROJECT_CHECKOUT_PROVIDER_ID = "project-checkout";

const projectCheckoutPathSchema = z.object({ path: z.string().min(1) });

const providerInputsBranchSchema = z.object({
  branch: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("named"), name: z.string().min(1) }),
    z.object({ kind: z.literal("default") }),
    z.object({ kind: z.literal("new"), baseBranch: z.string().min(1) }),
    z.object({ kind: z.literal("existing"), name: z.string().min(1) }),
  ]),
});
type BranchSelection = z.infer<typeof providerInputsBranchSchema>["branch"];

async function readLabelSource<T>(read: () => Promise<T[]>): Promise<T[]> {
  try {
    return await read();
  } catch {
    return [];
  }
}

function agentEnvironments(
  automations: readonly AutomationReadResult[],
): AgentEnvironment[] {
  return automations.flatMap((automation) =>
    "execution" in automation &&
    automation.execution.mode === "agent" &&
    automation.execution.targetThreadId === undefined
      ? [automation.execution.environment]
      : [],
  );
}

async function loadEnvironmentLabels(
  bb: Pick<BbPluginApi, "sdk">,
  environments: readonly AgentEnvironment[],
): Promise<EnvironmentLabels> {
  const namesProviders = environments.some(
    (environment) => environment.type === "provider",
  );
  const namesMachines = environments.some(
    (environment) =>
      (environment.type === "host" && environment.hostId !== undefined) ||
      (environment.type === "provider" &&
        environment.machine?.type === "existing"),
  );
  const providers = namesProviders
    ? await readLabelSource(() => bb.sdk.environments.listProviders())
    : [];
  const machines = namesMachines
    ? await readLabelSource(() => bb.sdk.hosts.list())
    : [];
  return {
    providers: new Map(
      providers.map((provider) => [
        provider.id,
        {
          displayName: provider.displayName,
          composition: provider.machineProviderId !== null,
        },
      ]),
    ),
    machines: new Map(machines.map((machine) => [machine.id, machine.name])),
  };
}

function branchSelectionLabel(
  branch: BranchSelection | undefined,
): string | null {
  switch (branch?.kind) {
    case undefined:
    case "default":
      return null;
    case "named":
      return `from ${branch.name}`;
    case "new":
      return `from ${branch.baseBranch}`;
    case "existing":
      return `on ${branch.name}`;
  }
}

function withBranch(placement: string, branch: string | null): string {
  return branch === null ? placement : `${placement} · ${branch}`;
}

function describeEnvironment(
  environment: AgentEnvironment,
  labels: EnvironmentLabels,
): string {
  const machineName = (hostId: string) =>
    labels.machines.get(hostId) ?? hostId;
  switch (environment.type) {
    case "project-default":
      return "Project default";
    case "reuse":
      return `Environment ${environment.environmentId}`;
    case "host": {
      const on =
        environment.hostId === undefined
          ? ""
          : ` on ${machineName(environment.hostId)}`;
      const workspace = environment.workspace;
      if (workspace.type === "managed-worktree") {
        return withBranch(
          `Worktree${on}`,
          branchSelectionLabel(workspace.baseBranch),
        );
      }
      if (workspace.type === "personal") return `Personal workspace${on}`;
      return withBranch(
        `${workspace.path ?? "Project checkout"}${on}`,
        branchSelectionLabel(workspace.branch),
      );
    }
    case "provider": {
      const provider = labels.providers.get(environment.environmentProviderId);
      const name = provider?.displayName ?? environment.environmentProviderId;
      const machine = environment.machine;
      const placement =
        machine === undefined ||
        (machine.type === "new" && provider?.composition === true)
          ? name
          : machine.type === "new"
            ? `${name} on a new ${machine.machineProviderId} machine`
            : `${name} on ${machineName(machine.hostId)}`;
      const inputs = providerInputsBranchSchema.safeParse(environment.inputs);
      const checkoutPath =
        environment.environmentProviderId === PROJECT_CHECKOUT_PROVIDER_ID
          ? projectCheckoutPathSchema.safeParse(environment.inputs)
          : null;
      const location =
        checkoutPath?.success !== true
          ? placement
          : machine?.type === "existing"
            ? `${checkoutPath.data.path} on ${machineName(machine.hostId)}`
            : checkoutPath.data.path;
      return withBranch(
        location,
        inputs.success ? branchSelectionLabel(inputs.data.branch) : null,
      );
    }
  }
}

function describeAgentTarget(
  execution: AgentExecutionTarget,
  labels: EnvironmentLabels,
): string {
  return execution.targetThreadId === undefined
    ? describeEnvironment(execution.environment, labels)
    : `re-prompts thread ${execution.targetThreadId}`;
}

function formatSessionOptions(
  sessionOptions: SessionOptionSelections | undefined,
): string {
  if (sessionOptions === undefined) return "-";
  return Object.entries(sessionOptions)
    .map(([optionId, value]) => `${optionId}=${String(value)}`)
    .join(", ");
}

type PrintableAutomation =
  | AutomationDetailResponse
  | Extract<AutomationReadProblem, { problem: "missing-agent-prompt" }>;

function printAutomation(
  automation: PrintableAutomation,
  labels: EnvironmentLabels,
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
      `  Options:   ${formatSessionOptions(automation.execution.sessionOptions)}`,
      `  Environment: ${describeAgentTarget(automation.execution, labels)}`,
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
  return argv.map(shellQuote).join(" ");
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

function printAutomationProblem(
  automation: AutomationReadProblem,
  labels: EnvironmentLabels,
): string {
  if (automation.problem === "missing-agent-prompt") {
    return printAutomation(automation, labels, "Prompt required");
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

function printAutomationTable(
  automations: AutomationReadResult[],
  labels: EnvironmentLabels,
): string {
  const environmentCell = (
    execution: AutomationResponse["execution"],
  ): string =>
    execution.mode === "agent" ? describeAgentTarget(execution, labels) : "-";
  return table(
    [
      "ID",
      "Name",
      "Status",
      "On",
      "Schedule",
      "Next run",
      "Runs",
      "Origin",
      "Environment",
    ],
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
              describeAgentTarget(automation.execution, labels),
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
            environmentCell(automation.execution),
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
          summary: "List automations for a project or a target thread",
          options: {
            project: {
              type: "string",
              placeholder: "id",
              description:
                "Project whose automations to list; required unless --target-thread is given",
            },
            "target-thread": {
              type: "string",
              placeholder: "thread-id",
              description:
                "List automations in any project that re-prompt this thread",
            },
            json: JSON_OPTION,
          },
          constraints: [
            { kind: "at-most-one", options: ["project", "target-thread"] },
          ],
          run: (input, ctx) =>
            attempt(async () => {
              const targetThreadId = input.options["target-thread"];
              const result = service.list(
                targetThreadId === undefined
                  ? {
                      projectId: requireProjectId(input.options.project, ctx),
                    }
                  : {
                      targetThreadId: requireOptionValue(
                        "target-thread",
                        targetThreadId,
                      ),
                    },
              );
              if (input.options.json) {
                return { exitCode: 0, stdout: jsonOutput(result) };
              }
              return {
                exitCode: 0,
                stdout:
                  result.length === 0
                    ? "No automations found\n"
                    : printAutomationTable(
                        result,
                        await loadEnvironmentLabels(
                          bb,
                          agentEnvironments(result),
                        ),
                      ),
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
                { ...input.options, "clear-options": false },
                ctx,
                projectId,
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
              if (input.options.json) {
                return { exitCode: 0, stdout: jsonOutput(created) };
              }
              const labels = await loadEnvironmentLabels(
                bb,
                agentEnvironments([created]),
              );
              return {
                exitCode: 0,
                stdout: `Automation created: ${created.id}\n${printAutomation(created, labels)}${printScriptFileSnapshotNote(created, scriptSource)}`,
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
              if (input.options.json) {
                return { exitCode: 0, stdout: jsonOutput(found) };
              }
              const labels = await loadEnvironmentLabels(
                bb,
                agentEnvironments([found]),
              );
              return {
                exitCode: 0,
                stdout:
                  "problem" in found
                    ? printAutomationProblem(found, labels)
                    : printAutomation(found, labels),
              };
            }),
        }),
        update: cliCommand({
          summary: "Update automation configuration",
          description:
            "Patch an existing agent or script with any subset of its flags; omitted settings keep their values. --prompt --provider --model together replace the execution with a new agent, and script flags on an agent automation replace it with a script (--script/--script-file required).",
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
            "clear-options": CLEAR_OPTIONS_OPTION,
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
                service,
                input.options,
                input.positionals.automationId,
                ctx,
              );
              const updated = await service.update(request);
              if (input.options.json) {
                return { exitCode: 0, stdout: jsonOutput(updated) };
              }
              const labels = await loadEnvironmentLabels(
                bb,
                agentEnvironments([updated]),
              );
              return {
                exitCode: 0,
                stdout: `Automation ${updated.id} updated\n${printAutomation(updated, labels)}${printScriptFileSnapshotNote(updated, scriptSource)}`,
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
