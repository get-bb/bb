import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { systemProviderInfoSchema } from "@bb/server-contract";
import { readJson } from "../helpers/json.js";
import { withTestHarness } from "../helpers/test-app.js";

const SVG_LOGO =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="8"/></svg>';

describe("custom ACP provider logos", () => {
  it("advertises and serves a data-dir-relative logo", async () => {
    await withTestHarness(
      {
        customAcpAgents: [
          {
            id: "example-agent",
            displayName: "Example Agent",
            command: "example-agent",
            args: [],
            env: {},
            supportsManualCompaction: false,
            logo: "agent-logos/example.svg",
          },
        ],
      },
      async (harness) => {
        const logoDir = join(harness.config.dataDir, "agent-logos");
        await mkdir(logoDir, { recursive: true });
        await writeFile(join(logoDir, "example.svg"), SVG_LOGO, "utf8");

        const providersResponse = await harness.app.request(
          "/api/v1/system/providers",
        );
        expect(providersResponse.status).toBe(200);
        const providers = systemProviderInfoSchema
          .array()
          .parse(await readJson(providersResponse));
        expect(
          providers.find((provider) => provider.id === "acp-example-agent"),
        ).toMatchObject({
          displayName: "Example Agent",
          logoUrl: "/api/v1/system/providers/acp-example-agent/logo",
        });

        const logoResponse = await harness.app.request(
          "/api/v1/system/providers/acp-example-agent/logo",
        );
        expect(logoResponse.status).toBe(200);
        expect(logoResponse.headers.get("content-type")).toBe("image/svg+xml");
        expect(logoResponse.headers.get("cache-control")).toBe("no-store");
        expect(await logoResponse.text()).toBe(SVG_LOGO);
      },
    );
  });

  it("returns 404 when the configured logo file is missing", async () => {
    await withTestHarness(
      {
        customAcpAgents: [
          {
            id: "missing-logo",
            displayName: "Missing Logo",
            command: "missing-logo",
            args: [],
            env: {},
            supportsManualCompaction: false,
            logo: "agent-logos/missing.png",
          },
        ],
      },
      async (harness) => {
        const response = await harness.app.request(
          "/api/v1/system/providers/acp-missing-logo/logo",
        );
        expect(response.status).toBe(404);
      },
    );
  });
});
