import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  createBridgeJsonRpcTestHarness,
  type BridgeJsonRpcOutputMessage,
  type BridgeJsonRpcTestHarness,
} from "../testing/bridge-json-rpc-test-helpers.js";

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock(
  "../../../../plugins/provider-claude-code/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs",
  () => ({
    query: (args: {
      options: { forkSession?: boolean; persistSession?: boolean };
    }) =>
      args.options.forkSession && args.options.persistSession === false
        ? {
            initializationResult: async () => ({}),
            getContextUsage: async () => null,
            close: () => {},
          }
        : queryMock(args),
    forkSession: vi.fn(),
    createSdkMcpServer: vi.fn(() => ({})),
    tool: vi.fn((_name, _description, _schema, handler) => handler),
  }),
);

const checkout = resolve(
  fileURLToPath(new URL("../../../..", import.meta.url)),
);

const CASES = [
  {
    id: "unshowable-request",
    userAnswered: false,
    what: "the agent asks something bb cannot show",
  },
  {
    id: "runtime-error",
    userAnswered: false,
    what: "bb stops waiting and the runtime answers the question with an error",
  },
  {
    id: "unreadable-resolution",
    userAnswered: false,
    what: "the runtime returns a resolution the bridge cannot read",
  },
  {
    id: "unmappable-answer",
    userAnswered: false,
    what: "the answer does not fit the agent's question",
  },
  {
    id: "user-stop",
    userAnswered: true,
    what: "the user stops the turn while the question is open",
  },
] as const;

type CaseId = (typeof CASES)[number]["id"];

type ProviderAnswer =
  | { kind: "error"; message: string }
  | { kind: "answer"; value: unknown };

interface Observation {
  answer: ProviderAnswer;
  warnings: string[];
}

type Driver = () => Promise<Observation>;
type Surface = Record<CaseId, Driver | { unreachable: string }>;

function problemsWith(
  scenario: (typeof CASES)[number],
  observation: Observation,
): string[] {
  if (scenario.userAnswered) {
    return observation.warnings.length === 0
      ? []
      : [
          `warned after the user's own answer: ${observation.warnings.join(" | ")}`,
        ];
  }
  if (observation.answer.kind === "error" || observation.warnings.length > 0) {
    return [];
  }
  return [
    `answered the agent with ${JSON.stringify(observation.answer.value)} as if the user had, with no warning and no error`,
  ];
}

function describeSurface(name: string, surface: Surface): void {
  describe(`unanswered interactions: ${name}`, () => {
    it.sequential.each(CASES)(
      "$id: $what",
      async (scenario) => {
        const driver = surface[scenario.id];
        if (typeof driver !== "function") {
          expect(driver.unreachable).not.toBe("");
          return;
        }
        expect(problemsWith(scenario, await driver())).toEqual([]);
      },
      60_000,
    );
  });
}

const deltaParamsSchema = z.object({
  threadId: z.string(),
  deltas: z.array(z.record(z.string(), z.unknown())),
});

function warningsFor(
  messages: readonly BridgeJsonRpcOutputMessage[],
  threadId: string,
): string[] {
  return messages
    .filter((message) => message.method === "thread/delta")
    .map((message) => deltaParamsSchema.parse(message.params))
    .filter((params) => params.threadId === threadId)
    .flatMap((params) => params.deltas)
    .filter((delta) => delta.kind === "provider.warning")
    .map((delta) => `${String(delta.summary)}: ${String(delta.details)}`);
}

function isInteractionRequest(message: BridgeJsonRpcOutputMessage): boolean {
  return message.method === "interaction/request" && message.id !== undefined;
}

async function waitUntil<T>(
  read: () => T | undefined,
  what: string,
  harness: BridgeJsonRpcTestHarness,
): Promise<T> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const value = read();
    if (value !== undefined) return value;
    await harness.flushWork();
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  throw new Error(
    `timed out waiting for ${what}: ${JSON.stringify(harness.messages.slice(-10))}`,
  );
}

async function waitForInteractionRequest(
  harness: BridgeJsonRpcTestHarness,
): Promise<BridgeJsonRpcOutputMessage> {
  return waitUntil(
    () => harness.messages.find(isInteractionRequest),
    "the forwarded interaction/request",
    harness,
  );
}

