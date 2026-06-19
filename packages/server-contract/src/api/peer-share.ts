import { z } from "zod";

/**
 * Peer sharing ("AirDrop for threads"): an instance advertises a renameable
 * display name on the local network, discovers nearby instances, and pushes a
 * read-only snapshot of a thread to one of them. The recipient sees an incoming
 * offer it can accept (import) or decline. No accounts, no central server.
 */

export const peerShareIdentitySchema = z
  .object({
    /** Stable per-install id used to recognize self in discovery + dedupe peers. */
    instanceId: z.string().min(1),
    /** Human label shown to others on the network. Defaults to the hostname. */
    displayName: z.string().min(1),
    /** Whether this instance announces itself on the local network. */
    discoverable: z.boolean(),
    /** Whether the server is reachable on the LAN (BB_LAN_SHARE binding). */
    lanReachable: z.boolean(),
  })
  .strict();
export type PeerShareIdentity = z.infer<typeof peerShareIdentitySchema>;

export const peerShareIdentityUpdateSchema = z
  .object({
    displayName: z.string().min(1).max(60).optional(),
    discoverable: z.boolean().optional(),
  })
  .strict();
export type PeerShareIdentityUpdate = z.infer<
  typeof peerShareIdentityUpdateSchema
>;

export const peerShareNearbyPeerSchema = z
  .object({
    instanceId: z.string().min(1),
    displayName: z.string().min(1),
    address: z.string().min(1),
    port: z.number().int().positive(),
  })
  .strict();
export type PeerShareNearbyPeer = z.infer<typeof peerShareNearbyPeerSchema>;

export const peerShareNearbyPeersResponseSchema = z
  .object({ peers: z.array(peerShareNearbyPeerSchema) })
  .strict();
export type PeerShareNearbyPeersResponse = z.infer<
  typeof peerShareNearbyPeersResponseSchema
>;

// --- Bundle (the portable thread snapshot that travels between instances) ---

export const peerShareBundleThreadSchema = z
  .object({
    title: z.string().nullable(),
    titleFallback: z.string().nullable(),
    providerId: z.string().min(1),
    createdAt: z.number().int().nonnegative(),
  })
  .strict();

export const peerShareBundleEventSchema = z
  .object({
    sequence: z.number().int().nonnegative(),
    scopeKind: z.enum(["turn", "thread"]),
    turnId: z.string().nullable(),
    providerThreadId: z.string().nullable(),
    type: z.string().min(1),
    itemId: z.string().nullable(),
    itemKind: z.string().nullable(),
    /** Event payload, kept as the canonical JSON string from the source events row. */
    data: z.string(),
    createdAt: z.number().int().nonnegative(),
  })
  .strict();

export const peerShareBundleSchema = z
  .object({
    version: z.literal(1),
    thread: peerShareBundleThreadSchema,
    events: z.array(peerShareBundleEventSchema),
  })
  .strict();
export type PeerShareBundle = z.infer<typeof peerShareBundleSchema>;

// --- Send (sender -> own server, which forwards to the peer) ---

export const peerShareSendRequestSchema = z
  .object({
    threadId: z.string().min(1),
    /** Target peer reachable address + API port (from the nearby peers list). */
    address: z.string().min(1),
    port: z.number().int().positive(),
  })
  .strict();
export type PeerShareSendRequest = z.infer<typeof peerShareSendRequestSchema>;

// --- Offer (peer -> recipient server receive endpoint) ---

export const peerShareOfferRequestSchema = z
  .object({
    senderName: z.string().min(1),
    bundle: peerShareBundleSchema,
  })
  .strict();
export type PeerShareOfferRequest = z.infer<typeof peerShareOfferRequestSchema>;

// --- Incoming offers awaiting accept/decline on the recipient ---

export const peerShareIncomingSchema = z
  .object({
    id: z.string().min(1),
    senderName: z.string().min(1),
    threadTitle: z.string(),
    eventCount: z.number().int().nonnegative(),
    createdAt: z.number().int().nonnegative(),
  })
  .strict();
export type PeerShareIncoming = z.infer<typeof peerShareIncomingSchema>;

export const peerShareIncomingListResponseSchema = z
  .object({ shares: z.array(peerShareIncomingSchema) })
  .strict();
export type PeerShareIncomingListResponse = z.infer<
  typeof peerShareIncomingListResponseSchema
>;

export const peerShareAcceptResponseSchema = z
  .object({
    threadId: z.string().min(1),
    projectId: z.string().min(1),
  })
  .strict();
export type PeerShareAcceptResponse = z.infer<
  typeof peerShareAcceptResponseSchema
>;
