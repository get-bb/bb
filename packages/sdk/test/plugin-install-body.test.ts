/**
 * Repro for get-bb/bb#1662.
 *
 * `bb plugin install <path>` builds its request through
 * `sdk.plugins.install`. Servers released before bb-app 0.38.0 validate the
 * install body with a strict schema that only knows `source`, so an extra
 * `selection` key the caller never asked for is rejected with HTTP 422
 * `expected { "source": string }`. The SDK must not send defaulted keys.
 *
 * The same servers answer with the 0.37.x installed-plugin shape, which has
 * no `publisherLabel`. The SDK must accept that response: the server has
 * already installed the plugin, so a parse failure would report a failure
 * after a successful change.
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

// The installed-plugin shape a bb-app 0.37.x server returns: every field of
// its `installedPluginSchema`, and nothing added later (no `publisherLabel`).
const legacyInstalledPlugin = {
  id: "my-plugin",
  source: "path:/tmp/my-plugin",
  rootDir: "/tmp/my-plugin",
  version: "0.1.0",
  provenance: "direct",
  isOrphanedBuiltin: false,
  sourceDisplay: "path · /tmp/my-plugin",
  updateState: {},
  enabled: true,
  description: null,
  name: "My plugin",
  icon: null,
  iconUrl: null,
  status: "running",
  statusDetail: null,
  handlerStats: { count: 0, totalMs: 0, maxMs: 0, errorCount: 0 },
  services: [],
  schedules: [],
  cliCommand: null,
  capabilities: [],
  hasSettings: false,
  app: { hasApp: false, bundle: null },
  logoUrl: null,
  logoDarkUrl: null,
};

function createLegacyServerSdk(): {
  sdk: ReturnType<typeof createBbSdk>;
  bodies: unknown[];
} {
  const bodies: unknown[] = [];
  const fetch: FetchImplementation = async (_input, init) => {
    const body: unknown = JSON.parse(String(init?.body));
    bodies.push(body);
    // Mimic a bb-app 0.37.x server: strict `{ source }` request, 0.37.x plugin
    // shape in the response.
    const ok = legacyPluginInstallRequestSchema.safeParse(body).success;
    return new Response(
      JSON.stringify(
        ok
          ? { ok: true, plugin: legacyInstalledPlugin }
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
  return { sdk, bodies };
}

describe("issue #1662: plugin install against a pre-0.38.0 server", () => {
  it("a plain root install sends only { source } and accepts the legacy response", async () => {
    const { sdk, bodies } = createLegacyServerSdk();
    await expect(
      sdk.plugins.install({ source: "path:/tmp/my-plugin" }),
    ).resolves.toEqual({ ...legacyInstalledPlugin, publisherLabel: null });
    expect(bodies).toEqual([{ source: "path:/tmp/my-plugin" }]);
  });

  it("a subdirectory install still sends an explicit selection", async () => {
    const { sdk, bodies } = createLegacyServerSdk();
    await sdk.plugins
      .install({
        source: "git:github.com/acme/plugins",
        subdirectory: "packages/notes",
      })
      .catch(() => undefined);
    expect(bodies).toEqual([
      {
        source: "git:github.com/acme/plugins",
        selection: { kind: "subdirectory", path: "packages/notes" },
      },
    ]);
  });
});
