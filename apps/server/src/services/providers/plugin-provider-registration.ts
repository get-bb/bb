/**
 * Maps a validated plugin provider declaration (`bb.providers.register`) onto
 * the registry's shapes: the client-facing `ProviderInfo` — the ONE client
 * shape every provider projects to — and the backend-only
 * `ProviderServerCapabilities`. Declarations are the only source of provider
 * metadata, so every field a consumer reads must be declarable.
 *
 * Every declared fact a registry consumer reads lands in one of the two
 * shapes — client-facing facts on `ProviderInfo`, backend-only ones on
 * `ProviderServerCapabilities`. The per-command options hook and the
 * cold-cache fallback models are kept on the registration itself: the hook
 * is code, not data, and the fallback list is served by the model-list
 * route, never by clients reading the info. The raw declaration is NOT kept:
 * a registration that carries it invites consumers to read around the
 * projection, and then there are two answers to every capability question.
 */
import {
  EMPTY_PROVIDER_NATIVE_ROOTS,
  isNamespacedGlyph,
  isPluginOwnedIconPath,
} from "@bb/domain";
import type { NormalizedPluginProviderDeclaration } from "@get-bb/plugin-sdk/internal/host-policy";
import type {
  AvailableModel,
  ProviderComposerAction,
  ProviderExtensionKinds,
  ProviderInfo,
  ProviderOptionDescriptor,
} from "@bb/domain";
import type {
  PluginProviderDeclaration,
  PluginProviderOptionDescriptor,
  PluginProviderOptionsContext,
} from "@get-bb/plugin-sdk";
import { deriveValidatedProviderOptions } from "@get-bb/plugin-sdk/internal/host-policy";
import type {
  ProviderRegistration,
  ProviderServerCapabilities,
} from "./provider-registry.js";

/**
 * Picker labels for the coarse reasoning ladder. A declaration that gives
 * only the ladder (ids) gets these labels; one that declares
 * `reasoningLevels` supplies its own. The same labels the app
 * rendered from its own table before providers declared them.
 */
const REASONING_LEVEL_LABELS: Readonly<Record<string, string>> = {
  none: "None",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  ultracode: "Ultracode",
  max: "Max",
  ultra: "Ultra",
};

/**
 * The two service tiers BB's execution options carry today. A provider that
 * declares `supportsServiceTier` without `serviceTiers` gets
 * this pair, which is what the fast-mode toggle offers.
 */
const DEFAULT_SERVICE_TIERS: readonly ProviderOptionDescriptor[] = [
  { id: "default", label: "Default" },
  { id: "fast", label: "Fast" },
];

function toOptionDescriptors(
  declared: readonly PluginProviderOptionDescriptor[],
): ProviderOptionDescriptor[] {
  return declared.map((option) => ({
    id: option.id,
    label: option.label,
    ...(option.description === undefined
      ? {}
      : { description: option.description }),
  }));
}

function projectReasoningLevels(
  declaration: PluginProviderDeclaration,
): ProviderOptionDescriptor[] {
  if (declaration.reasoningLevels !== undefined) {
    return toOptionDescriptors(declaration.reasoningLevels);
  }
  return declaration.capabilities.reasoningLevels.map((level) => ({
    id: level,
    label: REASONING_LEVEL_LABELS[level] ?? level,
  }));
}

function projectServiceTiers(
  declaration: PluginProviderDeclaration,
): ProviderOptionDescriptor[] | undefined {
  if (declaration.serviceTiers !== undefined) {
    return toOptionDescriptors(declaration.serviceTiers);
  }
  return declaration.capabilities.supportsServiceTier
    ? [...DEFAULT_SERVICE_TIERS]
    : undefined;
}

function projectExtensionKinds(
  pluginId: string,
  declaration: PluginProviderDeclaration,
): ProviderExtensionKinds | undefined {
  const declared = declaration.extensionKinds;
  if (declared === undefined) return undefined;
  const kinds: ProviderExtensionKinds = {};
  for (const [name, kind] of Object.entries(declared)) {
    kinds[`${pluginId}/${name}`] = {
      item: kind.item !== undefined,
      state: kind.state !== undefined,
    };
  }
  return kinds;
}

/** The declared cold-cache fallback list in the model-list wire shape. */
export function projectFallbackModels(
  declaration: PluginProviderDeclaration,
): AvailableModel[] {
  const fallback = declaration.models?.fallback ?? [];
  return fallback.map((model) => ({
    id: model.id,
    model: model.id,
    displayName: model.displayName,
    description: model.description,
    supportedReasoningEfforts: model.supportedReasoningEfforts.map(
      (effort) => ({
        reasoningEffort: effort.reasoningEffort,
        description: effort.description,
      }),
    ),
    defaultReasoningEffort: model.defaultReasoningEffort,
    isDefault: model.isDefault,
  }));
}

