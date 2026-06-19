import type { QueryClient } from "@tanstack/react-query";
import type { PeerShareIdentity } from "@bb/server-contract";

export const peerShareIdentityQueryKey = () =>
  ["peer-share", "identity"] as const;
export const peerSharePeersQueryKey = () => ["peer-share", "peers"] as const;
export const peerShareIncomingQueryKey = () =>
  ["peer-share", "incoming"] as const;

export function seedPeerShareIdentityCache(
  queryClient: QueryClient,
  identity: PeerShareIdentity,
): void {
  queryClient.setQueryData(peerShareIdentityQueryKey(), identity);
}

export function invalidatePeerShareIncomingCache(
  queryClient: QueryClient,
): void {
  void queryClient.invalidateQueries({
    queryKey: peerShareIncomingQueryKey(),
  });
}
