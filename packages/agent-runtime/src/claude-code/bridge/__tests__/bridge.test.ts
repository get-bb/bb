import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CanUseTool,
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
  DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG,
  type JsonValue,
  type PermissionEscalation,
} from "@bb/domain";

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: queryMock,
  createSdkMcpServer: vi.fn(() => ({})),
  tool: vi.fn((_name, _desc, _schema, handler) => handler),
}));

import { buildSessionOptions, handleLine } from "../bridge.js";
import {
  CLAUDE_USER_QUESTION_REQUEST_METHOD,
  type ClaudePermissionMode,
  type ClaudeUserQuestionInput,
} from "../../interactive-contract.js";
import { listClaudeCodeBridgeModels } from "../model-list.js";
import {
  createBridgeJsonRpcTestHarness,
  type BridgeJsonRpcOutputMessage,
} from "../../../test/bridge-json-rpc-test-helpers.js";

type BridgeSessionOptions = ReturnType<typeof buildSessionOptions>;
type BridgeSessionHooks = NonNullable<BridgeSessionOptions["hooks"]>;
type BridgePreToolUseHooks = NonNullable<BridgeSessionHooks["PreToolUse"]>;
type BridgePreToolUseHook = BridgePreToolUseHooks[number]["hooks"][number];
type BridgeJsonRpcTestHarness = ReturnType<
  typeof createBridgeJsonRpcTestHarness
>;
type SdkResultUsage = Extract<SDKMessage, { type: "result" }>["usage"];

interface ReadonlyBashHookArgs {
  command: string;
  hook: BridgePreToolUseHook;
}

interface AllowedReadonlyBashCase {
  command: string;
  expectedCommand: string;
}

interface DeniedReadonlyBashCase {
  command: string;
}

interface CanUseToolPolicyAllowExpectation {
  behavior: "allow";
  updatedInput: Record<string, unknown>;
}

interface CanUseToolPolicyDenyExpectation {
  behavior: "deny";
  messageIncludes: string;
}

type CanUseToolPolicyExpectation =
  | CanUseToolPolicyAllowExpectation
  | CanUseToolPolicyDenyExpectation;

interface CanUseToolPolicyCase {
  blockedPath?: string;
  decisionReason?: string;
  expected: CanUseToolPolicyExpectation;
  id: string;
  input: Record<string, unknown>;
  name: string;
  permissionEscalation: PermissionEscalation | null;
  permissionMode: ClaudePermissionMode;
  toolName: string;
}

interface ControlledClaudeQuery {
  close: ReturnType<typeof vi.fn>;
  emit(message: SDKMessage): void;
  fail(error: Error): void;
  finish(): void;
  initializationResult: ReturnType<typeof vi.fn>;
  [Symbol.asyncIterator](): AsyncIterator<SDKMessage>;
}

interface ClaudeQueryCallOptions {
  canUseTool?: CanUseTool;
  env?: Record<string, string | undefined>;
  resume?: string;
  sessionId?: string;
  settingSources?: string[];
  stderr?: (data: string) => void;
}

interface ClaudeQueryCall {
  options: ClaudeQueryCallOptions;
  prompt: AsyncIterable<SDKUserMessage>;
}

interface StaleResumeErrorMessageArgs {
  missingSessionId: string;
  sessionId: string;
}

interface TempClaudeExecutable {
  binDir: string;
  executablePath: string;
}

interface ControlledClaudeQueryMessageResult {
  result: IteratorResult<SDKMessage>;
  type: "result";
}

interface ControlledClaudeQueryErrorResult {
  error: Error;
  type: "error";
}

type ControlledClaudeQueryResult =
  | ControlledClaudeQueryMessageResult
  | ControlledClaudeQueryErrorResult;

const tempDirs: string[] = [];

interface StartBridgeThreadArgs {
  bridge: BridgeJsonRpcTestHarness;
  threadId: string;
}

interface ResumeBridgeThreadArgs {
  bridge: BridgeJsonRpcTestHarness;
  providerThreadId: string | null;
  requestId: number;
  threadId: string;
}

interface StopBridgeThreadArgs {
  bridge: BridgeJsonRpcTestHarness;
  queries: ControlledClaudeQuery[];
  threadId: string;
}

interface ForwardAskUserQuestionArgs {
  bridge: BridgeJsonRpcTestHarness;
  input?: ClaudeUserQuestionInput;
  toolUseID: string;
}

interface ForwardedAskUserQuestion {
  questionRequest: BridgeJsonRpcOutputMessage;
  resultPromise: ReturnType<CanUseTool>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isClaudeQueryCall(value: unknown): value is ClaudeQueryCall {
  if (!isRecord(value) || !isRecord(value.options)) {
    return false;
  }
  const { prompt } = value;
  if (
    prompt === null ||
    typeof prompt !== "object" ||
    !(Symbol.asyncIterator in prompt)
  ) {
    return false;
  }
  return (
    value.options.canUseTool === undefined ||
    typeof value.options.canUseTool === "function"
  );
}

function getProviderThreadIdFromResult(
  message: BridgeJsonRpcOutputMessage,
): string {
  if (
    !isRecord(message.result) ||
    typeof message.result.providerThreadId !== "string"
  ) {
    throw new Error("Expected response result with providerThreadId");
  }
  return message.result.providerThreadId;
}

function getLatestQueryOptions(): ClaudeQueryCallOptions {
  return getLatestQueryCall().options;
}

function getLatestQueryCall(): ClaudeQueryCall {
  const latestCall = queryMock.mock.calls.at(-1)?.[0];
  if (!isClaudeQueryCall(latestCall)) {
    throw new Error("Expected Claude SDK query options");
  }
  return latestCall;
}

function bridgeSdkMessageHasResultErrorText(
  output: BridgeJsonRpcOutputMessage,
  expectedErrorText: string,
): boolean {
  if (output.method !== "sdk/message" || !isRecord(output.params)) {
    return false;
  }
  const { message } = output.params;
  if (
    !isRecord(message) ||
    message.type !== "result" ||
    message.is_error !== true
  ) {
    return false;
  }
  if (message.result === expectedErrorText) {
    return true;
  }
  const { errors } = message;
  return (
    Array.isArray(errors) &&
    errors.length === 1 &&
    errors[0] === expectedErrorText
  );
}

function getSdkResultErrorMessages(
  messages: BridgeJsonRpcOutputMessage[],
  expectedErrorText: string,
): BridgeJsonRpcOutputMessage[] {
  return messages.filter((message) =>
    bridgeSdkMessageHasResultErrorText(message, expectedErrorText),
  );
}

function getBridgeErrorMessages(
  messages: BridgeJsonRpcOutputMessage[],
): string[] {
  return messages.flatMap((message) => {
    if (message.method !== "error" || !isRecord(message.params)) {
      return [];
    }
    return typeof message.params.message === "string"
      ? [message.params.message]
      : [];
  });
}

function getLastCanUseTool(): CanUseTool {
  const latestCall = queryMock.mock.calls.at(-1)?.[0];
  if (!isClaudeQueryCall(latestCall) || !latestCall.options.canUseTool) {
    throw new Error("Expected Claude SDK query to receive canUseTool");
  }
  return latestCall.options.canUseTool;
}

function invokeReadonlyBashHook(args: ReadonlyBashHookArgs) {
  return args.hook(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: {
        command: args.command,
        description: "Permission boundary test",
      },
      tool_use_id: "tool-1",
      session_id: "session-1",
      transcript_path: "/tmp/transcript.jsonl",
      cwd: "/tmp/worktree",
    },
    "tool-1",
    { signal: new AbortController().signal },
  );
}

function createControlledClaudeQuery(): ControlledClaudeQuery {
  let finishNext: ((result: IteratorResult<SDKMessage>) => void) | undefined;
  let failNext: ((error: Error) => void) | undefined;
  const pendingResults: ControlledClaudeQueryResult[] = [];
  function pushResult(result: IteratorResult<SDKMessage>): void {
    if (finishNext) {
      const resolve = finishNext;
      finishNext = undefined;
      failNext = undefined;
      resolve(result);
      return;
    }
    pendingResults.push({ type: "result", result });
  }
  function pushError(error: Error): void {
    if (failNext) {
      const reject = failNext;
      finishNext = undefined;
      failNext = undefined;
      reject(error);
      return;
    }
    pendingResults.push({ type: "error", error });
  }
  const iterator: AsyncIterator<SDKMessage> = {
    next: () => {
      const pending = pendingResults.shift();
      if (pending?.type === "result") return Promise.resolve(pending.result);
      if (pending?.type === "error") return Promise.reject(pending.error);
      return new Promise<IteratorResult<SDKMessage>>((resolve, reject) => {
        finishNext = resolve;
        failNext = reject;
      });
    },
    return: async () => {
      finishNext = undefined;
      failNext = undefined;
      return { value: undefined, done: true };
    },
  };
  return {
    close: vi.fn(() => {
      pushResult({ value: undefined, done: true });
    }),
    emit(message: SDKMessage): void {
      pushResult({ value: message, done: false });
    },
    fail(error: Error): void {
      pushError(error);
    },
    finish() {
      pushResult({ value: undefined, done: true });
    },
    initializationResult: vi.fn(),
    [Symbol.asyncIterator]() {
      return iterator;
    },
  };
}

async function readNextPromptText(call: ClaudeQueryCall): Promise<string> {
  const result = await call.prompt[Symbol.asyncIterator]().next();
  if (result.done) {
    throw new Error("Expected Claude prompt input");
  }
  const content = result.value.message.content;
  if (typeof content !== "string") {
    throw new Error("Expected Claude prompt text content");
  }
  return content;
}

