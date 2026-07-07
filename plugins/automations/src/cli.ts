import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import type { BbPluginApi, PluginCliContext, PluginCliResult } from "@bb/plugin-sdk";
import { z } from "zod";
import type { AutomationService } from "./service.js";
import type {
  AgentEnvironment,
  AutomationResponse,
  AutomationRunResponse,
  AutomationScriptInterpreter,
  CreateAutomationInput,
  PermissionMode,
  ResolvedCreateAutomationInput,
  UpdateAutomationInput,
} from "./rpc-types.js";
import {
  AUTOMATION_SCRIPT_TIMEOUT_DEFAULT_MS,
  automationScriptInterpreterSchema,
} from "./rpc-types.js";

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

interface ParsedArgs {
  command: string;
  positionals: string[];
  flags: Map<string, string | true>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command = "help", ...rest] = argv;
  const positionals: string[] = [];
  const flags = new Map<string, string | true>();
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg.startsWith("--")) {
      const [rawName, inlineValue] = arg.slice(2).split(/=(.*)/s, 2);
      if (!rawName) throw new Error(`Invalid flag ${arg}`);
      if (inlineValue !== undefined) {
        flags.set(rawName, inlineValue);
        continue;
      }
      const next = rest[index + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags.set(rawName, next);
        index += 1;
      } else {
        flags.set(rawName, true);
      }
    } else {
      positionals.push(arg);
    }
  }
  return { command, positionals, flags };
}

function flag(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags.get(name);
  if (value === undefined || value === true) return undefined;
  return value;
}

function boolFlag(args: ParsedArgs, name: string): boolean {
  return args.flags.has(name);
}

function requireFlag(args: ParsedArgs, name: string): string {
  const value = flag(args, name);
  if (!value) throw new Error(`Missing required option --${name} <value>.`);
  return value;
}

function optionalJson(args: ParsedArgs, value: unknown): string | null {
  return boolFlag(args, "json") ? `${JSON.stringify(value, null, 2)}\n` : null;
}

function parseRunAt(value: string): number {
  const runAt = Date.parse(value);
  if (!Number.isFinite(runAt)) {
    throw new Error("--at must be a valid date/time, preferably ISO 8601.");
  }
  if (runAt <= Date.now()) throw new Error("--at must be in the future.");
  return runAt;
}

