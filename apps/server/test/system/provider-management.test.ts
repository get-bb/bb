import { describe, expect, it } from "vitest";
import { getAppSettings } from "@bb/db";
import { systemProviderCatalogEntrySchema } from "@bb/server-contract";
import { requireBridgeLaunchForProviderId } from "../../src/services/system/provider-bridge-launch.js";
import { listSystemProviderInfos } from "../../src/services/system/execution-options.js";
import { resolveCreateThreadExecutionDefaults } from "../../src/services/threads/thread-default-policy.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";
import { readJson } from "../helpers/json.js";

async function readCatalog(response: Response) {
  expect(response.status).toBe(200);
  return systemProviderCatalogEntrySchema
    .array()
    .parse(await readJson(response));
}

function setProviderEnabled(
  harness: TestAppHarness,
  id: string,
  enabled: boolean,
) {
  return harness.app.request(`/api/v1/system/providers/${id}/enabled`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
}

async function visibleProviderIds(harness: TestAppHarness) {
  return (await listSystemProviderInfos(harness.deps)).map(
    (provider) => provider.id,
  );
}

describe("provider management", () => {
  it("keeps a disabled provider discoverable, blocks launches, and preserves its siblings across plugin disable and enable", async () => {
    await withTestHarness(
      { seedFirstPartyProviders: false },
      async (harness) => {
        await harness.pluginService.install("builtin:provider-acp", {
          kind: "root",
        });
        const disabled = await readCatalog(
          await setProviderEnabled(harness, "acp-cursor", false),
        );
        expect(
          disabled.find((provider) => provider.id === "acp-cursor")?.enabled,
        ).toBe(false);
        expect(getAppSettings(harness.db).disabledProviderIds).toEqual([
          "acp-cursor",
        ]);
        expect(await visibleProviderIds(harness)).not.toContain("acp-cursor");
        expect(() =>
          requireBridgeLaunchForProviderId(harness.deps, "acp-cursor"),
        ).toThrow('Provider "acp-cursor" is disabled');
        expect(() =>
          resolveCreateThreadExecutionDefaults(harness.deps.providerRegistry, {
            requestedProviderId: "acp-cursor",
            storedDefaults: null,
          }),
        ).toThrow('Provider "acp-cursor" is disabled');

        await readCatalog(
          await setProviderEnabled(harness, "acp-opencode", false),
        );
        await harness.pluginService.setEnabled("provider-acp", false);
        const catalog = await readCatalog(
          await harness.app.request("/api/v1/system/providers/catalog"),
        );
        expect(
          catalog.find((provider) => provider.id === "acp-opencode"),
        ).toMatchObject({ enabled: false, pluginEnabled: false });
        const enabled = await readCatalog(
          await setProviderEnabled(harness, "acp-cursor", true),
        );
        expect(
          enabled.find((provider) => provider.id === "acp-cursor"),
        ).toMatchObject({ enabled: true, pluginEnabled: true });
        expect(
          enabled.find((provider) => provider.id === "acp-opencode")?.enabled,
        ).toBe(false);
        expect(await visibleProviderIds(harness)).toContain("acp-cursor");
      },
    );
  });

  it("restores automatic discovery when a disabled installed-only provider is enabled again", async () => {
    await withTestHarness(
      { seedFirstPartyProviders: false },
      async (harness) => {
        await harness.pluginService.install("builtin:provider-acp", {
          kind: "root",
        });
        await readCatalog(
          await setProviderEnabled(harness, "acp-opencode", false),
        );
        await readCatalog(
          await setProviderEnabled(harness, "acp-opencode", true),
        );
        expect(getAppSettings(harness.db).disabledProviderIds).toEqual([]);
        expect(await visibleProviderIds(harness)).not.toContain("acp-opencode");
      },
    );
  });

  it("falls back to the next enabled provider when a project's last-used provider is disabled", async () => {
    await withTestHarness(
      { seedFirstPartyProviders: false },
      async (harness) => {
        await harness.pluginService.install("builtin:provider-acp", {
          kind: "root",
        });
        await readCatalog(
          await setProviderEnabled(harness, "acp-opencode", false),
        );
        const resolved = resolveCreateThreadExecutionDefaults(
          harness.deps.providerRegistry,
          {
            requestedProviderId: undefined,
            storedDefaults: {
              providerId: "acp-opencode",
              model: "default",
              serviceTier: "default",
              reasoningLevel: "medium",
              permissionMode: "auto",
            },
          },
        );
        expect(resolved.providerId).not.toBe("acp-opencode");
        expect(resolved.executionDefaults).toBeNull();
      },
    );
  });

  it("forgets a plugin's disabled providers when the plugin is uninstalled", async () => {
    await withTestHarness(
      { seedFirstPartyProviders: false },
      async (harness) => {
        await harness.pluginService.install("builtin:provider-acp", {
          kind: "root",
        });
        await readCatalog(
          await setProviderEnabled(harness, "acp-opencode", false),
        );
        await harness.pluginService.setEnabled("provider-acp", false);
        expect(await harness.pluginService.remove("provider-acp")).toBe(true);
        expect(getAppSettings(harness.db).disabledProviderIds).toEqual([]);
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
        await readCatalog(
          await setProviderEnabled(harness, "claude-code", false),
        );
        const { disabledProviderIds, ...legacySettings } = getAppSettings(
          harness.db,
        );
        const write = await harness.app.request("/api/v1/settings/general", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(legacySettings),
        });
        expect(write.status).toBe(200);
        expect(getAppSettings(harness.db).disabledProviderIds).toEqual(
          disabledProviderIds,
        );
      },
    );
  });
});
