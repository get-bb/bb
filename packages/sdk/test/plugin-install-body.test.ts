/**
 * Repro for get-bb/bb#1662.
 *
 * `bb plugin install <path>` builds its request through
 * `sdk.plugins.install`. Servers released before bb-app 0.38.0 validate the
 * install body with a strict schema that only knows `source`, so an extra
 * `selection` key the caller never asked for is rejected with HTTP 422
 * `expected { "source": string }`. The SDK must not send defaulted keys.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createBbSdk } from "../src/core.js";
import type { FetchImplementation } from "../src/response.js";
import { createHttpTransport } from "../src/transport-http.js";

// packages/server-contract/src/api/plugins.ts before fc3454809 (bb-app 0.37.x):
const legacyPluginInstallRequestSchema = z
  .object({ source: z.string().min(1) })
  .strict();

async function captureInstallBody(
  args: Parameters<ReturnType<typeof createBbSdk>["plugins"]["install"]>[0],
): Promise<unknown> {
  let captured: unknown;
  const fetch: FetchImplementation = async (_input, init) => {
    captured = JSON.parse(String(init?.body));
    // Mimic a bb-app 0.37.x server: strict `{ source }` only.
    const ok = legacyPluginInstallRequestSchema.safeParse(captured).success;
    return new Response(
      JSON.stringify(
        ok
          ? { ok: true, plugin: {} }
          : { ok: false, error: 'expected { "source": string }' },
      ),
      {
        status: ok ? 200 : 422,
        headers: { "content-type": "application/json" },
      },
    );
  };
  const sdk = createBbSdk({
    transport: createHttpTransport({
      baseUrl: "http://bb.test",
      fetch,
      runtime: "node",
    }),
  });
  // The response is a stub, so response parsing may throw; only the request
  // body matters here.
  await sdk.plugins.install(args).catch(() => undefined);
  return captured;
}

describe("issue #1662: plugin install request body vs pre-0.38.0 servers", () => {
  it("a plain root install sends only { source }", async () => {
    const body = await captureInstallBody({ source: "path:/tmp/my-plugin" });
    expect(body).toEqual({ source: "path:/tmp/my-plugin" });
    expect(legacyPluginInstallRequestSchema.safeParse(body).success).toBe(true);
  });

  it("a subdirectory install still sends an explicit selection", async () => {
    const body = await captureInstallBody({
      source: "git:github.com/acme/plugins",
      subdirectory: "packages/notes",
    });
    expect(body).toEqual({
      source: "git:github.com/acme/plugins",
      selection: { kind: "subdirectory", path: "packages/notes" },
    });
  });
});
