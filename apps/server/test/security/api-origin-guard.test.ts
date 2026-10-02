import http from "node:http";
import { createConnection } from "node:net";
import { threads } from "@bb/db";
import { createNodeBbSdk } from "@bb/sdk/node";
import { afterEach, describe, expect, it } from "vitest";
import {
  startTestServer,
  type RunningTestServer,
} from "../helpers/test-app.js";
import { seedThreadFixture } from "../helpers/seed.js";

let server: RunningTestServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

interface RequestArgs {
  body?: string;
  headers?: Record<string, string>;
  method?: string;
  path?: string;
}

async function statusFor(
  baseUrl: string,
  args: RequestArgs = {},
): Promise<number> {
  const response = await fetch(
    new URL(args.path ?? "/api/v1/threads", baseUrl),
    {
      method: args.method ?? "GET",
      ...(args.headers === undefined ? {} : { headers: args.headers }),
    },
  );
  return response.status;
}

function rawStatus(
  baseUrl: string,
  headers: Record<string, string>,
  args: RequestArgs = {},
): Promise<number> {
  return rawResponse(baseUrl, { ...args, headers }).then(
    (response) => response.status,
  );
}

function rawResponse(baseUrl: string, args: RequestArgs) {
  const url = new URL(args.path ?? "/api/v1/threads", baseUrl);
  return new Promise<{
    status: number;
    body: string;
    headers: http.IncomingHttpHeaders;
  }>((resolve, reject) => {
    const request = http.request(
      {
        host: url.hostname,
        port: url.port,
        path: url.pathname,
        method: args.method ?? "GET",
        headers: args.headers,
        setHost: args.headers?.host === undefined,
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          body += chunk;
        });
        response.once("error", reject);
        response.once("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            body,
            headers: response.headers,
          }),
        );
      },
    );
    request.once("error", reject);
    request.end(args.body);
  });
}

function duplicateHostStatus(
  baseUrl: string,
  hosts: string[],
): Promise<number> {
  const url = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const socket = createConnection({
      host: url.hostname,
      port: Number(url.port),
    });
    let response = "";
    socket.setEncoding("utf8");
    socket.setTimeout(5000, () =>
      socket.destroy(new Error("HTTP response timed out")),
    );
    socket.once("connect", () => {
      socket.write(
        `GET /api/v1/threads HTTP/1.1\r\n${hosts.map((host) => `Host: ${host}\r\n`).join("")}Connection: close\r\n\r\n`,
      );
    });
    socket.on("data", (chunk: string) => {
      response += chunk;
    });
    socket.once("error", reject);
    socket.once("end", () => {
      const status = /^HTTP\/1\.[01] ([0-9]{3})/u.exec(response)?.[1];
      if (status === undefined) {
        reject(new Error("Missing HTTP response status"));
      } else {
        resolve(Number(status));
      }
    });
  });
}

function hostlessStatus(baseUrl: string): Promise<number> {
  const url = new URL("/api/v1/threads", baseUrl);
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: url.hostname,
        port: url.port,
        path: url.pathname,
        setHost: false,
      },
      (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      },
    );
    request.once("error", reject);
    request.end();
  });
}

