import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  experimental_createBridgeDeltaEventCollector as createBridgeDeltaEventCollector,
  experimental_createBridgeJsonRpcTestHarness as createBridgeJsonRpcTestHarness,
  experimental_formatConformanceReport as formatConformanceReport,
  experimental_runBridgeConformance as runBridgeConformance,
} from "@get-bb/plugin-sdk/provider-bridge/testing";
import { BRIDGE_JSON_RPC_ERRORS } from "@get-bb/plugin-sdk/provider-bridge";
import type {
  BridgeJsonRpcObject,
  BridgeJsonRpcTestHarness,
} from "@get-bb/plugin-sdk/provider-bridge/testing";
import {
  experimental_providerBridge,
  experimental_resetRappBridgeForTests,
  experimental_setRappBridgeDurabilityFaultForTests,
  handleLine,
} from "./src/bridge.js";
import { canonicalString } from "./src/rapp1.js";
import { RappSessionStore } from "./src/session-store.js";
import {
  RAPP_BUSINESS_MODEL_ID,
  RAPP_FUNCTION_KEY_ENV,
  RAPP_MODEL_ID,
  RAPP_PROVIDER_ID,
  RAPP_SPEC,
  RAPP_USER_GUID_ENV,
} from "./src/vocabulary.js";

const servers: ReturnType<typeof createServer>[] = [];
const directories: string[] = [];
let harness: BridgeJsonRpcTestHarness;
let requestCounter = 0;
let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(process.cwd(), ".bb-rapp-bridge-"));
  const tempDir = mkdtempSync(join(process.cwd(), ".bb-rapp-temp-"));
  directories.push(dataDir, tempDir);
  experimental_resetRappBridgeForTests(dataDir);
  experimental_providerBridge.start?.({
    pluginId: "provider-rapp",
    dataDir,
    tempDir,
  });
  harness = createBridgeJsonRpcTestHarness(handleLine);
});

