export const principalKindValues = [
  "human",
  "agent",
  "machine",
  "system",
] as const;
export type PrincipalKind = (typeof principalKindValues)[number];

/**
 * Authenticated actor identity. Resolved only after server-side credential
 * validation — never from browser-supplied principal or actor fields.
 */
export type Principal = {
  readonly id: string;
  readonly kind: PrincipalKind;
  readonly displayName: string;
};

export type PolicyDecisionReason =
  | "unauthenticated"
  | "not_found"
  | "forbidden";

export type PolicyDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: PolicyDecisionReason };

/**
 * Named operation under authorization. Concrete inventories are layered on in
 * later slices; adapters must treat unknown names fail-closed unless they
 * intentionally allow them (local-owner).
 */
export type PolicyAction = {
  readonly name: string;
};

/**
 * Resource target for an authorization check. `id` is null for collection-level
 * or unscoped checks.
 */
export type PolicyResource = {
  readonly kind: string;
  readonly id: string | null;
};

export type PrincipalTransport = "http" | "websocket";

/**
 * Request metadata presented at the server boundary. Adapters must validate
 * credentials and must not treat caller-selected identity headers or query
 * parameters as authoritative.
 */
export type PrincipalRequest = {
  readonly method: string;
  readonly path: string;
  readonly transport: PrincipalTransport;
  readonly getHeader: (name: string) => string | undefined;
};
