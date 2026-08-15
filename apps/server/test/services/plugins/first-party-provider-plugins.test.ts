import { describe, expect, it } from "vitest";
import { listSystemProviderInfos } from "../../../src/services/system/execution-options.js";
import { withTestHarness, type TestAppHarness } from "../../helpers/test-app.js";

/**
 * Phase-4 equality gate (plans/agent-provider-plugin-surface.md): the four
 * first-party provider plugins must reproduce the core catalog seed exactly.
 * After installing them, the registry listing is deep-identical to the
 * pre-takeover core seed EXCEPT `logoUrl` (null → plugin asset URL) and
 * `source` (core → plugin) — same ids, same order, same capabilities (the
 * registry takeover merge preserves the seed's archive/rename/workflows/
 * session-restore facts), same composer actions, same reasoning ladders.
 */

const FIRST_PARTY_PROVIDER_PLUGINS = [
  {
    builtinName: "provider-codex",
    pluginId: "provider-codex",
    providerId: "codex",
    iconAsset: "icons/codex.svg",
  },
  {
    builtinName: "provider-claude-code",
    pluginId: "provider-claude-code",
    providerId: "claude-code",
    iconAsset: "icons/claude-code.svg",
  },
  {
    builtinName: "provider-pi",
    pluginId: "provider-pi",
    providerId: "pi",
    iconAsset: "icons/pi.svg",
  },
  {
    builtinName: "provider-acp",
    pluginId: "provider-acp",
    providerId: "acp-cursor",
    iconAsset: "icons/cursor.svg",
  },
] as const;

const SEED_PROVIDER_IDS = FIRST_PARTY_PROVIDER_PLUGINS.map(
  (plugin) => plugin.providerId,
);

function expectedLogoUrl(
  plugin: (typeof FIRST_PARTY_PROVIDER_PLUGINS)[number],
): string {
  // Served from the icon byte snapshot on the registration by the
  // provider-logo route (the raw plugin-assets route serves only branding
  // variants and built bundles).
  return `/api/v1/system/providers/${plugin.providerId}/logo`;
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
  it(
    "takes over the core seed with a listing deep-identical except logoUrl and source",
    async () => {
      await withTestHarness(async (harness) => {
        const registry = harness.deps.providerRegistry;
        const seed = structuredClone(registry.list());
        expect(seed.map((entry) => entry.info.id)).toEqual(SEED_PROVIDER_IDS);
        expect(seed.map((entry) => entry.source)).toEqual(
          SEED_PROVIDER_IDS.map(() => ({ kind: "core" })),
        );
        expect(seed.map((entry) => entry.info.logoUrl)).toEqual(
          SEED_PROVIDER_IDS.map(() => null),
        );
        const seedInfos = structuredClone(
          await listSystemProviderInfos(harness.deps, {}),
        );
        const seedCompaction = SEED_PROVIDER_IDS.map((providerId) =>
          registry.supportsManualCompaction(providerId),
        );

        await installFirstPartyProviderPlugins(harness);

        const after = registry.list();
        // Same providers in the same (picker) order.
        expect(after.map((entry) => entry.info.id)).toEqual(SEED_PROVIDER_IDS);
        for (const [index, registration] of after.entries()) {
          const plugin = FIRST_PARTY_PROVIDER_PLUGINS[index];
          const seedEntry = seed[index];
          if (plugin === undefined || seedEntry === undefined) {
            throw new Error(`missing seed entry at index ${index}`);
          }
          // The two permitted differences: source and logoUrl.
          expect(registration.source).toEqual({
            kind: "plugin",
            pluginId: plugin.pluginId,
          });
          expect(registration.info.logoUrl, plugin.providerId).toBe(
            expectedLogoUrl(plugin),
          );
          // Everything else is deep-identical to the pre-takeover core seed:
          // capabilities (archive/rename preserved by the takeover merge),
          // composer actions, display name, availability.
          expect(
            { ...registration.info, logoUrl: null },
            plugin.providerId,
          ).toStrictEqual(seedEntry.info);
          // Backend-only capabilities: workflows/session-restore preserved by
          // the merge; AI services + reasoning ladders from the declarations.
          expect(registration.serverCapabilities, plugin.providerId).toStrictEqual(
            seedEntry.serverCapabilities,
          );
          // The declared bridge reference rides the registration (phase 5).
          expect(registration.declaration, plugin.providerId).toMatchObject({
            kind: "agent",
            bridge: { entry: "provider-bridge" },
          });
        }
        // The compaction accessor answers from the plugin declarations and
        // must match the catalog's pre-takeover answers.
        expect(
          SEED_PROVIDER_IDS.map((providerId) =>
            registry.supportsManualCompaction(providerId),
          ),
        ).toEqual(seedCompaction);

        // The composed provider listing (GET /system/providers path) is
        // identical too, modulo the plugin-served logos.
        const afterInfos = await listSystemProviderInfos(harness.deps, {});
        expect(afterInfos.map((info) => info.logoUrl)).toEqual(
          FIRST_PARTY_PROVIDER_PLUGINS.map(expectedLogoUrl),
        );
        expect(
          afterInfos.map((info) => ({ ...info, logoUrl: null })),
        ).toStrictEqual(seedInfos);
      });
    },
    60_000,
  );

  it(
    "disabling provider-pi restores the pre-takeover core seed entry in place",
    async () => {
      await withTestHarness(async (harness) => {
        const registry = harness.deps.providerRegistry;
        const seedPi = structuredClone(registry.get("pi"));
        expect(seedPi?.source).toEqual({ kind: "core" });

        await installFirstPartyProviderPlugins(harness);
        expect(registry.get("pi")?.source).toEqual({
          kind: "plugin",
          pluginId: "provider-pi",
        });

        // Graceful absence (transitional): while the core seed still exists,
        // disabling a first-party provider plugin degrades that provider to
        // the pre-takeover core declaration instead of removing it.
        await harness.pluginService.setEnabled("provider-pi", false);

        expect(registry.get("pi")).toStrictEqual(seedPi);
        // Position preserved: pi stays third in the listing.
        expect(registry.list().map((entry) => entry.info.id)).toEqual(
          SEED_PROVIDER_IDS,
        );
        const infos = await listSystemProviderInfos(harness.deps, {});
        expect(
          infos.find((info) => info.id === "pi"),
        ).toStrictEqual(seedPi?.info);

        // Re-enabling takes the entry over again.
        await harness.pluginService.setEnabled("provider-pi", true);
        expect(registry.get("pi")?.source).toEqual({
          kind: "plugin",
          pluginId: "provider-pi",
        });
      });
    },
    60_000,
  );
});
