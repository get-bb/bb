import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import type {
  AvailableModel,
  ClientTurnRequestId,
  PendingInteractionCreate,
  ReasoningLevel,
  RuntimePermissionPolicy,
  ThreadEvent,
} from "@bb/domain";
import { getThreadEventScopeTurnId } from "@bb/domain";
import { createAgentRuntime } from "./runtime.js";
import type {
  AgentRuntimeContributedEnvEntry,
  AgentRuntimeExecutionOptions,
} from "./types.js";
import { resolveIntegrationBridgeLaunch } from "./test/integration-provider-bridges.js";
import { withBridgeLaunch } from "./test/runtime-test-harness.js";
import { createApprovalResolution } from "./test/runtime-integration-harness.js";
import { promptTextInput } from "./test/prompt-input.js";

const RECORD_ROOT = process.env.BB_SCENARIO_RECORD_DIR;
const RECORD_PROVIDER = process.env.BB_SCENARIO_RECORD_PROVIDER ?? "";
const RECORD_CELL = process.env.BB_SCENARIO_RECORD_CELL ?? "";

const RACE_TRIGGERS: Record<string, string> = {
  codex: "after-message:provider/unhandled",
};

const PROBE_ENV = "BB_CONFORMANCE_PROBE";

const CLI_PATTERNS: Record<string, RegExp> = {
  codex: /codex.*app-server/,
  "claude-code": /claude/,
  pi: /\bpi\b|pi-coding-agent/,
  "acp-cursor": /cursor-agent|\bagent\b.*acp|index\.js.*acp/,
  "acp-opencode": /opencode/,
};

interface Ctx {
  providerId: string;
  runtime: ReturnType<typeof withBridgeLaunch>;
  events: ThreadEvent[];
  log: string[];
  workspace: string;
  hooks: Array<(event: ThreadEvent) => void>;
  threadId: string;
}

function note(ctx: Ctx, text: string): void {
  const line = `${new Date().toISOString()} ${text}`;
  ctx.log.push(line);
  process.stderr.write(`[record ${ctx.providerId}] ${text}\n`);
}

function createCtx(providerId: string, cell: string): Ctx {
  if (RECORD_ROOT === undefined) throw new Error("no record root");
  const workspace = process.env.BB_SCENARIO_RECORD_WORKSPACE;
  if (workspace === undefined) throw new Error("no record workspace");
  const recordDir = join(RECORD_ROOT, cell);
  mkdirSync(recordDir, { recursive: true });
  const events: ThreadEvent[] = [];
  const hooks: Array<(event: ThreadEvent) => void> = [];
  const env: Record<string, string> = {
    BB_PROVIDER_BRIDGE_RECORD_DIR: recordDir,
  };
  if (providerId === "pi") {
    const sessionDir = join(workspace, ".bb-pi-bridge-sessions");
    mkdirSync(sessionDir, { recursive: true });
    env.BB_PI_BRIDGE_SESSION_DIR = sessionDir;
  }
  const runtime = createAgentRuntime({
    env,
    workspacePath: workspace,
    onEvent: (event) => {
      events.push(event);
      for (const hook of hooks.splice(0)) hook(event);
    },
    onToolCall: async () => ({
      contentItems: [{ type: "inputText", text: "ok" }],
      success: true,
    }),
    onInteractiveRequest: async (request: PendingInteractionCreate) => {
      const resolution = await createApprovalResolution(request);
      return request.payload.kind === "approval" &&
        request.payload.subject.kind !== "permission_grant" &&
        request.payload.availableDecisions.includes("allow_once")
        ? { ...resolution, decision: "allow_once", grantedPermissions: null }
        : resolution;
    },
    onStderr: () => {},
  });
  return {
    providerId,
    runtime: withBridgeLaunch(
      runtime,
      resolveIntegrationBridgeLaunch(providerId),
    ),
    events,
    log: [],
    workspace,
    hooks,
    threadId: "",
  };
}

function threadEvents(ctx: Ctx, threadId: string): ThreadEvent[] {
  return ctx.events.filter(
    (event) => "threadId" in event && event.threadId === threadId,
  );
}

function count(ctx: Ctx, threadId: string, type: ThreadEvent["type"]): number {
  return threadEvents(ctx, threadId).filter((event) => event.type === type)
    .length;
}

async function waitUntil(
  label: string,
  predicate: () => boolean,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      process.stderr.write(`[record] timed out: ${label}\n`);
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return true;
}

