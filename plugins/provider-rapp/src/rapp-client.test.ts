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
import {
  RAPP_BRAINSTEM_SECRET_ENV,
  RAPP_BRAINSTEM_URL_ENV,
  RAPP_BUSINESS_URL_ENV,
  RAPP_ENDPOINT_URL_REQUIREMENTS,
  RAPP_FUNCTION_KEY_ENV,
} from "./vocabulary.js";

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
  return listenOn("127.0.0.1", handler);
}

async function listenOn(
  host: "127.0.0.1" | "::1",
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<string> {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once("error", onError);
    server.listen(0, host, () => {
      server.off("error", onError);
      resolve();
    });
  });
  servers.push(server);
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected TCP server address");
  }
  const displayHost = host === "::1" ? "[::1]" : host;
  return `http://${displayHost}:${address.port}`;
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

const invalidRuntimeEndpoints = [
  {
    label: "a generic query parameter",
    endpoint: "https://example.com/chat?tenant=test",
  },
  {
    label: "a sig query parameter",
    endpoint:
      "https://example.com/api/businessinsightbot_function?sig=secret",
  },
  {
    label: "a signature query parameter",
    endpoint: "https://example.com/chat?signature=secret",
  },
  {
    label: "an auth query parameter",
    endpoint:
      "https://example.com/api/businessinsightbot_function?auth=secret",
  },
  {
    label: "a credential query parameter",
    endpoint: "https://example.com/chat?credential=secret",
  },
  {
    label: "a username",
    endpoint: "https://user@example.com/chat",
  },
  {
    label: "a password",
    endpoint: "https://:password@example.com/chat",
  },
  {
    label: "a fragment",
    endpoint: "https://example.com/chat#tenant",
  },
];

const runtimeEndpointSources = [
  {
    label: "Consumer",
    grail: "consumer",
    envName: RAPP_BRAINSTEM_URL_ENV,
  },
  {
    label: "Business",
    grail: "business",
    envName: RAPP_BUSINESS_URL_ENV,
  },
] as const;

describe("RAPP Grail client", () => {
  it("normalizes the Consumer Grail response while preserving RAPP/1 request fields", async () => {
    let received: unknown;
    let brainstemSecret: string | string[] | undefined;
    const base = await listen(async (request, response) => {
      received = await readJson(request);
      brainstemSecret = request.headers["x-brainstem-secret"];
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
      { [RAPP_BRAINSTEM_SECRET_ENV]: "brainstem-secret" },
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
    expect(brainstemSecret).toBe("brainstem-secret");
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
    let functionKey: string | string[] | undefined;
    const base = await listen(async (request, response) => {
      received = await readJson(request);
      functionKey = request.headers["x-functions-key"];
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
        [RAPP_FUNCTION_KEY_ENV]: "function-secret",
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

  describe.each(runtimeEndpointSources)(
    "$label runtime endpoint validation",
    ({ grail, envName }) => {
      it.each(invalidRuntimeEndpoints)("rejects $label", ({ endpoint }) => {
        const resolve = () =>
          resolveRappClientConfig(
            { grail, endpoint: "" },
            { [envName]: endpoint },
          );

        expect(resolve).toThrowError(RappClientError);
        expect(resolve).toThrow(RAPP_ENDPOINT_URL_REQUIREMENTS);
      });
    },
  );

  it("contacts an explicitly running IPv6 loopback endpoint without rewriting it", async () => {
    let requestUrl: string | undefined;
    let brainstemSecret: string | string[] | undefined;
    const base = await listenOn("::1", (request, response) => {
      requestUrl = request.url;
      brainstemSecret = request.headers["x-brainstem-secret"];
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          response: "ipv6 answer",
          session_id: "session-1",
          agent_logs: [],
        }),
      );
    });
    const config = resolveRappClientConfig(
      { grail: "consumer", endpoint: base },
      { [RAPP_BRAINSTEM_SECRET_ENV]: "ipv6-secret" },
    );

    const result = await callRapp(
      config,
      chatRequest,
      new AbortController().signal,
    );

    expect(config.endpoint.toString()).toBe(`${base}/chat`);
    expect(requestUrl).toBe("/chat");
    expect(brainstemSecret).toBe("ipv6-secret");
    expect(result.response).toBe("ipv6 answer");
  });

  it("refuses credential-bearing remote HTTP", () => {
    expect(() =>
      resolveRappClientConfig(
        {
          grail: "business",
          endpoint: "http://example.com/api/businessinsightbot_function",
        },
        { [RAPP_FUNCTION_KEY_ENV]: "secret" },
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
