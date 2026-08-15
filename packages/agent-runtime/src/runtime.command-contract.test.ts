import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { promptTextInput } from "./test/prompt-input.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ThreadEvent } from "@bb/domain";
import type { HostDaemonAcpLaunchSpec } from "@bb/host-daemon-contract";
import { createCodexProviderAdapter } from "./codex/adapter.js";
import { createAgentRuntimeWithAdapters } from "./runtime.js";
import { fakeProviderScriptPath } from "./test/index.js";
import {
  createFakeAdapter,
  fullRuntimeOptions,
  waitForRuntimeThreadEvent,
  waitForThreadTurnStarted,
} from "./test/runtime-test-harness.js";
import type { AgentRuntime, AgentRuntimeExecutionOptions } from "./types.js";

interface RuntimeLinkedWorktreeFixture {
  expectedWritableRoots: string[];
  workspacePath: string;
}

interface CreateRuntimeLinkedWorktreeFixtureArgs {
  rootPath: string;
}

type RuntimeEventHandler = (event: ThreadEvent) => void;

interface CreateContractRuntimeArgs {
  adapterId?: string;
  onEvent?: RuntimeEventHandler;
  scriptPath: string;
  workspacePath: string;
}

interface WriteArchiveProviderScriptArgs {
  archiveErrorMessage?: string;
  expectedProviderThreadId: string;
  threadId: string;
  unarchiveErrorMessage?: string;
}

const missingProviderThreadId = "t-missing";
const missingProviderThreadIdError =
  /No provider thread id available for t-missing/;
const acpLaunchSpec: HostDaemonAcpLaunchSpec = {
  displayName: "Custom ACP",
  command: "custom-agent",
  args: ["serve"],
  env: { CUSTOM_AGENT_TOKEN: "token" },
};

function createContractRuntime(args: CreateContractRuntimeArgs): AgentRuntime {
  return createAgentRuntimeWithAdapters({
    workspacePath: args.workspacePath,
    onEvent: args.onEvent ?? (() => {}),
    onToolCall: async () => ({
      contentItems: [{ type: "inputText", text: "ok" }],
      success: true,
    }),
    adapterFactory: () => {
      const adapter = createFakeAdapter(args.scriptPath);
      return args.adapterId === undefined
        ? adapter
        : { ...adapter, id: args.adapterId };
    },
  });
}

async function registerThreadWithoutProviderThreadId(
  runtime: AgentRuntime,
): Promise<void> {
  await expect(
    runtime.resumeThread({
      environmentId: "env-1",
      threadId: missingProviderThreadId,
      projectId: "p1",
      providerId: "fake",
      options: fullRuntimeOptions,
    }),
  ).rejects.toThrow(missingProviderThreadIdError);
}

function writeArchiveProviderScript(
  scriptPath: string,
  args: WriteArchiveProviderScriptArgs,
): void {
  writeFileSync(
    scriptPath,
    `
const readline = require("node:readline");

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\\n");
}

function paramsOf(message) {
  return message && typeof message.params === "object" && message.params !== null
    ? message.params
    : {};
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const message = JSON.parse(line);
  const params = paramsOf(message);
  if (message.method === "initialize") {
    send({ jsonrpc: "2.0", id: message.id, result: {} });
    return;
  }
  if (message.method === "thread/start") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: { providerThreadId: "provider-started" },
    });
    send({
      jsonrpc: "2.0",
      method: "thread/identity",
      params: {
        threadId: ${JSON.stringify(args.threadId)},
        providerThreadId: "provider-started",
      },
    });
    return;
  }
  if (message.method === "thread/archive" || message.method === "thread/unarchive") {
    if (
      params.threadId !== ${JSON.stringify(args.threadId)} ||
      params.providerThreadId !== ${JSON.stringify(args.expectedProviderThreadId)}
    ) {
      send({
        jsonrpc: "2.0",
        id: message.id,
        error: {
          code: -32000,
          message: "wrong archive params " + JSON.stringify(params),
        },
      });
      return;
    }
    const forcedError =
      message.method === "thread/archive"
        ? ${JSON.stringify(args.archiveErrorMessage ?? null)}
        : ${JSON.stringify(args.unarchiveErrorMessage ?? null)};
    if (forcedError) {
      send({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32000, message: forcedError },
      });
      return;
    }
    send({ jsonrpc: "2.0", id: message.id, result: {} });
    return;
  }
  send({
    jsonrpc: "2.0",
    id: message.id,
    error: { code: -32601, message: "Method not found: " + message.method },
  });
});
`,
    "utf8",
  );
}