let requestCounter = 0;
function nextClientRequestId(): ClientTurnRequestId {
  const alphabet = "23456789abcdefghijkmnpqrstuvwxyz";
  requestCounter += 1;
  let remaining = requestCounter + Math.floor(Math.random() * 1_000_000);
  let suffix = "";
  while (suffix.length < 10) {
    suffix = alphabet[remaining % alphabet.length] + suffix;
    remaining = Math.floor(remaining / alphabet.length);
  }
  return `creq_${suffix}` as ClientTurnRequestId;
}

function contributed(value: string): AgentRuntimeContributedEnvEntry[] {
  return [
    {
      name: PROBE_ENV,
      value,
      reason: "Conformance settings probe",
      source: { core: "machine-environment" },
    },
  ];
}

type PermissionChoice = "full" | "accept-edits" | "auto";

function alternatePermission(providerId: string): PermissionChoice | null {
  const modes =
    resolveIntegrationBridgeLaunch(providerId).capabilities.permissionModes;
  if (modes.includes("accept-edits")) return "accept-edits";
  if (modes.includes("auto")) return "auto";
  return null;
}

function permission(mode: PermissionChoice): RuntimePermissionPolicy {
  return mode === "full"
    ? {
        permissionMode: "full",
        permissionScope: "full",
        approvalReviewer: null,
        permissionEscalation: null,
      }
    : mode === "auto"
      ? {
          permissionMode: "auto",
          permissionScope: "workspace",
          approvalReviewer: "automatic",
          permissionEscalation: "ask",
        }
      : {
          permissionMode: "accept-edits",
          permissionScope: "workspace",
          approvalReviewer: "user",
          permissionEscalation: "ask",
        };
}

interface Settings {
  model: string;
  reasoningLevel: ReasoningLevel;
  permission: PermissionChoice;
  probe: string;
}

function options(ctx: Ctx, settings: Settings): AgentRuntimeExecutionOptions {
  return {
    model: settings.model,
    serviceTier: "default",
    reasoningLevel: settings.reasoningLevel,
    providerOptions: {},
    ...permission(settings.permission),
  };
}

async function pickModels(
  ctx: Ctx,
): Promise<{ first: AvailableModel; second: AvailableModel }> {
  const { models } = await ctx.runtime.listModels({
    providerId: ctx.providerId,
  });
  const preferred = process.env.BB_SCENARIO_RECORD_MODELS?.split(",");
  const byModel = (id: string) => models.find((model) => model.model === id);
  if (preferred !== undefined && preferred.length === 2) {
    const first = byModel(preferred[0]!);
    const second = byModel(preferred[1]!);
    if (first && second) return { first, second };
    throw new Error(
      `preferred models not listed: ${preferred.join(",")} of ${models.map((model) => model.model).join(",")}`,
    );
  }
  const first = models.find((model) => model.isDefault) ?? models[0]!;
  const second = models.find((model) => model.model !== first.model)!;
  return { first, second };
}

function supportedLevel(
  model: AvailableModel,
  wanted: ReasoningLevel,
): ReasoningLevel {
  const levels = model.supportedReasoningEfforts.map(
    (effort) => effort.reasoningEffort,
  );
  return (levels.includes(wanted) ? wanted : levels[0]) as ReasoningLevel;
}

