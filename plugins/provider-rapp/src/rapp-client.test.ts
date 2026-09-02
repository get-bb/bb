import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  callRapp,
  RappClientError,
  resolveRappClientConfig,
  type RappChatRequest,
} from "./rapp-client.js";

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
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

const chatRequest: RappChatRequest = {
  userInput: "hello",
  sessionId: "session-1",
  idempotencyKey: "request-1",
  conversationHistory: [{ role: "user", content: "earlier" }],
};

describe("RAPP Grail client", () => {
  it("normalizes the Consumer Grail response while preserving RAPP/1 request fields", async () => {
    let received: unknown;
    const base = await listen(async (request, response) => {
      received = await readJson(request);
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          response: "consumer answer",
          session_id: "session-1",
          agent_logs: "AgentOne\nAgentTwo",
          model: "claude-opus-5",
          requested_model: "claude-sonnet-5",
          voice_mode: false,
        }),
      );
    });
    const config = resolveRappClientConfig(
      { grail: "consumer", endpoint: base },
      {},
    );
    const result = await callRapp(
      config,
      chatRequest,
      new AbortController().signal,
    );
    expect(received).toEqual({
      user_input: "hello",
      session_id: "session-1",
      idempotency_key: "request-1",
      conversation_history: [{ role: "user", content: "earlier" }],
    });
    expect(result).toEqual({
      response: "consumer answer",
      agentLogs: ["AgentOne", "AgentTwo"],
      sessionId: "session-1",
      requestedModel: "claude-sonnet-5",
      actualModel: "claude-opus-5",
    });
    expect(config.endpoint.pathname).toBe("/chat");
    expect(config.modelListEndpoint?.pathname).toBe("/models");
    expect(config.modelSetEndpoint?.pathname).toBe("/models/set");
  });

  it("omits session_id until Brainstem assigns one", async () => {
    let received: unknown;
    const base = await listen(async (request, response) => {
      received = await readJson(request);
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          response: "assigned",
          session_id: "brainstem-session",
          agent_logs: [],
          model: "claude-opus-5",
          requested_model: "claude-opus-5",
        }),
      );
    });
    const result = await callRapp(
      resolveRappClientConfig({ grail: "consumer", endpoint: base }, {}),
      { ...chatRequest, sessionId: null },
      new AbortController().signal,
    );

    expect(received).toEqual({
      user_input: "hello",
      idempotency_key: "request-1",
      conversation_history: [{ role: "user", content: "earlier" }],
    });
    expect(result.sessionId).toBe("brainstem-session");
  });

  it("normalizes the Business Grail and keeps credentials out of the URL and body", async () => {
    let received: unknown;
    let functionKey: string | undefined;
    const base = await listen(async (request, response) => {
      received = await readJson(request);
      functionKey = request.headers["x-functions-key"] as string | undefined;
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          assistant_response: "business answer",
          voice_response: "short answer",
          agent_logs: ["BusinessAgent"],
          user_guid: "user-1",
        }),
      );
    });
    const config = resolveRappClientConfig(
      { grail: "business", endpoint: base },
      {
        RAPP_FUNCTION_KEY: "function-secret",
        RAPP_USER_GUID: "user-1",
      },
    );
    const result = await callRapp(
      config,
      chatRequest,
      new AbortController().signal,
    );
    expect(config.endpoint.pathname).toBe("/api/businessinsightbot_function");
    expect(config.endpoint.search).toBe("");
    expect(functionKey).toBe("function-secret");
    expect(received).toEqual({
      user_input: "hello",
      session_id: "session-1",
      idempotency_key: "request-1",
      conversation_history: [{ role: "user", content: "earlier" }],
      user_guid: "user-1",
    });
    expect(result.response).toBe("business answer");
    expect(result.sessionId).toBe("session-1");
    expect(result.requestedModel).toBeNull();
    expect(result.actualModel).toBeNull();
    expect(config.modelListEndpoint).toBeNull();
    expect(config.modelSetEndpoint).toBeNull();
  });

  it("refuses secret-bearing endpoint query parameters", () => {
    expect(() =>
      resolveRappClientConfig(
        {
          grail: "business",
          endpoint:
            "https://example.com/api/businessinsightbot_function?code=x",
        },
        {},
      ),
    ).toThrow("secret-bearing query parameters");
  });

  it("refuses URL credentials and credential-bearing remote HTTP", () => {
    expect(() =>
      resolveRappClientConfig(
        {
          grail: "consumer",
          endpoint: "https://user:password@example.com/chat",
        },
        {},
      ),
    ).toThrow("without credentials");
    expect(() =>
      resolveRappClientConfig(
        {
          grail: "business",
          endpoint: "http://example.com/api/businessinsightbot_function",
        },
        { RAPP_FUNCTION_KEY: "secret" },
      ),
    ).toThrow("require HTTPS");
  });

  it("does not forward credentials or prompts through redirects", async () => {
    let redirected = false;
    const target = await listen((_request, response) => {
      redirected = true;
      response.end();
    });
    const source = await listen((_request, response) => {
      response.statusCode = 307;
      response.setHeader("location", `${target}/capture`);
      response.end();
    });
    const config = resolveRappClientConfig(
      { grail: "business", endpoint: source },
      { RAPP_FUNCTION_KEY: "function-secret" },
    );

    await expect(
      callRapp(config, chatRequest, new AbortController().signal),
    ).rejects.toMatchObject({
      name: "RappClientError",
      kind: "connection",
    });
    expect(redirected).toBe(false);
  });

  it("keeps timeout and abort coverage active while reading the body", async () => {
    const base = await listen((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.write('{"response":"partial');
      setTimeout(() => response.end('"}'), 200);
    });
    const config = {
      ...resolveRappClientConfig({ grail: "consumer", endpoint: base }, {}),
      timeoutMs: 25,
    };

    const error = await callRapp(
      config,
      chatRequest,
      new AbortController().signal,
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RappClientError);
    expect(error).toMatchObject({ kind: "timeout" });
  });
});