function parseRunIn(value: string): number {
  const match = DURATION_PATTERN.exec(value.trim());
  if (!match) throw new Error("--in must be a duration like 30s, 5m, 2h, or 1d.");
  const amount = Number.parseInt(match[1] ?? "", 10);
  if (amount <= 0) throw new Error("--in must be greater than zero.");
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

function buildTrigger(args: ParsedArgs): CreateAutomationInput["trigger"] {
  const cron = flag(args, "cron");
  const at = flag(args, "at");
  const runIn = flag(args, "in");
  const triggerFlags = [cron !== undefined, at !== undefined, runIn !== undefined].filter(Boolean).length;
  if (triggerFlags !== 1) {
    throw new Error("Provide exactly one schedule flag: --cron, --at, or --in.");
  }
  if (cron !== undefined) {
    const timezone = flag(args, "timezone");
    if (!timezone) throw new Error("--cron requires --timezone.");
    return { triggerType: "schedule", cron, timezone };
  }
  if (flag(args, "timezone") !== undefined) {
    throw new Error("--timezone is only used with --cron.");
  }
  if (at !== undefined) return { triggerType: "once", runAt: parseRunAt(at) };
  if (runIn !== undefined) return { triggerType: "once", runAt: parseRunIn(runIn) };
  throw new Error("Provide exactly one schedule flag: --cron, --at, or --in.");
}

function parsePermissionMode(value: string | undefined): PermissionMode {
  if (value === undefined) return "readonly";
  if (value === "full" || value === "workspace-write" || value === "readonly") {
    return value;
  }
  throw new Error("Invalid --permission-mode. Expected full, workspace-write, or readonly.");
}

function parseScriptInterpreter(
  value: string | undefined,
): AutomationScriptInterpreter | undefined {
  if (value === undefined) return undefined;
  const parsed = automationScriptInterpreterSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new Error("Invalid --interpreter. Expected bash, sh, node, or python3.");
}

const INTERPRETER_BY_EXTENSION: Record<string, AutomationScriptInterpreter> = {
  ".sh": "bash",
  ".bash": "bash",
  ".js": "node",
  ".mjs": "node",
  ".py": "python3",
};

function inferInterpreterFromPath(
  filePath: string,
): AutomationScriptInterpreter | undefined {
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

function looksLikePath(value: string): boolean {
  return value.includes("/") || value.startsWith(".") || value.startsWith("~");
}

async function resolveConnectedHostId(bb: Pick<BbPluginApi, "sdk">): Promise<string> {
  const hosts = hostListSchema.parse(await bb.sdk.hosts.list());
  const host = hosts.find((candidate) => candidate.connected === true) ?? hosts.find((candidate) => candidate.status === "connected") ?? hosts[0];
  if (!host?.id) throw new Error("No connected host is available.");
  return host.id;
}

async function buildAgentEnvironment(
  bb: Pick<BbPluginApi, "sdk">,
  args: ParsedArgs,
): Promise<AgentEnvironment> {
  const environment = flag(args, "environment")?.trim();
  const newEnvironment = flag(args, "new-environment")?.trim();
  const baseBranch = flag(args, "base-branch")?.trim();
  if (environment && newEnvironment) {
    throw new Error("Cannot combine --environment with --new-environment.");
  }
  if (newEnvironment) {
    if (newEnvironment !== "worktree") {
      throw new Error(`Unknown environment kind '${newEnvironment}'. Supported: worktree.`);
    }
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

async function buildCreateExecution(
  bb: Pick<BbPluginApi, "sdk">,
  args: ParsedArgs,
): Promise<ResolvedCreateAutomationInput["execution"]> {
  const prompt = flag(args, "prompt");
  const script = flag(args, "script");
  const scriptFile = flag(args, "script-file");
  const hasAgent = prompt !== undefined;
  const hasScript = script !== undefined || scriptFile !== undefined;
  if (hasAgent && hasScript) {
    throw new Error("Provide either agent flags (--prompt) or script flags (--script/--script-file), not both.");
  }
  if (!hasAgent && !hasScript) {
    throw new Error("Provide an execution mode: agent (--prompt --provider --model) or script (--script-file <path> or --script <inline>).");
  }
  if (hasAgent) {
    const provider = flag(args, "provider");
    const model = flag(args, "model");
    if (!provider || !model) {
      throw new Error("Agent automations require --provider and --model alongside --prompt.");
    }
    return {
      mode: "agent",
      prompt,
      providerId: provider,
      model,
      permissionMode: parsePermissionMode(flag(args, "permission-mode")),
      environment: await buildAgentEnvironment(bb, args),
      ...(flag(args, "target-thread") ? { targetThreadId: flag(args, "target-thread") } : {}),
    };
  }
  if (args.flags.has("environment") || args.flags.has("new-environment") || args.flags.has("base-branch")) {
    throw new Error("Script automations do not accept environment flags.");
  }
  if (script !== undefined && scriptFile !== undefined) {
    throw new Error("Provide exactly one of --script or --script-file.");
  }
  const explicitInterpreter = parseScriptInterpreter(flag(args, "interpreter"));
  const timeoutMs = parseTimeoutMs(flag(args, "timeout"));
  const content = scriptFile ? await readFile(scriptFile, "utf8") : script;
  if (!content) throw new Error("Missing script content.");
  const interpreter =
    explicitInterpreter ?? (scriptFile ? inferInterpreterFromPath(scriptFile) : undefined);
  return {
    mode: "script",
    script: content,
    ...(scriptFile ? { scriptFile } : {}),
    ...(interpreter ? { interpreter } : {}),
    timeoutMs: timeoutMs ?? AUTOMATION_SCRIPT_TIMEOUT_DEFAULT_MS,
  };
}

function buildUpdateRequest(args: ParsedArgs): UpdateAutomationInput {
  const projectId = requireFlag(args, "project");
  const automationId = args.positionals[0];
  if (!automationId) throw new Error("Missing automationId.");
  const request: UpdateAutomationInput = { projectId, automationId };
  const name = flag(args, "name");
  if (name !== undefined) request.name = name;
  if (flag(args, "cron") !== undefined || flag(args, "timezone") !== undefined || flag(args, "at") !== undefined || flag(args, "in") !== undefined) {
    request.trigger = buildTrigger(args);
  }
  if (request.name === undefined && request.trigger === undefined) {
    throw new Error("No changes requested. Provide --name, --cron + --timezone, --at, or --in.");
  }
  return request;
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

function printAutomation(automation: AutomationResponse): string {
  const lines = [
    "",
    `  ID:        ${automation.id}`,
    `  Name:      ${automation.name}`,
    `  Enabled:   ${automation.enabled ? "yes" : "no"}`,
    `  Mode:      ${automation.execution.mode}`,
    `  Schedule:  ${formatAutomationTrigger(automation)}`,
    `  Next run:  ${formatTimestamp(automation.nextRunAt)}`,
    `  Last run:  ${formatTimestamp(automation.lastRunAt)}`,
    `  Runs:      ${automation.runCount}`,
    `  Origin:    ${automation.origin}`,
  ];
  if (automation.lastError) lines.push(`  Error:     ${automation.lastError}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function table(head: string[], rows: string[][]): string {
  const widths = head.map((label, index) =>
    Math.max(label.length, ...rows.map((row) => row[index]?.length ?? 0)),
  );
  const format = (row: string[]) =>
    row.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join("  ").trimEnd();
  return ["", format(head), ...rows.map(format), ""].join("\n") + "\n";
}

function printAutomationTable(automations: AutomationResponse[]): string {
  return table(
    ["ID", "Name", "On", "Schedule", "Next run", "Runs", "Origin"],
    automations.map((automation) => [
      automation.id,
      automation.name,
      automation.enabled ? "yes" : "no",
      formatAutomationTrigger(automation),
      formatTimestamp(automation.nextRunAt),
      String(automation.runCount),
      automation.origin,
    ]),
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

function helpText(): string {
  return `Automation commands

bb automation list --project <id>
bb automation create --project <id> --name <name> (--cron <expr> --timezone <tz> | --at <datetime> | --in <duration>) (--prompt <text> --provider <id> --model <model> | --script <inline> | --script-file <path>)
bb automation show <automationId> --project <id>
bb automation update <automationId> --project <id> [--name <name>] [--cron <expr> --timezone <tz> | --at <datetime> | --in <duration>]
bb automation pause <automationId> --project <id>
bb automation resume <automationId> --project <id>
bb automation run <automationId> --project <id> [--idempotency-key <key>]
bb automation runs <automationId> --project <id> [--limit <count>] [--output <runId>]
bb automation delete <automationId> --project <id> --yes
`;
}

export function registerAutomationCli(args: {
  bb: Pick<BbPluginApi, "cli" | "sdk">;
  service: AutomationService;
}): void {
  const { bb, service } = args;
  bb.cli.register({
    name: "automation",
    summary: "Inspect and manage automations (scheduled agent/script runs)",
    commands: [
      { name: "list", summary: "List automations for a project", usage: "bb automation list --project <id> [--json]" },
      { name: "create", summary: "Create an automation", usage: "bb automation create --project <id> --name <name> [schedule flags] [mode flags]" },
      { name: "show", summary: "Show automation details", usage: "bb automation show <automationId> --project <id> [--json]" },
      { name: "update", summary: "Update automation configuration", usage: "bb automation update <automationId> --project <id> [flags]" },
      { name: "pause", summary: "Pause an automation", usage: "bb automation pause <automationId> --project <id> [--json]" },
      { name: "resume", summary: "Resume an automation", usage: "bb automation resume <automationId> --project <id> [--json]" },
      { name: "run", summary: "Run an automation now", usage: "bb automation run <automationId> --project <id> [--idempotency-key <key>] [--json]" },
      { name: "runs", summary: "List automation runs", usage: "bb automation runs <automationId> --project <id> [--limit <count>] [--output <runId>] [--json]" },
      { name: "delete", summary: "Delete an automation", usage: "bb automation delete <automationId> --project <id> --yes [--json]" },
    ],
    async run(argv: string[], ctx: PluginCliContext): Promise<PluginCliResult> {
      try {
        const parsed = parseArgs(argv);
        const command = parsed.command;
        if (command === "help" || command === "--help" || command === "-h") {
          return { exitCode: 0, stdout: helpText() };
        }
        if (command === "list") {
          const result = service.list({ projectId: requireFlag(parsed, "project") });
          const json = optionalJson(parsed, result);
          return {
            exitCode: 0,
            stdout: json ?? (result.length === 0 ? "No automations found\n" : printAutomationTable(result)),
          };
        }
        if (command === "create") {
          const projectId = requireFlag(parsed, "project");
          const execution = await buildCreateExecution(bb, parsed);
          const request: ResolvedCreateAutomationInput = {
            projectId,
            name: requireFlag(parsed, "name"),
            enabled: !boolFlag(parsed, "disabled"),
            trigger: buildTrigger(parsed),
            execution,
            origin: ctx.threadId ? "agent" : "human",
            ...(ctx.threadId ? { createdByThreadId: ctx.threadId } : {}),
          };
          const created = await service.create(request);
          const json = optionalJson(parsed, created);
          return {
            exitCode: 0,
            stdout: json ?? `Automation created: ${created.id}\n${printAutomation(created)}`,
          };
        }
        if (command === "show") {
          const automationId = parsed.positionals[0];
          if (!automationId) throw new Error("Missing automationId.");
          const found = service.get({ projectId: requireFlag(parsed, "project"), automationId });
          const json = optionalJson(parsed, found);
          return { exitCode: 0, stdout: json ?? printAutomation(found) };
        }
        if (command === "update") {
          const updated = await service.update(buildUpdateRequest(parsed));
          const json = optionalJson(parsed, updated);
          return { exitCode: 0, stdout: json ?? `Automation ${updated.id} updated\n${printAutomation(updated)}` };
        }
        if (command === "pause" || command === "resume") {
          const automationId = parsed.positionals[0];
          if (!automationId) throw new Error("Missing automationId.");
          const input = { projectId: requireFlag(parsed, "project"), automationId };
          const updated = command === "pause" ? service.pause(input) : service.resume(input);
          const json = optionalJson(parsed, updated);
          return { exitCode: 0, stdout: json ?? `Automation ${updated.id} ${command === "pause" ? "paused" : "resumed"}\n` };
        }
        if (command === "run") {
          const automationId = parsed.positionals[0];
          if (!automationId) throw new Error("Missing automationId.");
          const result = await service.run({
            projectId: requireFlag(parsed, "project"),
            automationId,
            ...(flag(parsed, "idempotency-key") ? { idempotencyKey: flag(parsed, "idempotency-key") } : {}),
          });
          const json = optionalJson(parsed, result);
          const threadLine = result.run.threadId ? `Thread: ${result.run.threadId}\n` : "";
          return { exitCode: 0, stdout: json ?? `Run started: ${result.run.id}\n${threadLine}` };
        }
        if (command === "runs") {
          const automationId = parsed.positionals[0];
          if (!automationId) throw new Error("Missing automationId.");
          const limitText = flag(parsed, "limit");
          const limit = limitText === undefined ? undefined : Number.parseInt(limitText, 10);
          if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
            throw new Error("--limit must be a positive integer.");
          }
          const result = service.runs({
            projectId: requireFlag(parsed, "project"),
            automationId,
            limit: limit ?? 50,
          });
          const outputRunId = flag(parsed, "output");
          if (outputRunId) {
            const run = result.runs.find((candidate) => candidate.id === outputRunId);
            if (!run) throw new Error(`Run ${outputRunId} not found in returned runs. Increase --limit if it is older.`);
            const json = optionalJson(parsed, run);
            return { exitCode: 0, stdout: json ?? `${run.output ?? ""}\n` };
          }
          const json = optionalJson(parsed, result);
          return {
            exitCode: 0,
            stdout: json ?? (result.runs.length === 0 ? "No runs found\n" : printRunTable(result.runs)),
          };
        }
        if (command === "delete") {
          const automationId = parsed.positionals[0];
          if (!automationId) throw new Error("Missing automationId.");
          if (!boolFlag(parsed, "yes")) {
            throw new Error("Deletion requires --yes when run through the plugin CLI.");
          }
          await service.delete({ projectId: requireFlag(parsed, "project"), automationId });
          const value = { ok: true, id: automationId };
          const json = optionalJson(parsed, value);
          return { exitCode: 0, stdout: json ?? `Automation ${automationId} deleted\n` };
        }
        throw new Error(`Unknown automation command '${command}'.\n\n${helpText()}`);
      } catch (error) {
        return {
          exitCode: 1,
          stderr: `${error instanceof Error ? error.message : String(error)}\n`,
        };
      }
    },
  });
}
