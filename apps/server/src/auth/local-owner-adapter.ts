import type {
  PolicyAction,
  PolicyDecision,
  PolicyResource,
  Principal,
} from "@bb/domain";
import type { PrincipalPolicy, ResolvedPrincipal } from "./principal-policy.js";

export const LOCAL_OWNER_PRINCIPAL_ID = "local-owner";

/** Stable stock owner for single-operator BB. Frozen so callers share identity. */
export const LOCAL_OWNER_PRINCIPAL: Principal = Object.freeze({
  id: LOCAL_OWNER_PRINCIPAL_ID,
  kind: "human",
  displayName: "Local Owner",
});

function isLocalOwnerPrincipal(principal: Principal): boolean {
  return (
    principal.id === LOCAL_OWNER_PRINCIPAL.id &&
    principal.kind === LOCAL_OWNER_PRINCIPAL.kind &&
    principal.displayName === LOCAL_OWNER_PRINCIPAL.displayName
  );
}

/**
 * Stock PrincipalPolicy: one owner Principal and a session authorize closure
 * that explicitly allows only that sanitized local owner. Preserves ordinary
 * upstream BB behavior until a signed multiplayer adapter is configured.
 */
export function createLocalOwnerPrincipalPolicy(): PrincipalPolicy {
  return {
    async resolve(): Promise<ResolvedPrincipal> {
      const principal = LOCAL_OWNER_PRINCIPAL;
      return {
        principal,
        async authorize(
          _action: PolicyAction,
          _resource: PolicyResource,
        ): Promise<PolicyDecision> {
          if (!isLocalOwnerPrincipal(principal)) {
            return { allowed: false, reason: "unauthenticated" };
          }
          return { allowed: true };
        },
      };
    },
  };
}
