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
    turnStopped: false,
    what: "the agent asks something bb cannot show",
  },
  {
    id: "runtime-error",
    turnStopped: false,
    what: "bb stops waiting and the runtime answers the question with an error",
  },
  {
    id: "unreadable-resolution",
    turnStopped: false,
    what: "the runtime returns a resolution the bridge cannot read",
  },
  {
    id: "unmappable-answer",
    turnStopped: false,
    what: "the answer does not fit the agent's question",
  },
  {
    id: "withdrawn",
    turnStopped: false,
    what: "the bridge withdraws an open question",
  },
  {
    id: "turn-stopped",
    turnStopped: true,
    what: "the turn is stopped while the question is open",
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
  if (scenario.turnStopped) {
    return observation.warnings.length === 0
      ? []
      : [
          `warned after the turn was stopped: ${observation.warnings.join(" | ")}`,
        ];
  }
  return observation.warnings.length > 0
    ? []
    : [
        `answered the agent with ${JSON.stringify(observation.answer)} without the user and without a warning`,
      ];
}

function describeBridge(
  bridge: string,
  kinds: readonly string[],
  surfaces: Record<string, Surface>,
): void {
  describe(`unanswered interactions: ${bridge}`, () => {
    it("has a surface for every question kind the bridge routes", () => {
      expect(Object.keys(surfaces).sort()).toEqual([...kinds].sort());
    });
    for (const kind of kinds) {
      const surface = surfaces[kind];
      if (surface === undefined) continue;
      describe(kind, () => {
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

type ReplyBody =
  | { result: unknown }
  | { error: { code: number; message: string } };

type Reply =
  | {
      kind: "runtime";
      body: (request: BridgeJsonRpcOutputMessage) => ReplyBody;
    }
  | { kind: "stop" }
  | { kind: "new-prompt" }
  | { kind: "none" };

function answerRuntimeRequest(
  handleLine: (line: string) => void,
  request: BridgeJsonRpcOutputMessage,
  body: ReplyBody,
): void {
  handleLine(JSON.stringify({ jsonrpc: "2.0", id: request.id, ...body }));
}

const STOPPED_REPLY: ReplyBody = {
  error: { code: -32000, message: "Thread stopped by user request" },
};
const RUNTIME_ERROR: Reply = {
  kind: "runtime",
  body: () => ({
    error: { code: -32000, message: "The server closed the question" },
  }),
};
const UNREADABLE: Reply = {
  kind: "runtime",
  body: () => ({ result: { kind: "not-a-resolution" } }),
};
const STOP: Reply = { kind: "stop" };
const NONE: Reply = { kind: "none" };

function runtimeResult(result: unknown): Reply {
  return { kind: "runtime", body: () => ({ result }) };
}

const handleLineModuleSchema = z.object({
  handleLine: z.function({ input: [z.string()], output: z.void() }),
});

async function importModule(path: string): Promise<unknown> {
  return import(pathToFileURL(join(checkout, path)).href);
}

async function loadHandleLine(path: string) {
  return handleLineModuleSchema.parse(await importModule(path)).handleLine;
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

const methodListSchema = z.array(z.string().min(1)).min(1);

const acpModule = z
  .object({ ACP_QUESTION_REQUEST_METHODS: methodListSchema })
  .parse(
    await importModule("packages/provider-bridge-acp/src/bridge/bridge.ts"),
  );

interface AcpAsk {
  resultKey: "elicitationResult" | "permissionResult";
  prompt: string;
}

async function runAcp(ask: AcpAsk, reply: Reply): Promise<Observation> {
  const handleLine = await loadHandleLine(
    "packages/provider-bridge-acp/src/bridge/bridge.ts",
  );
  const workspaceDir = mkdtempSync(join(tmpdir(), "bb-unanswered-acp-"));
  const requestLog = join(workspaceDir, "requests.log");
  const harness = createBridgeJsonRpcTestHarness(handleLine);
  const threadId = `thr_unanswered_acp_${Date.now()}`;
  const options =
    ask.resultKey === "permissionResult" ? ACCEPT_EDITS_OPTIONS : FULL_OPTIONS;
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
  const turn = (id: number, text: string): void => {
    harness.sendRequest(id, "turn/start", {
      threadId,
      providerThreadId,
      clientRequestId: `creq_abcdefgh${id}k`,
      options: { ...options, providerOptions },
      input: [{ type: "text", text, mentions: [] }],
    });
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
    turn(2, ask.prompt);
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
        answerRuntimeRequest(handleLine, request, STOPPED_REPLY);
      } else if (reply.kind === "new-prompt") {
        turn(4, "echo a new prompt");
        await harness.waitForResponse(4);
      } else {
        answerRuntimeRequest(handleLine, request, reply.body(request));
      }
    }
    const result = await waitUntil(
      () =>
        readJsonLines(requestLog).find((line) => ask.resultKey in line)?.[
          ask.resultKey
        ],
      `the agent's ${ask.resultKey}`,
      harness,
    );
    await harness.flushWork();
    const failed =
      ask.resultKey === "elicitationResult"
        ? z.object({ error: z.string() }).safeParse(result).success
        : result === "error";
    return {
      answer: failed
        ? { kind: "error", message: JSON.stringify(result) }
        : { kind: "answer", value: result },
      warnings: warningsFor(harness.messages, threadId),
    };
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

const ACP_FORM: AcpAsk = { resultKey: "elicitationResult", prompt: "ask-form" };
const ACP_PERMISSION: AcpAsk = {
  resultKey: "permissionResult",
  prompt: "request-permission",
};

describeBridge("ACP", acpModule.ACP_QUESTION_REQUEST_METHODS, {
  "elicitation/create": {
    "unshowable-request": () =>
      runAcp({ ...ACP_FORM, prompt: "ask-form-too-large" }, NONE),
    "runtime-error": () => runAcp(ACP_FORM, RUNTIME_ERROR),
    "unreadable-resolution": () => runAcp(ACP_FORM, UNREADABLE),
    "unmappable-answer": () =>
      runAcp(
        ACP_FORM,
        runtimeResult({
          kind: "user_answer",
          answers: {
            strategy: { selected: ["reckless"] },
            dryRun: { selected: ["true"] },
          },
        }),
      ),
    withdrawn: () =>
      runAcp(
        { ...ACP_FORM, prompt: "then-unprompted-ask-form" },
        { kind: "new-prompt" },
      ),
    "turn-stopped": () => runAcp(ACP_FORM, STOP),
  },
  "session/request_permission": {
    "unshowable-request": {
      unreachable:
        "bb shows every well-formed ACP permission request; malformed ones get a JSON-RPC error before any question exists",
    },
    "runtime-error": () => runAcp(ACP_PERMISSION, RUNTIME_ERROR),
    "unreadable-resolution": () => runAcp(ACP_PERMISSION, UNREADABLE),
    "unmappable-answer": () =>
      runAcp(
        { ...ACP_PERMISSION, prompt: "request-permission-reject-only" },
        runtimeResult({ decision: "allow_once", grantedPermissions: null }),
      ),
    withdrawn: () =>
      runAcp(
        { ...ACP_PERMISSION, prompt: "then-unprompted-permission" },
        { kind: "new-prompt" },
      ),
    "turn-stopped": () => runAcp(ACP_PERMISSION, STOP),
  },
});

const piContract = z
  .object({ PI_EXTENSION_DIALOG_METHODS: methodListSchema })
  .parse(
    await importModule("plugins/provider-pi/src/extension-ui-contract.ts"),
  );

const piBridgeModuleSchema = z.object({
  handleLine: z.function({ input: [z.string()], output: z.void() }),
  experimental_closeAllForTests: z.function({
    input: [],
    output: z.promise(z.void()),
  }),
});

async function runPi(dialog: object, reply: Reply): Promise<Observation> {
  const module = piBridgeModuleSchema.parse(
    await importModule("plugins/provider-pi/src/bridge/bridge.ts"),
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
    if (reply.kind === "stop") {
      const request = await waitForInteractionRequest(harness);
      harness.sendRequest(4, "thread/stop", {
        threadId,
        providerThreadId,
        intent: "interrupt",
        activeTurnId: null,
      });
      await harness.waitForResponse(4);
      answerRuntimeRequest(module.handleLine, request, STOPPED_REPLY);
    } else if (reply.kind === "runtime") {
      const request = await waitForInteractionRequest(harness);
      answerRuntimeRequest(module.handleLine, request, reply.body(request));
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

const PI_DIALOGS: Record<string, { dialog: object; misfit: unknown }> = {
  select: {
    dialog: { method: "select", title: "Pick", options: ["A", "B"] },
    misfit: "not-an-option",
  },
  confirm: { dialog: { method: "confirm", title: "Proceed?" }, misfit: "yes" },
  input: { dialog: { method: "input", title: "Name?" }, misfit: 42 },
  editor: { dialog: { method: "editor", title: "Edit the note" }, misfit: 42 },
};

describeBridge(
  "Pi",
  piContract.PI_EXTENSION_DIALOG_METHODS,
  Object.fromEntries(
    Object.entries(PI_DIALOGS).map(([method, { dialog, misfit }]) => [
      method,
      {
        "unshowable-request": () =>
          runPi({ ...dialog, title: "x".repeat(9_000) }, NONE),
        "runtime-error": () => runPi(dialog, RUNTIME_ERROR),
        "unreadable-resolution": () => runPi(dialog, UNREADABLE),
        "unmappable-answer": () =>
          runPi(
            dialog,
            runtimeResult({ kind: "request_answer", value: misfit }),
          ),
        withdrawn: {
          unreachable:
            "the Pi bridge never withdraws an open dialog; bb queues a new prompt until the turn ends",
        },
        "turn-stopped": () => runPi(dialog, STOP),
      } satisfies Surface,
    ]),
  ),
);

const codexContract = z
  .object({ CODEX_QUESTION_REQUEST_METHODS: methodListSchema })
  .parse(
    await importModule("plugins/provider-codex/src/interactive-requests.ts"),
  );

const codexNativeResponseSchema = z.union([
  z.object({ result: z.unknown() }),
  z.object({ error: z.object({ message: z.string() }) }),
]);

async function runCodex(
  request: { method: string; params: object },
  reply: Reply,
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
      turns: [[{ kind: "request", id: 0, ...request }]],
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
    if (reply.kind === "stop") {
      const forwarded = await waitForInteractionRequest(harness);
      harness.sendRequest(3, "thread/stop", {
        threadId,
        providerThreadId,
        intent: "interrupt",
        activeTurnId: null,
      });
      await harness.waitForResponse(3);
      answerRuntimeRequest(handleLine, forwarded, STOPPED_REPLY);
    } else if (reply.kind === "runtime") {
      const forwarded = await waitForInteractionRequest(harness);
      answerRuntimeRequest(handleLine, forwarded, reply.body(forwarded));
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

const CODEX_ITEM = {
  threadId: "codex-thread",
  turnId: "turn-fx-1",
  itemId: "item-1",
};

const CODEX_REQUESTS: Record<
  string,
  { params: object; misfit: unknown | null }
> = {
  "mcpServer/elicitation/request": {
    params: {
      threadId: "codex-thread",
      turnId: null,
      serverName: "deployment-survey",
      mode: "form",
      message: "Configure the deployment",
      requestedSchema: {
        type: "object",
        properties: {
          retries: {
            type: "integer",
            title: "Retries",
            minimum: 1,
            maximum: 5,
          },
        },
        required: ["retries"],
      },
    },
    misfit: {
      kind: "request_answer",
      value: { action: "accept", content: { retries: 99 } },
    },
  },
  "item/commandExecution/requestApproval": {
    params: {
      ...CODEX_ITEM,
      reason: "Needs approval",
      command: "git push",
      cwd: "/tmp/project",
      commandActions: [],
      availableDecisions: ["accept", "decline"],
    },
    misfit: null,
  },
  "item/fileChange/requestApproval": {
    params: { ...CODEX_ITEM, reason: null, grantRoot: null },
    misfit: null,
  },
  "item/permissions/requestApproval": {
    params: {
      ...CODEX_ITEM,
      reason: null,
      permissions: { network: null, fileSystem: null },
    },
    misfit: { decision: "allow_once", grantedPermissions: null },
  },
  "item/tool/requestUserInput": {
    params: {
      ...CODEX_ITEM,
      questions: [
        {
          id: "target",
          header: "Target",
          question: "Which environment?",
          options: [{ label: "Staging", description: "Test first" }],
        },
      ],
    },
    misfit: {
      kind: "user_answer",
      answers: { target: { selected: [] } },
    },
  },
};

describeBridge(
  "Codex",
  codexContract.CODEX_QUESTION_REQUEST_METHODS,
  Object.fromEntries(
    Object.entries(CODEX_REQUESTS).map(([method, { params, misfit }]) => [
      method,
      {
        "unshowable-request": () =>
          runCodex(
            { method, params: { threadId: "codex-thread", turnId: null } },
            NONE,
          ),
        "runtime-error": () => runCodex({ method, params }, RUNTIME_ERROR),
        "unreadable-resolution": () => runCodex({ method, params }, UNREADABLE),
        "unmappable-answer":
          misfit === null
            ? {
                unreachable:
                  "every bb approval decision maps to a Codex decision for this request",
              }
            : () => runCodex({ method, params }, runtimeResult(misfit)),
        withdrawn: {
          unreachable:
            "the Codex bridge never withdraws an open question; the app-server owns its pending requests",
        },
        "turn-stopped": () => runCodex({ method, params }, STOP),
      } satisfies Surface,
    ]),
  ),
);

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

async function runClaude(
  tool: { name: string; input: unknown },
  reply: Reply,
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
      options: ACCEPT_EDITS_OPTIONS,
    });
    await harness.waitForResponse(1);
    const { canUseTool } = claudeCanUseToolSchema.parse(
      queryMock.mock.calls.at(-1)?.[0],
    ).options;
    const resultPromise = canUseTool(tool.name, tool.input, {
      requestId: "control-request",
      signal: abort.signal,
      toolUseID: "tool-question",
    });
    if (reply.kind === "stop") {
      const request = await waitForInteractionRequest(harness);
      abort.abort();
      answerRuntimeRequest(handleLine, request, STOPPED_REPLY);
    } else if (reply.kind === "runtime") {
      const request = await waitForInteractionRequest(harness);
      answerRuntimeRequest(handleLine, request, reply.body(request));
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

const questionIdSchema = z.object({
  params: z.object({
    payload: z.object({ questions: z.array(z.object({ id: z.string() })) }),
  }),
});

const CLAUDE_SESSION_GRANT_WITHOUT_PERMISSIONS = runtimeResult({
  decision: "allow_for_session",
  grantedPermissions: null,
});

const CLAUDE_TOOLS: Record<
  string,
  { input: unknown; invalidInput: unknown | null; misfit: Reply }
> = {
  AskUserQuestion: {
    input: {
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
    },
    invalidInput: { questions: "not a list" },
    misfit: {
      kind: "runtime",
      body: (request) => {
        const [question] =
          questionIdSchema.parse(request).params.payload.questions;
        return {
          result: {
            kind: "user_answer",
            answers: {
              [question?.id ?? "q"]: { selected: ["no-such-option"] },
            },
          },
        };
      },
    },
  },
  ExitPlanMode: {
    input: { plan: "Ship the fix" },
    invalidInput: { plan: 42 },
    misfit: CLAUDE_SESSION_GRANT_WITHOUT_PERMISSIONS,
  },
  WebFetch: {
    input: { url: "https://example.com", prompt: "Summarize" },
    invalidInput: null,
    misfit: CLAUDE_SESSION_GRANT_WITHOUT_PERMISSIONS,
  },
};

describeBridge(
  "Claude Code",
  ["AskUserQuestion", "ExitPlanMode", "WebFetch"],
  Object.fromEntries(
    Object.entries(CLAUDE_TOOLS).map(
      ([name, { input, invalidInput, misfit }]) => [
        name,
        {
          "unshowable-request":
            invalidInput === null
              ? {
                  unreachable:
                    "bb shows any tool's permission request with its raw input",
                }
              : () => runClaude({ name, input: invalidInput }, NONE),
          "runtime-error": () => runClaude({ name, input }, RUNTIME_ERROR),
          "unreadable-resolution": () => runClaude({ name, input }, UNREADABLE),
          "unmappable-answer": () => runClaude({ name, input }, misfit),
          withdrawn: {
            unreachable:
              "the Claude Code bridge never withdraws an open question; Claude's canUseTool waits for it",
          },
          "turn-stopped": () => runClaude({ name, input }, STOP),
        } satisfies Surface,
      ],
    ),
  ),
);
