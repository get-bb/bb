export interface ProviderHealthCacheKey {
  hostId: string;
  providerId: string;
}

export function providerHealthCacheKey(
  args: ProviderHealthCacheKey,
): ProviderHealthCacheKey {
  return args;
}
