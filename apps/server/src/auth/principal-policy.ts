import type {
  PolicyAction,
  PolicyDecision,
  PolicyResource,
  Principal,
  PrincipalRequest,
} from "@bb/domain";

export type {
  PolicyAction,
  PolicyDecision,
  PolicyResource,
  Principal,
  PrincipalRequest,
};

/**
 * Server-policy-owned client realtime delivery scope for a resolved session.
 * `unrestricted` is local-owner only; Work Together and internal derived grants
 * are always `scoped`.
 */
export type ClientRealtimeScope = "unrestricted" | "scoped";

/**
 * Request-scoped authorization session returned by PrincipalPolicy.resolve.
 * `authorize` is closed over adapter-validated credentials and must not accept
 * a caller-supplied Principal. Expiry and realtime scope are owned by the
 * server policy that issued the session, never by the client.
 */
export interface ResolvedPrincipal {
  readonly principal: Principal;
  /**
   * Absolute epoch-ms assertion expiry for client sockets, or null when the
   * session does not expire (local owner) / cannot be used as a client socket
   * (internal one-use grants).
   */
  readonly expiresAtMs: number | null;
  /** Delivery/authorization scope for client WebSocket sessions. */
  readonly clientRealtimeScope: ClientRealtimeScope;
  authorize(
    action: PolicyAction,
    resource: PolicyResource,
  ): Promise<PolicyDecision>;
}

/**
 * Deep authorization seam for request-scoped Principals. Keep adapters free of
 * Hono types; the server maps boundary metadata into PrincipalRequest and each
 * adapter validates the credentials it relies on.
 */
export interface PrincipalPolicy {
  resolve(request: PrincipalRequest): Promise<ResolvedPrincipal>;
}
