import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cliFetch, createCliBbSdk } from "../client.js";

interface RecordingServer {
  requests: IncomingHttpHeaders[];
  url: string;
}

const servers: Server[] = [];

async function startRecordingServer(): Promise<RecordingServer> {
  const requests: IncomingHttpHeaders[] = [];
  const server = createServer((request, response) => {
    requests.push(request.headers);
    response.writeHead(200, { "content-type": "application/json" }).end("{}");
  });
  servers.push(server);
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const { port } = server.address() as AddressInfo;
  return {
    requests,
    url: `http://127.0.0.1:${String(port)}`,
  };
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  );
});

describe("cliFetch", () => {
  it("attaches BB_SERVER_HEADERS only to requests for the configured server", async () => {
    const configured = await startRecordingServer();
    const other = await startRecordingServer();
    vi.stubEnv("BB_SERVER_URL", configured.url);
    vi.stubEnv(
      "BB_SERVER_HEADERS",
      JSON.stringify({ "x-bb-connect-machine": "test-machine-credential" }),
    );

    await cliFetch(`${configured.url}/api/v1/projects`, {
      headers: { "x-bb-connect-machine": "caller-value", accept: "text/plain" },
    });
    await cliFetch(new Request(`${configured.url}/api/v1/hosts`));
    await cliFetch(`${other.url}/catalog.json`);

    expect(
      configured.requests.map((headers) => headers["x-bb-connect-machine"]),
    ).toEqual(["test-machine-credential", "test-machine-credential"]);
    expect(configured.requests[0]?.accept).toBe("text/plain");
    expect(other.requests).toHaveLength(1);
    expect(other.requests[0]?.["x-bb-connect-machine"]).toBeUndefined();
  });

  it("sends SDK requests with the configured server headers", async () => {
    const configured = await startRecordingServer();
    vi.stubEnv("BB_SERVER_URL", configured.url);
    vi.stubEnv(
      "BB_SERVER_HEADERS",
      JSON.stringify({ "x-bb-connect-machine": "test-machine-credential" }),
    );

    await createCliBbSdk(configured.url)
      .projects.list()
      .catch(() => undefined);

    expect(configured.requests).toHaveLength(1);
    expect(configured.requests[0]?.["x-bb-connect-machine"]).toBe(
      "test-machine-credential",
    );
  });

  it("sends no server headers when BB_SERVER_HEADERS is unset", async () => {
    const configured = await startRecordingServer();
    vi.stubEnv("BB_SERVER_URL", configured.url);
    vi.stubEnv("BB_SERVER_HEADERS", undefined);

    await cliFetch(`${configured.url}/api/v1/projects`);

    expect(configured.requests[0]?.["x-bb-connect-machine"]).toBeUndefined();
  });
});
