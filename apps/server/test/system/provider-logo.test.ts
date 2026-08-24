import { describe, expect, it } from "vitest";
import { readJson } from "../helpers/json.js";
import { configuredAcpProvider } from "../helpers/provider-registry.js";
import { withTestHarness } from "../helpers/test-app.js";

/**
 * The logo route serves the icon snapshot a plugin's provider registration
 * captured. There is no second source: the deprecated `customAcpAgents`
 * config array carried a file path the server read and served itself, and it
 * is gone with the ACP tier.
 */
describe("provider logos", () => {
  it("serves the icon a plugin registered", async () => {
    await withTestHarness({}, async (harness) => {
      const response = await harness.app.request(
        "/api/v1/system/providers/acp-cursor/logo",
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/svg+xml");
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect((await response.text()).length).toBeGreaterThan(0);
    });
  });

  it("returns 404 for a provider that registered no icon bytes", async () => {
    // Every agent bb ships declares an SVG asset now; a user-configured ACP
    // agent declares a host glyph instead, which has no bytes to serve.
    await withTestHarness(
      {
        extraProviders: [
          await configuredAcpProvider({
            id: "example-agent",
            displayName: "Example Agent",
            command: "example-agent",
            args: ["acp"],
          }),
        ],
      },
      async (harness) => {
      const response = await harness.app.request(
        "/api/v1/system/providers/acp-example-agent/logo",
      );
      expect(response.status).toBe(404);
      expect(await readJson(response)).toMatchObject({
        code: "provider_logo_not_found",
      });
      },
    );
  });

  it("returns 404 for an unknown provider id", async () => {
    await withTestHarness({}, async (harness) => {
      const response = await harness.app.request(
        "/api/v1/system/providers/acp-not-a-provider/logo",
      );
      expect(response.status).toBe(404);
    });
  });
});
