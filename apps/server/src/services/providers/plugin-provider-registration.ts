/**
 * Maps a validated plugin provider declaration
 * (`bb.agents.experimental_registerProvider`) onto the registry's wire shapes:
 * the client-facing `ProviderInfo` and the backend-only
 * `ProviderServerCapabilities`. Declarations are the only source of provider
 * metadata, so every field a consumer reads must be declarable.
 *
 * Declared facts outside these shapes (`kind`, `bridge`,
 * `supportsManualCompaction`) are not dropped:
 * the full declaration rides the registration record, where the registry's
 * compaction accessor reads `supportsManualCompaction`.
 */
import type { ProviderComposerAction, ProviderInfo } from "@bb/domain";
import type { PluginProviderDeclaration } from "@get-bb/plugin-sdk";
import type {
  ProviderRegistration,
  ProviderServerCapabilities,
} from "./provider-registry.js";

export function buildPluginProviderRegistration(args: {
  pluginId: string;
  declaration: PluginProviderDeclaration;
}): Omit<ProviderRegistration, "source"> {
  const { declaration } = args;
  const { capabilities } = declaration;
  // The declaration and `ProviderInfo` now share one noun set, so these carry
  // over by name; only `fork` still needs a projection (below).
  const {
    supportsThreadArchive,
    supportsThreadRename,
    supportsServiceTier,
    supportsNativeUserQuestion,
    permissionModes,
  } = capabilities;

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
    // Served by the provider-logo route from the icon byte snapshot on the
    // registration (see registerProvider in plugin-runtime.ts). The raw
    // plugin-assets route serves only branding variants and built bundles,
    // so declared icon paths are never exposed as URLs directly.
    logoUrl:
      declaration.icon === undefined
        ? null
        : `/api/v1/system/providers/${declaration.id}/logo`,
    capabilities: {
      supportsThreadArchive,
      supportsThreadRename,
      supportsServiceTier,
      supportsNativeUserQuestion,
      permissionModes: [...permissionModes],
      // The one projection left: the declared fork ladder becomes the two
      // booleans clients read. Any cloning at all enables the fork affordance,
      // while rewind (edit-past-message) needs a session recreated at an
      // earlier point.
      supportsFork: capabilities.fork !== "none",
      supportsSessionRewind: capabilities.fork === "checkpoint",
    },
    composerActions,
  };

  const serverCapabilities: ProviderServerCapabilities = {
    supportsWorkflows: capabilities.supportsWorkflows,
    backsHostDaemonAiServices: capabilities.supportsHostAiServices,
    reasoningLevels: [...capabilities.reasoningLevels],
    fork: capabilities.fork,
  };

  return { info, serverCapabilities, declaration };
}
