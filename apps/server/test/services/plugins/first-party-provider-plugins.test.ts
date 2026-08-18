import { describe, expect, it } from "vitest";
import { listSystemProviderInfos } from "../../../src/services/system/execution-options.js";
import {
  withTestHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";

/**
 * The first-party provider plugins are the ONLY source of the four built-in
 * providers — the core catalog seed is deleted. So this is no longer a diff
 * against a "before" snapshot (there is nothing to diff against); it is a
 * golden pin on what the declarations must produce.
 *
 * What it guards is the same regression the old takeover merge existed to
 * prevent: the facts that used to be preserved from the seed because the
 * declaration had no slot for them — codex archive/rename mirroring and claude
 * workflows — are now declared, and a wrong or missing declaration silently
 * turns a flagship behavior off.
 */

const FIRST_PARTY_PROVIDER_PLUGINS = [
  {
    builtinName: "provider-codex",
    pluginId: "provider-codex",
    providerId: "codex",
    displayName: "Codex",
    supportsThreadArchive: true,
    supportsThreadRename: true,
    supportsWorkflows: false,
    supportsManualCompaction: true,
  },
  {
    builtinName: "provider-claude-code",
    pluginId: "provider-claude-code",
    providerId: "claude-code",
    displayName: "Claude Code",
    supportsThreadArchive: false,
    supportsThreadRename: false,
    supportsWorkflows: true,
    supportsManualCompaction: true,
  },
  {
    builtinName: "provider-pi",
    pluginId: "provider-pi",
    providerId: "pi",
    displayName: "Pi",
    supportsThreadArchive: false,
    supportsThreadRename: false,
    supportsWorkflows: false,
    supportsManualCompaction: true,
  },
  {
    builtinName: "provider-acp",
    pluginId: "provider-acp",
    providerId: "acp-cursor",
    displayName: "Cursor",
    supportsThreadArchive: false,
    supportsThreadRename: false,
    supportsWorkflows: false,
    supportsManualCompaction: false,
  },
] as const;

const PROVIDER_IDS = FIRST_PARTY_PROVIDER_PLUGINS.map(
  (plugin) => plugin.providerId,
);

function expectedLogoUrl(providerId: string): string {
  // Served from the icon byte snapshot on the registration by the
  // provider-logo route (the raw plugin-assets route serves only branding
  // variants and built bundles).
  return `/api/v1/system/providers/${providerId}/logo`;
}

async function installFirstPartyProviderPlugins(
  harness: TestAppHarness,
): Promise<void> {
  for (const plugin of FIRST_PARTY_PROVIDER_PLUGINS) {
    const entry = await harness.pluginService.install(
      `builtin:${plugin.builtinName}`,
      { kind: "root" },
    );
    expect(
      entry.status,
      `${plugin.builtinName}: ${entry.statusDetail ?? ""}`,
    ).toBe("running");
  }
}

describe("first-party provider plugins", () => {
  it("are the sole source of the built-in providers", async () => {
    await withTestHarness(
      { seedFirstPartyProviders: false },
      async (harness) => {
        const registry = harness.deps.providerRegistry;
        // No seed underneath: nothing exists until the plugins load.
        expect(registry.list()).toEqual([]);

        await installFirstPartyProviderPlugins(harness);

        const after = registry.list();
        // Product order, not plugin load order (which is alphabetical by
        // plugin id and would put acp-cursor first).
        expect(after.map((entry) => entry.info.id)).toEqual(PROVIDER_IDS);

        for (const [index, registration] of after.entries()) {
          const plugin = FIRST_PARTY_PROVIDER_PLUGINS[index];
          if (plugin === undefined) {
            throw new Error(`missing expectation at index ${index}`);
          }
          const label = plugin.providerId;
          expect(registration.source, label).toEqual({
            kind: "plugin",
            pluginId: plugin.pluginId,
          });
          expect(registration.info.displayName, label).toBe(plugin.displayName);
          expect(registration.info.logoUrl, label).toBe(
            expectedLogoUrl(plugin.providerId),
          );
          // The facts the takeover merge used to carry over from the seed.
          expect(
            registration.info.capabilities.supportsThreadArchive,
            label,
          ).toBe(plugin.supportsThreadArchive);
          expect(
            registration.info.capabilities.supportsThreadRename,
            label,
          ).toBe(plugin.supportsThreadRename);
          expect(registration.serverCapabilities.supportsWorkflows, label).toBe(
            plugin.supportsWorkflows,
          );
          expect(registry.supportsManualCompaction(plugin.providerId)).toBe(
            plugin.supportsManualCompaction,
          );
          // The declaration is metadata only; the implementation is the
          // plugin's own built bridge artifact (pi's is daemon-bundled).
          expect(registration.info.id, label).toBe(plugin.providerId);
        }

        // The composed provider listing (GET /system/providers path) agrees.
        const infos = await listSystemProviderInfos(harness.deps, {});
        expect(infos.map((info) => info.id)).toEqual(PROVIDER_IDS);
        expect(infos.map((info) => info.logoUrl)).toEqual(
          PROVIDER_IDS.map(expectedLogoUrl),
        );
      },
    );
  }, 60_000);

  it("disabling a provider plugin removes its provider, and re-enabling restores its position", async () => {
    await withTestHarness(
      { seedFirstPartyProviders: false },
      async (harness) => {
        const registry = harness.deps.providerRegistry;
        await installFirstPartyProviderPlugins(harness);
        expect(registry.get("pi")?.source).toEqual({
          kind: "plugin",
          pluginId: "provider-pi",
        });

        // With the seed deleted there is nothing to degrade to: the provider
        // is gone, and every policy accessor says so rather than keeping a
        // stale claim alive.
        await harness.pluginService.setEnabled("provider-pi", false);

        expect(registry.get("pi")).toBeNull();
        expect(registry.getServerCapabilities("pi")).toBeNull();
        expect(registry.getSupportedPermissionModes("pi")).toBeNull();
        expect(registry.supportsFork("pi")).toBe(false);
        expect(registry.supportsManualCompaction("pi")).toBe(false);
        expect(registry.list().map((entry) => entry.info.id)).toEqual([
          "codex",
          "claude-code",
          "acp-cursor",
        ]);
        const infos = await listSystemProviderInfos(harness.deps, {});
        expect(infos.find((info) => info.id === "pi")).toBeUndefined();

        // Re-enabling restores it in its product position, not at the end.
        await harness.pluginService.setEnabled("provider-pi", true);
        expect(registry.get("pi")?.source).toEqual({
          kind: "plugin",
          pluginId: "provider-pi",
        });
        expect(registry.list().map((entry) => entry.info.id)).toEqual(
          PROVIDER_IDS,
        );
      },
    );
  }, 60_000);
});
