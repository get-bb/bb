/**
 * Maps a validated plugin provider declaration
 * (`bb.agents.experimental_registerProvider`) onto the registry's wire shapes:
 * the client-facing `ProviderInfo` and the backend-only
 * `ProviderServerCapabilities`. Declarations are the only source of provider
 * metadata, so every field a consumer reads must be declarable.
 *
 * Every declared fact a registry consumer reads lands in one of the two
 * shapes — client-facing facts on `ProviderInfo`, backend-only ones on
 * `ProviderServerCapabilities`. Facts nothing reads (`kind`, `bridge`) are
 * deliberately dropped rather than stashed: a registration that also carries
 * the raw declaration invites consumers to read around the projection, and
 * then there are two answers to every capability question.
 */
import { isPluginOwnedIconPath } from "@bb/domain";
import type { ProviderComposerAction, ProviderInfo } from "@bb/domain";
import type { PluginProviderDeclaration } from "@get-bb/plugin-sdk";
import type {
  ProviderRegistration,
  ProviderServerCapabilities,
} from "./provider-registry.js";

export function buildPluginProviderRegistration(args: {
  available: boolean;
  pluginId: string;
  declaration: PluginProviderDeclaration;
}): Omit<ProviderRegistration, "source"> {
  const { declaration } = args;
  const { capabilities } = declaration;
  // The declaration and `ProviderInfo` share one noun set, so these carry over
  // by name; only `fork` still needs a projection (below).
  const {
    experimental_providerHealth,
    experimental_providerUsage,
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
    available: args.available,
    experimental_providerHealth,
    experimental_providerUsage,
    // Served by the provider-logo route from the icon byte snapshot on the
    // registration (see registerProvider in plugin-runtime.ts). The raw
    // plugin-assets route serves only branding variants and built bundles, so
    // declared icon paths are never exposed as URLs directly. A named host
    // glyph has no bytes, so it gets no URL — the client falls back the same
    // way it does for a provider with no icon at all.
    logoUrl:
      declaration.icon !== undefined && isPluginOwnedIconPath(declaration.icon)
        ? `/api/v1/system/providers/${declaration.id}/logo`
        : null,
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
    reasoningLevels: [...capabilities.reasoningLevels],
    fork: capabilities.fork,
    supportsManualCompaction: capabilities.supportsManualCompaction,
  };

  return { info, serverCapabilities };
}