function answerRuntimeRequest(
  handleLine: (line: string) => void,
  request: BridgeJsonRpcOutputMessage,
  reply: { result: unknown } | { error: { code: number; message: string } },
): void {
  handleLine(JSON.stringify({ jsonrpc: "2.0", id: request.id, ...reply }));
}

const RUNTIME_ERROR = {
  error: { code: -32000, message: "The server closed the question" },
};
const UNREADABLE_RESULT = { result: { kind: "not-a-resolution" } };
const handleLineModuleSchema = z.object({
  handleLine: z.function({ input: [z.string()], output: z.void() }),
});

async function loadHandleLine(path: string) {
  const module: unknown = await import(
    pathToFileURL(join(checkout, path)).href
  );
  return handleLineModuleSchema.parse(module).handleLine;
}

async function removeWorkspace(path: string): Promise<void> {
  await rm(path, {
    recursive: true,
    force: true,
    maxRetries: 20,
    retryDelay: 100,
  });
}

function readJsonLines(path: string): Record<string, unknown>[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => z.record(z.string(), z.unknown()).parse(JSON.parse(line)));
}

const FULL_OPTIONS = {
  permissionMode: "full",
  permissionScope: "full",
  approvalReviewer: null,
  permissionEscalation: null,
} as const;

const ACCEPT_EDITS_OPTIONS = {
  permissionMode: "accept-edits",
  permissionScope: "workspace",
  approvalReviewer: "user",
  permissionEscalation: "ask",
} as const;

type AcpAsk =
  | { kind: "elicitation"; prompt: string }
  | { kind: "permission"; prompt: string };

type AcpReply =
  | { kind: "runtime"; reply: Parameters<typeof answerRuntimeRequest>[2] }
  | { kind: "stop" }
  | { kind: "none" };

async function runAcp(ask: AcpAsk, reply: AcpReply): Promise<Observation> {
  const handleLine = await loadHandleLine(
    "packages/provider-bridge-acp/src/bridge/bridge.ts",
  );
  const workspaceDir = mkdtempSync(join(tmpdir(), "bb-unanswered-acp-"));
  const requestLog = join(workspaceDir, "requests.log");
  const harness = createBridgeJsonRpcTestHarness(handleLine);
  const threadId = `thr_unanswered_acp_${Date.now()}`;
  const options =
    ask.kind === "permission" ? ACCEPT_EDITS_OPTIONS : FULL_OPTIONS;
  const providerOptions = {
    acpLaunchSpec: {
      displayName: "Fake ACP",
      command: process.execPath,
      args: [
        join(
          checkout,
          "packages/provider-bridge-acp/src/bridge/fake-acp-agent.mjs",
        ),
      ],
      env: { FAKE_ACP_REQUEST_LOG: requestLog },
    },
  };
  let providerThreadId = "";
  try {
    harness.sendRequest(1, "thread/start", {
      threadId,
      cwd: workspaceDir,
      instructionMode: "append",
      options: { ...options, providerOptions },
    });
    providerThreadId = z
      .object({ providerThreadId: z.string() })
      .parse((await harness.waitForResponse(1)).result).providerThreadId;
    harness.sendRequest(2, "turn/start", {
      threadId,
      providerThreadId,
      clientRequestId: "creq_abcdefghjk",
      options: { ...options, providerOptions },
      input: [{ type: "text", text: ask.prompt, mentions: [] }],
    });
    await harness.waitForResponse(2);
    if (reply.kind !== "none") {
      const request = await waitForInteractionRequest(harness);
      if (reply.kind === "stop") {
        harness.sendRequest(3, "thread/stop", {
          threadId,
          providerThreadId,
          intent: "interrupt",
          activeTurnId: null,
        });
        await harness.waitForResponse(3);
        answerRuntimeRequest(handleLine, request, {
          error: { code: -32000, message: "Thread stopped by user request" },
        });
      } else {
        answerRuntimeRequest(handleLine, request, reply.reply);
      }
    }
    const key =
      ask.kind === "elicitation" ? "elicitationResult" : "permissionResult";
    const result = await waitUntil(
      () => readJsonLines(requestLog).find((line) => key in line)?.[key],
      `the agent's ${key}`,
      harness,
    );
    await harness.flushWork();
    const answer: ProviderAnswer =
      ask.kind === "elicitation"
        ? z.object({ error: z.string() }).safeParse(result).success
          ? { kind: "error", message: JSON.stringify(result) }
          : { kind: "answer", value: result }
        : result === "error"
          ? { kind: "error", message: "permission request failed" }
          : { kind: "answer", value: result };
    return { answer, warnings: warningsFor(harness.messages, threadId) };
  } finally {
    if (providerThreadId !== "") {
      harness.sendRequest(99, "thread/stop", {
        threadId,
        providerThreadId,
        intent: "interrupt",
        activeTurnId: null,
      });
      await harness.waitForResponse(99).catch(() => undefined);
    }
    harness.restore();
    await removeWorkspace(workspaceDir);
  }
}