function createResultUsage(): SdkResultUsage {
  return {
    cache_creation: {
      ephemeral_1h_input_tokens: 0,
      ephemeral_5m_input_tokens: 0,
    },
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    inference_geo: "",
    input_tokens: 0,
    iterations: [],
    output_tokens: 0,
    server_tool_use: {
      web_fetch_requests: 0,
      web_search_requests: 0,
    },
    service_tier: "standard",
    speed: "standard",
  };
}

function createStaleResumeErrorMessage(
  args: StaleResumeErrorMessageArgs,
): SDKMessage {
  return {
    type: "result",
    subtype: "error_during_execution",
    duration_ms: 0,
    duration_api_ms: 0,
    is_error: true,
    num_turns: 0,
    stop_reason: null,
    total_cost_usd: 0,
    usage: createResultUsage(),
    modelUsage: {},
    permission_denials: [],
    errors: [`No conversation found with session ID: ${args.missingSessionId}`],
    uuid: "00000000-0000-4000-8000-000000000001",
    session_id: args.sessionId,
  };
}

function createTempClaudeExecutable(): TempClaudeExecutable {
  const binDir = mkdtempSync(join(tmpdir(), "bb-claude-path-"));
  tempDirs.push(binDir);
  const executablePath = join(binDir, "claude");
  writeFileSync(executablePath, "#!/bin/sh\nexit 0\n");
  chmodSync(executablePath, 0o755);
  return { binDir, executablePath };
}

function createBridgeUserQuestionInput(): ClaudeUserQuestionInput {
  return {
    questions: [
      {
        question: "Which deployment target should I use?",
        header: "Target",
        options: [
          {
            label: "Staging",
            description: "Deploy to staging.",
          },
          {
            label: "Production",
            description: "Deploy to production.",
          },
        ],
        multiSelect: false,
      },
    ],
  };
}

async function startBridgeThread(args: StartBridgeThreadArgs): Promise<void> {
  args.bridge.sendRequest(1, "thread/start", {
    workflowsEnabled: false,
    claudeCodeMockCliTraffic: DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG,
    baseInstructions: "test",
    cwd: "/tmp/worktree",
    instructionMode: "append",
    permissionEscalation: "ask",
    permissionMode: "default",
    threadId: args.threadId,
  });
  await args.bridge.waitForResponse(1);
}

function sendResumeThread(args: ResumeBridgeThreadArgs): void {
  args.bridge.sendRequest(args.requestId, "thread/resume", {
    workflowsEnabled: false,
    claudeCodeMockCliTraffic: DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG,
    baseInstructions: "test",
    cwd: "/tmp/worktree",
    instructionMode: "append",
    permissionEscalation: "ask",
    permissionMode: "default",
    providerThreadId: args.providerThreadId,
    threadId: args.threadId,
  });
}

async function stopBridgeThread(args: StopBridgeThreadArgs): Promise<void> {
  args.bridge.sendRequest(2, "thread/stop", {
    threadId: args.threadId,
  });
  await args.bridge.flushWork();
  args.queries[0]?.finish();
  await args.bridge.waitForResponse(2);
}

async function forwardAskUserQuestion({
  bridge,
  input = createBridgeUserQuestionInput(),
  toolUseID,
}: ForwardAskUserQuestionArgs): Promise<ForwardedAskUserQuestion> {
  const canUseTool = getLastCanUseTool();
  const resultPromise = canUseTool("AskUserQuestion", input, {
    signal: new AbortController().signal,
    toolUseID,
  });
  await bridge.flushWork();

  const questionRequest = bridge.messages.find(
    (message) => message.method === CLAUDE_USER_QUESTION_REQUEST_METHOD,
  );
  if (questionRequest?.id === undefined) {
    throw new Error("Expected AskUserQuestion JSON-RPC request id");
  }
  return {
    questionRequest,
    resultPromise,
  };
}

