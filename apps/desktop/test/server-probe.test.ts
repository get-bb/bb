import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { probeBbServer } from "../src/server-probe.js";

interface TestServer {
  close(): Promise<void>;
  url: string;
}

interface StartTestServerArgs {
  handler(request: IncomingMessage, response: ServerResponse): void;
}

const testServers: TestServer[] = [];

function writeJson(
  response: ServerResponse,
  status: number,
  body: string,
): void {
  response.writeHead(status, {
    "content-type": "application/json",
  });
  response.end(body);
}

async function startTestServer(args: StartTestServerArgs): Promise<TestServer> {
  const server = createServer(args.handler);
  await new Promise<void>((resolvePromise) => {
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected test server to listen on a TCP port");
  }
  const testServer: TestServer = {
    close: async () => {
      await new Promise<void>((resolvePromise, rejectPromise) => {
        server.close((error) => {
          if (error) {
            rejectPromise(error);
            return;
          }
          resolvePromise();
        });
      });
    },
    url: `http://127.0.0.1:${address.port}`,
  };
  testServers.push(testServer);
  return testServer;
}

afterEach(async () => {
  while (testServers.length > 0) {
    const testServer = testServers.pop();
    if (testServer !== undefined) {
      await testServer.close();
    }
  }
});

describe("probeBbServer", () => {
  it("accepts a server with bb health and system config endpoints", async () => {
    const testServer = await startTestServer({
      handler(request, response) {
        if (request.url === "/health") {
          writeJson(response, 200, JSON.stringify({ ok: true }));
          return;
        }
        if (request.url === "/api/v1/system/config") {
          writeJson(
            response,
            200,
            JSON.stringify({
              featureFlags: {},
              hostDaemonPort: 38887,
              voiceTranscriptionEnabled: false,
            }),
          );
          return;
        }
        writeJson(response, 404, JSON.stringify({ message: "not found" }));
      },
    });

    await expect(
      probeBbServer({ serverUrl: testServer.url, timeoutMs: 500 }),
    ).resolves.toEqual({
      kind: "compatible",
      serverUrl: testServer.url,
    });
  });

  it("rejects a health-only service as incompatible", async () => {
    const testServer = await startTestServer({
      handler(request, response) {
        if (request.url === "/health") {
          writeJson(response, 200, JSON.stringify({ ok: true }));
          return;
        }
        writeJson(response, 404, JSON.stringify({ message: "not found" }));
      },
    });

    const result = await probeBbServer({
      serverUrl: testServer.url,
      timeoutMs: 500,
    });

    expect(result.kind).toBe("incompatible");
  });

  it("does not depend on the production version endpoint for startup compatibility", async () => {
    const testServer = await startTestServer({
      handler(request, response) {
        if (request.url === "/health") {
          writeJson(response, 200, JSON.stringify({ ok: true }));
          return;
        }
        if (request.url === "/api/v1/system/config") {
          writeJson(
            response,
            200,
            JSON.stringify({
              featureFlags: {},
              hostDaemonPort: 38887,
              voiceTranscriptionEnabled: false,
            }),
          );
          return;
        }
        if (request.url === "/api/v1/system/version") {
          return;
        }
        writeJson(response, 404, JSON.stringify({ message: "not found" }));
      },
    });

    await expect(
      probeBbServer({ serverUrl: testServer.url, timeoutMs: 50 }),
    ).resolves.toEqual({
      kind: "compatible",
      serverUrl: testServer.url,
    });
  });

  it("reports unavailable when nothing is listening", async () => {
    const testServer = await startTestServer({
      handler(_request, response) {
        writeJson(response, 200, JSON.stringify({ ok: true }));
      },
    });
    const unavailableUrl = testServer.url;
    await testServer.close();
    testServers.pop();

    const result = await probeBbServer({
      serverUrl: unavailableUrl,
      timeoutMs: 500,
    });

    expect(result.kind).toBe("unavailable");
  });
});