describeSurface("ACP form questions", {
  "unshowable-request": () =>
    runAcp(
      { kind: "elicitation", prompt: "ask-form-too-large" },
      {
        kind: "none",
      },
    ),
  "runtime-error": () =>
    runAcp(
      { kind: "elicitation", prompt: "ask-form" },
      {
        kind: "runtime",
        reply: RUNTIME_ERROR,
      },
    ),
  "unreadable-resolution": () =>
    runAcp(
      { kind: "elicitation", prompt: "ask-form" },
      {
        kind: "runtime",
        reply: UNREADABLE_RESULT,
      },
    ),
  "unmappable-answer": () =>
    runAcp(
      { kind: "elicitation", prompt: "ask-form" },
      {
        kind: "runtime",
        reply: {
          result: {
            kind: "user_answer",
            answers: {
              strategy: { selected: ["reckless"] },
              dryRun: { selected: ["true"] },
            },
          },
        },
      },
    ),
  "user-stop": () =>
    runAcp({ kind: "elicitation", prompt: "ask-form" }, { kind: "stop" }),
});

describeSurface("ACP permission requests", {
  "unshowable-request": {
    unreachable:
      "bb shows every well-formed ACP permission request; malformed ones get a JSON-RPC error before any answer",
  },
  "runtime-error": () =>
    runAcp(
      { kind: "permission", prompt: "request-permission" },
      {
        kind: "runtime",
        reply: RUNTIME_ERROR,
      },
    ),
  "unreadable-resolution": () =>
    runAcp(
      { kind: "permission", prompt: "request-permission" },
      {
        kind: "runtime",
        reply: UNREADABLE_RESULT,
      },
    ),
  "unmappable-answer": () =>
    runAcp(
      { kind: "permission", prompt: "request-permission-reject-only" },
      {
        kind: "runtime",
        reply: { result: { decision: "allow_once", grantedPermissions: null } },
      },
    ),
  "user-stop": () =>
    runAcp(
      { kind: "permission", prompt: "request-permission" },
      {
        kind: "stop",
      },
    ),
});

const piBridgeModuleSchema = z.object({
  handleLine: z.function({ input: [z.string()], output: z.void() }),
  experimental_closeAllForTests: z.function({
    input: [],
    output: z.promise(z.void()),
  }),
});

type PiReply =
  | { kind: "runtime"; reply: Parameters<typeof answerRuntimeRequest>[2] }
  | { kind: "stop" }
  | { kind: "none" };