describe("bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryMock.mockReturnValue({
      initializationResult: vi.fn().mockResolvedValue({
        account: {},
        models: [
          {
            value: "default",
            displayName: "Default (recommended)",
            description:
              "Opus 4.8 with 1M context [NEW] · Most capable for complex work",
            supportsEffort: true,
            supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
          },
          {
            value: "claude-haiku-4-5",
            displayName: "Haiku",
            description: "Haiku 4.5",
          },
          {
            value: "claude-sonnet-4-6",
            displayName: "Sonnet",
            description: "Sonnet 4.6 · Best for everyday tasks",
            supportsEffort: true,
            supportedEffortLevels: ["low", "medium", "high"],
          },
          {
            value: "claude-sonnet-4-6[1m]",
            displayName: "Sonnet (1M context)",
            description: "Sonnet 4.6 with 1M context · Billed as extra usage",
            supportsEffort: true,
            supportedEffortLevels: ["low", "medium", "high"],
          },
        ],
      }),
      close: vi.fn(),
    });
  });

  afterEach(() => {
    for (const tempDir of tempDirs.splice(0)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("keeps manager sessions on a plain string system prompt", () => {
    const options = buildSessionOptions(
      {
        workflowsEnabled: false,
        baseInstructions: "You are a manager.",
        cwd: "/tmp/worktree",
        disallowedTools: ["ExitPlanMode", "NotebookEdit", "Task"],
        instructionMode: "replace",
        permissionEscalation: "ask",
        permissionMode: "default",
      },
      {},
    );

    expect(options.tools).toBeUndefined();
    expect(options.cwd).toBe("/tmp/worktree");
    expect(options.disallowedTools).toEqual([
      "ExitPlanMode",
      "NotebookEdit",
      "Task",
    ]);
    expect(options.systemPrompt).toBe("You are a manager.");
  });

  it("decomposes ultracode into xhigh effort plus the ultracode settings flag", () => {
    const options = buildSessionOptions(
      {
        baseInstructions: "You are a coder.",
        cwd: "/tmp/worktree",
        instructionMode: "append",
        reasoningLevel: "ultracode",
        workflowsEnabled: true,
        permissionEscalation: "ask",
        permissionMode: "default",
      },
      {},
    );

    expect(options.effort).toBe("xhigh");
    expect(options.settings).toEqual({
      enableWorkflows: true,
      ultracode: true,
    });
  });

  it("enables workflows without the ultracode flag at lower efforts", () => {
    const options = buildSessionOptions(
      {
        baseInstructions: "You are a coder.",
        cwd: "/tmp/worktree",
        instructionMode: "append",
        reasoningLevel: "high",
        workflowsEnabled: true,
        permissionEscalation: "ask",
        permissionMode: "default",
      },
      {},
    );

    expect(options.effort).toBe("high");
    expect(options.settings).toEqual({ enableWorkflows: true });
  });

  it("passes no flag settings when workflows are not enabled", () => {
    const options = buildSessionOptions(
      {
        workflowsEnabled: false,
        baseInstructions: "You are a coder.",
        cwd: "/tmp/worktree",
        instructionMode: "append",
        reasoningLevel: "xhigh",
        permissionEscalation: "ask",
        permissionMode: "default",
      },
      {},
    );

    expect(options.settings).toBeUndefined();
  });

  it("leaves standard sessions on the default Claude tool preset", () => {
    const options = buildSessionOptions(
      {
        workflowsEnabled: false,
        baseInstructions: "You are a coder.",
        cwd: "/tmp/worktree",
        instructionMode: "append",
        reasoningLevel: "xhigh",
        permissionEscalation: "ask",
        permissionMode: "default",
      },
      {},
    );

    expect(options.tools).toBeUndefined();
    expect(options.cwd).toBe("/tmp/worktree");
    expect(options.systemPrompt).toEqual({
      type: "preset",
      preset: "claude_code",
      append: "You are a coder.",
    });
    expect(options.effort).toBe("xhigh");
    expect(options.thinking).toEqual({
      type: "adaptive",
      display: "summarized",
    });
  });

  it("passes Claude local plugins through to the session", () => {
    const options = buildSessionOptions(
      {
        workflowsEnabled: false,
        baseInstructions: "You are a coder.",
        cwd: "/tmp/worktree",
        instructionMode: "append",
        permissionEscalation: "ask",
        permissionMode: "default",
        plugins: [{ type: "local", path: "/tmp/bb-skills" }],
      },
      {},
    );

    expect(options.plugins).toEqual([
      { type: "local", path: "/tmp/bb-skills" },
    ]);
    expect(options).not.toHaveProperty("skills");
  });

  it("passes the resolved Claude permission mode through to the session", () => {
    const options = buildSessionOptions(
      {
        workflowsEnabled: false,
        baseInstructions: "You are a coder.",
        cwd: "/tmp/worktree",
        instructionMode: "append",
        permissionEscalation: "deny",
        permissionMode: "dontAsk",
      },
      {},
    );

    expect(options.permissionMode).toBe("dontAsk");
  });

  it("uses a Claude executable discovered from PATH for SDK sessions", () => {
    const { binDir, executablePath } = createTempClaudeExecutable();
    const options = buildSessionOptions(
      {
        workflowsEnabled: false,
        baseInstructions: "You are a coder.",
        cwd: "/tmp/worktree",
        instructionMode: "append",
        permissionEscalation: "ask",
        permissionMode: "default",
      },
      { PATH: binDir },
    );

    expect(options.pathToClaudeCodeExecutable).toBe(executablePath);
  });

  it("lets an explicit Claude executable override PATH discovery", () => {
    const { executablePath } = createTempClaudeExecutable();
    const options = buildSessionOptions(
      {
        workflowsEnabled: false,
        baseInstructions: "You are a coder.",
        cwd: "/tmp/worktree",
        instructionMode: "append",
        permissionEscalation: "ask",
        permissionMode: "default",
      },
      {
        BB_CLAUDE_CODE_EXECUTABLE: executablePath,
        PATH: "/usr/bin",
      },
    );

    expect(options.pathToClaudeCodeExecutable).toBe(executablePath);
  });

  it("trims explicit Claude executable overrides before forwarding", () => {
    const { executablePath } = createTempClaudeExecutable();
    const options = buildSessionOptions(
      {
        workflowsEnabled: false,
        baseInstructions: "You are a coder.",
        cwd: "/tmp/worktree",
        instructionMode: "append",
        permissionEscalation: "ask",
        permissionMode: "default",
      },
      {
        BB_CLAUDE_CODE_EXECUTABLE: `  ${executablePath}  `,
        PATH: "/usr/bin",
      },
    );

    expect(options.pathToClaudeCodeExecutable).toBe(executablePath);
  });

  it("rejects explicit Claude executable overrides that are not executable", () => {
    const binDir = mkdtempSync(join(tmpdir(), "bb-claude-path-"));
    tempDirs.push(binDir);
    const executablePath = join(binDir, "claude");

    expect(() =>
      buildSessionOptions(
        {
          workflowsEnabled: false,
          baseInstructions: "You are a coder.",
          cwd: "/tmp/worktree",
          instructionMode: "append",
          permissionEscalation: "ask",
          permissionMode: "default",
        },
        {
          BB_CLAUDE_CODE_EXECUTABLE: executablePath,
          PATH: "/usr/bin",
        },
      ),
    ).toThrow("BB_CLAUDE_CODE_EXECUTABLE must point to an executable");
  });

  it("configures workspace-write sessions with Claude sandbox settings", () => {
    const askOptions = buildSessionOptions(
      {
        workflowsEnabled: false,
        baseInstructions: "You are a coder.",
        cwd: "/tmp/worktree",
        instructionMode: "append",
        permissionEscalation: "ask",
        permissionMode: "acceptEdits",
      },
      {},
    );
    const denyOptions = buildSessionOptions(
      {
        workflowsEnabled: false,
        baseInstructions: "You are a coder.",
        cwd: "/tmp/worktree",
        instructionMode: "append",
        permissionEscalation: "deny",
        permissionMode: "acceptEdits",
      },
      {},
    );

    expect(askOptions.sandbox).toEqual({
      enabled: true,
      autoAllowBashIfSandboxed: true,
      allowUnsandboxedCommands: true,
    });
    expect(denyOptions.sandbox).toEqual({
      enabled: true,
      autoAllowBashIfSandboxed: true,
      allowUnsandboxedCommands: false,
    });
  });

  it("configures workspace-write sessions with additional writable roots", () => {
    const options = buildSessionOptions(
      {
        workflowsEnabled: false,
        additionalWorkspaceWriteRoots: [
          "/repo/.git/worktrees/bb13",
          "/repo/.git/objects",
        ],
        baseInstructions: "You are a coder.",
        cwd: "/tmp/worktree",
        instructionMode: "append",
        permissionEscalation: "deny",
        permissionMode: "acceptEdits",
      },
      {},
    );

    expect(options.additionalDirectories).toEqual([
      "/repo/.git/worktrees/bb13",
      "/repo/.git/objects",
    ]);
    expect(options.sandbox).toEqual({
      enabled: true,
      autoAllowBashIfSandboxed: true,
      allowUnsandboxedCommands: false,
      filesystem: {
        allowWrite: ["/repo/.git/worktrees/bb13", "/repo/.git/objects"],
      },
    });
  });

  it("configures readonly sessions with PreToolUse policy hooks", async () => {
    const askOptions = buildSessionOptions(
      {
        workflowsEnabled: false,
        baseInstructions: "You are a coder.",
        cwd: "/tmp/worktree",
        instructionMode: "append",
        permissionEscalation: "ask",
        permissionMode: "default",
      },
      {},
    );
    const denyOptions = buildSessionOptions(
      {
        workflowsEnabled: false,
        baseInstructions: "You are a coder.",
        cwd: "/tmp/worktree",
        instructionMode: "append",
        permissionEscalation: "deny",
        permissionMode: "dontAsk",
      },
      {},
    );

    const askHook = askOptions.hooks?.PreToolUse?.[0]?.hooks[0];
    if (!askHook) {
      throw new Error("Expected readonly ask PreToolUse hook");
    }
    const allowedReadonlyBashCases = [
      { command: "pwd", expectedCommand: "pwd" },
      { command: "pwd -P", expectedCommand: "pwd -P" },
      { command: "pwd -L", expectedCommand: "pwd -L" },
      {
        command: "git status --short",
        expectedCommand: "git --no-optional-locks status --short",
      },
      {
        command: "git --no-optional-locks status --short",
        expectedCommand: "git --no-optional-locks status --short",
      },
      {
        command: "git --no-pager status --short",
        expectedCommand: "git --no-optional-locks --no-pager status --short",
      },
      {
        command: "git diff --stat main...HEAD",
        expectedCommand:
          "git --no-optional-locks diff --no-ext-diff --no-textconv --stat main...HEAD",
      },
      {
        command: "git diff -U3 -- package.json",
        expectedCommand:
          "git --no-optional-locks diff --no-ext-diff --no-textconv -U3 -- package.json",
      },
      {
        command: "git diff -- file.txt",
        expectedCommand:
          "git --no-optional-locks diff --no-ext-diff --no-textconv -- file.txt",
      },
      {
        command: "git diff -- --no-ext-diff --no-textconv package.json",
        expectedCommand:
          "git --no-optional-locks diff --no-ext-diff --no-textconv -- --no-ext-diff --no-textconv package.json",
      },
      {
        command: "git show --stat --oneline -1 HEAD",
        expectedCommand:
          "git --no-optional-locks show --no-ext-diff --no-textconv --stat --oneline -1 HEAD",
      },
      {
        command: "git show HEAD -- --no-ext-diff --no-textconv package.json",
        expectedCommand:
          "git --no-optional-locks show --no-ext-diff --no-textconv HEAD -- --no-ext-diff --no-textconv package.json",
      },
      {
        command: "git merge-base main HEAD",
        expectedCommand: "git --no-optional-locks merge-base main HEAD",
      },
      {
        command: "git log --oneline --max-count=1",
        expectedCommand:
          "git --no-optional-locks log --no-ext-diff --no-textconv --oneline --max-count=1",
      },
      {
        command: "git log -- --no-ext-diff --no-textconv package.json",
        expectedCommand:
          "git --no-optional-locks log --no-ext-diff --no-textconv -- --no-ext-diff --no-textconv package.json",
      },
      {
        command: "git branch --show-current",
        expectedCommand: "git --no-optional-locks branch --show-current",
      },
      {
        command: "git branch --list bb/probe",
        expectedCommand: "git --no-optional-locks branch --list bb/probe",
      },
      {
        command: "git branch --merged main",
        expectedCommand: "git --no-optional-locks branch --merged main",
      },
      {
        command: "git ls-files --modified -- package.json",
        expectedCommand:
          "git --no-optional-locks ls-files --modified -- package.json",
      },
      {
        command: "git rev-parse --show-toplevel",
        expectedCommand: "git --no-optional-locks rev-parse --show-toplevel",
      },
      {
        command: "git grep -n TODO -- package.json",
        expectedCommand: "git --no-optional-locks grep -n TODO -- package.json",
      },
      {
        command: "git blame -L1,5 package.json",
        expectedCommand: "git --no-optional-locks blame -L1,5 package.json",
      },
    ] satisfies AllowedReadonlyBashCase[];
    for (const testCase of allowedReadonlyBashCases) {
      await expect(
        invokeReadonlyBashHook({
          command: testCase.command,
          hook: askHook,
        }),
      ).resolves.toMatchObject({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          updatedInput: {
            command: testCase.expectedCommand,
            description: "Permission boundary test",
          },
        },
      });
    }

    const deniedReadonlyBashCases = [
      { command: "git add package.json" },
      { command: "git reset -- package.json" },
      { command: "git commit -m probe" },
      { command: "git checkout main" },
      { command: "git switch main" },
      { command: "git restore package.json" },
      { command: "git clean -fd" },
      { command: "git apply patch.diff" },
      { command: "git update-index --refresh" },
      { command: "git stash" },
      { command: "git fetch origin" },
      { command: "git pull" },
      { command: "git push" },
      { command: "git branch bb-probe" },
      { command: "git branch --merged main extra" },
      { command: "git -c core.pager=cat status --short" },
      { command: "git -C /tmp status" },
      { command: "git --git-dir=/tmp/repo status" },
      { command: "git diff -- ../etc/passwd" },
      { command: "git diff -- /etc/passwd" },
      { command: "git diff --textconv -- file.txt" },
      { command: "git show --ext-diff HEAD" },
      { command: "git grep -n TODO -- /etc/passwd" },
      { command: "git blame /etc/passwd" },
      { command: "GIT_DIR=/tmp/repo git status" },
      { command: "VAR=1 git diff --stat" },
      { command: "env FOO=bar git status" },
      { command: "git status --short; cat /tmp/secret" },
      { command: "git status --short && cat /tmp/secret" },
      { command: "git status --short | cat" },
      { command: "git status --short > /tmp/out" },
      { command: "git status --short $(cat /tmp/secret)" },
      { command: "git status --short `cat /tmp/secret`" },
      { command: "git blame --contents /tmp/secret package.json" },
      { command: "git blame --contents=/tmp/secret package.json" },
      { command: "git grep -f /tmp/pattern TODO" },
      { command: "git log --output=/tmp/log" },
      { command: "git show --output=/tmp/out HEAD" },
      { command: "pwd package.json" },
    ] satisfies DeniedReadonlyBashCase[];
    for (const testCase of deniedReadonlyBashCases) {
      await expect(
        invokeReadonlyBashHook({
          command: testCase.command,
          hook: askHook,
        }),
      ).resolves.toMatchObject({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "ask",
        },
      });
    }

    await expect(
      askHook(
        {
          hook_event_name: "PreToolUse",
          tool_name: "Agent",
          tool_input: {},
          tool_use_id: "tool-1",
          session_id: "session-1",
          transcript_path: "/tmp/transcript.jsonl",
          cwd: "/tmp/worktree",
        },
        "tool-1",
        { signal: new AbortController().signal },
      ),
    ).resolves.toEqual({ continue: true });

    const preToolUseHook = denyOptions.hooks?.PreToolUse?.[0]?.hooks[0];
    if (!preToolUseHook) {
      throw new Error("Expected readonly PreToolUse hook");
    }
    await expect(
      preToolUseHook(
        {
          hook_event_name: "PreToolUse",
          tool_name: "Bash",
          tool_input: {
            command: "git reset -- package.json",
          },
          tool_use_id: "tool-1",
          session_id: "session-1",
          transcript_path: "/tmp/transcript.jsonl",
          cwd: "/tmp/worktree",
        },
        "tool-1",
        { signal: new AbortController().signal },
      ),
    ).resolves.toMatchObject({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
      },
    });
  });

  describe("readonly Bash canUseTool policy", () => {
    const policyCases = [
      {
        id: "default-status-rewrite",
        name: "default readonly rewrites safe Git status",
        permissionMode: "default",
        permissionEscalation: "ask",
        toolName: "Bash",
        decisionReason: "This command requires approval",
        input: {
          command: "git status --short",
          description: "Permission boundary test",
        },
        expected: {
          behavior: "allow",
          updatedInput: {
            command: "git --no-optional-locks status --short",
            description: "Permission boundary test",
          },
        },
      },
      {
        id: "dontask-status-allow",
        name: "dontAsk readonly allows safe Git status",
        permissionMode: "dontAsk",
        permissionEscalation: "deny",
        toolName: "Bash",
        decisionReason: "This command requires approval",
        input: {
          command: "git --no-optional-locks status --short",
          description: "Permission boundary test",
        },
        expected: {
          behavior: "allow",
          updatedInput: {
            command: "git --no-optional-locks status --short",
            description: "Permission boundary test",
          },
        },
      },
      {
        id: "dontask-mutating-bash-deny",
        name: "dontAsk readonly denies mutating Bash",
        permissionMode: "dontAsk",
        permissionEscalation: "deny",
        toolName: "Bash",
        blockedPath: "/tmp/project/package.json",
        input: {
          command: "git add package.json",
          description: "Permission boundary test",
        },
        expected: {
          behavior: "deny",
          messageIncludes: "bb readonly mode allows reading and analysis only",
        },
      },
      {
        id: "dontask-read-deny",
        name: "dontAsk readonly does not auto-allow non-Bash tools",
        permissionMode: "dontAsk",
        permissionEscalation: "deny",
        toolName: "Read",
        blockedPath: "/tmp/project/package.json",
        input: { file_path: "/tmp/project/package.json" },
        expected: {
          behavior: "deny",
          messageIncludes: "bb readonly mode allows reading and analysis only",
        },
      },
      {
        id: "workspace-write-deny",
        name: "workspace-write does not use readonly Bash auto-allow",
        permissionMode: "acceptEdits",
        permissionEscalation: "deny",
        toolName: "Bash",
        blockedPath: "/tmp/project",
        input: {
          command: "git status --short",
          description: "Permission boundary test",
        },
        expected: {
          behavior: "deny",
          messageIncludes: "bb workspace-write mode allows work inside",
        },
      },
      {
        id: "full-bypass-allow",
        name: "full bypass does not rewrite via readonly Bash auto-allow",
        permissionMode: "bypassPermissions",
        permissionEscalation: null,
        toolName: "Bash",
        decisionReason: "This command requires approval",
        input: {
          command: "git status --short",
          description: "Permission boundary test",
        },
        expected: {
          behavior: "allow",
          updatedInput: {
            command: "git status --short",
            description: "Permission boundary test",
          },
        },
      },
    ] satisfies CanUseToolPolicyCase[];

    it.each(policyCases)("$name", async (testCase) => {
      const bridge = createBridgeJsonRpcTestHarness(handleLine);
      const queries: ControlledClaudeQuery[] = [];
      queryMock.mockImplementation(() => {
        const query = createControlledClaudeQuery();
        queries.push(query);
        return query;
      });

      try {
        const startRequestId = 1;
        const stopRequestId = startRequestId + 1;
        const threadId = `thread-readonly-bash-policy-${testCase.id}`;
        const toolUseID = `tool-readonly-policy-${testCase.id}`;
        bridge.sendRequest(startRequestId, "thread/start", {
          workflowsEnabled: false,
          claudeCodeMockCliTraffic: DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG,
          baseInstructions: "test",
          cwd: "/tmp/worktree",
          instructionMode: "append",
          permissionEscalation: testCase.permissionEscalation,
          permissionMode: testCase.permissionMode,
          threadId,
        });
        await bridge.waitForResponse(startRequestId);

        const canUseTool = getLastCanUseTool();
        const result = await canUseTool(testCase.toolName, testCase.input, {
          blockedPath: testCase.blockedPath,
          decisionReason: testCase.decisionReason,
          signal: new AbortController().signal,
          toolUseID,
        });

        switch (testCase.expected.behavior) {
          case "allow":
            expect(result).toMatchObject({
              behavior: "allow",
              toolUseID,
              updatedInput: testCase.expected.updatedInput,
            });
            expect("decisionClassification" in result).toBe(false);
            break;
          case "deny":
            if (result.behavior !== "deny") {
              throw new Error(`Expected ${testCase.name} to deny`);
            }
            expect(result.toolUseID).toBe(toolUseID);
            expect(result.message).toContain(testCase.expected.messageIncludes);
            break;
        }

        bridge.sendRequest(stopRequestId, "thread/stop", {
          threadId,
        });
        await bridge.flushWork();
        queries[0]?.finish();
        await bridge.waitForResponse(stopRequestId);
      } finally {
        bridge.restore();
      }
    });
  });

  it("forwards AskUserQuestion through canUseTool and returns the answer payload", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    const queries: ControlledClaudeQuery[] = [];
    queryMock.mockImplementation(() => {
      const query = createControlledClaudeQuery();
      queries.push(query);
      return query;
    });

    try {
      const threadId = "thread-ask-user-question";
      const toolUseID = "tool-question-1";
      const questionInput = createBridgeUserQuestionInput();
      const updatedInput = {
        questions: questionInput.questions,
        answers: {
          "Which deployment target should I use?": "Staging",
        },
      };

      await startBridgeThread({ bridge, threadId });
      const { questionRequest, resultPromise } = await forwardAskUserQuestion({
        bridge,
        input: questionInput,
        toolUseID,
      });

      expect(questionRequest).toMatchObject({
        method: CLAUDE_USER_QUESTION_REQUEST_METHOD,
        params: {
          threadId,
          itemId: toolUseID,
          questions: questionInput.questions,
        },
      });

      handleLine(
        JSON.stringify({
          jsonrpc: "2.0",
          id: questionRequest.id,
          result: {
            kind: "user_question",
            behavior: "allow",
            updatedInput,
          },
        }),
      );

      await expect(resultPromise).resolves.toMatchObject({
        behavior: "allow",
        toolUseID,
        updatedInput,
      });

      await stopBridgeThread({ bridge, queries, threadId });
    } finally {
      bridge.restore();
    }
  });

  it("denies invalid AskUserQuestion input before forwarding to bb", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    const queries: ControlledClaudeQuery[] = [];
    queryMock.mockImplementation(() => {
      const query = createControlledClaudeQuery();
      queries.push(query);
      return query;
    });

    try {
      const threadId = "thread-invalid-ask-user-question-input";
      await startBridgeThread({ bridge, threadId });

      const canUseTool = getLastCanUseTool();
      await expect(
        canUseTool(
          "AskUserQuestion",
          { questions: [] },
          {
            signal: new AbortController().signal,
            toolUseID: "tool-question-invalid-input",
          },
        ),
      ).resolves.toMatchObject({
        behavior: "deny",
        message: "Invalid AskUserQuestion input",
      });
      expect(
        bridge.messages.some(
          (message) => message.method === CLAUDE_USER_QUESTION_REQUEST_METHOD,
        ),
      ).toBe(false);

      await stopBridgeThread({ bridge, queries, threadId });
    } finally {
      bridge.restore();
    }
  });

  it("denies AskUserQuestion when bb returns an interactive request error", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    const queries: ControlledClaudeQuery[] = [];
    queryMock.mockImplementation(() => {
      const query = createControlledClaudeQuery();
      queries.push(query);
      return query;
    });

    try {
      const threadId = "thread-ask-user-question-error";
      const toolUseID = "tool-question-error";
      await startBridgeThread({ bridge, threadId });
      const { questionRequest, resultPromise } = await forwardAskUserQuestion({
        bridge,
        toolUseID,
      });

      handleLine(
        JSON.stringify({
          jsonrpc: "2.0",
          id: questionRequest.id,
          error: {
            code: -32000,
            message: "No interactive request handler is configured",
          },
        }),
      );

      await expect(resultPromise).resolves.toMatchObject({
        behavior: "deny",
        message: "No interactive request handler is configured",
        toolUseID,
      });

      await stopBridgeThread({ bridge, queries, threadId });
    } finally {
      bridge.restore();
    }
  });

  it("denies AskUserQuestion when bb returns an invalid response payload", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    const queries: ControlledClaudeQuery[] = [];
    queryMock.mockImplementation(() => {
      const query = createControlledClaudeQuery();
      queries.push(query);
      return query;
    });

    try {
      const threadId = "thread-ask-user-question-invalid-response";
      const toolUseID = "tool-question-invalid-response";
      await startBridgeThread({ bridge, threadId });
      const { questionRequest, resultPromise } = await forwardAskUserQuestion({
        bridge,
        toolUseID,
      });

      handleLine(
        JSON.stringify({
          jsonrpc: "2.0",
          id: questionRequest.id,
          result: {
            kind: "user_question",
            behavior: "allow",
            updatedInput: {
              questions: [],
              answers: {},
            },
          },
        }),
      );

      await expect(resultPromise).resolves.toMatchObject({
        behavior: "deny",
        message: "Invalid interactive response payload",
        toolUseID,
      });

      await stopBridgeThread({ bridge, queries, threadId });
    } finally {
      bridge.restore();
    }
  });

  it("denies AskUserQuestion when bb returns a mismatched response kind", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    const queries: ControlledClaudeQuery[] = [];
    queryMock.mockImplementation(() => {
      const query = createControlledClaudeQuery();
      queries.push(query);
      return query;
    });

    try {
      const threadId = "thread-ask-user-question-kind-mismatch";
      const toolUseID = "tool-question-kind-mismatch";
      await startBridgeThread({ bridge, threadId });
      const { questionRequest, resultPromise } = await forwardAskUserQuestion({
        bridge,
        toolUseID,
      });

      handleLine(
        JSON.stringify({
          jsonrpc: "2.0",
          id: questionRequest.id,
          result: {
            kind: "permission_request",
            behavior: "deny",
            message: "Denied",
          },
        }),
      );

      await expect(resultPromise).resolves.toMatchObject({
        behavior: "deny",
        message: "Interactive response kind mismatch",
        toolUseID,
      });

      await stopBridgeThread({ bridge, queries, threadId });
    } finally {
      bridge.restore();
    }
  });

  it("returns the bridge-owned Claude model list from the SDK probe", async () => {
    const { models, selectedOnlyModels } = await listClaudeCodeBridgeModels();
    expect(models).toEqual([
      expect.objectContaining({
        id: "claude-fable-5",
        model: "claude-fable-5",
        displayName: "Fable 5",
        isDefault: false,
      }),
      expect.objectContaining({
        id: "claude-mythos-5",
        model: "claude-mythos-5",
        displayName: "Mythos 5",
        isDefault: false,
      }),
      expect.objectContaining({
        id: "claude-opus-4-8[1m]",
        model: "claude-opus-4-8[1m]",
        displayName: "Opus 4.8 (1M)",
        isDefault: true,
      }),
      expect.objectContaining({
        id: "claude-opus-4-7[1m]",
        model: "claude-opus-4-7[1m]",
        displayName: "Opus 4.7 (1M)",
        isDefault: false,
      }),
      expect.objectContaining({
        id: "claude-sonnet-5",
        model: "claude-sonnet-5",
        displayName: "Sonnet 5",
        isDefault: false,
      }),
    ]);
    expect(selectedOnlyModels.map((model) => model.model)).toEqual([
      "claude-sonnet-4-6[1m]",
      "claude-sonnet-4-6",
      "claude-haiku-4-5",
      "claude-opus-4-8",
      "claude-opus-4-7",
      "claude-opus-4-6[1m]",
      "claude-opus-4-6",
      "best",
      "fable",
      "opus[1m]",
      "opus",
      "sonnet[1m]",
      "sonnet",
      "haiku",
    ]);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("exposes the host HOME and CLAUDE settings cascade to the Claude SDK on thread/start", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    const queries: ControlledClaudeQuery[] = [];
    queryMock.mockImplementation(() => {
      const query = createControlledClaudeQuery();
      queries.push(query);
      return query;
    });

    const originalHome = process.env.HOME;
    process.env.HOME = "/Users/test-bb";
    try {
      bridge.sendRequest(1, "thread/start", {
        workflowsEnabled: false,
        claudeCodeMockCliTraffic: DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG,
        baseInstructions: "test",
        cwd: "/tmp/worktree",
        instructionMode: "append",
        permissionEscalation: "ask",
        permissionMode: "default",
        threadId: "thread-home-config",
      });
      await bridge.waitForResponse(1);

      const queryOptions = getLatestQueryOptions();
      expect(queryOptions.env?.HOME).toBe("/Users/test-bb");
      // Sessions report as the Claude CLI entrypoint (renders `sdk-cli` on the
      // wire), with no `client-app/...` user-agent segment.
      expect(queryOptions.env?.CLAUDE_CODE_ENTRYPOINT).toBe("cli");
      expect(queryOptions.env?.CLAUDE_AGENT_SDK_CLIENT_APP).toBeUndefined();
      expect(queryOptions.settingSources).toEqual(["user", "project", "local"]);

      bridge.sendRequest(2, "thread/stop", {
        threadId: "thread-home-config",
      });
      await bridge.flushWork();
      queries[0]?.finish();
      await bridge.waitForResponse(2);
    } finally {
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
      bridge.restore();
    }
  });

  it("includes captured Claude stderr when the SDK stream fails", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    const queries: ControlledClaudeQuery[] = [];
    queryMock.mockImplementation(() => {
      const query = createControlledClaudeQuery();
      queries.push(query);
      return query;
    });

    try {
      const threadId = "thread-sdk-stderr-error";
      bridge.sendRequest(1, "thread/start", {
        workflowsEnabled: false,
        claudeCodeMockCliTraffic: DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG,
        baseInstructions: "test",
        cwd: "/tmp/worktree",
        instructionMode: "append",
        permissionEscalation: "ask",
        permissionMode: "default",
        threadId,
      });
      await bridge.waitForResponse(1);

      getLatestQueryOptions().stderr?.(
        "--dangerously-skip-permissions cannot be used with root/sudo privileges for security reasons\n",
      );
      queries[0]?.fail(new Error("Claude Code process exited with code 1"));
      await bridge.flushWork();

      const errorMessages = getBridgeErrorMessages(bridge.messages);
      expect(errorMessages).toHaveLength(1);
      expect(errorMessages[0]).toContain(
        "Claude Code process exited with code 1",
      );
      expect(errorMessages[0]).toContain("Claude Code stderr:");
      expect(errorMessages[0]).toContain(
        "cannot be used with root/sudo privileges",
      );

      bridge.sendRequest(2, "thread/stop", { threadId });
      await bridge.waitForResponse(2);
    } finally {
      bridge.restore();
    }
  });

  it("routes enabled mock CLI traffic through a loopback proxy", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    const queries: ControlledClaudeQuery[] = [];
    queryMock.mockImplementation(() => {
      const query = createControlledClaudeQuery();
      queries.push(query);
      return query;
    });

    try {
      bridge.sendRequest(1, "thread/start", {
        workflowsEnabled: false,
        claudeCodeMockCliTraffic: {
          enabled: true,
          endpoint: "http://127.0.0.1:18950",
        },
        baseInstructions: "test",
        cwd: "/tmp/worktree",
        instructionMode: "append",
        permissionEscalation: "ask",
        permissionMode: "default",
        threadId: "thread-mock-cli-traffic",
      });
      await bridge.waitForResponse(1);

      const queryOptions = getLatestQueryOptions();
      expect(queryOptions.env?.ANTHROPIC_BASE_URL).toMatch(
        /^http:\/\/127\.0\.0\.1:\d+$/u,
      );
      expect(queryOptions.env?.ANTHROPIC_BASE_URL).not.toBe(
        "http://127.0.0.1:18950",
      );
      expect(queryOptions.env?.NO_PROXY).toContain("127.0.0.1");
      expect(queryOptions.env?.NO_PROXY).toContain("localhost");
      expect(queryOptions.env?.no_proxy).toContain("127.0.0.1");
      expect(queryOptions.env?.no_proxy).toContain("localhost");

      bridge.sendRequest(2, "thread/stop", {
        threadId: "thread-mock-cli-traffic",
      });
      await bridge.flushWork();
      queries[0]?.finish();
      await bridge.waitForResponse(2);
    } finally {
      bridge.restore();
    }
  });

  it("passes thread/start max reasoningLevel through to Claude SDK effort and thinking display", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    const queries: ControlledClaudeQuery[] = [];
    queryMock.mockImplementation(() => {
      const query = createControlledClaudeQuery();
      queries.push(query);
      return query;
    });

    try {
      bridge.sendRequest(1, "thread/start", {
        workflowsEnabled: false,
        claudeCodeMockCliTraffic: DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG,
        baseInstructions: "test",
        cwd: "/tmp/worktree",
        instructionMode: "append",
        permissionEscalation: "ask",
        permissionMode: "default",
        reasoningLevel: "max",
        threadId: "thread-reasoning",
      });
      await bridge.waitForResponse(1);

      expect(queryMock).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            effort: "max",
            thinking: {
              type: "adaptive",
              display: "summarized",
            },
          }),
        }),
      );

      bridge.sendRequest(2, "thread/stop", {
        threadId: "thread-reasoning",
      });
      await bridge.flushWork();
      queries[0]?.finish();
      await bridge.waitForResponse(2);
    } finally {
      bridge.restore();
    }
  });

  it("passes thread/start additional workspace-write roots to Claude SDK options", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    const queries: ControlledClaudeQuery[] = [];
    queryMock.mockImplementation(() => {
      const query = createControlledClaudeQuery();
      queries.push(query);
      return query;
    });

    try {
      bridge.sendRequest(1, "thread/start", {
        workflowsEnabled: false,
        claudeCodeMockCliTraffic: DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG,
        additionalWorkspaceWriteRoots: [
          "/repo/.git/worktrees/bb13",
          "/repo/.git/objects",
        ],
        baseInstructions: "test",
        cwd: "/tmp/worktree",
        instructionMode: "append",
        permissionEscalation: "deny",
        permissionMode: "acceptEdits",
        threadId: "thread-roots",
      });
      await bridge.waitForResponse(1);

      expect(queryMock).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            additionalDirectories: [
              "/repo/.git/worktrees/bb13",
              "/repo/.git/objects",
            ],
            sandbox: expect.objectContaining({
              filesystem: {
                allowWrite: ["/repo/.git/worktrees/bb13", "/repo/.git/objects"],
              },
            }),
          }),
        }),
      );

      bridge.sendRequest(2, "thread/stop", {
        threadId: "thread-roots",
      });
      await bridge.flushWork();
      queries[0]?.finish();
      await bridge.waitForResponse(2);
    } finally {
      bridge.restore();
    }
  });

  it("passes thread/resume additional workspace-write roots to Claude SDK options", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    const queries: ControlledClaudeQuery[] = [];
    queryMock.mockImplementation(() => {
      const query = createControlledClaudeQuery();
      queries.push(query);
      return query;
    });

    try {
      bridge.sendRequest(1, "thread/resume", {
        workflowsEnabled: false,
        claudeCodeMockCliTraffic: DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG,
        additionalWorkspaceWriteRoots: [
          "/repo/.git/worktrees/bb13",
          "/repo/.git/objects",
        ],
        cwd: "/tmp/worktree",
        instructionMode: "append",
        permissionEscalation: "deny",
        permissionMode: "acceptEdits",
        providerThreadId: "provider-thread-roots",
        threadId: "thread-resume-roots",
      });
      await bridge.waitForResponse(1);

      expect(queryMock).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            additionalDirectories: [
              "/repo/.git/worktrees/bb13",
              "/repo/.git/objects",
            ],
            sandbox: expect.objectContaining({
              filesystem: {
                allowWrite: ["/repo/.git/worktrees/bb13", "/repo/.git/objects"],
              },
            }),
          }),
        }),
      );

      bridge.sendRequest(2, "thread/stop", {
        threadId: "thread-resume-roots",
      });
      await bridge.flushWork();
      queries[0]?.finish();
      await bridge.waitForResponse(2);
    } finally {
      bridge.restore();
    }
  });

  it("returns an existing live same-provider thread/resume session", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    const queries: ControlledClaudeQuery[] = [];
    queryMock.mockImplementation(() => {
      const query = createControlledClaudeQuery();
      queries.push(query);
      return query;
    });

    try {
      const threadId = "thread-resume-idempotent";
      const providerThreadId = "provider-thread-idempotent";
      sendResumeThread({
        bridge,
        providerThreadId,
        requestId: 1,
        threadId,
      });
      const firstResponse = await bridge.waitForResponse(1);

      expect(getProviderThreadIdFromResult(firstResponse)).toBe(
        providerThreadId,
      );
      expect(queryMock).toHaveBeenCalledTimes(1);
      expect(getLatestQueryOptions()).toMatchObject({
        resume: providerThreadId,
      });

      sendResumeThread({
        bridge,
        providerThreadId,
        requestId: 2,
        threadId,
      });
      const duplicateResponse = await bridge.waitForResponse(2);

      expect(getProviderThreadIdFromResult(duplicateResponse)).toBe(
        providerThreadId,
      );
      expect(queryMock).toHaveBeenCalledTimes(1);
      expect(queries).toHaveLength(1);
      expect(queries[0]?.close).not.toHaveBeenCalled();

      bridge.sendRequest(3, "thread/stop", { threadId });
      await bridge.flushWork();
      queries[0]?.finish();
      await bridge.waitForResponse(3);
    } finally {
      queries[0]?.finish();
      bridge.restore();
    }
  });

  it("replaces a live thread/resume session when the provider thread differs", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    const queries: ControlledClaudeQuery[] = [];
    queryMock.mockImplementation(() => {
      const query = createControlledClaudeQuery();
      queries.push(query);
      return query;
    });

    try {
      const threadId = "thread-resume-different-provider";
      const originalProviderThreadId = "provider-thread-original";
      const replacementProviderThreadId = "provider-thread-replacement";
      sendResumeThread({
        bridge,
        providerThreadId: originalProviderThreadId,
        requestId: 1,
        threadId,
      });
      await bridge.waitForResponse(1);

      sendResumeThread({
        bridge,
        providerThreadId: replacementProviderThreadId,
        requestId: 2,
        threadId,
      });
      const replacementResponse = await bridge.waitForResponse(2);

      expect(getProviderThreadIdFromResult(replacementResponse)).toBe(
        replacementProviderThreadId,
      );
      expect(queries).toHaveLength(2);
      expect(queries[0]?.close).toHaveBeenCalledTimes(1);
      expect(getLatestQueryOptions()).toMatchObject({
        resume: replacementProviderThreadId,
      });

      bridge.sendRequest(3, "thread/stop", { threadId });
      await bridge.flushWork();
      queries[1]?.finish();
      await bridge.waitForResponse(3);
    } finally {
      queries.forEach((query) => query.finish());
      bridge.restore();
    }
  });

  it("replaces a live thread/resume session when no provider thread is requested", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    const queries: ControlledClaudeQuery[] = [];
    queryMock.mockImplementation(() => {
      const query = createControlledClaudeQuery();
      queries.push(query);
      return query;
    });

    try {
      const threadId = "thread-resume-no-provider";
      sendResumeThread({
        bridge,
        providerThreadId: "provider-thread-original",
        requestId: 1,
        threadId,
      });
      await bridge.waitForResponse(1);

      sendResumeThread({
        bridge,
        providerThreadId: null,
        requestId: 2,
        threadId,
      });
      await expect(bridge.waitForResponse(2)).resolves.toMatchObject({
        result: { providerThreadId: null, threadId },
      });

      expect(queries).toHaveLength(2);
      expect(queries[0]?.close).toHaveBeenCalledTimes(1);
      expect(getLatestQueryOptions()).not.toHaveProperty("resume");

      bridge.sendRequest(3, "thread/stop", { threadId });
      await bridge.flushWork();
      queries[1]?.finish();
      await bridge.waitForResponse(3);
    } finally {
      queries.forEach((query) => query.finish());
      bridge.restore();
    }
  });

  it("replaces a stream-ended same-provider thread/resume session", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    const queries: ControlledClaudeQuery[] = [];
    queryMock.mockImplementation(() => {
      const query = createControlledClaudeQuery();
      queries.push(query);
      return query;
    });

    try {
      const threadId = "thread-resume-stream-ended";
      const providerThreadId = "provider-thread-stream-ended";
      sendResumeThread({
        bridge,
        providerThreadId,
        requestId: 1,
        threadId,
      });
      await bridge.waitForResponse(1);

      queries[0]?.finish();
      await bridge.flushWork();

      sendResumeThread({
        bridge,
        providerThreadId,
        requestId: 2,
        threadId,
      });
      const replacementResponse = await bridge.waitForResponse(2);

      expect(getProviderThreadIdFromResult(replacementResponse)).toBe(
        providerThreadId,
      );
      expect(queries).toHaveLength(2);
      expect(getLatestQueryOptions()).toMatchObject({
        resume: providerThreadId,
      });

      bridge.sendRequest(3, "thread/stop", { threadId });
      await bridge.flushWork();
      queries[1]?.finish();
      await bridge.waitForResponse(3);
    } finally {
      queries.forEach((query) => query.finish());
      bridge.restore();
    }
  });

  it("waits for a closing same-provider thread/resume session before replacing it", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    const queries: ControlledClaudeQuery[] = [];
    queryMock.mockImplementation(() => {
      const query = createControlledClaudeQuery();
      queries.push(query);
      return query;
    });

    try {
      const threadId = "thread-resume-closing";
      const providerThreadId = "provider-thread-closing";
      sendResumeThread({
        bridge,
        providerThreadId,
        requestId: 1,
        threadId,
      });
      await bridge.waitForResponse(1);

      bridge.sendRequest(2, "thread/stop", { threadId });
      await bridge.flushWork();
      sendResumeThread({
        bridge,
        providerThreadId,
        requestId: 3,
        threadId,
      });
      await bridge.flushWork();

      expect(bridge.hasResponse(3)).toBe(false);
      expect(queries).toHaveLength(1);

      queries[0]?.finish();
      await bridge.waitForResponse(2);
      const resumeResponse = await bridge.waitForResponse(3);

      expect(getProviderThreadIdFromResult(resumeResponse)).toBe(
        providerThreadId,
      );
      expect(queries).toHaveLength(2);
      expect(getLatestQueryOptions()).toMatchObject({
        resume: providerThreadId,
      });

      bridge.sendRequest(4, "thread/stop", { threadId });
      await bridge.flushWork();
      queries[1]?.finish();
      await bridge.waitForResponse(4);
    } finally {
      queries.forEach((query) => query.finish());
      bridge.restore();
    }
  });

  it("resumes a Claude session when follow-up arrives after an SDK stream error", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    const queries: ControlledClaudeQuery[] = [];
    queryMock.mockImplementation(() => {
      const query = createControlledClaudeQuery();
      queries.push(query);
      return query;
    });

    try {
      const threadId = "thread-sdk-error-follow-up";
      const inputText = "Continue after the provider error";
      bridge.sendRequest(1, "thread/start", {
        workflowsEnabled: false,
        claudeCodeMockCliTraffic: DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG,
        baseInstructions: "test",
        cwd: "/tmp/worktree",
        instructionMode: "append",
        permissionEscalation: "ask",
        permissionMode: "default",
        threadId,
      });
      const startResponse = await bridge.waitForResponse(1);
      const providerThreadId = getProviderThreadIdFromResult(startResponse);

      queries[0]?.fail(new Error("Claude SDK exploded"));
      await bridge.flushWork();

      expect(
        bridge.messages.some(
          (message) =>
            message.method === "error" &&
            isRecord(message.params) &&
            message.params.threadId === threadId &&
            message.params.message === "Claude SDK exploded",
        ),
      ).toBe(true);

      bridge.sendRequest(2, "turn/start", {
        input: [{ type: "text", text: inputText }],
        providerThreadId,
        threadId,
      });
      await bridge.waitForResponse(2);

      expect(queries).toHaveLength(2);
      expect(getLatestQueryOptions()).toMatchObject({
        resume: providerThreadId,
      });
      await expect(readNextPromptText(getLatestQueryCall())).resolves.toBe(
        inputText,
      );

      bridge.sendRequest(3, "thread/stop", {
        threadId,
      });
      await bridge.flushWork();
      queries[1]?.finish();
      await bridge.waitForResponse(3);
    } finally {
      bridge.restore();
    }
  });

  it("does not resume an ended Claude session for invalid follow-up input", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    const queries: ControlledClaudeQuery[] = [];
    queryMock.mockImplementation(() => {
      const query = createControlledClaudeQuery();
      queries.push(query);
      return query;
    });

    try {
      const threadId = "thread-sdk-error-invalid-follow-up";
      bridge.sendRequest(1, "thread/start", {
        workflowsEnabled: false,
        claudeCodeMockCliTraffic: DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG,
        baseInstructions: "test",
        cwd: "/tmp/worktree",
        instructionMode: "append",
        permissionEscalation: "ask",
        permissionMode: "default",
        threadId,
      });
      const startResponse = await bridge.waitForResponse(1);
      const providerThreadId = getProviderThreadIdFromResult(startResponse);

      queries[0]?.fail(new Error("Claude SDK exploded"));
      await bridge.flushWork();

      bridge.sendRequest(2, "turn/start", {
        input: [{ type: "text", text: "" }],
        providerThreadId,
        threadId,
      });
      const response = await bridge.waitForResponse(2);

      expect(response).toMatchObject({
        error: { code: -32602, message: "Missing input text" },
      });
      expect(queries).toHaveLength(1);

      bridge.sendRequest(3, "thread/stop", {
        threadId,
      });
      await bridge.waitForResponse(3);
    } finally {
      bridge.restore();
    }
  });

  it("queues grouped turn input as separate Claude SDK user messages", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    const queries: ControlledClaudeQuery[] = [];
    queryMock.mockImplementation(() => {
      const query = createControlledClaudeQuery();
      queries.push(query);
      return query;
    });

    try {
      const threadId = "thread-grouped-turn-input";
      bridge.sendRequest(1, "thread/start", {
        workflowsEnabled: false,
        claudeCodeMockCliTraffic: DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG,
        baseInstructions: "test",
        cwd: "/tmp/worktree",
        instructionMode: "append",
        permissionEscalation: "ask",
        permissionMode: "default",
        threadId,
      });
      const startResponse = await bridge.waitForResponse(1);
      const providerThreadId = getProviderThreadIdFromResult(startResponse);

      bridge.sendRequest(2, "turn/start", {
        input: [
          { type: "text", text: "First grouped input" },
          { type: "text", text: "\n\n" },
          { type: "text", text: "Second grouped input" },
        ],
        inputGroups: [
          [{ type: "text", text: "First grouped input" }],
          [{ type: "text", text: "Second grouped input" }],
        ],
        providerThreadId,
        threadId,
      });
      await bridge.flushWork();
      await expect(bridge.waitForResponse(2)).resolves.toMatchObject({
        result: { threadId },
      });

      const call = getLatestQueryCall();
      await expect(readNextPromptText(call)).resolves.toBe(
        "First grouped input",
      );
      await expect(readNextPromptText(call)).resolves.toBe(
        "Second grouped input",
      );

      bridge.sendRequest(3, "thread/stop", {
        threadId,
      });
      await bridge.flushWork();
      queries[0]?.finish();
      await bridge.waitForResponse(3);
    } finally {
      bridge.restore();
    }
  });

  it("acknowledges grouped turn input after queuing SDK user messages", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    const queries: ControlledClaudeQuery[] = [];
    queryMock.mockImplementation(() => {
      const query = createControlledClaudeQuery();
      queries.push(query);
      return query;
    });

    try {
      const threadId = "thread-grouped-turn-input-rejects-later-prompt";
      await startBridgeThread({ bridge, threadId });

      bridge.sendRequest(2, "turn/start", {
        input: [
          { type: "text", text: "First grouped input" },
          { type: "text", text: "\n\n" },
          { type: "text", text: "Second grouped input" },
        ],
        inputGroups: [
          [{ type: "text", text: "First grouped input" }],
          [{ type: "text", text: "Second grouped input" }],
        ],
        providerThreadId: null,
        threadId,
      });
      await bridge.flushWork();

      await expect(bridge.waitForResponse(2)).resolves.toMatchObject({
        result: { threadId },
      });
      await expect(readNextPromptText(getLatestQueryCall())).resolves.toBe(
        "First grouped input",
      );

      queries[0]?.finish();
      await bridge.flushWork();
      expect(
        bridge.messages.filter((message) => message.id === 2),
      ).toHaveLength(1);
    } finally {
      bridge.restore();
    }
  });

  it("forwards stale Claude resume errors without starting a fresh session", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    const queries: ControlledClaudeQuery[] = [];
    queryMock.mockImplementation(() => {
      const query = createControlledClaudeQuery();
      queries.push(query);
      return query;
    });

    try {
      const threadId = "thread-stale-resume-error";
      const staleProviderThreadId = "stale-provider-thread";
      const staleErrorText = `No conversation found with session ID: ${staleProviderThreadId}`;
      const inputText = "Reply READY";
      bridge.sendRequest(1, "thread/resume", {
        workflowsEnabled: false,
        claudeCodeMockCliTraffic: DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG,
        baseInstructions: "test",
        cwd: "/tmp/worktree",
        instructionMode: "append",
        permissionEscalation: "ask",
        permissionMode: "default",
        providerThreadId: staleProviderThreadId,
        threadId,
      });
      const resumeResponse = await bridge.waitForResponse(1);

      expect(getProviderThreadIdFromResult(resumeResponse)).toBe(
        staleProviderThreadId,
      );
      expect(getLatestQueryOptions()).toMatchObject({
        resume: staleProviderThreadId,
      });

      bridge.sendRequest(2, "turn/start", {
        input: [{ type: "text", text: inputText }],
        providerThreadId: staleProviderThreadId,
        threadId,
      });
      await bridge.waitForResponse(2);

      queries[0]?.emit(
        createStaleResumeErrorMessage({
          missingSessionId: staleProviderThreadId,
          sessionId: staleProviderThreadId,
        }),
      );
      await bridge.flushWork();

      expect(queries).toHaveLength(1);
      expect(
        getSdkResultErrorMessages(bridge.messages, staleErrorText),
      ).toHaveLength(1);
      expect(
        bridge.messages.some((message) => message.method === "error"),
      ).toBe(false);

      bridge.sendRequest(3, "thread/stop", {
        threadId,
      });
      await bridge.flushWork();
      queries[0]?.finish();
      await bridge.waitForResponse(3);
    } finally {
      bridge.restore();
    }
  });

  it("holds thread stop open until the Claude SDK stream closes", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    const queries: ControlledClaudeQuery[] = [];
    queryMock.mockImplementation(() => {
      const query = createControlledClaudeQuery();
      queries.push(query);
      return query;
    });

    try {
      bridge.sendRequest(1, "thread/start", {
        workflowsEnabled: false,
        claudeCodeMockCliTraffic: DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG,
        baseInstructions: "test",
        cwd: "/tmp/worktree",
        instructionMode: "append",
        permissionEscalation: "ask",
        permissionMode: "default",
        threadId: "thread-stop-waits",
      });
      await bridge.waitForResponse(1);

      bridge.sendRequest(2, "thread/stop", {
        threadId: "thread-stop-waits",
      });
      await bridge.flushWork();

      expect(bridge.hasResponse(2)).toBe(false);
      expect(queries).toHaveLength(1);
      expect(queries[0]?.close).not.toHaveBeenCalled();

      queries[0]?.finish();
      await expect(bridge.waitForResponse(2)).resolves.toMatchObject({
        id: 2,
        result: { ok: true },
      });
      expect(queries[0]?.close).not.toHaveBeenCalled();
    } finally {
      bridge.restore();
    }
  });

  it("waits for an in-flight close before replacing the same thread", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    const queries: ControlledClaudeQuery[] = [];
    queryMock.mockImplementation(() => {
      const query = createControlledClaudeQuery();
      queries.push(query);
      return query;
    });

    try {
      bridge.sendRequest(11, "thread/start", {
        workflowsEnabled: false,
        claudeCodeMockCliTraffic: DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG,
        baseInstructions: "test",
        cwd: "/tmp/worktree",
        instructionMode: "append",
        permissionEscalation: "ask",
        permissionMode: "default",
        threadId: "thread-overlap",
      });
      await bridge.waitForResponse(11);

      bridge.sendRequest(12, "thread/stop", {
        threadId: "thread-overlap",
      });
      await bridge.flushWork();
      bridge.sendRequest(13, "thread/start", {
        workflowsEnabled: false,
        claudeCodeMockCliTraffic: DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG,
        baseInstructions: "test",
        cwd: "/tmp/worktree",
        instructionMode: "append",
        permissionEscalation: "ask",
        permissionMode: "default",
        threadId: "thread-overlap",
      });
      await bridge.flushWork();

      expect(bridge.hasResponse(12)).toBe(false);
      expect(bridge.hasResponse(13)).toBe(false);
      expect(queries).toHaveLength(1);

      queries[0]?.finish();
      await expect(bridge.waitForResponse(12)).resolves.toMatchObject({
        id: 12,
        result: { ok: true },
      });
      await expect(bridge.waitForResponse(13)).resolves.toMatchObject({
        id: 13,
      });
      expect(queries).toHaveLength(2);

      bridge.sendRequest(14, "thread/stop", {
        threadId: "thread-overlap",
      });
      await bridge.flushWork();
      queries[1]?.finish();
      await bridge.waitForResponse(14);
    } finally {
      bridge.restore();
    }
  });

  it("delays turn steer responses until the SDK prompt consumes the input", async () => {
    const threadId = "thread-steer-consumed";
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    const queries: ControlledClaudeQuery[] = [];
    queryMock.mockImplementation(() => {
      const query = createControlledClaudeQuery();
      queries.push(query);
      return query;
    });

    try {
      await startBridgeThread({ bridge, threadId });

      bridge.sendRequest(2, "turn/steer", {
        expectedTurnId: "turn-1",
        input: [{ type: "text", text: "Please account for the restart" }],
        providerThreadId: null,
        threadId,
      });
      await bridge.flushWork();

      expect(bridge.hasResponse(2)).toBe(false);
      await expect(readNextPromptText(getLatestQueryCall())).resolves.toBe(
        "Please account for the restart",
      );
      await expect(bridge.waitForResponse(2)).resolves.toMatchObject({
        result: { threadId },
      });

      await stopBridgeThread({ bridge, queries, threadId });
    } finally {
      queries[0]?.finish();
      bridge.restore();
    }
  });

  it("acknowledges grouped turn steer input after queuing SDK user messages", async () => {
    const threadId = "thread-grouped-steer-queued";
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    const queries: ControlledClaudeQuery[] = [];
    queryMock.mockImplementation(() => {
      const query = createControlledClaudeQuery();
      queries.push(query);
      return query;
    });

    try {
      await startBridgeThread({ bridge, threadId });

      bridge.sendRequest(2, "turn/steer", {
        expectedTurnId: "turn-1",
        input: [
          { type: "text", text: "First grouped steer" },
          { type: "text", text: "\n\n" },
          { type: "text", text: "Second grouped steer" },
        ],
        inputGroups: [
          [{ type: "text", text: "First grouped steer" }],
          [{ type: "text", text: "Second grouped steer" }],
        ],
        providerThreadId: null,
        threadId,
      });
      await bridge.flushWork();

      await expect(bridge.waitForResponse(2)).resolves.toMatchObject({
        result: { threadId },
      });
      await expect(readNextPromptText(getLatestQueryCall())).resolves.toBe(
        "First grouped steer",
      );

      queries[0]?.finish();
      await bridge.flushWork();
      expect(
        bridge.messages.filter((message) => message.id === 2),
      ).toHaveLength(1);
    } finally {
      queries[0]?.finish();
      bridge.restore();
    }
  });

  describe("prompt attachment text markers", () => {
    async function sendTurnAndReadPrompt(
      bridge: BridgeJsonRpcTestHarness,
      queries: ControlledClaudeQuery[],
      threadId: string,
      input: JsonValue[],
    ): Promise<string> {
      await startBridgeThread({ bridge, threadId });
      bridge.sendRequest(2, "turn/start", {
        input,
        providerThreadId: null,
        threadId,
      });
      await bridge.waitForResponse(2);
      const text = await readNextPromptText(getLatestQueryCall());
      await stopBridgeThread({ bridge, queries, threadId });
      return text;
    }

    function withBridgeHarness(): {
      bridge: BridgeJsonRpcTestHarness;
      queries: ControlledClaudeQuery[];
    } {
      const bridge = createBridgeJsonRpcTestHarness(handleLine);
      const queries: ControlledClaudeQuery[] = [];
      queryMock.mockImplementation(() => {
        const query = createControlledClaudeQuery();
        queries.push(query);
        return query;
      });
      return { bridge, queries };
    }

    it("forwards a text-only prompt unchanged", async () => {
      const { bridge, queries } = withBridgeHarness();
      try {
        const text = await sendTurnAndReadPrompt(
          bridge,
          queries,
          "thread-marker-text",
          [{ type: "text", text: "Hello there" }],
        );
        expect(text).toBe("Hello there");
      } finally {
        bridge.restore();
      }
    });

    it("joins multiple text fragments with newlines", async () => {
      const { bridge, queries } = withBridgeHarness();
      try {
        const text = await sendTurnAndReadPrompt(
          bridge,
          queries,
          "thread-marker-text-multi",
          [
            { type: "text", text: "Line one" },
            { type: "text", text: "Line two" },
          ],
        );
        expect(text).toBe("Line one\nLine two");
      } finally {
        bridge.restore();
      }
    });

    it("emits a path-bearing marker for a localImage attachment", async () => {
      const { bridge, queries } = withBridgeHarness();
      try {
        const text = await sendTurnAndReadPrompt(
          bridge,
          queries,
          "thread-marker-local-image",
          [
            { type: "text", text: "Describe this" },
            {
              type: "localImage",
              path: "/staged/runtime-attachments/req-1/000-screenshot.png",
            },
          ],
        );
        expect(text).toBe(
          "Describe this\n[Attached image. It is on disk at /staged/runtime-attachments/req-1/000-screenshot.png — use the Read tool to view it.]",
        );
      } finally {
        bridge.restore();
      }
    });

    it("emits a name+mime+size marker for a localFile with full metadata", async () => {
      const { bridge, queries } = withBridgeHarness();
      try {
        const text = await sendTurnAndReadPrompt(
          bridge,
          queries,
          "thread-marker-local-file-full",
          [
            { type: "text", text: "Summarize this" },
            {
              type: "localFile",
              path: "/staged/runtime-attachments/req-2/000-report.pdf",
              name: "report.pdf",
              mimeType: "application/pdf",
              sizeBytes: 12345,
            },
          ],
        );
        expect(text).toBe(
          'Summarize this\n[Attached file "report.pdf" (application/pdf, 12345 bytes). It is on disk at /staged/runtime-attachments/req-2/000-report.pdf — use the Read tool to view it.]',
        );
      } finally {
        bridge.restore();
      }
    });

    it("omits missing fields from the localFile marker", async () => {
      const { bridge, queries } = withBridgeHarness();
      try {
        const text = await sendTurnAndReadPrompt(
          bridge,
          queries,
          "thread-marker-local-file-minimal",
          [
            {
              type: "localFile",
              path: "/staged/runtime-attachments/req-3/000-data.csv",
            },
          ],
        );
        expect(text).toBe(
          "[Attached file. It is on disk at /staged/runtime-attachments/req-3/000-data.csv — use the Read tool to view it.]",
        );
      } finally {
        bridge.restore();
      }
    });

    it("emits a URL marker for a remote image attachment", async () => {
      const { bridge, queries } = withBridgeHarness();
      try {
        const text = await sendTurnAndReadPrompt(
          bridge,
          queries,
          "thread-marker-image-url",
          [
            { type: "text", text: "Compare to:" },
            { type: "image", url: "https://example.com/cat.png" },
          ],
        );
        expect(text).toBe(
          "Compare to:\n[Attached image: https://example.com/cat.png]",
        );
      } finally {
        bridge.restore();
      }
    });

    it("accepts an attachment-only turn (no text fragments)", async () => {
      const { bridge, queries } = withBridgeHarness();
      try {
        const text = await sendTurnAndReadPrompt(
          bridge,
          queries,
          "thread-marker-attachment-only",
          [
            {
              type: "localImage",
              path: "/staged/runtime-attachments/req-4/000-only.png",
            },
          ],
        );
        expect(text).toBe(
          "[Attached image. It is on disk at /staged/runtime-attachments/req-4/000-only.png — use the Read tool to view it.]",
        );
      } finally {
        bridge.restore();
      }
    });
  });
});