function createRuntimeLinkedWorktreeFixture(
  args: CreateRuntimeLinkedWorktreeFixtureArgs,
): RuntimeLinkedWorktreeFixture {
  const rootPath = realpathSync.native(args.rootPath);
  const workspacePath = join(rootPath, "worktree");
  const commonDir = join(rootPath, "repo.git");
  const gitDir = join(commonDir, "worktrees", "bb1");
  const headRef = "refs/heads/bb/probe";
  const headRefParent = join(commonDir, "refs", "heads", "bb");
  const headLogParent = join(commonDir, "logs", "refs", "heads", "bb");

  mkdirSync(workspacePath, { recursive: true });
  mkdirSync(gitDir, { recursive: true });
  mkdirSync(join(commonDir, "objects"), { recursive: true });
  mkdirSync(headRefParent, { recursive: true });
  mkdirSync(headLogParent, { recursive: true });
  writeFileSync(join(workspacePath, ".git"), `gitdir: ${gitDir}\n`);
  writeFileSync(join(gitDir, "gitdir"), `${join(workspacePath, ".git")}\n`);
  writeFileSync(join(gitDir, "commondir"), "../..\n");
  writeFileSync(join(gitDir, "HEAD"), `ref: ${headRef}\n`);

  return {
    expectedWritableRoots: [
      gitDir,
      join(commonDir, "objects"),
      headRefParent,
      headLogParent,
    ],
    workspacePath,
  };
}