async function runPi(dialog: object, reply: PiReply): Promise<Observation> {
  const module = piBridgeModuleSchema.parse(
    await import(
      pathToFileURL(join(checkout, "plugins/provider-pi/src/bridge/bridge.ts"))
        .href
    ),
  );
  const workspaceDir = mkdtempSync(join(tmpdir(), "bb-unanswered-pi-"));
  const uiLog = join(workspaceDir, "ui.log");
  vi.stubEnv("BB_PI_BRIDGE_COMMAND", process.execPath);
  vi.stubEnv(
    "BB_PI_BRIDGE_ARGS",
    JSON.stringify([
      join(checkout, "plugins/provider-pi/src/bridge/fake-pi-rpc.mjs"),
    ]),
  );
  vi.stubEnv("BB_PI_BRIDGE_SESSION_DIR", join(workspaceDir, "sessions"));
  vi.stubEnv("FAKE_PI_UI_LOG", uiLog);
  const harness = createBridgeJsonRpcTestHarness(module.handleLine);
  const threadId = `thr_unanswered_pi_${Date.now()}`;
  try {
    harness.sendRequest(1, "initialize", {
      protocolVersion: 2,
      client: { name: "test", version: "0" },
      grammarVersions: [3, 3],
    });
    await harness.waitForResponse(1);
    harness.sendRequest(2, "thread/start", {
      threadId,
      cwd: workspaceDir,
      instructionMode: "append",
      options: FULL_OPTIONS,
    });
    const providerThreadId = z
      .object({ providerThreadId: z.string() })
      .parse((await harness.waitForResponse(2)).result).providerThreadId;
    harness.sendRequest(3, "turn/start", {
      threadId,
      providerThreadId,
      clientRequestId: "creq_abcdefghjk",
      input: [
        { type: "text", text: `/ui ${JSON.stringify(dialog)}`, mentions: [] },
      ],
      options: FULL_OPTIONS,
    });
    if (reply.kind !== "none") {
      const request = await waitForInteractionRequest(harness);
      if (reply.kind === "stop") {
        harness.sendRequest(4, "thread/stop", {
          threadId,
          providerThreadId,
          intent: "interrupt",
          activeTurnId: null,
        });
        await harness.waitForResponse(4);
        answerRuntimeRequest(module.handleLine, request, {
          error: { code: -32000, message: "Thread stopped by user request" },
        });
      } else {
        answerRuntimeRequest(module.handleLine, request, reply.reply);
      }
    }
    const response = await waitUntil(
      () => readJsonLines(uiLog).at(-1),
      "the extension_ui_response Pi received",
      harness,
    );
    await harness.flushWork();
    const { type: _type, id: _id, ...fields } = response;
    return {
      answer: { kind: "answer", value: fields },
      warnings: warningsFor(harness.messages, threadId),
    };
  } finally {
    await module.experimental_closeAllForTests();
    harness.restore();
    vi.unstubAllEnvs();
    await removeWorkspace(workspaceDir);
  }
}

const PI_SELECT = { method: "select", title: "Pick", options: ["A", "B"] };

describeSurface("Pi extension dialogs", {
  "unshowable-request": () =>
    runPi(
      { method: "select", title: "x".repeat(9_000), options: ["A", "B"] },
      { kind: "none" },
    ),
  "runtime-error": () =>
    runPi(PI_SELECT, { kind: "runtime", reply: RUNTIME_ERROR }),
  "unreadable-resolution": () =>
    runPi(PI_SELECT, { kind: "runtime", reply: UNREADABLE_RESULT }),
  "unmappable-answer": () =>
    runPi(PI_SELECT, {
      kind: "runtime",
      reply: { result: { kind: "request_answer", value: "not-an-option" } },
    }),
  "user-stop": () => runPi(PI_SELECT, { kind: "stop" }),
});

const CODEX_FORM_ELICITATION = {
  method: "mcpServer/elicitation/request",
  id: 0,
  params: {
    threadId: "form-native-thread",
    turnId: null,
    serverName: "deployment-survey",
    mode: "form",
    message: "Configure the deployment",
    requestedSchema: {
      type: "object",
      properties: {
        retries: { type: "integer", title: "Retries", minimum: 1, maximum: 5 },
      },
      required: ["retries"],
    },
  },
};

const codexNativeResponseSchema = z.union([
  z.object({ result: z.unknown() }),
  z.object({ error: z.object({ message: z.string() }) }),
]);

type CodexReply =
  | { kind: "runtime"; reply: Parameters<typeof answerRuntimeRequest>[2] }
  | { kind: "stop" }
  | { kind: "none" };