export function buildPluginProviderRegistration(args: {
  available: boolean;
  pluginId: string;
  declaration: NormalizedPluginProviderDeclaration;
  /** The owning plugin's current non-secret settings, read per command. */
  readSettings: () => PluginProviderOptionsContext["settings"];
}): Omit<ProviderRegistration, "pluginId" | "iconNames"> {
  const { declaration } = args;
  const { capabilities } = declaration;
  // The declaration and `ProviderInfo` share one noun set, so these carry over
  // by name; only `fork` still needs a projection (below).
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

  const strings = declaration.strings;
  const serviceTiers = projectServiceTiers(declaration);
  const extensionKinds = projectExtensionKinds(args.pluginId, declaration);

  const info: ProviderInfo = {
    id: declaration.id,
    pluginId: args.pluginId,
    displayName: declaration.displayName,
    ...(declaration.family === undefined
      ? {}
      : { family: declaration.family }),
    available: args.available,
    maintenance: { ...declaration.maintenance },
    // Served by the provider-logo route from the icon byte snapshot on the
    // registration (see registerProvider in plugin-runtime.ts). The raw
    // plugin-assets route serves only branding variants and built bundles, so
    // declared icon paths are never exposed as URLs directly. A plugin
    // declared icon (`"<pluginId>/<name>"`) is snapshotted the same way and
    // projects to the same URL. A named host glyph has no bytes, so it gets
    // no URL and travels by name instead.
    logoUrl:
      declaration.icon !== undefined &&
      (isPluginOwnedIconPath(declaration.icon) ||
        isNamespacedGlyph(declaration.icon))
        ? `/api/v1/system/providers/${declaration.id}/logo`
        : null,
    ...(declaration.icon !== undefined &&
    !isPluginOwnedIconPath(declaration.icon) &&
    !isNamespacedGlyph(declaration.icon)
      ? { icon: { glyph: declaration.icon } }
      : {}),
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
      // Filled once, at the plugin boundary: the validator normalizes every
      // declaration before it reaches here, so a second default would only
      // hide a declaration that skipped it.
      modelCatalogScope: declaration.models.scope,
    },
    composerActions,
    ...(strings === undefined
      ? {}
      : {
          strings: {
            signInHint: strings.signInHint,
            expiredHint: strings.expiredHint,
            installUrl: strings.installUrl,
            ...(strings.brandPrefix === undefined
              ? {}
              : { brandPrefix: strings.brandPrefix }),
            ...(strings.planModeCopy === undefined
              ? {}
              : { planModeCopy: strings.planModeCopy }),
            ...(strings.iconTint === undefined
              ? {}
              : { iconTint: { ...strings.iconTint } }),
          },
        }),
    reasoningLevels: projectReasoningLevels(declaration),
    ...(serviceTiers === undefined ? {} : { serviceTiers }),
    ...(extensionKinds === undefined ? {} : { extensionKinds }),
  };

  const serverCapabilities: ProviderServerCapabilities = {
    reasoningLevels: [...capabilities.reasoningLevels],
    fork: capabilities.fork,
    supportsManualCompaction: capabilities.supportsManualCompaction,
  };

  return {
    info,
    serverCapabilities,
    bridgeOptions: declaration.experimental_bridgeOptions ?? {},
    // The validators themselves, for the ingest route; clients learn only
    // which kinds exist (`ProviderInfo.extensionKinds`, projected by WS2a).
    extensionKinds: declaration.extensionKinds ?? {},
    visibility: declaration.experimental_visibility ?? "always",
    fallbackModels: projectFallbackModels(declaration),
    envPassthrough: declaration.env?.passthrough ?? [],
    // Normalized by the declaration validator; absent means no roots.
    nativeSkillRoots:
      declaration.experimental_nativeSkillRoots ?? EMPTY_PROVIDER_NATIVE_ROOTS,
    nativeCommandRoots:
      declaration.experimental_nativeCommandRoots ??
      EMPTY_PROVIDER_NATIVE_ROOTS,
    resolvesNativeRoots: declaration.experimental_resolvesNativeRoots,
    deriveProviderOptions: (context) =>
      deriveValidatedProviderOptions({
        declaration,
        context: { ...context, settings: args.readSettings() },
      }),
  };
}
