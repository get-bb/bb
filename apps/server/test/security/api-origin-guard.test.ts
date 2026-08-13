import http from "node:http";
import { createNodeBbSdk } from "@bb/sdk/node";
import { afterEach, describe, expect, it } from "vitest";
import {
  startTestServer,
  type RunningTestServer,
} from "../helpers/test-app.js";

// CORS decides whether a browser may read a response; it never stops the
// request. A `no-cors` POST with a simple content type skips the preflight and
// the handler runs. `/api/v1/*` now rejects a foreign browser origin outright.
//
// These tests pin the callers that must keep working, because the guard's whole
// risk is locking someone out: bb Connect through the tunnel, curl, the `bb`
// CLI, and the SDK.

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

/** `fetch` drops a `Host` override, so proxy shapes need the raw client. */
function rawStatus(
  baseUrl: string,
  headers: Record<string, string>,
): Promise<number> {
  const url = new URL("/api/v1/threads", baseUrl);
  return new Promise((resolve, reject) => {
    const request = http.request(
      { host: url.hostname, port: url.port, path: url.pathname, headers },
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

    // Node's `fetch` sends no `Origin` on a same-origin-less request, exactly
    // as curl and the CLI/SDK HTTP clients do.
    expect(await statusFor(server.baseUrl)).toBe(200);
    expect(
      await statusFor(server.baseUrl, {
        method: "POST",
        path: "/api/v1/threads",
        headers: { "content-type": "application/json" },
      }),
    ).not.toBe(403);

    // A mutation with a non-JSON body must NOT be rejected for its content
    // type: `requireJsonForMutation` stays off so `curl -d` keeps working.
    expect(
      await statusFor(server.baseUrl, {
        method: "POST",
        path: "/api/v1/threads",
        headers: { "content-type": "application/x-www-form-urlencoded" },
      }),
    ).not.toBe(415);

    // The SDK over its own HTTP client, end to end.
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

    // A `sandbox="allow-scripts"` frame (the HTML/file previews) has an opaque
    // origin and sends the literal `null`, which is not a bb app origin.
    expect(
      await statusFor(server.baseUrl, {
        method: "POST",
        headers: { origin: "null", "content-type": "text/plain" },
      }),
    ).toBe(403);
  });

  it("accepts the app's own origin and the request host", async () => {
    server = await startTestServer();
    const origin = new URL(server.baseUrl).origin;

    expect(await statusFor(server.baseUrl, { headers: { origin } })).toBe(200);
  });

  // The bb Connect tunnel forwards a remote request to the loopback server
  // after rewriting `Origin` from the public connect origin to the loopback
  // origin (`headersForLoopbackRequest` in @bb/tunnel-client) and dropping the
  // public `Host`. That rewrite is what keeps a remote user working; this test
  // is the canary for it.
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

  // If the tunnel ever stops rewriting `Origin`, a remote user is locked out of
  // their own server. This asserts the shape of that failure so the cause is
  // obvious rather than mysterious.
  it("rejects an unrewritten public connect origin, documenting the tunnel dependency", async () => {
    server = await startTestServer();

    expect(
      await statusFor(server.baseUrl, {
        headers: { origin: "https://bee.getbb.app" },
      }),
    ).toBe(403);
  });

  // bb is commonly served over a LAN address or Tailscale Serve, which the
  // server cannot enumerate into an allowlist. `isTrustedOrigin` admits those
  // by matching the origin against the request `Host` (or `X-Forwarded-Host`
  // with `X-Forwarded-Proto`). `fetch` silently drops a `Host` override, so
  // these go over `http.request` — a `fetch`-based version of this test passes
  // for the wrong reason.
  it("accepts bb served over a LAN address or Tailscale Serve", async () => {
    server = await startTestServer();
    const port = new URL(server.baseUrl).port;

    // LAN: the reverse proxy passes Host through.
    expect(
      await rawStatus(server.baseUrl, {
        origin: `http://192.168.1.5:${port}`,
        host: `192.168.1.5:${port}`,
      }),
    ).toBe(200);

    // Tailscale Serve: TLS terminated upstream, Host preserved. bb supports
    // this shape deliberately (see the plugin-wire suite), so it must pass.
    expect(
      await rawStatus(server.baseUrl, {
        origin: "https://box.ts.net",
        host: "box.ts.net",
        "x-forwarded-proto": "https",
      }),
    ).toBe(200);

    // A LAN deployment behind a proxy that rewrites Host but forwards it.
    expect(
      await rawStatus(server.baseUrl, {
        origin: `http://192.168.1.5:${port}`,
        host: `127.0.0.1:${port}`,
        "x-forwarded-host": `192.168.1.5:${port}`,
      }),
    ).toBe(200);

    // IPv6 literals are addresses too.
    expect(
      await rawStatus(server.baseUrl, {
        origin: `http://[::1]:${port}`,
        host: `[::1]:${port}`,
      }),
    ).toBe(200);
  });

  // A rewriting proxy must forward the original authority. bb already imposes
  // this on its plugin routes, which have used the same check all along.
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

  // A deployment that serves the app from a non-loopback domain configures
  // `appUrl`; that origin must be trusted.
  it("accepts a configured app origin", async () => {
    server = await startTestServer({ appUrl: "https://app.example.com" });

    expect(
      await statusFor(server.baseUrl, {
        headers: { origin: "https://app.example.com" },
      }),
    ).toBe(200);
  });
});