async function runCodex(
  request: object,
  reply: CodexReply,
): Promise<Observation> {
  const handleLine = await loadHandleLine(
    "plugins/provider-codex/src/bridge/bridge.ts",
  );
  const workspaceDir = mkdtempSync(join(tmpdir(), "bb-unanswered-codex-"));
  const scriptPath = join(workspaceDir, "script.json");
  const responseLog = join(workspaceDir, "responses.jsonl");
  writeFileSync(
    scriptPath,
    JSON.stringify({
      responseLogPath: responseLog,
      turns: [[{ kind: "request", ...request }]],
    }),
  );
  vi.stubEnv("BB_CODEX_BRIDGE_APP_SERVER_COMMAND", process.execPath);
  vi.stubEnv(
    "BB_CODEX_BRIDGE_APP_SERVER_ARGS",
    JSON.stringify([
      join(
        checkout,
        "plugins/provider-codex/src/bridge/fake-codex-app-server.mjs",
      ),
      scriptPath,
    ]),
  );
  const harness = createBridgeJsonRpcTestHarness(handleLine);
  const threadId = `thr_unanswered_codex_${Date.now()}`;
  let providerThreadId = "";
  try {
    harness.sendRequest(1, "thread/start", {
      threadId,
      cwd: workspaceDir,
      instructionMode: "append",
      options: FULL_OPTIONS,
    });
    providerThreadId = z
      .object({ providerThreadId: z.string() })
      .parse((await harness.waitForResponse(1)).result).providerThreadId;
    harness.sendRequest(2, "turn/start", {
      threadId,
      providerThreadId,
      input: [{ type: "text", text: "ask", mentions: [] }],
      clientRequestId: "creq_23456789ab",
      options: FULL_OPTIONS,
    });
    if (reply.kind !== "none") {
      const forwarded = await waitForInteractionRequest(harness);
      if (reply.kind === "stop") {
        harness.sendRequest(3, "thread/stop", {
          threadId,
          providerThreadId,
          intent: "interrupt",
          activeTurnId: null,
        });
        await harness.waitForResponse(3);
        answerRuntimeRequest(handleLine, forwarded, {
          error: { code: -32000, message: "Thread stopped by user request" },
        });
      } else {
        answerRuntimeRequest(handleLine, forwarded, reply.reply);
      }
    }
    if (reply.kind === "stop") {
      await waitUntil(
        () => (harness.hasResponse(2) ? true : undefined),
        "the stopped turn to settle",
        harness,
      );
      await harness.flushWork();
      return {
        answer: {
          kind: "answer",
          value: readJsonLines(responseLog).at(-1) ?? "nothing",
        },
        warnings: warningsFor(harness.messages, threadId),
      };
    }
    const native = await waitUntil(
      () => readJsonLines(responseLog).at(-1),
      "the response Codex received",
      harness,
    );
    await harness.flushWork();
    const parsed = codexNativeResponseSchema.parse(native);
    return {
      answer:
        "error" in parsed
          ? { kind: "error", message: parsed.error.message }
          : { kind: "answer", value: parsed.result },
      warnings: warningsFor(harness.messages, threadId),
    };
  } finally {
    if (providerThreadId !== "") {
      harness.sendRequest(99, "thread/stop", {
        threadId,
        providerThreadId,
        intent: "release",
        activeTurnId: null,
      });
      await harness.waitForResponse(99).catch(() => undefined);
    }
    harness.restore();
    vi.unstubAllEnvs();
    await removeWorkspace(workspaceDir);
  }
}

describeSurface("Codex MCP elicitations", {
  "unshowable-request": () =>
    runCodex(
      {
        method: CODEX_FORM_ELICITATION.method,
        id: 0,
        params: { threadId: "form-native-thread", turnId: null },
      },
      { kind: "none" },
    ),
  "runtime-error": () =>
    runCodex(CODEX_FORM_ELICITATION, { kind: "runtime", reply: RUNTIME_ERROR }),
  "unreadable-resolution": () =>
    runCodex(CODEX_FORM_ELICITATION, {
      kind: "runtime",
      reply: UNREADABLE_RESULT,
    }),
  "unmappable-answer": () =>
    runCodex(CODEX_FORM_ELICITATION, {
      kind: "runtime",
      reply: {
        result: {
          kind: "request_answer",
          value: { action: "accept", content: { retries: 99 } },
        },
      },
    }),
  "user-stop": () => runCodex(CODEX_FORM_ELICITATION, { kind: "stop" }),
});

const claudeCanUseToolSchema = z.object({
  options: z.object({
    canUseTool: z.function({
      input: [z.string(), z.unknown(), z.unknown()],
      output: z.promise(z.unknown()),
    }),
  }),
});

const claudePermissionResultSchema = z.union([
  z.object({ behavior: z.literal("deny"), message: z.string() }),
  z.object({ behavior: z.literal("allow") }).passthrough(),
]);