async function startThread(ctx: Ctx, settings: Settings): Promise<string> {
  const threadId = `thr_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  await ctx.runtime.startThread({
    environmentId: `env_${randomUUID().slice(0, 8)}`,
    threadId,
    projectId: `proj_${randomUUID().slice(0, 8)}`,
    providerId: ctx.providerId,
    options: options(ctx, settings),
    contributedEnv: contributed(settings.probe),
  });
  ctx.threadId = threadId;
  note(ctx, `started thread ${threadId}`);
  return threadId;
}

async function runTurn(
  ctx: Ctx,
  threadId: string,
  settings: Settings,
  text: string,
): Promise<void> {
  note(ctx, `turn/start ${JSON.stringify(settings)}: ${text}`);
  await ctx.runtime.runTurn({
    threadId,
    clientRequestId: nextClientRequestId(),
    input: [promptTextInput({ text })],
    options: options(ctx, settings),
    contributedEnv: contributed(settings.probe),
  });
}

async function steer(
  ctx: Ctx,
  threadId: string,
  settings: Settings,
  text: string,
): Promise<void> {
  const expectedTurnId = ctx.runtime.getActiveTurnId(threadId);
  if (expectedTurnId === null) {
    note(ctx, "no active turn to steer; starting a turn instead");
    await runTurn(ctx, threadId, settings, text);
    return;
  }
  const clientRequestId = nextClientRequestId();
  note(ctx, `turn/steer ${JSON.stringify(settings)}: ${text}`);
  const result = await ctx.runtime.steerTurn({
    threadId,
    expectedTurnId,
    clientRequestId,
    input: [promptTextInput({ text })],
    options: options(ctx, settings),
    contributedEnv: contributed(settings.probe),
  });
  note(ctx, `steer result ${JSON.stringify(result)}`);
  if (result.status === "stale") {
    if (result.activeTurnId !== null) {
      note(ctx, `re-steering into ${result.activeTurnId}`);
      const second = await ctx.runtime.steerTurn({
        threadId,
        expectedTurnId: result.activeTurnId,
        clientRequestId,
        input: [promptTextInput({ text })],
        options: options(ctx, settings),
        contributedEnv: contributed(settings.probe),
      });
      note(ctx, `re-steer result ${JSON.stringify(second)}`);
      return;
    }
    await ctx.runtime.runTurn({
      threadId,
      clientRequestId,
      input: [promptTextInput({ text })],
      options: options(ctx, settings),
      contributedEnv: contributed(settings.probe),
    });
  }
}

async function settleTurns(
  ctx: Ctx,
  threadId: string,
  completed: number,
  timeoutMs = 120_000,
): Promise<void> {
  await waitUntil(
    `${completed} turns completed`,
    () => count(ctx, threadId, "turn/completed") >= completed,
    timeoutMs,
  );
  await new Promise((resolve) => setTimeout(resolve, 1_500));
}

function hasStartedCommand(ctx: Ctx, threadId: string, since: number): boolean {
  return threadEvents(ctx, threadId)
    .slice(since)
    .some(
      (event) =>
        event.type === "item/started" &&
        (event.item.type === "commandExecution" ||
          (event.item.type === "toolCall" &&
            /bash|shell|terminal|exec/i.test(event.item.tool))),
    );
}

function processTree(): Array<{ pid: number; ppid: number; command: string }> {
  return execFileSync("ps", ["-axo", "pid=,ppid=,command="], {
    encoding: "utf8",
  })
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => {
      const match = /^(\d+)\s+(\d+)\s+(.*)$/.exec(line)!;
      return {
        pid: Number(match[1]),
        ppid: Number(match[2]),
        command: match[3]!,
      };
    });
}

function descendants(
  rootPid: number,
): Array<{ pid: number; ppid: number; command: string }> {
  const tree = processTree();
  const result: Array<{ pid: number; ppid: number; command: string }> = [];
  const queue = [rootPid];
  while (queue.length > 0) {
    const parent = queue.shift()!;
    for (const proc of tree) {
      if (proc.ppid === parent) {
        result.push(proc);
        queue.push(proc.pid);
      }
    }
  }
  return result;
}

function killProviderCli(ctx: Ctx): string[] {
  const procs = descendants(process.pid);
  const bridges = procs.filter((proc) => proc.ppid === process.pid);
  const killed: string[] = [];
  const pattern = CLI_PATTERNS[ctx.providerId]!;
  for (const bridge of bridges) {
    for (const child of procs.filter((proc) => proc.ppid === bridge.pid)) {
      if (!pattern.test(child.command)) continue;
      if (/--no-session|model\/list/.test(child.command)) continue;
      process.kill(child.pid, "SIGKILL");
      killed.push(`${child.pid} ${child.command.slice(0, 160)}`);
    }
  }
  return killed;
}

function writeNotes(
  ctx: Ctx,
  cell: string,
  threadId: string,
  extra: Record<string, unknown>,
): void {
  if (RECORD_ROOT === undefined) return;
  writeFileSync(
    join(RECORD_ROOT, cell, `${ctx.providerId}.notes.json`),
    `${JSON.stringify(
      {
        providerId: ctx.providerId,
        cell,
        threadId,
        log: ctx.log,
        events: threadEvents(ctx, threadId).map((event) => {
          const base: Record<string, unknown> = { type: event.type };
          const turnId =
            "scope" in event ? getThreadEventScopeTurnId(event.scope) : null;
          if (turnId) base.turn = turnId;
          if ("item" in event && event.item !== undefined) {
            base.item = event.item.type;
            if (event.item.type === "agentMessage") base.text = event.item.text;
            if (event.item.type === "commandExecution") {
              base.command = event.item.command;
              base.output = event.item.aggregatedOutput;
              base.status = event.item.status;
            }
          }
          if (event.type === "turn/completed") base.status = event.status;
          if (event.type === "provider/error" || event.type === "system/error")
            base.message = event.message;
          if (event.type === "turn/input/accepted")
            base.clientRequestId = event.clientRequestId;
          return base;
        }),
        ...extra,
      },
      null,
      2,
    )}\n`,
  );
}

const SCENARIOS: Record<
  string,
  (ctx: Ctx) => Promise<{ threadId: string; extra?: Record<string, unknown> }>
> = {
  async "settings-follow-up"(ctx) {
    const { first, second } = await pickModels(ctx);
    let settings: Settings = {
      model: first.model,
      reasoningLevel: supportedLevel(first, "low"),
      permission: "full",
      probe: "probe-first",
    };
    const threadId = await startThread(ctx, settings);
    let turns = 0;
    const turn = async (text: string) => {
      turns += 1;
      await runTurn(ctx, threadId, settings, text);
      await settleTurns(ctx, threadId, turns);
    };
    await turn("Reply with exactly: settings-1");
    settings = {
      ...settings,
      model: second.model,
      reasoningLevel: supportedLevel(second, settings.reasoningLevel),
    };
    await turn("Reply with exactly: settings-2");
    settings = { ...settings, probe: "probe-second" };
    await turn(
      `Run this shell command exactly once: \`printf '%s' "$${PROBE_ENV}"\`. Then reply with exactly its output and nothing else.`,
    );
    const alternate = alternatePermission(ctx.providerId);
    if (alternate !== null) {
      settings = { ...settings, permission: alternate };
      await turn(
        "Run this shell command exactly once: `printf settings-4`. Then reply with exactly its output and nothing else.",
      );
    }
    settings = { ...settings, reasoningLevel: supportedLevel(second, "high") };
    await turn("Reply with exactly: settings-5");
    return { threadId, extra: { models: [first.model, second.model] } };
  },

  async "settings-steer"(ctx) {
    const { first, second } = await pickModels(ctx);
    let settings: Settings = {
      model: first.model,
      reasoningLevel: supportedLevel(first, "low"),
      permission: "full",
      probe: "probe-first",
    };
    const threadId = await startThread(ctx, settings);
    const changes: Array<[string, (current: Settings) => Settings]> = [
      [
        "model",
        (current) => ({
          ...current,
          model: second.model,
          reasoningLevel: supportedLevel(second, current.reasoningLevel),
        }),
      ],
      ["env", (current) => ({ ...current, probe: "probe-second" })],
    ];
    const alternate = alternatePermission(ctx.providerId);
    if (alternate !== null) {
      changes.push([
        "permission",
        (current) => ({ ...current, permission: alternate }),
      ]);
    }
    changes.push([
      "reasoning",
      (current) => ({
        ...current,
        reasoningLevel: supportedLevel(second, "high"),
      }),
    ]);
    for (const [index, [dimension, change]] of changes.entries()) {
      const turn = index + 1;
      const since = threadEvents(ctx, threadId).length;
      await runTurn(
        ctx,
        threadId,
        settings,
        `Run this shell command exactly once: \`python3 -c "import time; time.sleep(8)"\`. When it finishes, reply with exactly: steer-${turn}-original`,
      );
      const started = await waitUntil(
        "command started",
        () => hasStartedCommand(ctx, threadId, since),
        60_000,
      );
      if (!started) note(ctx, "command never started; steering anyway");
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      settings = change(settings);
      const steerText =
        dimension === "env"
          ? `New instruction: after the command finishes, run \`printf '%s' "$${PROBE_ENV}"\` once and reply with exactly its output.`
          : dimension === "permission"
            ? `New instruction: after the command finishes, run \`printf steer-${turn}-steered\` once and reply with exactly its output.`
            : `New instruction: after the command finishes, reply with exactly: steer-${turn}-steered`;
      await steer(ctx, threadId, settings, steerText);
      await waitUntil(
        `turn ${turn} settles`,
        () =>
          ctx.runtime.getActiveTurnId(threadId) === null &&
          count(ctx, threadId, "turn/completed") >= turn,
        120_000,
      );
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      if (ctx.runtime.getActiveTurnId(threadId) !== null) {
        await waitUntil(
          "no active turn",
          () => ctx.runtime.getActiveTurnId(threadId) === null,
          120_000,
        );
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
    }
    return { threadId, extra: { models: [first.model, second.model] } };
  },

  async "steer-race"(ctx) {
    const { first } = await pickModels(ctx);
    const settings: Settings = {
      model: first.model,
      reasoningLevel: supportedLevel(first, "low"),
      permission: "full",
      probe: "probe-first",
    };
    const threadId = await startThread(ctx, settings);
    const trigger =
      process.env.BB_SCENARIO_RECORD_RACE_TRIGGER ??
      RACE_TRIGGERS[ctx.providerId] ??
      "message-completed";
    const race: { steering: Promise<void> | null } = { steering: null };
    let sawMessage = false;
    const fire = () => {
      race.steering ??= steer(
        ctx,
        threadId,
        settings,
        "Also reply with exactly the single word: steered",
      );
    };
    const arm = () => {
      ctx.hooks.push((event) => {
        if (!("threadId" in event) || event.threadId !== threadId) {
          arm();
          return;
        }
        const messageCompleted =
          event.type === "item/completed" && event.item.type === "agentMessage";
        if (messageCompleted) sawMessage = true;
        const matches =
          trigger === "first-delta"
            ? event.type === "item/agentMessage/delta"
            : trigger === "message-completed"
              ? messageCompleted
              : sawMessage &&
                event.type === trigger.replace(/^after-message:/, "");
        if (matches) fire();
        else arm();
      });
    };
    arm();
    note(ctx, `race trigger ${trigger}`);
    await runTurn(
      ctx,
      threadId,
      settings,
      "Reply with exactly the single word: race",
    );
    await waitUntil("steer fired", () => race.steering !== null, 60_000);
    await race.steering;
    await waitUntil(
      "race settles",
      () => ctx.runtime.getActiveTurnId(threadId) === null,
      120_000,
    );
    await new Promise((resolve) => setTimeout(resolve, 8_000));
    await waitUntil(
      "idle",
      () => ctx.runtime.getActiveTurnId(threadId) === null,
      120_000,
    );
    const completed = count(ctx, threadId, "turn/completed");
    await runTurn(
      ctx,
      threadId,
      settings,
      "Reply with exactly the single word: after",
    );
    await settleTurns(ctx, threadId, completed + 1);
    await new Promise((resolve) => setTimeout(resolve, 6_000));
    return { threadId, extra: { trigger } };
  },

  async "provider-exit"(ctx) {
    const { first } = await pickModels(ctx);
    const settings: Settings = {
      model: first.model,
      reasoningLevel: supportedLevel(first, "low"),
      permission: "full",
      probe: "probe-first",
    };
    const threadId = await startThread(ctx, settings);
    const since = threadEvents(ctx, threadId).length;
    await runTurn(
      ctx,
      threadId,
      settings,
      'Run this shell command exactly once: `python3 -c "import time; time.sleep(41)"`. When it finishes, reply with exactly: exit-1',
    );
    await waitUntil(
      "command started",
      () => hasStartedCommand(ctx, threadId, since),
      60_000,
    );
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const killed = killProviderCli(ctx);
    note(ctx, `killed ${JSON.stringify(killed)}`);
    await waitUntil(
      "killed turn settles",
      () => count(ctx, threadId, "turn/completed") >= 1,
      60_000,
    );
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    await waitUntil(
      "idle",
      () => ctx.runtime.getActiveTurnId(threadId) === null,
      30_000,
    );
    const completed = count(ctx, threadId, "turn/completed");
    try {
      await runTurn(ctx, threadId, settings, "Reply with exactly: after-exit");
      await settleTurns(ctx, threadId, completed + 1);
    } catch (error) {
      note(
        ctx,
        `turn after exit failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return { threadId, extra: { killed } };
  },
};

describe.runIf(RECORD_ROOT !== undefined)("record a scenario cell", () => {
  it(`${RECORD_PROVIDER} ${RECORD_CELL}`, async () => {
    const scenario = SCENARIOS[RECORD_CELL];
    if (scenario === undefined) {
      throw new Error(`unknown scenario cell "${RECORD_CELL}"`);
    }
    const ctx = createCtx(RECORD_PROVIDER, RECORD_CELL);
    let extra: Record<string, unknown> = {};
    try {
      extra = (await scenario(ctx)).extra ?? {};
    } finally {
      writeNotes(ctx, RECORD_CELL, ctx.threadId, extra);
      await ctx.runtime.shutdown().catch(() => {});
    }
  }, 900_000);
});
