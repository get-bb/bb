import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  PeerShareIdentity,
  PeerShareIdentityUpdate,
  PeerShareIncomingListResponse,
  PeerShareNearbyPeersResponse,
  PeerShareSendRequest,
} from "@bb/server-contract";
import * as api from "@/lib/api";
import {
  invalidatePeerShareIncomingCache,
  peerShareIdentityQueryKey,
  peerShareIncomingQueryKey,
  peerSharePeersQueryKey,
  seedPeerShareIdentityCache,
} from "./cache-owners/peer-share-cache-owner";

export function usePeerShareIdentity(options?: { enabled?: boolean }) {
  return useQuery<PeerShareIdentity>({
    queryKey: peerShareIdentityQueryKey(),
    queryFn: ({ signal }) => api.getPeerShareIdentity(signal),
    enabled: options?.enabled ?? true,
    staleTime: 30_000,
  });
}

/**
 * Nearby discoverable instances. Polls while enabled (e.g. the send dialog is
 * open) since LAN presence changes second-to-second and is not pushed.
 */
export function usePeerSharePeers(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;
  return useQuery<PeerShareNearbyPeersResponse>({
    queryKey: peerSharePeersQueryKey(),
    queryFn: ({ signal }) => api.listPeerSharePeers(signal),
    enabled,
    refetchInterval: enabled ? 3_000 : false,
    staleTime: 0,
  });
}

/**
 * Pending inbound offers. Polls so a received share surfaces promptly without
 * wiring a dedicated realtime change kind.
 */
export function usePeerShareIncoming(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;
  return useQuery<PeerShareIncomingListResponse>({
    queryKey: peerShareIncomingQueryKey(),
    queryFn: ({ signal }) => api.listPeerShareIncoming(signal),
    enabled,
    refetchInterval: enabled ? 4_000 : false,
    staleTime: 0,
  });
}

export function useUpdatePeerShareIdentity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (update: PeerShareIdentityUpdate) =>
      api.updatePeerShareIdentity(update),
    onSuccess: (identity) => {
      seedPeerShareIdentityCache(queryClient, identity);
    },
  });
}

export function useSendPeerShare() {
  return useMutation({
    mutationFn: (request: PeerShareSendRequest) => api.sendPeerShare(request),
  });
}

export function useAcceptPeerShare() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.acceptPeerShare(id),
    onSuccess: () => {
      invalidatePeerShareIncomingCache(queryClient);
    },
  });
}

export function useDeclinePeerShare() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.declinePeerShare(id),
    onSuccess: () => {
      invalidatePeerShareIncomingCache(queryClient);
    },
  });
}
