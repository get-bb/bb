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
 * Deep authorization seam for request-scoped Principals. Keep adapters free of
 * Hono types; the server maps boundary metadata into PrincipalRequest and each
 * adapter validates the credentials it relies on.
 */
export interface PrincipalPolicy {
  principal(request: PrincipalRequest): Promise<Principal>;
  authorize(
    principal: Principal,
    action: PolicyAction,
    resource: PolicyResource,
  ): Promise<PolicyDecision>;
}
