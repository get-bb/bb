import { createServer, request as httpRequest } from "node:http";
import type { IncomingHttpHeaders, IncomingMessage, Server } from "node:http";
import { describe, expect, it, vi } from "vitest";
import type { JsonValue } from "@bb/domain";
import { startClaudeCodeMockCliTrafficProxy } from "../mock-cli-traffic-proxy.js";

interface CapturedRequest {
  body: string;
  headers: IncomingHttpHeaders;
  method: string | undefined;
  url: string | undefined;
}

interface CapturingUpstreamServer {
  baseUrl: string;
  close(): Promise<void>;
  capturedRequest: Promise<CapturedRequest>;
}

interface SendJsonRequestArgs {
  body: JsonValue;
  headers: Record<string, string>;
  url: string;
}

interface HttpResponse {
  body: string;
  statusCode: number;
}

interface InvalidEndpointCase {
  endpoint: string;
}

function readMessageBody(message: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    message.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    message.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    message.on("error", reject);
  });
}

function listen(server: Server): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Expected upstream server to bind to a TCP port"));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function startCapturingUpstreamServer(): Promise<CapturingUpstreamServer> {
  let resolveCapturedRequest: (value: CapturedRequest) => void = () =>
    undefined;
  const capturedRequest = new Promise<CapturedRequest>((resolve) => {
    resolveCapturedRequest = resolve;
  });
  const server = createServer(async (request, response) => {
    resolveCapturedRequest({
      body: await readMessageBody(request),
      headers: request.headers,
      method: request.method,
      url: request.url,
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
  });

  return {
    baseUrl: await listen(server),
    close: () => closeServer(server),
    capturedRequest,
  };
}

function sendJsonRequest(args: SendJsonRequestArgs): Promise<HttpResponse> {
  const body = JSON.stringify(args.body);
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      new URL(args.url),
      {
        headers: {
          ...args.headers,
          "content-length": String(Buffer.byteLength(body)),
        },
        method: "POST",
      },
      async (response) => {
        resolve({
          body: await readMessageBody(response),
          statusCode: response.statusCode ?? 0,
        });
      },
    );
    request.on("error", reject);
    request.end(body);
  });
}

describe("startClaudeCodeMockCliTrafficProxy", () => {
  it("rewrites SDK identity headers and JSON body fields for a local endpoint", async () => {
    const stderrWrite = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const upstream = await startCapturingUpstreamServer();
    try {
      const proxy = await startClaudeCodeMockCliTrafficProxy({
        endpoint: upstream.baseUrl,
        threadId: "thr_mock_proxy",
      });
      try {
        const response = await sendJsonRequest({
          url: `${proxy.baseUrl}/v1/messages`,
          headers: {
            "content-type": "application/json",
            "user-agent":
              "claude-cli/2.1.170 (external, sdk-cli, agent-sdk/0.3.162)",
            "x-anthropic-billing-header":
              "client=agent-sdk/0.3.162; cc_entrypoint=sdk-cli",
          },
          body: {
            metadata: {
              cc_entrypoint: "sdk-cli",
              note: "sdk-ts agent-sdk/0.3.162",
            },
            messages: [
              {
                role: "user",
                content: "sent by sdk-cli",
              },
            ],
          },
        });

        expect(response.statusCode).toBe(200);
        expect(response.body).toBe(JSON.stringify({ ok: true }));

        const capturedRequest = await upstream.capturedRequest;
        expect(capturedRequest.method).toBe("POST");
        expect(capturedRequest.url).toBe("/v1/messages");
        expect(capturedRequest.headers["user-agent"]).toBe(
          "claude-cli/2.1.170 (external, cli)",
        );
        expect(capturedRequest.headers["x-anthropic-billing-header"]).toBe(
          "client=cli-mock-agent-sdk/0.3.162; cc_entrypoint=cli",
        );

        const capturedBody: unknown = JSON.parse(capturedRequest.body);
        expect(capturedBody).toEqual({
          metadata: {
            cc_entrypoint: "cli",
            note: "cli cli-mock-agent-sdk/0.3.162",
          },
          messages: [
            {
              role: "user",
              content: "sent by cli",
            },
          ],
        });
      } finally {
        await proxy.close();
      }
    } finally {
      stderrWrite.mockRestore();
      await upstream.close();
    }
  });

  it("normalizes any billing header entrypoint to cli and logs the forwarded request", async () => {
    const stderrWrite = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const upstream = await startCapturingUpstreamServer();
    try {
      const proxy = await startClaudeCodeMockCliTrafficProxy({
        endpoint: upstream.baseUrl,
        threadId: "thr_mock_proxy",
      });
      try {
        const response = await sendJsonRequest({
          url: `${proxy.baseUrl}/v1/messages`,
          headers: {
            "content-type": "application/json",
            "user-agent": "claude-cli/2.1.170 (external, desktop)",
            "x-anthropic-billing-header":
              "cc_version=2.1.170; cc_entrypoint=desktop; cch=00000",
          },
          body: { message: "hello" },
        });

        expect(response.statusCode).toBe(200);

        const capturedRequest = await upstream.capturedRequest;
        expect(capturedRequest.headers["x-anthropic-billing-header"]).toBe(
          "cc_version=2.1.170; cc_entrypoint=cli; cch=00000",
        );
        expect(stderrWrite).toHaveBeenCalledWith(
          expect.stringContaining(
            '"component":"claude-code-mock-cli-traffic-proxy"',
          ),
        );
        expect(stderrWrite).toHaveBeenCalledWith(
          expect.stringContaining('"billingHeader":"rewritten-to-cli"'),
        );
      } finally {
        await proxy.close();
      }
    } finally {
      stderrWrite.mockRestore();
      await upstream.close();
    }
  });

  it("accepts the approved Anthropic test endpoint", async () => {
    const proxy = await startClaudeCodeMockCliTrafficProxy({
      endpoint: "https://api.anthropic.com",
      threadId: "thr_mock_proxy",
    });
    await proxy.close();
  });

  const invalidEndpointCases = [
    { endpoint: "https://127.0.0.1:18950" },
    { endpoint: "http://example.com:18950" },
    { endpoint: "https://test.anthropic.com" },
  ] satisfies InvalidEndpointCase[];

  it.each(invalidEndpointCases)(
    "rejects non-local mock endpoint $endpoint",
    async ({ endpoint }) => {
      await expect(
        startClaudeCodeMockCliTrafficProxy({
          endpoint,
          threadId: "thr_mock_proxy",
        }),
      ).rejects.toThrow(
        "Mock CLI traffic endpoint must be an http:// loopback URL or https://api.anthropic.com",
      );
    },
  );
});
