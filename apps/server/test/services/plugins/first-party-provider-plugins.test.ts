import { describe, expect, it } from "vitest";
import { listSystemProviderInfos } from "../../../src/services/system/execution-options.js";
import {
  withTestHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";

/**
 * The first-party provider plugins are the ONLY source of built-in
 * providers — the core catalog seed is deleted. So this is no longer a diff
 * against a "before" snapshot (there is nothing to diff against); it is a
 * golden pin on what the declarations must produce.
 *
 * What it guards is the same regression the old takeover merge existed to
 * prevent: the facts that used to be preserved from the seed because the
 * declaration had no slot for them — codex archive/rename mirroring, for one —
 * are now declared, and a wrong or missing declaration silently turns a
 * flagship behavior off.
 */

const FIRST_PARTY_PROVIDER_DECLARATIONS = [
  {
    builtinName: "provider-codex",
    pluginId: "provider-codex",
    providerId: "codex",
    displayName: "Codex",
    supportsThreadArchive: true,
    supportsThreadRename: true,
    fork: "checkpoint",
    supportsManualCompaction: true,
    supportsUsage: true,
    visibility: "always",
    hasLogo: true,
  },
  {
    builtinName: "provider-claude-code",
    pluginId: "provider-claude-code",
    providerId: "claude-code",
    displayName: "Claude Code",
    supportsThreadArchive: false,
    supportsThreadRename: false,
    fork: "checkpoint",
    supportsManualCompaction: true,
    supportsUsage: true,
    visibility: "always",
    hasLogo: true,
  },
  {
    builtinName: "provider-pi",
    pluginId: "provider-pi",
    providerId: "pi",
    displayName: "Pi",
    supportsThreadArchive: false,
    supportsThreadRename: false,
    fork: "checkpoint",
    supportsManualCompaction: true,
    supportsUsage: false,
    visibility: "always",
    hasLogo: true,
  },
  {
    builtinName: "provider-acp",
    pluginId: "provider-acp",
    providerId: "acp-cursor",
    displayName: "Cursor",
    supportsThreadArchive: false,
    supportsThreadRename: false,
    fork: "none",
    supportsManualCompaction: false,
    supportsUsage: true,
    visibility: "always",
    hasLogo: true,
  },
  {
    builtinName: "provider-acp",
    pluginId: "provider-acp",
    providerId: "acp-opencode",
    displayName: "opencode",
    supportsThreadArchive: false,
    supportsThreadRename: false,
    fork: "tip",
    supportsManualCompaction: true,
    supportsUsage: false,
    visibility: "installed",
    hasLogo: true,
  },
  {
    builtinName: "provider-acp",
    pluginId: "provider-acp",
    providerId: "acp-omp",
    displayName: "omp",
    supportsThreadArchive: false,
    supportsThreadRename: false,
    fork: "tip",
    supportsManualCompaction: false,
    supportsUsage: false,
    visibility: "installed",
    hasLogo: true,
  },
  {
    builtinName: "provider-acp",
    pluginId: "provider-acp",
    providerId: "acp-grok",
    displayName: "Grok Build",
    supportsThreadArchive: false,
    supportsThreadRename: false,
    fork: "none",
    supportsManualCompaction: false,
    supportsUsage: false,
    visibility: "installed",
    hasLogo: true,
  },
  {
    builtinName: "provider-acp",
    pluginId: "provider-acp",
    providerId: "acp-hermes-agent",
    displayName: "Hermes Agent",
    supportsThreadArchive: false,
    supportsThreadRename: false,
    fork: "tip",
    supportsManualCompaction: false,
    supportsUsage: false,
    visibility: "installed",
    hasLogo: true,
  },
] as const;

const PROVIDER_IDS = FIRST_PARTY_PROVIDER_DECLARATIONS.map(
  (plugin) => plugin.providerId,
);
const ALWAYS_VISIBLE_PROVIDER_IDS = FIRST_PARTY_PROVIDER_DECLARATIONS.filter(
  (plugin) => plugin.visibility === "always",
).map((plugin) => plugin.providerId);

function expectedLogoUrl(providerId: string): string {
  // Served from the icon byte snapshot on the registration by the
  // provider-logo route (the raw plugin-assets route serves only branding
  // variants and built bundles).
  return `/api/v1/system/providers/${providerId}/logo`;
}

async function installFirstPartyProviderPlugins(
  harness: TestAppHarness,
): Promise<void> {
  for (const builtinName of new Set(
    FIRST_PARTY_PROVIDER_DECLARATIONS.map((plugin) => plugin.builtinName),
  )) {
    const entry = await harness.pluginService.install(
      `builtin:${builtinName}`,
      { kind: "root" },
    );
    expect(entry.status, `${builtinName}: ${entry.statusDetail ?? ""}`).toBe(
      "running",
    );
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
        // Install order: the bundled plugin list ranks codex, claude-code,
        // pi, then acp — not plugin load order (alphabetical by plugin id,
        // which would put acp-cursor first).
        expect(after.map((entry) => entry.info.id)).toEqual(PROVIDER_IDS);

        for (const [index, registration] of after.entries()) {
          const plugin = FIRST_PARTY_PROVIDER_DECLARATIONS[index];
          if (plugin === undefined) {
            throw new Error(`missing expectation at index ${index}`);
          }
          const label = plugin.providerId;
          expect(registration.pluginId, label).toBe(plugin.pluginId);
          expect(registration.info.displayName, label).toBe(plugin.displayName);
          expect(registration.info.logoUrl, label).toBe(
            plugin.hasLogo ? expectedLogoUrl(plugin.providerId) : null,
          );
          // The URL alone proves nothing: the route serves the byte snapshot
          // taken at registration, and a declared icon whose file is absent
          // leaves the snapshot empty behind a well-formed URL.
          expect(registration.icon !== undefined, label).toBe(plugin.hasLogo);
          expect(registration.visibility, label).toBe(plugin.visibility);
          // The facts the takeover merge used to carry over from the seed.
          expect(
            registration.info.capabilities.supportsThreadArchive,
            label,
          ).toBe(plugin.supportsThreadArchive);
          expect(
            registration.info.capabilities.supportsThreadRename,
            label,
          ).toBe(plugin.supportsThreadRename);
          expect(registry.supportsManualCompaction(plugin.providerId)).toBe(
            plugin.supportsManualCompaction,
          );
          // Fork is declared per agent, not per tier: the ACP bridge refuses
          // `session/fork` for agents whose `initialize` reply does not
          // advertise it (cursor-agent, grok), so a declaration above what the
          // agent answers makes POST /threads/fork create a thread that dies
          // on start (#1833). The declaration is the server's fork gate and
          // the app's fork affordance, so it must match the agent.
          expect(registration.serverCapabilities.fork, label).toBe(plugin.fork);
          expect(registry.supportsFork(plugin.providerId), label).toBe(
            plugin.fork !== "none",
          );
          expect(registration.info.maintenance.usage, label).toBe(
            plugin.supportsUsage,
          );
          // The implementation and its static options ride the plugin's own
          // bridge artifact.
          expect(registration.info.id, label).toBe(plugin.providerId);
        }

        // The composed provider listing (GET /system/providers path) agrees.
        const infos = await listSystemProviderInfos(harness.deps, {});
        expect(infos.map((info) => info.id)).toEqual(
          ALWAYS_VISIBLE_PROVIDER_IDS,
        );
        expect(infos.map((info) => info.logoUrl)).toEqual(
          ALWAYS_VISIBLE_PROVIDER_IDS.map(expectedLogoUrl),
        );
        // The client-facing fork flag (the app's "Fork into new thread"
        // affordance) agrees with the declaration.
        expect(
          infos.map((info) => [info.id, info.capabilities.supportsFork]),
        ).toEqual(
          FIRST_PARTY_PROVIDER_DECLARATIONS.filter(
            (plugin) => plugin.visibility === "always",
          ).map((plugin) => [plugin.providerId, plugin.fork !== "none"]),
        );
      },
    );
  }, 60_000);

  it("pins the client-read ProviderInfo fields of the four core providers", async () => {
    // Registry equality: the fields clients already read must come out of the
    // declarations exactly as they did before the target-state fields were
    // projected. A declaration edit that moves one of these is a product
    // change, not a refactor.
    await withTestHarness(
      { seedFirstPartyProviders: false },
      async (harness) => {
        await installFirstPartyProviderPlugins(harness);
        const clientFields = (providerId: string) => {
          const info = harness.deps.providerRegistry.get(providerId)?.info;
          if (info === undefined) throw new Error(`${providerId} missing`);
          const {
            id,
            displayName,
            logoUrl,
            available,
            maintenance,
            capabilities,
            composerActions,
          } = info;
          return {
            id,
            displayName,
            logoUrl,
            available,
            maintenance,
            capabilities,
            composerActions,
          };
        };
        const skills = { kind: "skills", trigger: "/" } as const;
        const plan = {
          kind: "plan",
          command: { trigger: "/", name: "plan", trailingText: " " },
        } as const;
        const goal = {
          kind: "goal",
          command: { trigger: "/", name: "goal", trailingText: " " },
        } as const;

        expect(clientFields("codex")).toStrictEqual({
          id: "codex",
          displayName: "Codex",
          logoUrl: expectedLogoUrl("codex"),
          available: true,
          maintenance: { health: true, usage: true, installation: true },
          capabilities: {
            supportsThreadArchive: true,
            supportsThreadRename: true,
            supportsServiceTier: true,
            supportsNativeUserQuestion: false,
            permissionModes: ["accept-edits", "auto", "full"],
            supportsFork: true,
            supportsSessionRewind: true,
            modelCatalogScope: "host",
          },
          composerActions: [skills, plan, goal],
        });
        expect(clientFields("claude-code")).toStrictEqual({
          id: "claude-code",
          displayName: "Claude Code",
          logoUrl: expectedLogoUrl("claude-code"),
          available: true,
          maintenance: { health: true, usage: true, installation: true },
          capabilities: {
            supportsThreadArchive: false,
            supportsThreadRename: false,
            supportsServiceTier: false,
            supportsNativeUserQuestion: true,
            permissionModes: ["accept-edits", "auto", "full"],
            supportsFork: true,
            supportsSessionRewind: true,
            modelCatalogScope: "host",
          },
          composerActions: [skills, plan],
        });
        expect(clientFields("pi")).toStrictEqual({
          id: "pi",
          displayName: "Pi",
          logoUrl: expectedLogoUrl("pi"),
          available: true,
          maintenance: { health: true, usage: false, installation: true },
          capabilities: {
            supportsThreadArchive: false,
            supportsThreadRename: false,
            supportsServiceTier: false,
            supportsNativeUserQuestion: false,
            permissionModes: ["full"],
            supportsFork: true,
            supportsSessionRewind: true,
            modelCatalogScope: "workspace",
          },
          composerActions: [skills],
        });
        expect(clientFields("acp-cursor")).toStrictEqual({
          id: "acp-cursor",
          displayName: "Cursor",
          logoUrl: expectedLogoUrl("acp-cursor"),
          available: true,
          maintenance: { health: true, usage: true, installation: true },
          capabilities: {
            supportsThreadArchive: false,
            supportsThreadRename: false,
            supportsServiceTier: true,
            supportsNativeUserQuestion: false,
            permissionModes: ["accept-edits", "full"],
            // cursor-agent does not advertise ACP session/fork (#1833).
            supportsFork: false,
            supportsSessionRewind: false,
            modelCatalogScope: "host",
          },
          composerActions: [skills],
        });

        // The new projections are filled from the declarations.
        const claude = harness.deps.providerRegistry.get("claude-code");
        expect(claude?.info.strings?.signInHint).toMatch(/claude/);
        expect(claude?.info.reasoningLevels?.map((level) => level.id)).toEqual([
          "low",
          "medium",
          "high",
          "xhigh",
          "ultracode",
          "max",
        ]);
        expect(claude?.fallbackModels.map((model) => model.id)).toContain(
          "claude-opus-5[1m]",
        );
        expect(claude?.envPassthrough).toEqual(["BB_CLAUDE_CODE_EXECUTABLE"]);
        expect(
          harness.deps.providerRegistry
            .get("codex")
            ?.info.serviceTiers?.map((tier) => tier.id),
        ).toEqual(["default", "fast"]);
      },
    );
  }, 60_000);

  it("disabling a provider plugin removes its provider, and re-enabling restores its position", async () => {
    await withTestHarness(
      { seedFirstPartyProviders: false },
      async (harness) => {
        const registry = harness.deps.providerRegistry;
        await installFirstPartyProviderPlugins(harness);
        expect(registry.get("pi")?.pluginId).toBe("provider-pi");

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
          "acp-opencode",
          "acp-omp",
          "acp-grok",
          "acp-hermes-agent",
        ]);
        const infos = await listSystemProviderInfos(harness.deps, {});
        expect(infos.find((info) => info.id === "pi")).toBeUndefined();

        // Re-enabling restores it in its install position, not at the end.
        await harness.pluginService.setEnabled("provider-pi", true);
        expect(registry.get("pi")?.pluginId).toBe("provider-pi");
        expect(registry.list().map((entry) => entry.info.id)).toEqual(
          PROVIDER_IDS,
        );
      },
    );
  }, 60_000);
});
