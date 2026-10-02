import http from "node:http";
import { createNodeBbSdk } from "@bb/sdk/node";
import { afterEach, describe, expect, it } from "vitest";
import {
  startTestServer,
  type RunningTestServer,
} from "../helpers/test-app.js";

let server: RunningTestServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

interface RequestArgs {
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
  path = "/api/v1/threads",
  method = "GET",
): Promise<number> {
  const url = new URL(path, baseUrl);
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: url.hostname,
        port: url.port,
        path: url.pathname,
        headers,
        method,
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

  it("rejects rebinding hosts before API, internal, asset, and preflight handling", async () => {
    server = await startTestServer();
    const host = `attacker.example:${new URL(server.baseUrl).port}`;

    for (const path of [
      "/api/v1/threads",
      "/health",
      "/internal/session/open",
      "/",
      "/install.sh",
    ]) {
      for (const origin of [undefined, `http://${host}`]) {
        const headers: Record<string, string> = { host };
        if (origin !== undefined) headers.origin = origin;
        expect(await rawStatus(server.baseUrl, headers, path)).toBe(403);
      }
    }
    expect(
      await rawStatus(
        server.baseUrl,
        {
          host,
          origin: `http://${host}`,
          "access-control-request-method": "POST",
        },
        "/api/v1/threads",
        "OPTIONS",
      ),
    ).toBe(403);
    expect(
      await rawStatus(server.baseUrl, {
        host,
        "x-forwarded-host": new URL(server.baseUrl).host,
      }),
    ).toBe(403);
  });

  it("does not trust an attacker origin through forwarded headers", async () => {
    server = await startTestServer();
    expect(
      await rawStatus(server.baseUrl, {
        host: new URL(server.baseUrl).host,
        origin: "https://attacker.example",
        "x-forwarded-host": "attacker.example",
        "x-forwarded-proto": "https",
      }),
    ).toBe(403);
  });

  it("rejects malformed Host authorities", async () => {
    server = await startTestServer();
    for (const host of [
      "localhost@attacker.example",
      "attacker.example@localhost",
      "localhost/path",
      "localhost?x",
      "localhost#x",
      "localhost:0",
      "localhost:65536",
      "localhost,attacker.example",
    ]) {
      expect([400, 403]).toContain(await rawStatus(server.baseUrl, { host }));
    }
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

  it("accepts the app's own origin and the request host", async () => {
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

  it("accepts direct IP access and a configured Tailscale proxy", async () => {
    server = await startTestServer({ appUrl: "https://box.ts.net" });
    const port = new URL(server.baseUrl).port;

    for (const host of [
      `192.168.1.5:${port}`,
      `100.64.0.5:${port}`,
      `[2001:db8::5]:${port}`,
      "box.ts.net",
    ]) {
      expect(await rawStatus(server.baseUrl, { host })).toBe(200);
    }

    expect(
      await rawStatus(server.baseUrl, {
        origin: `http://192.168.1.5:${port}`,
        host: `192.168.1.5:${port}`,
      }),
    ).toBe(200);

    expect(
      await rawStatus(server.baseUrl, {
        origin: "https://box.ts.net",
        host: "box.ts.net",
        "x-forwarded-proto": "https",
      }),
    ).toBe(200);

    expect(
      await rawStatus(server.baseUrl, {
        origin: "https://box.ts.net",
        host: `127.0.0.1:${port}`,
        "x-forwarded-host": "box.ts.net",
        "x-forwarded-proto": "https",
      }),
    ).toBe(200);

    expect(
      await rawStatus(server.baseUrl, {
        origin: `http://192.168.1.5:${port}`,
        host: `127.0.0.1:${port}`,
        "x-forwarded-host": `192.168.1.5:${port}`,
      }),
    ).toBe(200);

    expect(
      await rawStatus(server.baseUrl, {
        origin: `http://[::1]:${port}`,
        host: `[::1]:${port}`,
      }),
    ).toBe(200);
  });

  it("requires a rewriting proxy to send X-Forwarded-Host", async () => {
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
});
