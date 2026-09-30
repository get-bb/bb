import { describe, expect, it } from "vitest";
import { getAppSettings } from "@bb/db";
import { systemProviderCatalogEntrySchema } from "@bb/server-contract";
import { requireBridgeLaunchForProviderId } from "../../src/services/system/provider-bridge-launch.js";
import { listSystemProviderInfos } from "../../src/services/system/execution-options.js";
import { resolveCreateThreadExecutionDefaults } from "../../src/services/threads/thread-default-policy.js";
import { withTestHarness } from "../helpers/test-app.js";
import { readJson } from "../helpers/json.js";

async function readCatalog(response: Response) {
  expect(response.status).toBe(200);
  return systemProviderCatalogEntrySchema
    .array()
    .parse(await readJson(response));
}

describe("provider management", () => {
  it("keeps a disabled provider discoverable, blocks launches, and preserves its siblings across plugin disable and enable", async () => {
    await withTestHarness(
      { seedFirstPartyProviders: false },
      async (harness) => {
        await harness.pluginService.install("builtin:provider-acp", {
          kind: "root",
        });
        const setEnabled = (id: string, enabled: boolean) =>
          harness.app.request(`/api/v1/system/providers/${id}/enabled`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ enabled }),
          });
        await readCatalog(await setEnabled("acp-opencode", true));
        expect(
          (await listSystemProviderInfos(harness.deps)).map(
            (provider) => provider.id,
          ),
        ).toContain("acp-opencode");
        const disabled = await readCatalog(
          await setEnabled("acp-opencode", false),
        );
        expect(
          disabled.find((provider) => provider.id === "acp-opencode")?.enabled,
        ).toBe(false);
        expect(getAppSettings(harness.db).providerEnabled["acp-opencode"]).toBe(
          false,
        );
        const visible = (await listSystemProviderInfos(harness.deps)).map(
          (provider) => provider.id,
        );
        expect(visible).not.toContain("acp-opencode");
        expect(visible).toContain("acp-cursor");
        expect(() =>
          requireBridgeLaunchForProviderId(harness.deps, "acp-opencode"),
        ).toThrow('Provider "acp-opencode" is disabled');
        expect(() =>
          resolveCreateThreadExecutionDefaults(harness.deps.providerRegistry, {
            requestedProviderId: "acp-opencode",
            storedDefaults: null,
          }),
        ).toThrow('Provider "acp-opencode" is disabled');
        await harness.pluginService.setEnabled("provider-acp", false);
        const catalog = await readCatalog(
          await harness.app.request("/api/v1/system/providers/catalog"),
        );
        expect(
          catalog.find((provider) => provider.id === "acp-cursor"),
        ).toMatchObject({ enabled: true, pluginEnabled: false });
        const enabled = await readCatalog(await setEnabled("acp-cursor", true));
        expect(
          enabled.find((provider) => provider.id === "acp-cursor"),
        ).toMatchObject({ enabled: true, pluginEnabled: true });
        expect(
          enabled.find((provider) => provider.id === "acp-opencode")?.enabled,
        ).toBe(false);
        expect(
          (await listSystemProviderInfos(harness.deps)).map(
            (provider) => provider.id,
          ),
        ).not.toContain("acp-opencode");
        await readCatalog(await setEnabled("acp-opencode", true));
        expect(
          (await listSystemProviderInfos(harness.deps)).map(
            (provider) => provider.id,
          ),
        ).toContain("acp-opencode");
      },
    );
  });

  it("discovers Claude while its plugin is off and keeps provider preferences through older settings writes", async () => {
    await withTestHarness(
      { seedFirstPartyProviders: false },
      async (harness) => {
        await harness.pluginService.install("builtin:provider-claude-code", {
          kind: "root",
        });
        await harness.pluginService.setEnabled("provider-claude-code", false);
        const catalog = await readCatalog(
          await harness.app.request("/api/v1/system/providers/catalog"),
        );
        expect(
          catalog.find((provider) => provider.id === "claude-code"),
        ).toMatchObject({ displayName: "Claude Code", pluginEnabled: false });
        const response = await harness.app.request(
          "/api/v1/system/providers/claude-code/enabled",
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ enabled: false }),
          },
        );
        await readCatalog(response);
        const { providerEnabled, ...legacySettings } = getAppSettings(
          harness.db,
        );
        const write = await harness.app.request("/api/v1/settings/general", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(legacySettings),
        });
        expect(write.status).toBe(200);
        expect(getAppSettings(harness.db).providerEnabled).toEqual(
          providerEnabled,
        );
      },
    );
  });
});