afterEach(async () => {
  harness.restore();
  experimental_providerBridge.onClose?.();
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

async function listen(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected TCP server address");
  }
  return `http://127.0.0.1:${address.port}`;
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function request(method: string, params: BridgeJsonRpcObject) {
  requestCounter += 1;
  const id = `rapp-test-${requestCounter}`;
  harness.sendRequest(id, method, params);
  const response = await harness.waitForResponse(id);
  expect(response.error, `${method} returned an error`).toBeUndefined();
  return response;
}

function options(
  endpoint: string,
  model = RAPP_MODEL_ID,
  grail: "consumer" | "business" = "consumer",
): BridgeJsonRpcObject {
  return {
    model,
    reasoningLevel: "none",
    permissionMode: "full",
    permissionScope: "full",
    approvalReviewer: null,
    permissionEscalation: null,
    instructions: "Be concise.",
    providerOptions: {
      grail,
      endpoint,
      model,
    },
  };
}

async function waitForCompletedTurn(threadId: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const settled = harness.messages.some((message) => {
      if (message.method !== "thread/delta") {
        return false;
      }
      const params = message.params as {
        threadId?: string;
        deltas?: Array<{ kind?: string; status?: string }>;
      };
      return (
        params.threadId === threadId &&
        params.deltas?.some(
          (delta) =>
            delta.kind === "turn.boundary" && delta.status === "completed",
        ) === true
      );
    });
    if (settled) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`RAPP turn did not settle for ${threadId}`);
}

function threadDeltas(threadId: string): Array<Record<string, unknown>> {
  return harness.messages.flatMap((message) => {
    if (message.method !== "thread/delta") {
      return [];
    }
    const params = message.params as {
      threadId?: string;
      deltas?: Array<Record<string, unknown>>;
    };
    return params.threadId === threadId ? (params.deltas ?? []) : [];
  });
}

function agentMessageText(delta: Record<string, unknown>): string | null {
  if (delta.kind !== "item.close") {
    return null;
  }
  const item = delta.item;
  if (typeof item !== "object" || item === null) {
    return null;
  }
  const text: unknown = Reflect.get(item, "text");
  return Reflect.get(item, "type") === "agentMessage" &&
    typeof text === "string"
    ? text
    : null;
}

function persistedStateText(directory: string): string {
  const paths = [
    join(directory, "identity.json"),
    ...readdirSync(join(directory, "sessions")).map((name) =>
      join(directory, "sessions", name),
    ),
    ...readdirSync(join(directory, "objects")).map((name) =>
      join(directory, "objects", name),
    ),
  ];
  return paths.map((path) => readFileSync(path, "utf8")).join("\n");
}

function persistedSessionHeadPath(directory: string): string {
  const names = readdirSync(join(directory, "sessions"));
  if (names.length !== 1) {
    throw new Error("Expected exactly one persisted RAPP session head");
  }
  return join(directory, "sessions", names[0] ?? "");
}

async function waitFor(
  predicate: () => boolean,
  message: string,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(message);
}

describe("RAPP provider bridge", () => {
  it("passes the provider bridge conformance suite", async () => {
    const endpoint = await listen(async (incoming, response) => {
      if (incoming.method === "GET") {
        response.setHeader("content-type", "application/json");
        if (incoming.url === "/models") {
          response.end(
            JSON.stringify({
              current: "claude-opus-5",
              models: [
                {
                  id: "claude-opus-5",
                  name: "Claude Opus 5",
                  available: true,
                },
              ],
            }),
          );
          return;
        }
        response.end(
          JSON.stringify({
            status: "ok",
            version: "test",
            agents: [],
          }),
        );
        return;
      }
      const body = await readJson(incoming);
      const parsed = body as { user_input?: string; session_id?: string };
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          response: `RAPP: ${parsed.user_input ?? ""}`,
          agent_logs: [],
          session_id: parsed.session_id ?? "session",
        }),
      );
    });
    const report = await runBridgeConformance({
      transport: { send: handleLine, takeMessages: harness.takeMessages },
      providerId: RAPP_PROVIDER_ID,
      session: {
        cwd: "/workspace/rapp",
        promptInput: [{ type: "text", text: "hello", mentions: [] }],
        options: options(endpoint),
      },
      timeoutMs: 5_000,
    });
    harness.restore();
    console.info(
      `RAPP bridge conformance:\n${formatConformanceReport(report)}`,
    );
    expect(report.results.filter((result) => result.status === "fail")).toEqual(
      [],
    );
    expect(report.passed).toBe(true);
  });

  it("maps Brainstem's verified Copilot catalog in source order", async () => {
    const requests: string[] = [];
    const endpoint = await listen((incoming, response) => {
      requests.push(`${incoming.method} ${incoming.url}`);
      response.setHeader("content-type", "application/json");
      if (incoming.url === "/models") {
        response.end(
          JSON.stringify({
            current: "claude-sonnet-5",
            models: [
              {
                id: "gpt-5.4",
                name: "GPT-5.4",
                available: true,
              },
              {
                id: "gpt-4o",
                name: "GPT-4o",
                available: false,
              },
              {
                id: "bootstrap-only",
                name: "Bootstrap only",
              },
              {
                id: "claude-sonnet-5",
                name: "Claude Sonnet 5",
                available: true,
              },
              {
                id: "gpt-5.4",
                name: "GPT-5.4 duplicate",
                available: true,
              },
            ],
          }),
        );
        return;
      }
      response.end(
        JSON.stringify({ status: "ok", version: "test", agents: [] }),
      );
    });

    const response = await request("model/list", {
      providerOptions: {
        grail: "consumer",
        endpoint,
      },
    });
    const result = response.result as {
      models: Array<Record<string, unknown>>;
      selectedOnlyModels: Array<Record<string, unknown>>;
    };

    expect(requests).toEqual(["GET /health", "GET /models"]);
    expect(result.models.map((model) => model.model)).toEqual([
      "gpt-5.4",
      "claude-sonnet-5",
    ]);
    expect(
      result.models.filter((model) => model.isDefault).map((model) => model.id),
    ).toEqual(["claude-sonnet-5"]);
    expect(result.models[0]).toMatchObject({
      displayName: "GPT-5.4",
      description: "GitHub Copilot model supplied by RAPP Brainstem",
    });
    expect(result.selectedOnlyModels).toEqual([
      expect.objectContaining({
        id: RAPP_MODEL_ID,
        model: RAPP_MODEL_ID,
        isDefault: false,
      }),
    ]);
  });

  it("returns the fixed Business Grail model without contacting model endpoints", async () => {
    const response = await request("model/list", {
      providerOptions: {
        grail: "business",
        endpoint: "",
      },
    });

    expect(response.result).toEqual({
      models: [
        expect.objectContaining({
          id: RAPP_BUSINESS_MODEL_ID,
          model: RAPP_BUSINESS_MODEL_ID,
          isDefault: true,
        }),
      ],
      selectedOnlyModels: [],
    });
  });

  it("sets a concrete Consumer model before chat and attributes fallback", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const endpoint = await listen(async (incoming, response) => {
      response.setHeader("content-type", "application/json");
      if (incoming.method === "GET") {
        response.end(
          JSON.stringify({ status: "ok", version: "test", agents: [] }),
        );
        return;
      }
      const body = await readJson(incoming);
      calls.push({ path: incoming.url ?? "", body });
      if (incoming.url === "/models/set") {
        response.end(JSON.stringify({ model: "claude-sonnet-5" }));
        return;
      }
      response.end(
        JSON.stringify({
          response: "fallback answer",
          session_id: "consumer-session",
          agent_logs: [],
          requested_model: "claude-sonnet-5",
          model: "claude-haiku-4.5",
        }),
      );
    });
    const threadId = "thr_concrete_model";
    const start = await request("thread/start", {
      threadId,
      cwd: "/workspace/rapp",
      instructionMode: "append",
      options: options(endpoint, "claude-sonnet-5"),
    });
    const identity = start.result as { providerThreadId: string };

    await request("turn/start", {
      threadId,
      providerThreadId: identity.providerThreadId,
      input: [{ type: "text", text: "route me", mentions: [] }],
      clientRequestId: "creq_abcdefghjk",
      options: options(endpoint, "claude-sonnet-5"),
    });
    await waitForCompletedTurn(threadId);

    expect(calls.map((call) => call.path)).toEqual(["/models/set", "/chat"]);
    expect(calls[0]?.body).toEqual({ model: "claude-sonnet-5" });
    expect(
      threadDeltas(threadId).find((delta) => delta.kind === "extension.state"),
    ).toMatchObject({
      payload: {
        selectedModel: "claude-sonnet-5",
        requestedModel: "claude-sonnet-5",
        actualModel: "claude-haiku-4.5",
      },
    });
  });

  it("rejects a concrete Consumer turn when Brainstem reports another requested model", async () => {
    const endpoint = await listen(async (incoming, response) => {
      response.setHeader("content-type", "application/json");
      if (incoming.method === "GET") {
        response.end(
          JSON.stringify({ status: "ok", version: "test", agents: [] }),
        );
        return;
      }
      await readJson(incoming);
      if (incoming.url === "/models/set") {
        response.end(JSON.stringify({ model: "model-a" }));
        return;
      }
      response.end(
        JSON.stringify({
          response: "wrong route",
          session_id: "mismatch-session",
          agent_logs: [],
          requested_model: "model-b",
          model: "model-b",
        }),
      );
    });
    const threadId = "thr_requested_mismatch";
    const selectedOptions = options(endpoint, "model-a");
    const start = await request("thread/start", {
      threadId,
      cwd: "/workspace/rapp",
      instructionMode: "append",
      options: selectedOptions,
    });
    const identity = start.result as { providerThreadId: string };

    await request("turn/start", {
      threadId,
      providerThreadId: identity.providerThreadId,
      input: [{ type: "text", text: "mismatch", mentions: [] }],
      clientRequestId: "creq_mnpqrstuvw",
      options: selectedOptions,
    });
    await waitFor(
      () =>
        threadDeltas(threadId).some(
          (delta) =>
            delta.kind === "turn.boundary" && delta.status === "failed",
        ),
      "mismatched Consumer turn did not fail",
    );

    expect(
      threadDeltas(threadId).find(
        (delta) => delta.kind === "turn.boundary" && delta.status === "failed",
      ),
    ).toMatchObject({
      error: {
        message: expect.stringContaining(
          "RAPP Brainstem requested model model-b after bb selected model-a",
        ),
      },
    });
    expect(
      threadDeltas(threadId).some((delta) => delta.kind === "extension.state"),
    ).toBe(false);
  });

  it("does not retain a pending turn when model selection fails before chat", async () => {
    let modelSetCalls = 0;
    let chatCalls = 0;
    const endpoint = await listen(async (incoming, response) => {
      response.setHeader("content-type", "application/json");
      if (incoming.method === "GET") {
        response.end(
          JSON.stringify({ status: "ok", version: "test", agents: [] }),
        );
        return;
      }
      const body = await readJson(incoming);
      if (incoming.url === "/models/set") {
        modelSetCalls += 1;
        if (modelSetCalls === 1) {
          response.statusCode = 503;
          response.end(JSON.stringify({ error: "model unavailable" }));
          return;
        }
        response.end(JSON.stringify({ model: "model-a" }));
        return;
      }
      chatCalls += 1;
      response.end(
        JSON.stringify({
          response: "after local precondition retry",
          session_id: "precondition-session",
          agent_logs: [],
          requested_model: "model-a",
          model: "model-a",
          received: body,
        }),
      );
    });
    const threadId = "thr_model_precondition";
    const start = await request("thread/start", {
      threadId,
      cwd: "/workspace/rapp",
      instructionMode: "append",
      options: options(endpoint, "model-a"),
    });
    const identity = start.result as { providerThreadId: string };

    await request("turn/start", {
      threadId,
      providerThreadId: identity.providerThreadId,
      input: [{ type: "text", text: "first attempt", mentions: [] }],
      clientRequestId: "creq_abcdefghjq",
      options: options(endpoint, "model-a"),
    });
    await waitFor(
      () =>
        threadDeltas(threadId).some(
          (delta) =>
            delta.kind === "turn.boundary" && delta.status === "failed",
        ),
      "model selection failure did not settle",
    );
    expect(chatCalls).toBe(0);
    expect(
      new RappSessionStore(dataDir).load(identity.providerThreadId)?.snapshot
        .pendingTurn,
    ).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 0));

    await request("turn/start", {
      threadId,
      providerThreadId: identity.providerThreadId,
      input: [{ type: "text", text: "second attempt", mentions: [] }],
      clientRequestId: "creq_abcdefghjr",
      options: options(endpoint, "model-a"),
    });
    await waitForCompletedTurn(threadId);
    expect(modelSetCalls).toBe(2);
    expect(chatCalls).toBe(1);
    expect(
      threadDeltas(threadId).some(
        (delta) =>
          agentMessageText(delta) === "after local precondition retry",
      ),
    ).toBe(true);
  });

  it("routes Business turns without model selection", async () => {
    const calls: string[] = [];
    const endpoint = await listen(async (incoming, response) => {
      calls.push(`${incoming.method} ${incoming.url}`);
      response.setHeader("content-type", "application/json");
      const body = await readJson(incoming);
      response.end(
        JSON.stringify({
          assistant_response: `Business: ${(body as { user_input?: string }).user_input ?? ""}`,
          agent_logs: [],
        }),
      );
    });
    const threadId = "thr_business_model";
    const businessOptions = options(
      endpoint,
      RAPP_BUSINESS_MODEL_ID,
      "business",
    );
    const start = await request("thread/start", {
      threadId,
      cwd: "/workspace/rapp",
      instructionMode: "append",
      options: businessOptions,
    });
    const identity = start.result as { providerThreadId: string };

    await request("turn/start", {
      threadId,
      providerThreadId: identity.providerThreadId,
      input: [{ type: "text", text: "business", mentions: [] }],
      clientRequestId: "creq_23456789ab",
      options: businessOptions,
    });
    await waitForCompletedTurn(threadId);

    expect(calls).toEqual(["POST /api/businessinsightbot_function"]);
    expect(
      threadDeltas(threadId).find((delta) => delta.kind === "extension.state"),
    ).toMatchObject({
      payload: {
        grail: "business",
        selectedModel: RAPP_BUSINESS_MODEL_ID,
        requestedModel: null,
        actualModel: null,
      },
    });
  });

  it("never persists Business credentials or user identifiers in pending or delivery state", async () => {
    const userGuid = "user-guid-must-not-persist";
    const functionKey = "function-key-must-not-persist";
    const previousUserGuid = process.env[RAPP_USER_GUID_ENV];
    const previousFunctionKey = process.env[RAPP_FUNCTION_KEY_ENV];
    process.env[RAPP_USER_GUID_ENV] = userGuid;
    process.env[RAPP_FUNCTION_KEY_ENV] = functionKey;
    try {
      let receivedUserGuid: unknown;
      let receivedFunctionKey: string | undefined;
      const endpoint = await listen(async (incoming, response) => {
        const body = await readJson(incoming);
        if (typeof body === "object" && body !== null) {
          receivedUserGuid = Reflect.get(body, "user_guid");
        }
        const header = incoming.headers["x-functions-key"];
        receivedFunctionKey = typeof header === "string" ? header : undefined;
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            assistant_response: "business answer",
            agent_logs: [],
            user_guid: userGuid,
          }),
        );
      });
      const threadId = "thr_business_sensitive_state";
      const start = await request("thread/start", {
        threadId,
        cwd: "/workspace/rapp",
        instructionMode: "append",
        options: options(endpoint, RAPP_BUSINESS_MODEL_ID, "business"),
      });
      const identity = start.result as { providerThreadId: string };

      await request("turn/start", {
        threadId,
        providerThreadId: identity.providerThreadId,
        input: [{ type: "text", text: "business prompt", mentions: [] }],
        clientRequestId: "creq_abcdefghjs",
        options: options(endpoint, RAPP_BUSINESS_MODEL_ID, "business"),
      });
      await waitForCompletedTurn(threadId);

      expect(receivedUserGuid).toBe(userGuid);
      expect(receivedFunctionKey).toBe(functionKey);
      const persisted = persistedStateText(dataDir);
      expect(persisted).not.toContain(userGuid);
      expect(persisted).not.toContain(functionKey);
      expect(persisted).not.toContain("user_guid");
      expect(persisted).not.toContain("x-functions-key");
      expect(persisted).toContain("business");
      expect(persisted).toContain(RAPP_BUSINESS_MODEL_ID);
    } finally {
      if (previousUserGuid === undefined) {
        delete process.env[RAPP_USER_GUID_ENV];
      } else {
        process.env[RAPP_USER_GUID_ENV] = previousUserGuid;
      }
      if (previousFunctionKey === undefined) {
        delete process.env[RAPP_FUNCTION_KEY_ENV];
      } else {
        process.env[RAPP_FUNCTION_KEY_ENV] = previousFunctionKey;
      }
    }
  });

  it("rejects model and Grail mismatches before opening a session", async () => {
    for (const [grail, model] of [
      ["business", "claude-sonnet-5"],
      ["consumer", RAPP_BUSINESS_MODEL_ID],
    ] as const) {
      requestCounter += 1;
      const id = `rapp-mismatch-${requestCounter}`;
      harness.sendRequest(id, "thread/start", {
        threadId: `thr_${grail}_mismatch`,
        cwd: "/workspace/rapp",
        instructionMode: "append",
        options: options("http://127.0.0.1:7071", model, grail),
      });
      const response = await harness.waitForResponse(id);
      expect(response.error).toMatchObject({
        code: BRIDGE_JSON_RPC_ERRORS.INVALID_PARAMS,
      });
    }
  });

  it("never replays an ambiguous pending chat and requires an explicit interrupt to discard it", async () => {
    const requests: Array<Record<string, unknown>> = [];
    let chatCount = 0;
    const endpoint = await listen(async (incoming, response) => {
      response.setHeader("content-type", "application/json");
      if (incoming.method === "GET") {
        response.end(
          JSON.stringify({ status: "ok", version: "test", agents: [] }),
        );
        return;
      }
      const body = (await readJson(incoming)) as Record<string, unknown>;
      requests.push(body);
      chatCount += 1;
      if (chatCount === 1) {
        response.statusCode = 503;
        response.end(JSON.stringify({ error: "completion unknown" }));
        return;
      }
      response.end(
        JSON.stringify({
          response: `answer-${chatCount}`,
          session_id:
            typeof body.session_id === "string"
              ? body.session_id
              : "remote-session",
          agent_logs: [],
          requested_model: "claude-opus-5",
          model: "claude-opus-5",
        }),
      );
    });
    const threadId = "thr_pending_retry";
    const firstStart = await request("thread/start", {
      threadId,
      cwd: "/workspace/rapp",
      instructionMode: "append",
      options: options(endpoint),
    });
    const identity = firstStart.result as { providerThreadId: string };

    await request("turn/start", {
      threadId,
      providerThreadId: identity.providerThreadId,
      input: [{ type: "text", text: "original prompt", mentions: [] }],
      clientRequestId: "creq_23456789ac",
      options: options(endpoint),
    });
    await waitFor(
      () =>
        threadDeltas(threadId).some(
          (delta) =>
            delta.kind === "turn.boundary" && delta.status === "failed",
        ),
      "initial pending turn did not fail",
    );
    expect(requests).toHaveLength(1);
    expect(
      threadDeltas(threadId).find(
        (delta) => delta.kind === "turn.boundary" && delta.status === "failed",
      ),
    ).toMatchObject({
      error: {
        message: expect.stringContaining(
          "legacy Brainstem does not honor idempotency keys",
        ),
      },
    });
    const legacyPending = new RappSessionStore(dataDir).load(
      identity.providerThreadId,
    );
    if (legacyPending === null) {
      throw new Error("Ambiguous pending RAPP turn was not persisted");
    }
    writeFileSync(
      persistedSessionHeadPath(dataDir),
      canonicalString({
        schema: "bb/provider-rapp-session-head/1",
        provider_thread_id: identity.providerThreadId,
        egg_address: legacyPending.eggAddress,
        turn_counter: legacyPending.snapshot.turnCounter,
      }),
      "utf8",
    );

    experimental_resetRappBridgeForTests(dataDir);
    await request("thread/resume", {
      threadId,
      providerThreadId: identity.providerThreadId,
      cwd: "/workspace/rapp",
      instructionMode: "append",
      options: options(endpoint),
    });
    await request("turn/start", {
      threadId,
      providerThreadId: identity.providerThreadId,
      input: [{ type: "text", text: "replacement prompt", mentions: [] }],
      clientRequestId: "creq_23456789ad",
      options: options(endpoint),
    });
    await waitFor(
      () =>
        threadDeltas(threadId).filter(
          (delta) =>
            delta.kind === "turn.boundary" && delta.status === "failed",
        ).length === 2,
      "retained pending turn did not fail closed",
    );
    expect(requests).toHaveLength(1);
    expect(
      threadDeltas(threadId)
        .filter(
          (delta) =>
            delta.kind === "turn.boundary" && delta.status === "failed",
        )
        .at(-1),
    ).toMatchObject({
      error: {
        message: expect.stringContaining(
          "Explicitly interrupt/stop this thread",
        ),
      },
    });

    await request("thread/stop", {
      threadId,
      providerThreadId: identity.providerThreadId,
      intent: "interrupt",
      activeTurnId: null,
    });

    await request("turn/start", {
      threadId,
      providerThreadId: identity.providerThreadId,
      input: [{ type: "text", text: "later prompt", mentions: [] }],
      clientRequestId: "creq_23456789ae",
      options: options(endpoint),
    });
    await waitForCompletedTurn(threadId);

    expect(requests).toHaveLength(2);
    expect(requests[0]).toEqual({
      user_input: "original prompt",
      idempotency_key: "creq_23456789ac",
      conversation_history: [
        {
          role: "user",
          content: "BB thread instructions:\nBe concise.",
        },
      ],
    });
    expect(requests[1]).toEqual({
      user_input: "later prompt",
      idempotency_key: "creq_23456789ae",
      conversation_history: [
        {
          role: "user",
          content: "BB thread instructions:\nBe concise.",
        },
      ],
    });
  }, 15_000);

  it("recovers a committed completion from the delivery journal after a bridge crash", async () => {
    let chatCalls = 0;
    const endpoint = await listen(async (incoming, response) => {
      response.setHeader("content-type", "application/json");
      if (incoming.method === "GET") {
        response.end(
          JSON.stringify({ status: "ok", version: "test", agents: [] }),
        );
        return;
      }
      await readJson(incoming);
      chatCalls += 1;
      response.end(
        JSON.stringify({
          response: "recovered answer",
          session_id: "recovered-session",
          agent_logs: ["RecoveryAgent"],
          requested_model: "claude-opus-5",
          model: "claude-opus-5",
        }),
      );
    });
    const threadId = "thr_delivery_recovery";
    const start = await request("thread/start", {
      threadId,
      cwd: "/workspace/rapp",
      instructionMode: "append",
      options: options(endpoint),
    });
    const identity = start.result as { providerThreadId: string };

    experimental_setRappBridgeDurabilityFaultForTests(
      "after-completion-commit",
      () => experimental_resetRappBridgeForTests(dataDir),
    );
    await request("turn/start", {
      threadId,
      providerThreadId: identity.providerThreadId,
      input: [{ type: "text", text: "recover me", mentions: [] }],
      clientRequestId: "creq_abcdefghjm",
      options: options(endpoint),
    });
    await waitFor(
      () =>
        (new RappSessionStore(dataDir).load(identity.providerThreadId)
          ?.pendingDelivery ??
          null) !== null,
      "completed response was not committed to the delivery journal",
    );

    expect(chatCalls).toBe(1);
    expect(
      threadDeltas(threadId).some(
        (delta) => agentMessageText(delta) === "recovered answer",
      ),
    ).toBe(false);
    const providerTurnId = threadDeltas(threadId).find(
      (delta) => delta.kind === "turn.open",
    )?.providerTurnId;
    expect(typeof providerTurnId).toBe("string");

    await request("thread/resume", {
      threadId,
      providerThreadId: identity.providerThreadId,
      cwd: "/workspace/rapp",
      instructionMode: "append",
      options: options(endpoint),
    });
    await waitForCompletedTurn(threadId);

    expect(chatCalls).toBe(1);
    expect(
      threadDeltas(threadId).find(
        (delta) => agentMessageText(delta) === "recovered answer",
      ),
    ).toMatchObject({
      key: {
        providerItemId: `${identity.providerThreadId}-t1-message`,
      },
      providerTurnId,
    });
    expect(
      threadDeltas(threadId).find(
        (delta) =>
          delta.kind === "item.close" &&
          typeof delta.item === "object" &&
          delta.item !== null &&
          Reflect.get(delta.item, "tool") === "rapp_agents",
      ),
    ).toMatchObject({
      item: { result: "RecoveryAgent" },
      providerTurnId,
    });
    expect(
      threadDeltas(threadId).find(
        (delta) => delta.kind === "extension.state",
      ),
    ).toMatchObject({
      payload: {
        grail: "consumer",
        sessionId: "recovered-session",
        endpoint: expect.stringContaining("/chat"),
        selectedModel: RAPP_MODEL_ID,
        requestedModel: "claude-opus-5",
        actualModel: "claude-opus-5",
      },
    });
    const recovered = new RappSessionStore(dataDir).load(
      identity.providerThreadId,
    );
    expect(recovered?.pendingDelivery?.phase).toBe("emitted");
    expect(recovered?.snapshot.transcript).toEqual([
      { role: "user", content: "recover me" },
      { role: "assistant", content: "recovered answer" },
    ]);
    await request("turn/start", {
      threadId,
      providerThreadId: identity.providerThreadId,
      input: [{ type: "text", text: "   ", mentions: [] }],
      clientRequestId: "creq_abcdefghjt",
      options: options(endpoint),
    });
    await waitFor(
      () =>
        threadDeltas(threadId).some(
          (delta) =>
            delta.kind === "turn.boundary" && delta.status === "failed",
        ),
      "acknowledging follow-up turn did not settle locally",
    );
    expect(chatCalls).toBe(1);
    expect(
      new RappSessionStore(dataDir).load(identity.providerThreadId)
        ?.pendingDelivery,
    ).toBeNull();
  });

  it("deduplicates replay in a surviving assembler but exposes the unavoidable fresh-assembler duplicate", async () => {
    let chatCalls = 0;
    const endpoint = await listen(async (incoming, response) => {
      response.setHeader("content-type", "application/json");
      if (incoming.method === "GET") {
        response.end(
          JSON.stringify({ status: "ok", version: "test", agents: [] }),
        );
        return;
      }
      await readJson(incoming);
      chatCalls += 1;
      response.end(
        JSON.stringify({
          response: "deliver once",
          session_id: "delivery-session",
          agent_logs: ["DeliveryAgent"],
          requested_model: "claude-opus-5",
          model: "claude-opus-5",
        }),
      );
    });
    const threadId = "thr_delivery_duplicate_safe";
    const start = await request("thread/start", {
      threadId,
      cwd: "/workspace/rapp",
      instructionMode: "append",
      options: options(endpoint),
    });
    const identity = start.result as { providerThreadId: string };

    experimental_setRappBridgeDurabilityFaultForTests(
      "after-delivery-emission",
      () => experimental_resetRappBridgeForTests(dataDir),
    );
    await request("turn/start", {
      threadId,
      providerThreadId: identity.providerThreadId,
      input: [{ type: "text", text: "deliver safely", mentions: [] }],
      clientRequestId: "creq_abcdefghjn",
      options: options(endpoint),
    });
    await waitFor(
      () =>
        (new RappSessionStore(dataDir).load(identity.providerThreadId)
          ?.pendingDelivery ??
          null) !== null,
      "delivery journal was acknowledged despite the injected crash",
    );
    expect(
      new RappSessionStore(dataDir).load(identity.providerThreadId)
        ?.pendingDelivery?.phase,
    ).toBe("ready");

    const replayStartIndex = harness.messages.length;
    await request("thread/resume", {
      threadId,
      providerThreadId: identity.providerThreadId,
      cwd: "/workspace/rapp",
      instructionMode: "append",
      options: options(endpoint),
    });
    await waitForCompletedTurn(threadId);

    expect(chatCalls).toBe(1);
    expect(
      threadDeltas(threadId).filter(
        (delta) => agentMessageText(delta) === "deliver once",
      ),
    ).toHaveLength(2);
    const collector = createBridgeDeltaEventCollector(RAPP_PROVIDER_ID);
    const assembled = harness.messages.flatMap((message) =>
      collector.assembleMessage(message),
    );
    expect(
      assembled.filter(
        (event) =>
          event.type === "item/completed" &&
          event.item.type === "agentMessage" &&
          event.item.text === "deliver once",
      ),
    ).toHaveLength(1);
    expect(
      assembled.filter(
        (event) =>
          event.type === "item/completed" &&
          event.item.type === "toolCall" &&
          event.item.tool === "rapp_agents",
      ),
    ).toHaveLength(1);
    const resetAssembler = createBridgeDeltaEventCollector(RAPP_PROVIDER_ID);
    const initialEvents = harness.messages
      .slice(0, replayStartIndex)
      .flatMap((message) => resetAssembler.assembleMessage(message));
    resetAssembler.assembler.assemble({
      threadId,
      deltas: [{ kind: "session.reset" }],
    });
    const replayEvents = harness.messages
      .slice(replayStartIndex)
      .flatMap((message) => resetAssembler.assembleMessage(message));
    const initialMessageIds = initialEvents.flatMap((event) =>
      event.type === "item/completed" &&
      event.item.type === "agentMessage" &&
      event.item.text === "deliver once"
        ? [event.item.id]
        : [],
    );
    const replayMessageIds = replayEvents.flatMap((event) =>
      event.type === "item/completed" &&
      event.item.type === "agentMessage" &&
      event.item.text === "deliver once"
        ? [event.item.id]
        : [],
    );
    expect(initialMessageIds).toHaveLength(1);
    expect(replayMessageIds).toHaveLength(1);
    expect(replayMessageIds[0]).not.toBe(initialMessageIds[0]);
    expect(
      new RappSessionStore(dataDir).load(identity.providerThreadId)
        ?.pendingDelivery?.phase,
    ).toBe("emitted");
    await request("turn/start", {
      threadId,
      providerThreadId: identity.providerThreadId,
      input: [{ type: "text", text: "   ", mentions: [] }],
      clientRequestId: "creq_abcdefghju",
      options: options(endpoint),
    });
    await waitFor(
      () =>
        threadDeltas(threadId).some(
          (delta) =>
            delta.kind === "turn.boundary" && delta.status === "failed",
        ),
      "duplicate-window acknowledgement turn did not settle locally",
    );
    expect(chatCalls).toBe(1);
    expect(
      new RappSessionStore(dataDir).load(identity.providerThreadId)
        ?.pendingDelivery,
    ).toBeNull();
  });

  it("rejects a near-limit turn before making any endpoint request", async () => {
    let networkCalls = 0;
    const endpoint = await listen((_incoming, response) => {
      networkCalls += 1;
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          response: "must not execute",
          session_id: "unused",
          agent_logs: [],
        }),
      );
    });
    const threadId = "thr_capacity_preflight";
    const start = await request("thread/start", {
      threadId,
      cwd: "/workspace/rapp",
      instructionMode: "append",
      options: options(endpoint),
    });
    const identity = start.result as { providerThreadId: string };
    const store = new RappSessionStore(dataDir);
    const saved = store.load(identity.providerThreadId);
    if (saved === null) {
      throw new Error("RAPP session was not persisted");
    }
    store.save(
      {
        ...saved.snapshot,
        turnCounter: 1,
        transcript: [{ role: "assistant", content: "x".repeat(985_000) }],
      },
      null,
    );
    experimental_resetRappBridgeForTests(dataDir);
    await request("thread/resume", {
      threadId,
      providerThreadId: identity.providerThreadId,
      cwd: "/workspace/rapp",
      instructionMode: "append",
      options: options(endpoint),
    });

    await request("turn/start", {
      threadId,
      providerThreadId: identity.providerThreadId,
      input: [{ type: "text", text: "too late", mentions: [] }],
      clientRequestId: "creq_abcdefghjp",
      options: options(endpoint),
    });
    await waitFor(
      () =>
        threadDeltas(threadId).some(
          (delta) =>
            delta.kind === "turn.boundary" &&
            delta.status === "failed" &&
            typeof delta.error === "object" &&
            delta.error !== null &&
            String(Reflect.get(delta.error, "message")).includes(
              "Start a new thread",
            ),
        ),
      "near-limit turn did not fail its local capacity preflight",
    );
    expect(networkCalls).toBe(0);
  });

  it("serializes model selection and full chats across Consumer threads", async () => {
    let activeModel = "";
    let chatCount = 0;
    let releaseFirstChat: () => void = () => {};
    const firstChatGate = new Promise<void>((resolve) => {
      releaseFirstChat = resolve;
    });
    const events: string[] = [];
    const endpoint = await listen(async (incoming, response) => {
      response.setHeader("content-type", "application/json");
      if (incoming.method === "GET") {
        response.end(
          JSON.stringify({ status: "ok", version: "test", agents: [] }),
        );
        return;
      }
      const body = (await readJson(incoming)) as { model?: string };
      if (incoming.url === "/models/set") {
        activeModel = body.model ?? "";
        events.push(`set:${activeModel}`);
        response.end(JSON.stringify({ model: activeModel }));
        return;
      }
      chatCount += 1;
      const thisChat = chatCount;
      events.push(`chat-start:${activeModel}`);
      if (thisChat === 1) {
        await firstChatGate;
      }
      events.push(`chat-end:${activeModel}`);
      response.end(
        JSON.stringify({
          response: `answer:${activeModel}`,
          session_id: `session-${thisChat}`,
          agent_logs: [],
          requested_model: activeModel,
          model: activeModel,
        }),
      );
    });

    const firstThread = "thr_model_a";
    const secondThread = "thr_model_b";
    const firstStart = await request("thread/start", {
      threadId: firstThread,
      cwd: "/workspace/rapp",
      instructionMode: "append",
      options: options(endpoint, "model-a"),
    });
    const secondStart = await request("thread/start", {
      threadId: secondThread,
      cwd: "/workspace/rapp",
      instructionMode: "append",
      options: options(endpoint, "model-b"),
    });
    const firstIdentity = firstStart.result as { providerThreadId: string };
    const secondIdentity = secondStart.result as { providerThreadId: string };

    await request("turn/start", {
      threadId: firstThread,
      providerThreadId: firstIdentity.providerThreadId,
      input: [{ type: "text", text: "first", mentions: [] }],
      clientRequestId: "creq_aaaaabbbbb",
      options: options(endpoint, "model-a"),
    });
    await waitFor(
      () => events.includes("chat-start:model-a"),
      "first Consumer chat did not start",
    );
    await request("turn/start", {
      threadId: secondThread,
      providerThreadId: secondIdentity.providerThreadId,
      input: [{ type: "text", text: "second", mentions: [] }],
      clientRequestId: "creq_cccccddddd",
      options: options(endpoint, "model-b"),
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(events).toEqual(["set:model-a", "chat-start:model-a"]);

    releaseFirstChat();
    await Promise.all([
      waitForCompletedTurn(firstThread),
      waitForCompletedTurn(secondThread),
    ]);
    expect(events).toEqual([
      "set:model-a",
      "chat-start:model-a",
      "chat-end:model-a",
      "set:model-b",
      "chat-start:model-b",
      "chat-end:model-b",
    ]);
    expect(
      threadDeltas(firstThread).find(
        (delta) => delta.kind === "extension.state",
      ),
    ).toMatchObject({
      payload: {
        selectedModel: "model-a",
        requestedModel: "model-a",
        actualModel: "model-a",
      },
    });
    expect(
      threadDeltas(secondThread).find(
        (delta) => delta.kind === "extension.state",
      ),
    ).toMatchObject({
      payload: {
        selectedModel: "model-b",
        requestedModel: "model-b",
        actualModel: "model-b",
      },
    });
  });

  it("interrupts only the active turn and keeps the RAPP session usable", async () => {
    let chatCount = 0;
    const prompts: unknown[] = [];
    const endpoint = await listen(async (incoming, response) => {
      response.setHeader("content-type", "application/json");
      if (incoming.method === "GET") {
        response.end(
          JSON.stringify({ status: "ok", version: "test", agents: [] }),
        );
        return;
      }
      const body = (await readJson(incoming)) as Record<string, unknown>;
      prompts.push(body.user_input);
      chatCount += 1;
      if (chatCount === 1) {
        response.write('{"response":"waiting');
        setTimeout(() => response.end('"}'), 500);
        return;
      }
      response.end(
        JSON.stringify({
          response: "after interrupt",
          session_id:
            typeof body.session_id === "string"
              ? body.session_id
              : "interrupt-session",
          agent_logs: [],
          requested_model: "claude-opus-5",
          model: "claude-opus-5",
        }),
      );
    });
    const threadId = "thr_interrupt_keeps_session";
    const start = await request("thread/start", {
      threadId,
      cwd: "/workspace/rapp",
      instructionMode: "append",
      options: options(endpoint),
    });
    const identity = start.result as { providerThreadId: string };

    await request("turn/start", {
      threadId,
      providerThreadId: identity.providerThreadId,
      input: [{ type: "text", text: "wait", mentions: [] }],
      clientRequestId: "creq_23456789af",
      options: options(endpoint),
    });
    await waitFor(
      () => threadDeltas(threadId).some((delta) => delta.kind === "turn.open"),
      "interruptible turn did not open",
    );
    await waitFor(
      () => prompts.length === 1 && prompts[0] === "wait",
      "interruptible prompt did not reach Brainstem",
    );
    const opened = threadDeltas(threadId).find(
      (delta) => delta.kind === "turn.open",
    );
    const providerTurnId = opened?.providerTurnId;
    expect(typeof providerTurnId).toBe("string");
    if (typeof providerTurnId !== "string") {
      throw new Error("turn.open did not carry a provider turn id");
    }

    await request("thread/stop", {
      threadId,
      providerThreadId: identity.providerThreadId,
      intent: "interrupt",
      activeTurnId: providerTurnId,
    });
    await waitFor(
      () =>
        threadDeltas(threadId).some(
          (delta) =>
            delta.kind === "turn.boundary" && delta.status === "interrupted",
        ),
      "active turn did not settle as interrupted",
    );

    await request("turn/start", {
      threadId,
      providerThreadId: identity.providerThreadId,
      input: [{ type: "text", text: "continue", mentions: [] }],
      clientRequestId: "creq_23456789ag",
      options: options(endpoint),
    });
    await waitFor(
      () => prompts.length === 2,
      "second prompt did not reach Brainstem after interrupt",
    );
    await waitFor(
      () =>
        threadDeltas(threadId).some(
          (delta) => agentMessageText(delta) === "after interrupt",
        ),
      "session was not usable after interrupt",
    );
    expect(prompts).toEqual(["wait", "continue"]);
  }, 15_000);

  it("ignores a stale release and settles persistence failures as failed turns", async () => {
    const endpoint = await listen(async (incoming, response) => {
      response.setHeader("content-type", "application/json");
      if (incoming.method === "GET") {
        response.end(
          JSON.stringify({ status: "ok", version: "test", agents: [] }),
        );
        return;
      }
      response.end(
        JSON.stringify({
          response: "still attached",
          session_id: "stale-stop-session",
          agent_logs: [],
          requested_model: "claude-opus-5",
          model: "claude-opus-5",
        }),
      );
    });
    const threadId = "thr_stale_stop";
    const start = await request("thread/start", {
      threadId,
      cwd: "/workspace/rapp",
      instructionMode: "append",
      options: options(endpoint),
    });
    const identity = start.result as { providerThreadId: string };
    await request("thread/stop", {
      threadId,
      providerThreadId: "rapp_stale_identity",
      intent: "release",
      activeTurnId: null,
    });
    await request("turn/start", {
      threadId,
      providerThreadId: identity.providerThreadId,
      input: [{ type: "text", text: "still here", mentions: [] }],
      clientRequestId: "creq_23456789ah",
      options: options(endpoint),
    });
    await waitForCompletedTurn(threadId);

    const brokenThreadId = "thr_persistence_failure";
    const brokenStart = await request("thread/start", {
      threadId: brokenThreadId,
      cwd: "/workspace/rapp",
      instructionMode: "append",
      options: options(endpoint),
    });
    const brokenIdentity = brokenStart.result as {
      providerThreadId: string;
    };
    rmSync(join(dataDir, "sessions"), { recursive: true, force: true });
    writeFileSync(join(dataDir, "sessions"), "not a directory");
    await request("turn/start", {
      threadId: brokenThreadId,
      providerThreadId: brokenIdentity.providerThreadId,
      input: [{ type: "text", text: "cannot persist", mentions: [] }],
      clientRequestId: "creq_23456789aj",
      options: options(endpoint),
    });
    await waitFor(
      () =>
        threadDeltas(brokenThreadId).some(
          (delta) =>
            delta.kind === "turn.boundary" && delta.status === "failed",
        ),
      "persistence failure did not settle the turn",
    );
    expect(
      threadDeltas(brokenThreadId).some(
        (delta) => agentMessageText(delta) !== null,
      ),
    ).toBe(false);
  });

  it("carries instructions, history, idempotency, logs, and RAPP/1 state across resume", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const paths: string[] = [];
    const endpoint = await listen(async (incoming, response) => {
      if (incoming.method === "GET") {
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            status: "ok",
            version: "test",
            agents: [],
          }),
        );
        return;
      }
      const body = await readJson(incoming);
      const parsed = body as Record<string, unknown>;
      requests.push(parsed);
      paths.push(incoming.url ?? "");
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          response: `answer-${requests.length}`,
          session_id:
            typeof parsed.session_id === "string"
              ? parsed.session_id
              : "session-1",
          agent_logs: `Agent-${requests.length}`,
          model: "grail-model",
          requested_model: "claude-opus-5",
        }),
      );
    });
    const threadId = "thr_rapp";
    const start = await request("thread/start", {
      threadId,
      cwd: "/workspace/rapp",
      instructionMode: "append",
      options: options(endpoint),
    });
    const identity = start.result as { providerThreadId: string };

    await request("turn/start", {
      threadId,
      providerThreadId: identity.providerThreadId,
      input: [{ type: "text", text: "first", mentions: [] }],
      clientRequestId: "creq_abcdefghjk",
      options: options(endpoint),
    });
    await waitForCompletedTurn(threadId);
    await request("thread/stop", {
      threadId,
      providerThreadId: identity.providerThreadId,
      intent: "release",
      activeTurnId: null,
    });
    expect(
      new RappSessionStore(dataDir).load(identity.providerThreadId)
        ?.pendingDelivery?.phase,
    ).toBe("emitted");
    await request("thread/resume", {
      threadId,
      providerThreadId: identity.providerThreadId,
      cwd: "/workspace/rapp",
      instructionMode: "append",
      options: options(endpoint),
    });

    await request("turn/start", {
      threadId,
      providerThreadId: identity.providerThreadId,
      input: [{ type: "text", text: "second", mentions: [] }],
      clientRequestId: "creq_mnpqrstuvw",
      options: options(endpoint),
    });
    await waitFor(
      () =>
        requests.length === 2 &&
        threadDeltas(threadId).some(
          (delta) => agentMessageText(delta) === "answer-2",
        ),
      "second turn did not settle after resume",
    );

    expect(requests).toHaveLength(2);
    expect(paths).toEqual(["/chat", "/chat"]);
    expect(requests[0]).toMatchObject({
      user_input: "first",
      idempotency_key: "creq_abcdefghjk",
      conversation_history: [
        {
          role: "user",
          content: "BB thread instructions:\nBe concise.",
        },
      ],
    });
    expect(requests[1]).toMatchObject({
      user_input: "second",
      idempotency_key: "creq_mnpqrstuvw",
      conversation_history: [
        {
          role: "user",
          content: "BB thread instructions:\nBe concise.",
        },
        { role: "user", content: "first" },
        { role: "assistant", content: "answer-1" },
      ],
    });

    const deltas = threadDeltas(threadId);
    expect(
      deltas
        .map(agentMessageText)
        .filter((text): text is string => text !== null),
    ).toEqual(["answer-1", "answer-1", "answer-2"]);
    const collector = createBridgeDeltaEventCollector(RAPP_PROVIDER_ID);
    const assembled = harness.messages.flatMap((message) =>
      collector.assembleMessage(message),
    );
    expect(
      assembled.flatMap((event) =>
        event.type === "item/completed" &&
        event.item.type === "agentMessage"
          ? [event.item.text]
          : [],
      ),
    ).toEqual(["answer-1", "answer-2"]);
    const states = deltas.filter((delta) => delta.kind === "extension.state");
    expect(states.at(-1)).toMatchObject({
      payload: {
        spec: RAPP_SPEC,
        grail: "consumer",
        sessionId: "session-1",
        turnCount: 2,
        eggAddress: expect.stringMatching(/^[0-9a-f]{64}$/u),
        selectedModel: RAPP_MODEL_ID,
        requestedModel: "claude-opus-5",
        actualModel: "grail-model",
      },
    });
    expect(
      assembled.flatMap((event) =>
        event.type === "item/completed" &&
        event.item.type === "toolCall" &&
        event.item.tool === "rapp_agents"
          ? [event.item.result]
          : [],
      ),
    ).toEqual(["Agent-1", "Agent-2"]);
  });
});
