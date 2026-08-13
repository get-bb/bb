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
