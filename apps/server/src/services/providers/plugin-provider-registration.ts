/**
 * Maps a validated plugin provider declaration
 * (`bb.agents.experimental_registerProvider`) onto the registry's wire shapes:
 * the client-facing `ProviderInfo` and the backend-only
 * `ProviderServerCapabilities`. The shapes mirror the core catalog entries in
 * packages/agent-providers/src/catalog.ts exactly, so plugin providers ride
 * every existing consumer unchanged.
 *
 * Declared facts outside these shapes (`kind`, `bridge`,
 * `supportsNativeSessionRewind`, `supportsManualCompaction`) are not dropped:
 * the full declaration rides the registration record, where the registry's
 * compaction accessor reads `supportsManualCompaction`.
 */
import type { ProviderServerCapabilities } from "@bb/agent-providers";
import type { ProviderComposerAction, ProviderInfo } from "@bb/domain";
import type { PluginProviderDeclaration } from "@get-bb/plugin-sdk";
import type { ProviderRegistration } from "./provider-registry.js";

export function buildPluginProviderRegistration(args: {
  pluginId: string;
  declaration: PluginProviderDeclaration;
}): Omit<ProviderRegistration, "source"> {
  const { pluginId, declaration } = args;
  const { capabilities } = declaration;

  // Skills slash-command typeahead is universal (BB injects skills into every
  // provider), so it always leads; declared actions carry the composer's own
  // fixed command syntax, identical to the core catalog entries.
  const composerActions: ProviderComposerAction[] = [
    { kind: "skills", trigger: "/" },
  ];
  for (const action of declaration.composerActions) {
    composerActions.push(
      action === "plan"
        ? {
            kind: "plan",
            command: { trigger: "/", name: "plan", trailingText: " " },
          }
        : {
            kind: "goal",
            command: { trigger: "/", name: "goal", trailingText: " " },
          },
    );
  }

  const info: ProviderInfo = {
    id: declaration.id,
    displayName: declaration.displayName,
    available: true,
    logoUrl:
      declaration.icon === undefined
        ? null
        : `/api/v1/plugins/${pluginId}/assets/${declaration.icon.asset}`,
    capabilities: {
      // Archive/name sync are bridge-handshake facts (reported at
      // `initialize`), never declared — plugin providers start without them.
      supportsArchive: false,
      supportsRename: false,
      supportsServiceTier: capabilities.supportsServiceTier,
      supportsUserQuestion: capabilities.supportsNativeUserQuestion,
      supportsFork: capabilities.supportsNativeFork,
      supportedPermissionModes: [...capabilities.permissionModes],
    },
    composerActions,
  };

  const serverCapabilities: ProviderServerCapabilities = {
    supportsWorkflows: false,
    // Session persistence is per-session (`sessionRestorable` on
    // thread-identity results); the declaration carries no static claim.
    supportsSessionRestore: false,
    backsHostDaemonAiServices: capabilities.supportsHostAiServices,
    reasoningLevels: [...capabilities.reasoningLevels],
  };

  return { info, serverCapabilities, declaration };
}
