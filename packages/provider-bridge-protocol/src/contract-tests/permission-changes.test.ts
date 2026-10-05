import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createBridgeJsonRpcTestHarness } from "../testing/bridge-json-rpc-test-helpers.js";
import { assembleCapturedThreadEvents } from "../testing/bridge-delta-assembly.js";
import {
  permissionChangeCases,
  runPermissionChangeCase,
} from "./permission-changes.js";

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock(
  "../../../../plugins/provider-claude-code/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs",
  () => ({
    query: queryMock,
    forkSession: vi.fn(),
    createSdkMcpServer: vi.fn(() => ({})),
    tool: vi.fn((_name, _description, _schema, handler) => handler),
  }),
);

const checkout = resolve(
  fileURLToPath(new URL("../../../..", import.meta.url)),
);
const bridgeModuleSchema = z.object({
  handleLine: z.function({ input: [z.string()], output: z.void() }),
});
async function loadBridge(provider: "codex" | "claude-code") {
  const module: unknown = await import(
    pathToFileURL(
      join(checkout, "plugins", `provider-${provider}`, "src/bridge/bridge.ts"),
    ).href
  );
  return bridgeModuleSchema.parse(module).handleLine;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

interface UserMessage {
  message: { content: string };
}
interface ClaudeQueryCall {
  prompt: AsyncIterable<UserMessage>;
  options: { permissionMode?: string; sandbox?: { enabled?: boolean } };
}
function getLatestQueryCall(): ClaudeQueryCall {
  return z
    .object({
      prompt: z.custom<AsyncIterable<UserMessage>>(
        (value) => isRecord(value) && Symbol.asyncIterator in value,
      ),
      options: z.object({
        permissionMode: z.string().optional(),
        sandbox: z.object({ enabled: z.boolean().optional() }).optional(),
      }),
    })
    .parse(queryMock.mock.calls.at(-1)?.[0]);
}
function getLatestQueryOptions() {
  return getLatestQueryCall().options;
}
function createControlledClaudeQuery() {
  let resolveNext:
    | ((result: IteratorResult<Record<string, unknown>>) => void)
    | undefined;
  const pending: IteratorResult<Record<string, unknown>>[] = [];
  function emit(result: IteratorResult<Record<string, unknown>>) {
    if (resolveNext) {
      const resolve = resolveNext;
      resolveNext = undefined;
      resolve(result);
    } else {
      pending.push(result);
    }
  }
  return {
    applyFlagSettings: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(() => emit({ value: undefined, done: true })),
    emit(message: Record<string, unknown>) {
      emit({ value: message, done: false });
    },
    finish() {
      emit({ value: undefined, done: true });
    },
    getContextUsage: vi.fn().mockResolvedValue(null),
    interrupt: vi.fn().mockResolvedValue(undefined),
    setModel: vi.fn().mockResolvedValue(undefined),
    setPermissionMode: vi.fn().mockResolvedValue(undefined),
    [Symbol.asyncIterator]() {
      return {
        next() {
          const result = pending.shift();
          return result
            ? Promise.resolve(result)
            : new Promise<IteratorResult<Record<string, unknown>>>(
                (resolve) => {
                  resolveNext = resolve;
                },
              );
        },
        async return() {
          return { value: undefined, done: true };
        },
      };
    },
  };
}

async function readNextPrompt(call: ClaudeQueryCall): Promise<UserMessage> {
  const result = await call.prompt[Symbol.asyncIterator]().next();
  if (result.done) {
    throw new Error("Expected Claude prompt input");
  }
  return result.value;
}

async function readNextPromptText(call: ClaudeQueryCall): Promise<string> {
  const content = (await readNextPrompt(call)).message.content;
  if (typeof content !== "string") {
    throw new Error("Expected Claude prompt text content");
  }
  return content;
}

function createResultUsage() {
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

function createSuccessfulResultMessage(
  sessionId: string,
): Record<string, unknown> {
  return {
    type: "result",
    subtype: "success",
    duration_ms: 1,
    duration_api_ms: 1,
    is_error: false,
    num_turns: 1,
    result: "ok",
    stop_reason: "end_turn",
    total_cost_usd: 0,
    usage: createResultUsage(),
    modelUsage: {},
    permission_denials: [],
    uuid: "00000000-0000-4000-8000-000000000004",
    session_id: sessionId,
  };
}

describe("cross-provider permission changes: Codex", () => {
  const THREAD_ID = "thr_permission_contract";
  let harness: ReturnType<typeof createBridgeJsonRpcTestHarness>;
  let workspaceDir: string;
  let requestLogPath: string;
  beforeEach(async () => {
    workspaceDir = mkdtempSync(join(tmpdir(), "bb-permission-codex-"));
    requestLogPath = join(workspaceDir, "requests.jsonl");
    const scriptPath = join(workspaceDir, "script.json");
    writeFileSync(scriptPath, JSON.stringify({ requestLogPath }));
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
    harness = createBridgeJsonRpcTestHarness(await loadBridge("codex"));
  });
  afterEach(async () => {
    harness.sendRequest(999, "thread/stop", {
      threadId: THREAD_ID,
      providerThreadId: "cleanup",
      intent: "release",
      activeTurnId: null,
    });
    await harness.waitForResponse(999);
    harness.restore();
    vi.unstubAllEnvs();
    rmSync(workspaceDir, { recursive: true, force: true });
  });
  function recordedRequests() {
    return readFileSync(requestLogPath, "utf8")
      .trim()
      .split("\n")
      .map((line) =>
        z
          .object({
            method: z.string(),
            params: z.record(z.string(), z.unknown()),
          })
          .parse(JSON.parse(line)),
      );
  }
  it.each(permissionChangeCases(["accept-edits", "auto", "full"]))(
    "permission contract: $before -> $after on $method",
    async (scenario) => {
      let providerThreadId = "";
      let id = 100;
      await runPermissionChangeCase(
        {
          async start(options) {
            harness.sendRequest(++id, "thread/start", {
              threadId: THREAD_ID,
              cwd: workspaceDir,
              instructionMode: "append",
              options,
            });
            const response = await harness.waitForResponse(id);
            expect(response.error).toBeUndefined();
            ({ providerThreadId } = z
              .object({ providerThreadId: z.string() })
              .parse(response.result));
          },
          async dispatch(method, options, hold) {
            harness.sendRequest(++id, method, {
              threadId: THREAD_ID,
              providerThreadId,
              expectedTurnId: "turn-fx-1",
              clientRequestId: "creq_abcdefghjk",
              input: [
                {
                  type: "text",
                  text: hold ? "/wait-for-interrupt" : "permission probe",
                  mentions: [],
                },
              ],
              options,
            });
            const response = await harness.waitForResponse(id);
            expect(response.error).toBeUndefined();
            if (!hold) {
              await harness.flushWork();
            }
          },
          async observe() {
            const requests = recordedRequests();
            const params = z
              .object({
                sandboxPolicy: z.object({
                  type: z.enum(["workspaceWrite", "dangerFullAccess"]),
                }),
                approvalPolicy: z.enum(["never", "on-request"]),
                approvalsReviewer: z.enum(["user", "auto_review"]),
              })
              .parse(
                requests
                  .filter((request) => request.method === "turn/start")
                  .at(-1)?.params,
              );
            const sandbox = params.sandboxPolicy.type === "workspaceWrite";
            expect(params.approvalPolicy).toBe(
              sandbox ? "on-request" : "never",
            );
            if (
              scenario.method === "turn/steer" &&
              requests.filter((request) => request.method === "turn/start")
                .length > 1
            ) {
              expect(
                requests.filter((request) => request.method === "turn/steer"),
              ).toHaveLength(0);
              expect(
                requests.filter(
                  (request) => request.method === "turn/interrupt",
                ),
              ).toHaveLength(1);
            }
            return {
              mode: !sandbox
                ? "full"
                : params.approvalsReviewer === "auto_review"
                  ? "auto"
                  : "accept-edits",
              sandbox,
            };
          },
        },
        scenario,
      );
    },
    30_000,
  );
});

describe("cross-provider permission changes: Claude", () => {
  it.each(permissionChangeCases(["accept-edits", "auto", "full"]))(
    "permission contract: $before -> $after on $method",
    async (scenario) => {
      const threadId = "thread-permission-contract";
      const bridge = createBridgeJsonRpcTestHarness(
        await loadBridge("claude-code"),
      );
      const queries: ReturnType<typeof createControlledClaudeQuery>[] = [];
      let id = 100;
      queryMock.mockImplementation(() => {
        const query = createControlledClaudeQuery();
        queries.push(query);
        return query;
      });
      try {
        await runPermissionChangeCase(
          {
            async start(options) {
              bridge.sendRequest(++id, "thread/start", {
                threadId,
                cwd: "/tmp/worktree",
                instructionMode: "append",
                options,
              });
              expect((await bridge.waitForResponse(id)).error).toBeUndefined();
            },
            async dispatch(method, options, hold) {
              const completed = assembleCapturedThreadEvents(
                bridge.messages,
                "claude-code",
              ).filter((event) => event.type === "turn/completed").length;
              bridge.sendRequest(++id, method, {
                threadId,
                providerThreadId: threadId,
                expectedTurnId: "turn-1",
                clientRequestId: "creq_abcdefghjk",
                input: [
                  { type: "text", text: "permission probe", mentions: [] },
                ],
                options,
              });
              await bridge.flushWork();
              expect(await readNextPromptText(getLatestQueryCall())).toBe(
                "permission probe",
              );
              expect((await bridge.waitForResponse(id)).error).toBeUndefined();
              if (!hold) {
                queries.at(-1)?.emit(createSuccessfulResultMessage(threadId));
                await vi.waitFor(() => {
                  const events = assembleCapturedThreadEvents(
                    bridge.messages,
                    "claude-code",
                  ).filter((event) => event.type === "turn/completed");
                  expect(events.length).toBeGreaterThan(completed);
                  expect(events.at(-1)).toMatchObject({ status: "completed" });
                });
              }
            },
            async observe() {
              const query = queries.at(-1);
              const options = getLatestQueryOptions();
              const mode =
                query?.setPermissionMode.mock.calls.at(-1)?.[0] ??
                options.permissionMode;
              let sandbox = options.sandbox?.enabled === true;
              for (const [settings] of query?.applyFlagSettings.mock.calls ??
                []) {
                if (isRecord(settings) && "sandbox" in settings) {
                  sandbox =
                    isRecord(settings.sandbox) &&
                    settings.sandbox.enabled === true;
                }
              }
              expect(["bypassPermissions", "acceptEdits", "auto"]).toContain(
                mode,
              );
              return {
                mode:
                  mode === "bypassPermissions"
                    ? "full"
                    : mode === "acceptEdits"
                      ? "accept-edits"
                      : "auto",
                sandbox,
              };
            },
          },
          scenario,
        );
      } finally {
        bridge.sendRequest(++id, "thread/stop", {
          threadId,
          providerThreadId: threadId,
          intent: "release",
          activeTurnId: null,
        });
        queries.forEach((query) => query.finish());
        await bridge.waitForResponse(id);
        bridge.restore();
      }
    },
  );
});