function controlledClaudeQuery() {
  let finish: (() => void) | undefined;
  return {
    applyFlagSettings: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(() => finish?.()),
    getContextUsage: vi.fn().mockResolvedValue(null),
    initializationResult: vi
      .fn()
      .mockResolvedValue({ account: {}, models: [] }),
    interrupt: vi.fn().mockResolvedValue(undefined),
    setModel: vi.fn().mockResolvedValue(undefined),
    setPermissionMode: vi.fn().mockResolvedValue(undefined),
    [Symbol.asyncIterator]() {
      return {
        next: () =>
          new Promise<IteratorResult<unknown>>((resolveNext) => {
            finish = () => resolveNext({ value: undefined, done: true });
          }),
        return: async () => ({ value: undefined, done: true }),
      };
    },
  };
}

type ClaudeReply =
  | { kind: "runtime"; reply: Parameters<typeof answerRuntimeRequest>[2] }
  | { kind: "stop" }
  | { kind: "none" };

async function runClaude(
  input: unknown,
  reply: ClaudeReply,
): Promise<Observation> {
  const handleLine = await loadHandleLine(
    "plugins/provider-claude-code/src/bridge/bridge.ts",
  );
  const harness = createBridgeJsonRpcTestHarness(handleLine);
  const threadId = `thr_unanswered_claude_${Date.now()}`;
  const queries: ReturnType<typeof controlledClaudeQuery>[] = [];
  queryMock.mockImplementation(() => {
    const query = controlledClaudeQuery();
    queries.push(query);
    return query;
  });
  const abort = new AbortController();
  try {
    harness.sendRequest(1, "thread/start", {
      threadId,
      cwd: "/tmp/worktree",
      instructionMode: "append",
      options: FULL_OPTIONS,
    });
    await harness.waitForResponse(1);
    const { canUseTool } = claudeCanUseToolSchema.parse(
      queryMock.mock.calls.at(-1)?.[0],
    ).options;
    const resultPromise = canUseTool("AskUserQuestion", input, {
      requestId: "control-request",
      signal: abort.signal,
      toolUseID: "tool-question",
    });
    if (reply.kind !== "none") {
      const request = await waitForInteractionRequest(harness);
      if (reply.kind === "stop") {
        abort.abort();
        answerRuntimeRequest(handleLine, request, {
          error: { code: -32000, message: "Thread stopped by user request" },
        });
      } else {
        answerRuntimeRequest(handleLine, request, reply.reply);
      }
    }
    const result = claudePermissionResultSchema.parse(await resultPromise);
    await harness.flushWork();
    return {
      answer:
        result.behavior === "deny"
          ? { kind: "error", message: result.message }
          : { kind: "answer", value: result },
      warnings: warningsFor(harness.messages, threadId),
    };
  } finally {
    harness.sendRequest(99, "thread/stop", {
      threadId,
      providerThreadId: threadId,
      intent: "interrupt",
      activeTurnId: null,
    });
    await harness.flushWork();
    queries[0]?.close();
    await harness.waitForResponse(99).catch(() => undefined);
    harness.restore();
    queryMock.mockReset();
  }
}

const CLAUDE_QUESTION = {
  questions: [
    {
      question: "Which deployment target should I use?",
      header: "Target",
      options: [
        { label: "Staging", description: "Deploy to staging." },
        { label: "Production", description: "Deploy to production." },
      ],
      multiSelect: false,
    },
  ],
};

describeSurface("Claude Code questions", {
  "unshowable-request": () =>
    runClaude({ questions: "not a list" }, { kind: "none" }),
  "runtime-error": () =>
    runClaude(CLAUDE_QUESTION, { kind: "runtime", reply: RUNTIME_ERROR }),
  "unreadable-resolution": () =>
    runClaude(CLAUDE_QUESTION, { kind: "runtime", reply: UNREADABLE_RESULT }),
  "unmappable-answer": () =>
    runClaude(CLAUDE_QUESTION, {
      kind: "runtime",
      reply: {
        result: {
          kind: "user_answer",
          answers: { "an-unknown-question": { selected: ["Staging"] } },
        },
      },
    }),
  "user-stop": () => runClaude(CLAUDE_QUESTION, { kind: "stop" }),
});
