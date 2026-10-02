import type {
  AvailableModel,
  ProviderInfo,
  ProviderOptionDescriptor,
} from "./provider-types.js";
import { DEFAULT_SERVICE_TIER, type ServiceTier } from "./shared-types.js";

type ServiceTierProviderSource = Pick<ProviderInfo, "serviceTiers"> & {
  capabilities: Pick<ProviderInfo["capabilities"], "supportsServiceTier">;
};

type ServiceTierModelSource = Pick<
  AvailableModel,
  "supportedServiceTiers"
>;

export function providerServiceTierOptions(
  provider: ServiceTierProviderSource | null | undefined,
): ProviderOptionDescriptor[] {
  if (!provider?.capabilities.supportsServiceTier) {
    return [];
  }
  return (provider.serviceTiers ?? []).filter(
    (tier) => tier.id !== DEFAULT_SERVICE_TIER,
  );
}

export function resolveServiceTierOptions(args: {
  provider: ServiceTierProviderSource | null | undefined;
  model: ServiceTierModelSource | null | undefined;
}): ProviderOptionDescriptor[] {
  const declared = providerServiceTierOptions(args.provider);
  const supported = args.model?.supportedServiceTiers;
  if (supported === undefined) {
    return declared;
  }
  const supportedById = new Map(supported.map((tier) => [tier.id, tier]));
  return declared.flatMap((tier) => {
    const modelTier = supportedById.get(tier.id);
    if (modelTier === undefined) {
      return [];
    }
    const description = modelTier.description ?? tier.description;
    return [
      {
        id: tier.id,
        label: modelTier.label ?? tier.label,
        ...(description === undefined ? {} : { description }),
      },
    ];
  });
}

export function reconcileServiceTier(
  serviceTier: ServiceTier,
  options: readonly Pick<ProviderOptionDescriptor, "id">[],
): ServiceTier {
  return options.some((option) => option.id === serviceTier)
    ? serviceTier
    : DEFAULT_SERVICE_TIER;
}