describe("createAgentRuntime command contracts", () => {
  let tmpDir: string;
  let scriptPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "bb-runtime-test-"));
    scriptPath = fakeProviderScriptPath;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("passes runtime workspace-write roots to adapter construction", async () => {
    let capturedAdditionalWorkspaceWriteRoots: readonly string[] | undefined;
    const runtime = createAgentRuntimeWithAdapters({
      workspacePath: tmpDir,
      additionalWorkspaceWriteRoots: [
        "/repo/.git/worktrees/bb13",
        "/repo/.git/objects",
      ],
      onEvent: () => {},
      onToolCall: async () => ({
        contentItems: [{ type: "inputText", text: "ok" }],
        success: true,
      }),
      adapterFactory: (_providerId, options) => {
        capturedAdditionalWorkspaceWriteRoots =
          options.additionalWorkspaceWriteRoots;
        return createFakeAdapter(scriptPath);
      },
    });

    try {
      await runtime.ensureProvider({ providerId: "fake" });
      expect(capturedAdditionalWorkspaceWriteRoots).toEqual([
        "/repo/.git/worktrees/bb13",
        "/repo/.git/objects",
      ]);
    } finally {
      await runtime.shutdown();
    }
  });

  it("passes acp launch specs to adapter construction for model list, start, and resume", async () => {
    const captured: Array<HostDaemonAcpLaunchSpec | undefined> = [];
    const createRuntime = () =>
      createAgentRuntimeWithAdapters({
        workspacePath: tmpDir,
        onEvent: () => {},
        onToolCall: async () => ({
          contentItems: [{ type: "inputText", text: "ok" }],
          success: true,
        }),
        adapterFactory: (_providerId, options) => {
          captured.push(options.acpLaunchSpec);
          return createFakeAdapter(scriptPath);
        },
      });

    const listRuntime = createRuntime();
    await listRuntime.listModels({
      providerId: "acp-custom",
      acpLaunchSpec,
    });
    await listRuntime.shutdown();

    const startRuntime = createRuntime();
    await startRuntime.startThread({
      acpLaunchSpec,
      environmentId: "env-1",
      threadId: "t-start",
      projectId: "p1",
      providerId: "acp-custom",
      options: fullRuntimeOptions,
    });
    await startRuntime.shutdown();

    const resumeRuntime = createRuntime();
    await resumeRuntime.resumeThread({
      acpLaunchSpec,
      environmentId: "env-1",
      threadId: "t-resume",
      projectId: "p1",
      providerThreadId: "provider-resume",
      providerId: "acp-custom",
      options: fullRuntimeOptions,
    });
    await resumeRuntime.shutdown();

    expect(captured).toEqual([acpLaunchSpec, acpLaunchSpec, acpLaunchSpec]);
    // Spawns the fake ACP agent three times (model list now adds a discovery
    // session), so allow extra headroom over the 5s default on slower CI.
  }, 30000);

  it("uses a new provider process cache entry when the acp launch spec changes", async () => {
    const seenModelListMarkers: string[] = [];
    const adapterConstructions: string[] = [];
    const runtime = createAgentRuntimeWithAdapters({
      workspacePath: tmpDir,
      onEvent: () => {},
      onToolCall: async () => ({
        contentItems: [{ type: "inputText", text: "ok" }],
        success: true,
      }),
      adapterFactory: (_providerId, options) => {
        const marker = options.acpLaunchSpec?.env.CACHE_MARKER ?? "missing";
        adapterConstructions.push(marker);
        const base = createFakeAdapter(scriptPath);
        return {
          ...base,
          buildCommandPlan(
            command: Parameters<typeof base.buildCommandPlan>[0],
          ) {
            if (command.type === "model/list") {
              seenModelListMarkers.push(marker);
            }
            return base.buildCommandPlan(command);
          },
        };
      },
    });

    try {
      await runtime.listModels({
        providerId: "acp-custom",
        acpLaunchSpec: {
          ...acpLaunchSpec,
          env: { CACHE_MARKER: "first" },
        },
      });
      await runtime.listModels({
        providerId: "acp-custom",
        acpLaunchSpec: {
          ...acpLaunchSpec,
          env: { CACHE_MARKER: "second" },
        },
      });

      expect(adapterConstructions).toEqual(["first", "second"]);
      expect(seenModelListMarkers).toEqual(["first", "second"]);
    } finally {
      await runtime.shutdown();
    }
  }, 30000);

  it("prefixes provider rename titles and normalizes provider title events", async () => {
    const events = new Array<ThreadEvent>();
    const renameLogPath = join(tmpDir, "rename-title.txt");
    const renameProviderScriptPath = join(tmpDir, "rename-provider.cjs");
    writeFileSync(
      renameProviderScriptPath,
      `
const fs = require("node:fs");
const readline = require("node:readline");
const renameLogPath = ${JSON.stringify(renameLogPath)};

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\\n");
}

function paramsOf(message) {
  return message && typeof message.params === "object" && message.params !== null
    ? message.params
    : {};
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const message = JSON.parse(line);
  const params = paramsOf(message);
  if (message.method === "initialize") {
    send({ jsonrpc: "2.0", id: message.id, result: {} });
    return;
  }
  if (message.method === "thread/start") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: { providerThreadId: "provider-thread-1" },
    });
    send({
      jsonrpc: "2.0",
      method: "thread/identity",
      params: {
        threadId: params.threadId,
        providerThreadId: "provider-thread-1",
      },
    });
    return;
  }
  if (message.method === "thread/name/set") {
    fs.writeFileSync(renameLogPath, params.title, "utf8");
    send({ jsonrpc: "2.0", id: message.id, result: {} });
    send({
      jsonrpc: "2.0",
      method: "thread/name/updated",
      params: {
        threadId: params.threadId,
        providerThreadId: params.providerThreadId,
        threadName: params.title,
      },
    });
    return;
  }
});
`,
      "utf8",
    );
    const runtime = createContractRuntime({
      onEvent: (event) => events.push(event),
      scriptPath: renameProviderScriptPath,
      workspacePath: tmpDir,
    });

    try {
      await runtime.startThread({
        environmentId: "env-1",
        threadId: "t1",
        projectId: "p1",
        providerId: "fake",
        options: fullRuntimeOptions,
      });
      await runtime.renameThread({ threadId: "t1", title: "New Title" });
      await waitForRuntimeThreadEvent({
        events,
        label: "normalized provider title event",
        predicate: (event) =>
          event.type === "thread/name/updated" &&
          event.threadId === "t1" &&
          event.threadName === "New Title",
        runtime,
        threadId: "t1",
      });

      expect(readFileSync(renameLogPath, "utf8")).toBe("[bb] New Title");
      expect(events).not.toContainEqual(
        expect.objectContaining({
          threadName: "[bb] New Title",
          type: "thread/name/updated",
        }),
      );
    } finally {
      await runtime.shutdown();
    }
  });

  it("retries a Codex rename while its new rollout file is still empty", async () => {
    const renameAttemptsPath = join(tmpDir, "rename-attempts.txt");
    const renameTitlePath = join(tmpDir, "retried-rename-title.txt");
    const providerScriptPath = join(tmpDir, "codex-rename-retry-provider.cjs");
    writeFileSync(
      providerScriptPath,
      `
const fs = require("node:fs");
const readline = require("node:readline");
const renameAttemptsPath = ${JSON.stringify(renameAttemptsPath)};
const renameTitlePath = ${JSON.stringify(renameTitlePath)};
let renameAttempts = 0;

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\\n");
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const message = JSON.parse(line);
  const params = message.params ?? {};
  if (message.method === "initialize") {
    send({ jsonrpc: "2.0", id: message.id, result: {} });
    return;
  }
  if (message.method === "thread/start") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: { providerThreadId: "provider-thread-1" },
    });
    return;
  }
  if (message.method === "thread/name/set") {
    renameAttempts += 1;
    fs.writeFileSync(renameAttemptsPath, String(renameAttempts), "utf8");
    if (renameAttempts === 1) {
      send({
        jsonrpc: "2.0",
        id: message.id,
        error: {
          code: -32603,
          message:
            "failed to set thread name: rollout at /tmp/new-rollout.jsonl is empty",
        },
      });
      return;
    }
    fs.writeFileSync(renameTitlePath, params.title, "utf8");
    send({ jsonrpc: "2.0", id: message.id, result: {} });
  }
});
`,
      "utf8",
    );
    const runtime = createContractRuntime({
      adapterId: "codex",
      scriptPath: providerScriptPath,
      workspacePath: tmpDir,
    });

    try {
      await runtime.startThread({
        environmentId: "env-1",
        threadId: "t1",
        projectId: "p1",
        providerId: "codex",
        options: fullRuntimeOptions,
      });
      await runtime.renameThread({ threadId: "t1", title: "New Title" });

      expect(readFileSync(renameAttemptsPath, "utf8")).toBe("2");
      expect(readFileSync(renameTitlePath, "utf8")).toBe("[bb] New Title");
    } finally {
      await runtime.shutdown();
    }
  });

  it("stops retrying a Codex rename once its rollout stays empty", async () => {
    const renameAttemptsPath = join(tmpDir, "exhausted-rename-attempts.txt");
    const providerScriptPath = join(tmpDir, "codex-rename-empty-provider.cjs");
    writeFileSync(
      providerScriptPath,
      `
const fs = require("node:fs");
const readline = require("node:readline");
const renameAttemptsPath = ${JSON.stringify(renameAttemptsPath)};
let renameAttempts = 0;

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\\n");
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    send({ jsonrpc: "2.0", id: message.id, result: {} });
    return;
  }
  if (message.method === "thread/start") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: { providerThreadId: "provider-thread-1" },
    });
    return;
  }
  if (message.method === "thread/name/set") {
    renameAttempts += 1;
    fs.writeFileSync(renameAttemptsPath, String(renameAttempts), "utf8");
    send({
      jsonrpc: "2.0",
      id: message.id,
      error: {
        code: -32603,
        message:
          "failed to set thread name: rollout at /tmp/new-rollout.jsonl is empty",
      },
    });
  }
});
`,
      "utf8",
    );
    const runtime = createContractRuntime({
      adapterId: "codex",
      scriptPath: providerScriptPath,
      workspacePath: tmpDir,
    });

    try {
      await runtime.startThread({
        environmentId: "env-1",
        threadId: "t1",
        projectId: "p1",
        providerId: "codex",
        options: fullRuntimeOptions,
      });

      await expect(
        runtime.renameThread({ threadId: "t1", title: "New Title" }),
      ).rejects.toThrow(/rollout at .+ is empty/i);
      expect(readFileSync(renameAttemptsPath, "utf8")).toBe("3");
    } finally {
      await runtime.shutdown();
    }
  });

  it("preserves Codex captured linked-worktree git roots from start to turn/start", async () => {
    const fixture = createRuntimeLinkedWorktreeFixture({ rootPath: tmpDir });
    const providerScriptPath = join(tmpDir, "codex-runtime-provider.cjs");
    const turnStartLogPath = join(tmpDir, "turn-start.json");
    const workspaceWriteOptions = {
      ...fullRuntimeOptions,
      permissionEscalation: "ask",
      permissionMode: "accept-edits",
      permissionScope: "workspace",
      approvalReviewer: "user",
    } satisfies AgentRuntimeExecutionOptions;

    writeFileSync(
      providerScriptPath,
      `
const fs = require("node:fs");
const readline = require("node:readline");
const turnStartLogPath = ${JSON.stringify(turnStartLogPath)};

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\\n");
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    send({ jsonrpc: "2.0", id: message.id, result: {} });
    return;
  }

  if (message.method === "account/rateLimits/read") {
    send({ jsonrpc: "2.0", id: message.id, result: { rateLimits: {} } });
    return;
  }

  if (message.method === "thread/start") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: { thread: { id: "codex-thread-runtime" } },
    });
    return;
  }

  if (message.method === "turn/start") {
    fs.writeFileSync(turnStartLogPath, JSON.stringify(message.params), "utf8");
    send({ jsonrpc: "2.0", id: message.id, result: {} });
  }
});
`,
      "utf8",
    );

    const runtime = createAgentRuntimeWithAdapters({
      workspacePath: fixture.workspacePath,
      onEvent: () => {},
      onToolCall: async () => ({
        contentItems: [{ type: "inputText", text: "ok" }],
        success: true,
      }),
      adapterFactory: (_providerId, options) =>
        createCodexProviderAdapter({
          additionalWorkspaceWriteRoots: options.additionalWorkspaceWriteRoots,
          processArgs: [providerScriptPath],
          processCommand: "node",
        }),
    });

    try {
      const { providerThreadId } = await runtime.startThread({
        environmentId: "env-1",
        options: workspaceWriteOptions,
        projectId: "p1",
        providerId: "codex",
        threadId: "t1",
      });

      expect(providerThreadId).toBe("codex-thread-runtime");

      await runtime.runTurn({
        clientRequestId: "creq_222222224p",
        input: [promptTextInput({ text: "commit" })],
        options: workspaceWriteOptions,
        threadId: "t1",
      });

      expect(JSON.parse(readFileSync(turnStartLogPath, "utf8"))).toMatchObject({
        sandboxPolicy: {
          type: "workspaceWrite",
          writableRoots: fixture.expectedWritableRoots,
        },
        threadId: "codex-thread-runtime",
      });
    } finally {
      await runtime.shutdown();
    }
  });

  it("keeps Codex automatic review on-request for agent-initiated runtime commands", async () => {
    const providerScriptPath = join(tmpDir, "codex-auto-review-provider.cjs");
    const threadStartLogPath = join(tmpDir, "auto-thread-start.json");
    const turnStartLogPath = join(tmpDir, "auto-turn-start.json");
    const agentInitiatedOptions = {
      ...fullRuntimeOptions,
      approvalReviewer: "automatic",
      permissionEscalation: "deny",
      permissionMode: "auto",
      permissionScope: "workspace",
    } satisfies AgentRuntimeExecutionOptions;

    writeFileSync(
      providerScriptPath,
      `
const fs = require("node:fs");
const readline = require("node:readline");
const threadStartLogPath = ${JSON.stringify(threadStartLogPath)};
const turnStartLogPath = ${JSON.stringify(turnStartLogPath)};

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\\n");
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    send({ jsonrpc: "2.0", id: message.id, result: {} });
    return;
  }
  if (message.method === "account/rateLimits/read") {
    send({ jsonrpc: "2.0", id: message.id, result: { rateLimits: {} } });
    return;
  }
  if (message.method === "thread/start") {
    fs.writeFileSync(threadStartLogPath, JSON.stringify(message.params), "utf8");
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: { thread: { id: "codex-auto-review-thread" } },
    });
    return;
  }
  if (message.method === "turn/start") {
    fs.writeFileSync(turnStartLogPath, JSON.stringify(message.params), "utf8");
    send({ jsonrpc: "2.0", id: message.id, result: {} });
  }
});
`,
      "utf8",
    );

    const runtime = createAgentRuntimeWithAdapters({
      workspacePath: tmpDir,
      onEvent: () => {},
      onToolCall: async () => ({
        contentItems: [{ type: "inputText", text: "ok" }],
        success: true,
      }),
      adapterFactory: () =>
        createCodexProviderAdapter({
          additionalWorkspaceWriteRoots: [],
          processArgs: [providerScriptPath],
          processCommand: "node",
        }),
    });

    try {
      await runtime.startThread({
        environmentId: "env-1",
        options: agentInitiatedOptions,
        projectId: "p1",
        providerId: "codex",
        threadId: "t1",
      });
      expect(
        JSON.parse(readFileSync(threadStartLogPath, "utf8")),
      ).toMatchObject({
        approvalPolicy: "on-request",
        approvalsReviewer: "auto_review",
        sandbox: "workspace-write",
      });

      await runtime.runTurn({
        clientRequestId: "creq_222222224v",
        input: [promptTextInput({ text: "inspect and edit" })],
        options: agentInitiatedOptions,
        threadId: "t1",
      });
      expect(JSON.parse(readFileSync(turnStartLogPath, "utf8"))).toMatchObject({
        approvalPolicy: "on-request",
        approvalsReviewer: "auto_review",
        sandboxPolicy: { type: "workspaceWrite" },
      });
    } finally {
      await runtime.shutdown();
    }
  });

  it("rejects required adapter commands that return no-op plans", async () => {
    const baseAdapter = createFakeAdapter(scriptPath);
    const runtime = createAgentRuntimeWithAdapters({
      workspacePath: tmpDir,
      onEvent: () => {},
      onToolCall: async () => ({
        contentItems: [{ type: "inputText", text: "ok" }],
        success: true,
      }),
      adapterFactory: () => ({
        ...baseAdapter,
        buildCommandPlan(command) {
          if (command.type === "turn/start") {
            return { kind: "noop", reason: "turn start unsupported" };
          }
          return baseAdapter.buildCommandPlan(command);
        },
      }),
    });

    await runtime.startThread({
      environmentId: "env-1",
      threadId: "t1",
      projectId: "p1",
      providerId: "fake",
      options: fullRuntimeOptions,
    });
    await expect(
      runtime.runTurn({
        clientRequestId: "creq_222222224q",
        threadId: "t1",
        input: [promptTextInput({ text: "hello" })],
        options: fullRuntimeOptions,
      }),
    ).rejects.toThrow(/returned no provider request for turn\/start/);
    await runtime.shutdown();
  });

  it("rejects no-op steer commands instead of silently dropping them", async () => {
    const events: ThreadEvent[] = [];
    const baseAdapter = createFakeAdapter(scriptPath);
    const runtime = createAgentRuntimeWithAdapters({
      workspacePath: tmpDir,
      onEvent: (event) => events.push(event),
      onToolCall: async () => ({
        contentItems: [{ type: "inputText", text: "ok" }],
        success: true,
      }),
      adapterFactory: () => ({
        ...baseAdapter,
        buildCommandPlan(command) {
          if (command.type === "turn/steer") {
            return { kind: "noop", reason: "steer unsupported" };
          }
          return baseAdapter.buildCommandPlan(command);
        },
      }),
    });

    await runtime.startThread({
      environmentId: "env-1",
      threadId: "t1",
      projectId: "p1",
      providerId: "fake",
      options: fullRuntimeOptions,
    });
    await runtime.runTurn({
      clientRequestId: "creq_222222224r",
      threadId: "t1",
      input: [promptTextInput({ text: "delay:500" })],
      options: fullRuntimeOptions,
    });
    await waitForThreadTurnStarted({
      events,
      providerId: "fake",
      runtime,
      threadId: "t1",
      turnId: "turn-1",
    });
    await expect(
      runtime.steerTurn({
        clientRequestId: "creq_222222224s",
        threadId: "t1",
        expectedTurnId: "turn-1",
        input: [promptTextInput({ text: "steer" })],
        options: fullRuntimeOptions,
      }),
    ).rejects.toThrow(/returned no provider request for turn\/steer/);
    await runtime.shutdown();
  });

  it("rejects unsupported thread rename instead of silently succeeding", async () => {
    const baseAdapter = createFakeAdapter(scriptPath);
    const runtime = createAgentRuntimeWithAdapters({
      workspacePath: tmpDir,
      onEvent: () => {},
      onToolCall: async () => ({
        contentItems: [{ type: "inputText", text: "ok" }],
        success: true,
      }),
      adapterFactory: () => ({
        ...baseAdapter,
        capabilities: {
          ...baseAdapter.capabilities,
          supportsRename: false,
        },
      }),
    });

    await runtime.startThread({
      environmentId: "env-1",
      threadId: "t1",
      projectId: "p1",
      providerId: "fake",
      options: fullRuntimeOptions,
    });
    await expect(
      runtime.renameThread({ threadId: "t1", title: "New Title" }),
    ).rejects.toThrow(/does not support thread rename/);
    await runtime.shutdown();
  });

  it.each([
    { reportedCleared: true, label: "confirms success" },
    { reportedCleared: false, label: "reconciles a stale failure" },
  ])(
    "$label after Codex persists a delayed Goal clear",
    async ({ reportedCleared }) => {
      const providerScriptPath = join(tmpDir, "codex-goal-clear-provider.cjs");
      const caseSuffix = reportedCleared ? "success" : "stale-failure";
      const responseMarkerPath = join(
        tmpDir,
        `goal-clear-response-${caseSuffix}`,
      );
      const notificationReleasePath = join(
        tmpDir,
        `release-goal-clear-${caseSuffix}`,
      );
      writeFileSync(
        providerScriptPath,
        `
const fs = require("node:fs");
const readline = require("node:readline");
const responseMarkerPath = ${JSON.stringify(responseMarkerPath)};
const notificationReleasePath = ${JSON.stringify(notificationReleasePath)};

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\\n");
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    send({ jsonrpc: "2.0", id: message.id, result: {} });
    return;
  }
  if (message.method === "account/rateLimits/read") {
    send({ jsonrpc: "2.0", id: message.id, result: { rateLimits: {} } });
    return;
  }
  if (message.method === "thread/start") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: { thread: { id: "codex-goal-thread" } },
    });
    return;
  }
  if (message.method === "thread/goal/clear") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: { cleared: ${reportedCleared} },
    });
    fs.writeFileSync(responseMarkerPath, "responded", "utf8");
    const releasePoll = setInterval(() => {
      if (!fs.existsSync(notificationReleasePath)) {
        return;
      }
      clearInterval(releasePoll);
      send({
        jsonrpc: "2.0",
        method: "thread/goal/cleared",
        params: { threadId: "codex-goal-thread" },
      });
    }, 5);
  }
});
`,
        "utf8",
      );
      const events: ThreadEvent[] = [];
      const runtime = createAgentRuntimeWithAdapters({
        workspacePath: tmpDir,
        onEvent: (event) => events.push(event),
        onToolCall: async () => ({
          contentItems: [{ type: "inputText", text: "ok" }],
          success: true,
        }),
        adapterFactory: () =>
          createCodexProviderAdapter({
            additionalWorkspaceWriteRoots: [],
            processArgs: [providerScriptPath],
            processCommand: "node",
          }),
      });

      try {
        await runtime.startThread({
          environmentId: "env-1",
          threadId: "t-goal",
          projectId: "p1",
          providerId: "codex",
          options: fullRuntimeOptions,
        });
        let settled = false;
        const clearPromise = runtime.clearThreadGoal({
          threadId: "t-goal",
        });
        void clearPromise.then(
          () => {
            settled = true;
          },
          () => {
            settled = true;
          },
        );

        await vi.waitFor(() => {
          expect(existsSync(responseMarkerPath)).toBe(true);
        });
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(settled).toBe(false);

        writeFileSync(notificationReleasePath, "release", "utf8");
        await expect(clearPromise).resolves.toEqual({ cleared: true });
        expect(events).toContainEqual(
          expect.objectContaining({
            threadId: "t-goal",
            type: "thread/goal/cleared",
          }),
        );
      } finally {
        await runtime.shutdown();
      }
    },
    10_000,
  );

  it("rejects thread resume when providerThreadId cannot be resolved", async () => {
    const runtime = createContractRuntime({
      scriptPath,
      workspacePath: tmpDir,
    });

    await registerThreadWithoutProviderThreadId(runtime);
    await runtime.shutdown();
  });

  it("rejects turn start when providerThreadId cannot be resolved", async () => {
    const runtime = createContractRuntime({
      scriptPath,
      workspacePath: tmpDir,
    });

    await registerThreadWithoutProviderThreadId(runtime);
    await expect(
      runtime.runTurn({
        clientRequestId: "creq_222222224t",
        threadId: missingProviderThreadId,
        input: [promptTextInput({ text: "hello" })],
        options: fullRuntimeOptions,
      }),
    ).rejects.toThrow(missingProviderThreadIdError);
    await runtime.shutdown();
  });

  it("rejects thread rename when providerThreadId cannot be resolved", async () => {
    const runtime = createContractRuntime({
      scriptPath,
      workspacePath: tmpDir,
    });

    await registerThreadWithoutProviderThreadId(runtime);
    await expect(
      runtime.renameThread({
        threadId: missingProviderThreadId,
        title: "New Title",
      }),
    ).rejects.toThrow(missingProviderThreadIdError);
    await runtime.shutdown();
  });

  it("archives threads using caller-provided provider ids without runtime registry state", async () => {
    const archiveScriptPath = join(tmpDir, "archive-provider.cjs");
    writeArchiveProviderScript(archiveScriptPath, {
      expectedProviderThreadId: "provider-explicit",
      threadId: "t-archive",
    });
    const runtime = createContractRuntime({
      scriptPath: archiveScriptPath,
      workspacePath: tmpDir,
    });

    await runtime.archiveThread({
      threadId: "t-archive",
      providerId: "fake",
      providerThreadId: "provider-explicit",
    });
    await runtime.shutdown();
  });

  it("unarchives threads using caller-provided provider ids without runtime registry state", async () => {
    const archiveScriptPath = join(tmpDir, "unarchive-provider.cjs");
    writeArchiveProviderScript(archiveScriptPath, {
      expectedProviderThreadId: "provider-explicit",
      threadId: "t-unarchive",
    });
    const runtime = createContractRuntime({
      scriptPath: archiveScriptPath,
      workspacePath: tmpDir,
    });

    await runtime.unarchiveThread({
      threadId: "t-unarchive",
      providerId: "fake",
      providerThreadId: "provider-explicit",
    });
    await runtime.shutdown();
  });

  it("accepts Codex duplicate archive and unarchive state errors", async () => {
    const archiveScriptPath = join(tmpDir, "archive-idempotency-provider.cjs");
    writeArchiveProviderScript(archiveScriptPath, {
      archiveErrorMessage: "no rollout found for thread id provider-explicit",
      expectedProviderThreadId: "provider-explicit",
      threadId: "t-archive-idempotency",
      unarchiveErrorMessage:
        "no archived rollout found for thread id provider-explicit",
    });
    const runtime = createContractRuntime({
      scriptPath: archiveScriptPath,
      workspacePath: tmpDir,
    });

    await runtime.archiveThread({
      threadId: "t-archive-idempotency",
      providerId: "fake",
      providerThreadId: "provider-explicit",
    });
    await runtime.unarchiveThread({
      threadId: "t-archive-idempotency",
      providerId: "fake",
      providerThreadId: "provider-explicit",
    });
    await runtime.shutdown();
  });

  function createArchivedSessionRuntime(extraArgs: string[] = []) {
    return createAgentRuntimeWithAdapters({
      workspacePath: tmpDir,
      onEvent: () => {},
      onToolCall: async () => ({
        contentItems: [{ type: "inputText", text: "ok" }],
        success: true,
      }),
      adapterFactory: () => {
        const adapter = createFakeAdapter(scriptPath);
        return {
          ...adapter,
          id: "codex",
          process: {
            ...adapter.process,
            args: [...adapter.process.args, "--archived-session", ...extraArgs],
          },
        };
      },
    });
  }

  it("unarchives Codex sessions before retrying a turn", async () => {
    const runtime = createArchivedSessionRuntime();

    try {
      await runtime.startThread({
        environmentId: "env-1",
        projectId: "p1",
        providerId: "codex",
        threadId: "t-archived",
        options: fullRuntimeOptions,
      });
      await runtime.runTurn({
        clientRequestId: "creq_222222224u",
        input: [promptTextInput({ text: "continue" })],
        options: fullRuntimeOptions,
        threadId: "t-archived",
      });
    } finally {
      await runtime.shutdown();
    }
  });

  // The fake keys its archived set on the exact provider thread id it was
  // asked to unarchive, so a call that succeeds proves bb unarchived the
  // right session before it retried.
  it("unarchives Codex sessions before retrying a resume", async () => {
    const runtime = createArchivedSessionRuntime();

    try {
      await runtime.resumeThread({
        environmentId: "env-1",
        projectId: "p1",
        providerId: "codex",
        providerThreadId: "prov-archived-resume",
        threadId: "t-archived-resume",
        options: fullRuntimeOptions,
      });
    } finally {
      await runtime.shutdown();
    }
  });

  it("unarchives an archived Codex source session before retrying a fork", async () => {
    const runtime = createArchivedSessionRuntime();

    try {
      await runtime.startThread({
        environmentId: "env-1",
        fork: { sourceProviderThreadId: "prov-archived-source" },
        projectId: "p1",
        providerId: "codex",
        threadId: "t-archived-fork",
        options: fullRuntimeOptions,
      });
    } finally {
      await runtime.shutdown();
    }
  });

  it("reports the archived-session error when unarchiving fails", async () => {
    const runtime = createArchivedSessionRuntime(["--unarchive-fails"]);

    try {
      await expect(
        runtime.resumeThread({
          environmentId: "env-1",
          projectId: "p1",
          providerId: "codex",
          providerThreadId: "prov-unarchive-fails",
          threadId: "t-unarchive-fails",
          options: fullRuntimeOptions,
        }),
      ).rejects.toThrow(/is archived/);
    } finally {
      await runtime.shutdown();
    }
  });

  // A provider that dies while bb recovers cannot be unarchived or retried.
  // The caller must still get the archived-session error, because it names the
  // session and the CLI command that fixes it. A process-level error such as
  // `Provider "codex" has exited` tells the user nothing actionable.
  it("keeps the archived-session error when the provider exits mid-recovery", async () => {
    const runtime = createArchivedSessionRuntime(["--exit-after-archived"]);

    try {
      await expect(
        runtime.resumeThread({
          environmentId: "env-1",
          projectId: "p1",
          providerId: "codex",
          providerThreadId: "prov-exit-recovery",
          threadId: "t-exit-recovery",
          options: fullRuntimeOptions,
        }),
      ).rejects.toThrow(/session prov-exit-recovery is archived/);
    } finally {
      await runtime.shutdown();
    }
  });

  it("rejects turn steer when providerThreadId cannot be resolved", async () => {
    const events: ThreadEvent[] = [];
    const activeTurnScriptPath = join(tmpDir, "active-turn-provider.cjs");
    writeFileSync(
      activeTurnScriptPath,
      `
const readline = require("node:readline");

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\\n");
}

let turnStartedInterval = null;
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    send({ jsonrpc: "2.0", id: message.id, result: {} });
    turnStartedInterval = setInterval(() => {
      send({
        jsonrpc: "2.0",
        method: "turn/started",
        params: { threadId: "${missingProviderThreadId}", turnId: "turn-1" },
      });
    }, 10);
    return;
  }

  send({ jsonrpc: "2.0", id: message.id, result: {} });
});
process.on("SIGTERM", () => {
  if (turnStartedInterval) {
    clearInterval(turnStartedInterval);
  }
  process.exit(0);
});
`,
      "utf8",
    );
    const runtime = createContractRuntime({
      onEvent: (event) => events.push(event),
      scriptPath: activeTurnScriptPath,
      workspacePath: tmpDir,
    });

    await registerThreadWithoutProviderThreadId(runtime);
    await waitForRuntimeThreadEvent({
      events,
      label: "synthetic active turn without provider identity",
      predicate: (event) =>
        event.type === "turn/started" &&
        event.threadId === missingProviderThreadId,
      runtime,
      threadId: missingProviderThreadId,
      timeoutMs: 1000,
    });
    await expect(
      runtime.steerTurn({
        clientRequestId: "creq_222222224u",
        threadId: missingProviderThreadId,
        expectedTurnId: "turn-1",
        input: [promptTextInput({ text: "steer" })],
        options: fullRuntimeOptions,
      }),
    ).rejects.toThrow(missingProviderThreadIdError);
    await runtime.shutdown();
  });

  it("rejects unsupported execution options before they reach adapters", async () => {
    const runtime = createAgentRuntimeWithAdapters({
      workspacePath: tmpDir,
      onEvent: () => {},
      onToolCall: async () => ({
        contentItems: [{ type: "inputText", text: "ok" }],
        success: true,
      }),
      adapterFactory: () => createFakeAdapter(scriptPath),
    });

    await expect(
      runtime.startThread({
        environmentId: "env-1",
        threadId: "t1",
        projectId: "p1",
        providerId: "fake",
        options: {
          ...fullRuntimeOptions,
          serviceTier: "fast",
        },
      }),
    ).rejects.toThrow(/does not support service tiers/);
    await runtime.shutdown();
  });

  it("rejects no-op stop commands for active turns but allows explicit idle no-ops", async () => {
    const events: ThreadEvent[] = [];
    const baseAdapter = createFakeAdapter(scriptPath);
    const runtime = createAgentRuntimeWithAdapters({
      workspacePath: tmpDir,
      onEvent: (event) => events.push(event),
      onToolCall: async () => ({
        contentItems: [{ type: "inputText", text: "ok" }],
        success: true,
      }),
      adapterFactory: () => ({
        ...baseAdapter,
        buildCommandPlan(command) {
          if (command.type === "thread/stop") {
            return { kind: "noop", reason: "no active turn to stop" };
          }
          return baseAdapter.buildCommandPlan(command);
        },
      }),
    });

    const startResult = await runtime.startThread({
      environmentId: "env-1",
      threadId: "t1",
      projectId: "p1",
      providerId: "fake",
      options: fullRuntimeOptions,
    });
    await expect(runtime.stopThread({ threadId: "t1" })).resolves.toEqual({
      providerCheckpointId: null,
    });

    // Even a no-op stop removes the thread from the runtime, so the follow-up
    // turn resumes the provider session first.
    expect(runtime.hasThread("t1")).toBe(false);
    await runtime.resumeThread({
      environmentId: "env-1",
      threadId: "t1",
      projectId: "p1",
      providerThreadId: startResult.providerThreadId,
      providerId: "fake",
      options: fullRuntimeOptions,
    });
    await runtime.runTurn({
      clientRequestId: "creq_222222224v",
      threadId: "t1",
      input: [promptTextInput({ text: "delay:500" })],
      options: fullRuntimeOptions,
    });
    await waitForThreadTurnStarted({
      events,
      providerId: "fake",
      runtime,
      threadId: "t1",
      turnId: "turn-1",
    });
    await expect(runtime.stopThread({ threadId: "t1" })).rejects.toThrow(
      /returned no provider request for thread\/stop with active turn/,
    );

    await runtime.shutdown();
  });
});
