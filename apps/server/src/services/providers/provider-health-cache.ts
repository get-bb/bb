export function providerHealthCacheKey(args: {
  hostId: string;
  providerId: string;
}): string {
  return `${args.hostId} ${args.providerId}`;
}
