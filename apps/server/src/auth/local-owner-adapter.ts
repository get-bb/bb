import type {
  PolicyAction,
  PolicyDecision,
  PolicyResource,
  Principal,
} from "@bb/domain";
import type { PrincipalPolicy } from "./principal-policy.js";

export const LOCAL_OWNER_PRINCIPAL_ID = "local-owner";

/** Stable stock owner for single-operator BB. Frozen so callers share identity. */
export const LOCAL_OWNER_PRINCIPAL: Principal = Object.freeze({
  id: LOCAL_OWNER_PRINCIPAL_ID,
  kind: "human",
  displayName: "Local Owner",
});

/**
 * Stock PrincipalPolicy: one owner Principal and explicit allow for all actions.
 * Preserves ordinary upstream BB behavior until a signed multiplayer adapter is
 * configured.
 */
export function createLocalOwnerPrincipalPolicy(): PrincipalPolicy {
  return {
    async principal(): Promise<Principal> {
      return LOCAL_OWNER_PRINCIPAL;
    },
    async authorize(
      principal: Principal,
      _action: PolicyAction,
      _resource: PolicyResource,
    ): Promise<PolicyDecision> {
      if (
        principal.id !== LOCAL_OWNER_PRINCIPAL.id ||
        principal.kind !== LOCAL_OWNER_PRINCIPAL.kind ||
        principal.displayName !== LOCAL_OWNER_PRINCIPAL.displayName
      ) {
        return { allowed: false, reason: "unauthenticated" };
      }
      return { allowed: true };
    },
  };
}
