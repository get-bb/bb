import type { ProviderInfo } from "@bb/domain";

/**
 * A `ProviderInfo` the way the server projects a registered provider: the
 * plugin's declared logo is served as `logoUrl`, which is the only source of
 * a provider's brand mark in the app (core vendors none).
 */
export function makeProviderInfo(
  overrides: Partial<ProviderInfo> & Pick<ProviderInfo, "id">,
): ProviderInfo {
  const id = overrides.id;
  return {
    pluginId: `provider-${id}`,
    displayName: id,
    logoUrl: `/api/v1/system/providers/${id}/logo`,
    available: true,
    maintenance: { health: false, usage: false, installation: false },
    composerActions: [],
    capabilities: {
      supportsThreadArchive: true,
      supportsThreadRename: true,
      supportsServiceTier: false,
      supportsNativeUserQuestion: false,
      supportsFork: true,
      supportsSessionRewind: false,
      modelCatalogScope: "workspace",
      permissionModes: ["accept-edits", "auto", "full"],
    },
    ...overrides,
  };
}
