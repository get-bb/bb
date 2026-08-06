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
 * Request-scoped authorization session returned by PrincipalPolicy.resolve.
 * `authorize` is closed over adapter-validated credentials and must not accept
 * a caller-supplied Principal.
 */
export interface ResolvedPrincipal {
  readonly principal: Principal;
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
