import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cliFetch, createCliBbSdk } from "../client.js";

interface RecordingServer {
  requests: IncomingHttpHeaders[];
  url: string;
}

const servers: Server[] = [];

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "bb-cli-client-"));
  vi.stubEnv("BB_DATA_DIR", dataDir);
  vi.stubEnv("BB_SERVER_HEADERS", undefined);
});

async function startRecordingServer(
  redirectUrl?: string,
): Promise<RecordingServer> {
  const requests: IncomingHttpHeaders[] = [];
  const server = createServer((request, response) => {
    requests.push(request.headers);
    if (redirectUrl !== undefined) {
      response.writeHead(302, { location: redirectUrl }).end();
      return;
    }
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
  rmSync(dataDir, { recursive: true, force: true });
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

describe("CLI saved credentials and redirects", () => {
  it("authenticates without connection environment variables", async () => {
    const configured = await startRecordingServer();
    vi.stubEnv("BB_SERVER_URL", undefined);
    writeFileSync(
      join(dataDir, "config.json"),
      JSON.stringify({
        serverUrl: configured.url,
        serverHeaders: { "x-bb-connect-machine": "test-saved-credential" },
      }),
    );
    await cliFetch(`${configured.url}/api/v1/projects`);
    expect(configured.requests[0]?.["x-bb-connect-machine"]).toBe(
      "test-saved-credential",
    );
  });

  it("never forwards the machine credential after a redirect, even when follow is requested", async () => {
    const other = await startRecordingServer();
    const configured = await startRecordingServer(other.url);
    vi.stubEnv("BB_SERVER_URL", configured.url);
    vi.stubEnv(
      "BB_SERVER_HEADERS",
      JSON.stringify({ "x-bb-connect-machine": "test-machine-credential" }),
    );
    await expect(
      cliFetch(`${configured.url}/api/v1/projects`, { redirect: "follow" }),
    ).rejects.toThrow();
    expect(configured.requests[0]?.["x-bb-connect-machine"]).toBe(
      "test-machine-credential",
    );
    expect(other.requests).toHaveLength(0);
  });

  it.each([undefined, "{}"])(
    "preserves default redirect behavior without credentials (%s)",
    async (headers) => {
      const other = await startRecordingServer();
      const configured = await startRecordingServer(other.url);
      vi.stubEnv("BB_SERVER_URL", configured.url);
      vi.stubEnv("BB_SERVER_HEADERS", headers);
      const response = await cliFetch(`${configured.url}/api/v1/projects`);
      expect(response.status).toBe(200);
      expect(other.requests).toHaveLength(1);
      expect(other.requests[0]?.["x-bb-connect-machine"]).toBeUndefined();
    },
  );
});

describe("invalid private headers", () => {
  it.each(["saved", "environment"])(
    "rejects invalid %s headers without exposing their values",
    async (source) => {
      const configured = await startRecordingServer();
      const cases = [
        { "x-bb-connect-machine": "FAKE_SECRET_SENTINEL\nSECOND_PART" },
        { "invalid\nheader": "FAKE_SECRET_SENTINEL" },
      ];
      for (const headers of cases) {
        vi.stubEnv(
          "BB_SERVER_URL",
          source === "saved" ? undefined : configured.url,
        );
        if (source === "saved") {
          writeFileSync(
            join(dataDir, "config.json"),
            JSON.stringify({
              serverUrl: configured.url,
              serverHeaders: headers,
            }),
          );
        } else {
          vi.stubEnv("BB_SERVER_HEADERS", JSON.stringify(headers));
        }
        expect(() =>
          cliFetch(`${configured.url}/api/v1/projects`),
        ).toThrowError(new Error("Invalid private BB server headers"));
      }
      expect(configured.requests).toHaveLength(0);
    },
  );
});