describe("/api/v1 browser origin guard", () => {
  it("passes callers that send no Origin: curl, the bb CLI, and the SDK", async () => {
    server = await startTestServer();

    expect(await statusFor(server.baseUrl)).toBe(200);
    expect(
      await statusFor(server.baseUrl, {
        method: "POST",
        path: "/api/v1/threads",
        headers: { "content-type": "application/json" },
      }),
    ).not.toBe(403);

    expect(
      await statusFor(server.baseUrl, {
        method: "POST",
        path: "/api/v1/threads",
        headers: { "content-type": "application/x-www-form-urlencoded" },
      }),
    ).not.toBe(415);

    const sdk = createNodeBbSdk({ baseUrl: server.baseUrl });
    await expect(sdk.threads.list()).resolves.toBeDefined();
  });

  it("rejects a foreign browser origin on both reads and mutations", async () => {
    server = await startTestServer();

    for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
      expect(
        await statusFor(server.baseUrl, {
          method,
          headers: {
            origin: "http://127.0.0.1:3009",
            "content-type": "text/plain",
          },
        }),
      ).toBe(403);
    }
  });

  it("rejects a sandboxed iframe's opaque origin", async () => {
    server = await startTestServer();

    for (const method of ["GET", "POST"]) {
      expect(
        await statusFor(server.baseUrl, {
          method,
          headers: { origin: "null", "content-type": "text/plain" },
        }),
      ).toBe(403);
    }
  });

  it("accepts the configured local app origin", async () => {
    server = await startTestServer();
    const origin = new URL(server.baseUrl).origin;

    expect(await statusFor(server.baseUrl, { headers: { origin } })).toBe(200);
  });

  it("accepts the origin the connect tunnel rewrites to", async () => {
    server = await startTestServer();
    const loopbackOrigin = new URL(server.baseUrl).origin;

    expect(
      await statusFor(server.baseUrl, {
        method: "POST",
        headers: {
          origin: loopbackOrigin,
          host: new URL(server.baseUrl).host,
          "content-type": "application/json",
        },
      }),
    ).not.toBe(403);
  });

  it("rejects an unrewritten public connect origin, documenting the tunnel dependency", async () => {
    server = await startTestServer();

    expect(
      await statusFor(server.baseUrl, {
        headers: { origin: "https://bee.getbb.app" },
      }),
    ).toBe(403);
  });

  it("rejects unconfigured LAN, proxy, and IPv6 hostnames", async () => {
    server = await startTestServer();
    const port = new URL(server.baseUrl).port;

    expect(
      await rawStatus(server.baseUrl, {
        origin: `http://192.168.1.5:${port}`,
        host: `192.168.1.5:${port}`,
      }),
    ).toBe(403);

    expect(
      await rawStatus(server.baseUrl, {
        origin: "https://box.ts.net",
        host: "box.ts.net",
        "x-forwarded-proto": "https",
      }),
    ).toBe(403);

    expect(
      await rawStatus(server.baseUrl, {
        origin: `http://192.168.1.5:${port}`,
        host: `127.0.0.1:${port}`,
        "x-forwarded-host": `192.168.1.5:${port}`,
      }),
    ).toBe(403);

    expect(
      await rawStatus(server.baseUrl, {
        origin: `http://[::1]:${port}`,
        host: `[::1]:${port}`,
      }),
    ).toBe(403);
  });

  it("does not trust proxy headers to authorize an origin", async () => {
    server = await startTestServer();
    const port = new URL(server.baseUrl).port;

    expect(
      await rawStatus(server.baseUrl, {
        origin: `http://192.168.1.5:${port}`,
        host: `127.0.0.1:${port}`,
      }),
    ).toBe(403);
  });

  it("accepts a configured app origin", async () => {
    server = await startTestServer({ appUrl: "https://app.example.com" });

    expect(
      await statusFor(server.baseUrl, {
        headers: { origin: "https://app.example.com" },
      }),
    ).toBe(200);
  });

  it.each(["attacker.example", "another.invalid", "qq.alexvarga.xyz"])(
    "rejects rebinding through %s with and without Origin before reading or mutating threads",
    async (hostname) => {
      server = await startTestServer();
      const { thread, project } = seedThreadFixture(server);
      const before = server.db.select().from(threads).all();
      const host = `${hostname}:${new URL(server.baseUrl).port}`;

      for (const origin of [undefined, `http://${host}`, server.baseUrl]) {
        const headers = {
          host,
          ...(origin === undefined ? {} : { origin }),
          "content-type": "application/json",
        };
        for (const path of [
          "/api/v1/threads",
          `/api/v1/threads/${thread.id}`,
          `/api/v1/threads/${thread.id}/messages`,
          `/api/v1/threads/${thread.id}/events`,
          `/api/v1/threads/${thread.id}/thread-storage/files/private.txt`,
        ]) {
          const response = await rawResponse(server.baseUrl, { headers, path });
          expect(response.status).toBe(403);
          expect(response.body).not.toContain(thread.id);
        }
        for (const args of [
          {
            method: "POST",
            path: "/api/v1/threads",
            body: JSON.stringify({
              projectId: project.id,
              title: "Injected",
              providerId: thread.providerId,
              permissionMode: "full",
            }),
          },
          {
            method: "PATCH",
            path: `/api/v1/threads/${thread.id}`,
            body: JSON.stringify({ title: "Injected" }),
          },
          { method: "DELETE", path: `/api/v1/threads/${thread.id}` },
        ]) {
          expect(await rawStatus(server.baseUrl, headers, args)).toBe(403);
        }
      }
      expect(server.db.select().from(threads).all()).toEqual(before);
    },
  );

  it("checks Host before CORS, plugin exceptions, internal routes, and root responses", async () => {
    server = await startTestServer();
    const host = `unconfigured.example:${new URL(server.baseUrl).port}`;
    for (const path of [
      "/",
      "/health",
      "/install.sh",
      "/internal/session/open",
      "/api/v1/plugins/missing/http/",
      "/ws",
      "/ws/terminals/missing",
    ]) {
      for (const method of ["GET", "HEAD", "OPTIONS", "POST"]) {
        const response = await rawResponse(server.baseUrl, {
          path,
          method,
          headers: {
            host,
            origin: `http://${host}`,
            "access-control-request-method": "POST",
            "x-forwarded-host": new URL(server.baseUrl).host,
            "x-forwarded-proto": "http",
          },
        });
        expect(response.status).toBe(403);
        expect(response.headers["access-control-allow-origin"]).toBeUndefined();
      }
    }
  });

  it("rejects absent, malformed, misleading, and noncanonical Host values", async () => {
    server = await startTestServer();
    expect([400, 403]).toContain(await hostlessStatus(server.baseUrl));
    expect(
      (await server.app.fetch(new Request(`${server.baseUrl}/api/v1/threads`)))
        .status,
    ).toBe(403);
    for (const hosts of [
      [new URL(server.baseUrl).host, "attacker.example"],
      ["attacker.example", new URL(server.baseUrl).host],
    ]) {
      expect([400, 403]).toContain(
        await duplicateHostStatus(server.baseUrl, hosts),
      );
    }
    for (const host of [
      "",
      "localhost.attacker.example",
      "127.0.0.1.attacker.example",
      "localhost.",
      "127.1",
      "2130706433",
      "0x7f000001",
      "localhost:0",
      "localhost:65536",
      "localhost:",
      "localhost/path",
      "localhost?query",
      "localhost#fragment",
      "localhost\\path",
      "user@localhost",
      "http://localhost",
      "localhost,attacker.example",
      "localhost:80:80",
    ]) {
      expect([400, 403], host).toContain(
        await rawStatus(server.baseUrl, { host }),
      );
    }
    expect(await rawStatus(server.baseUrl, { host: "LOCALHOST" })).toBe(200);
    expect(await rawStatus(server.baseUrl, { host: "localhost:12345" })).toBe(
      200,
    );
  });

  it("requires explicit appUrl configuration for an alias and follows runtime changes", async () => {
    server = await startTestServer({ appUrl: undefined });
    const port = new URL(server.baseUrl).port;
    const alias = `bb.test:${port}`;
    expect(await rawStatus(server.baseUrl, { host: alias })).toBe(403);

    server.config.appUrl = `http://${alias}`;
    expect(await rawStatus(server.baseUrl, { host: alias })).toBe(200);
    expect(
      await rawStatus(server.baseUrl, {
        host: alias,
        origin: `http://${alias}`,
      }),
    ).toBe(200);
    expect(
      await rawStatus(server.baseUrl, {
        host: `bb.test.attacker.example:${port}`,
      }),
    ).toBe(403);

    server.config.appUrl = "https://replacement.test";
    expect(await rawStatus(server.baseUrl, { host: alias })).toBe(403);
    expect(await rawStatus(server.baseUrl, { host: "replacement.test" })).toBe(
      200,
    );
    delete server.config.appUrl;
    expect(await rawStatus(server.baseUrl, { host: "replacement.test" })).toBe(
      403,
    );
  });
});
