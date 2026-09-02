import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
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
  handleLine,
} from "./src/bridge.js";
import {
  RAPP_BUSINESS_MODEL_ID,
  RAPP_MODEL_ID,
  RAPP_PROVIDER_ID,
  RAPP_SPEC,
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
        message:
          "RAPP Brainstem requested model model-b after bb selected model-a",
      },
    });
    expect(
      threadDeltas(threadId).some((delta) => delta.kind === "extension.state"),
    ).toBe(false);
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
        requestedModel: RAPP_BUSINESS_MODEL_ID,
        actualModel: RAPP_BUSINESS_MODEL_ID,
      },
    });
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

  it("persists and reuses an exact pending chat after failure and resume", async () => {
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
        response.end(JSON.stringify({ error: "retry this turn" }));
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
    await waitForCompletedTurn(threadId);

    await request("turn/start", {
      threadId,
      providerThreadId: identity.providerThreadId,
      input: [{ type: "text", text: "next prompt", mentions: [] }],
      clientRequestId: "creq_23456789ae",
      options: options(endpoint),
    });
    await waitFor(
      () =>
        threadDeltas(threadId).filter(
          (delta) =>
            delta.kind === "turn.boundary" && delta.status === "completed",
        ).length === 2,
      "new turn did not complete after pending success",
    );

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
    expect(requests[1]).toEqual(requests[0]);
    expect(requests[2]).toMatchObject({
      user_input: "next prompt",
      session_id: "remote-session",
      idempotency_key: "creq_23456789ae",
      conversation_history: [
        {
          role: "user",
          content: "BB thread instructions:\nBe concise.",
        },
        { role: "user", content: "original prompt" },
        { role: "assistant", content: "answer-2" },
      ],
    });
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
          (delta) =>
            delta.kind === "item.textClose" && delta.text === "after interrupt",
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
        (delta) => delta.kind === "item.textClose",
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
        threadDeltas(threadId).filter(
          (delta) =>
            delta.kind === "turn.boundary" && delta.status === "completed",
        ).length === 2,
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
        .filter((delta) => delta.kind === "item.textClose")
        .map((delta) => delta.text),
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
      deltas
        .filter(
          (delta) =>
            delta.kind === "item.close" &&
            (delta.item as { tool?: string } | undefined)?.tool ===
              "rapp_agents",
        )
        .map((delta) => (delta.item as { result?: string }).result),
    ).toEqual(["Agent-1", "Agent-2"]);
  });
});
