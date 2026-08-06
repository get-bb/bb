import type {
  PolicyAction,
  PolicyDecision,
  PolicyResource,
  Principal,
  PrincipalRequest,
} from "@bb/domain";
import {
  WORK_TOGETHER_PRINCIPAL_ASSERTION_HEADER,
  WORK_TOGETHER_PRINCIPAL_CLOCK_SKEW_SECONDS,
} from "@bb/server-contract";
import {
  freezeWorkTogetherMembership,
  type WorkTogetherMembershipVerifier,
} from "./work-together-membership.js";
import { isRegistryIssuedClientWebsocketAuthorization } from "./client-websocket-authorization.js";
import type { PrincipalPolicy, ResolvedPrincipal } from "./principal-policy.js";
import { decidePublicHttpAuthorization } from "./public-http-authorization.js";
import {
  WorkTogetherPrincipalAssertionError,
  rejectWorkTogetherPrincipalAssertion,
} from "./work-together-principal-assertion-error.js";
import type { PrincipalAssertionReplayGuard } from "./work-together-principal-replay-guard.js";
import {
  assertWorkTogetherPrincipalVerifierConfig,
  copyPinnedVerificationKeys,
  readSafeNonnegativeIntegerNow,
  verifyWorkTogetherPrincipalAssertion,
  type WorkTogetherPrincipalVerificationKey,
} from "./work-together-principal-verifier.js";

const FORBIDDEN_IDENTITY_HEADERS = [
  "authorization",
  "x-user-id",
  "x-clerk-user-id",
  "x-forwarded-user",
  "x-auth-request-user",
  "x-principal-id",
  "x-actor-id",
  "x-bb-principal",
  "x-bb-actor-id",
] as const;

export type WorkTogetherPrincipalPolicyOptions = {
  readonly issuer: string;
  readonly cellId: string;
  readonly workspaceId: string;
  readonly verificationKeys:
    | ReadonlyMap<string, WorkTogetherPrincipalVerificationKey>
    | Readonly<Record<string, WorkTogetherPrincipalVerificationKey>>;
  readonly membershipVerifier: WorkTogetherMembershipVerifier;
  readonly replayGuard: PrincipalAssertionReplayGuard;
  /** Injected epoch-ms clock. Defaults to Date.now. */
  readonly now?: () => number;
};

/**
 * Signed Work Together Principal policy.
 *
 * Resolves a frozen human Principal from a compact JWS assertion after
 * membership and (when required) replay checks. Session authorize rechecks
 * current membership for the exact signed revision on every call.
 */
export function createWorkTogetherPrincipalPolicy(
  options: WorkTogetherPrincipalPolicyOptions,
): PrincipalPolicy {
  try {
    return createValidatedWorkTogetherPrincipalPolicy(options);
  } catch (error) {
    if (error instanceof WorkTogetherPrincipalAssertionError) {
      throw error;
    }
    rejectWorkTogetherPrincipalAssertion();
  }
}

function createValidatedWorkTogetherPrincipalPolicy(
  options: WorkTogetherPrincipalPolicyOptions,
): PrincipalPolicy {
  const now = options.now ?? Date.now;
  assertWorkTogetherPrincipalVerifierConfig({
    issuer: options.issuer,
    cellId: options.cellId,
    workspaceId: options.workspaceId,
    now,
  });
  if (
    options.membershipVerifier === null ||
    typeof options.membershipVerifier !== "object" ||
    typeof options.membershipVerifier.currentMembership !== "function"
  ) {
    rejectWorkTogetherPrincipalAssertion();
  }
  if (
    options.replayGuard === null ||
    typeof options.replayGuard !== "object" ||
    typeof options.replayGuard.consume !== "function"
  ) {
    rejectWorkTogetherPrincipalAssertion();
  }

  const verificationKeys = copyPinnedVerificationKeys(options.verificationKeys);
  const issuer = options.issuer;
  const cellId = options.cellId;
  const workspaceId = options.workspaceId;
  const membershipVerifier = options.membershipVerifier;
  const replayGuard = options.replayGuard;

  return {
    async resolve(request: PrincipalRequest): Promise<ResolvedPrincipal> {
      try {
        assertNoForbiddenIdentityHeaders(request);
        const token = readAssertionToken(request);

        const verified = await verifyWorkTogetherPrincipalAssertion({
          token,
          config: {
            issuer,
            cellId,
            workspaceId,
            verificationKeys,
            now,
          },
          actualMethod: request.method,
          actualTarget: request.target,
          actualTransport: request.transport,
        });
        const claims = verified.claims;

        let membership;
        try {
          membership = await membershipVerifier.currentMembership({
            cellId,
            subject: claims.sub,
          });
        } catch {
          rejectWorkTogetherPrincipalAssertion();
        }
        if (membership === null) {
          rejectWorkTogetherPrincipalAssertion();
        }
        membership = freezeWorkTogetherMembership(membership);
        if (membership.membershipRevision !== claims.membership_revision) {
          rejectWorkTogetherPrincipalAssertion();
        }

        const requiresReplay =
          claims.transport === "websocket" || claims.request_method !== "GET";
        if (requiresReplay) {
          const nowMs = readSafeNonnegativeIntegerNow(now);
          const expiresAtMs =
            (claims.exp + WORK_TOGETHER_PRINCIPAL_CLOCK_SKEW_SECONDS) * 1000;
          let replayResult;
          try {
            replayResult = await replayGuard.consume({
              jti: claims.jti,
              expiresAtMs,
              nowMs,
            });
          } catch {
            rejectWorkTogetherPrincipalAssertion();
          }
          if (replayResult !== "consumed") {
            rejectWorkTogetherPrincipalAssertion();
          }
        }

        const principal: Principal = Object.freeze({
          id: claims.sub,
          kind: "human" as const,
          displayName: claims.display_name,
        });
        const expectedRevision = claims.membership_revision;
        const subject = claims.sub;
        // Exact assertion expiry for client sockets (not replay-skew window).
        const expiresAtMs = claims.exp * 1000;

        const session: ResolvedPrincipal = {
          principal,
          expiresAtMs,
          clientRealtimeScope: "scoped",
          async authorize(
            action: PolicyAction,
            resource: PolicyResource,
          ): Promise<PolicyDecision> {
            try {
              const currentResult = await membershipVerifier.currentMembership({
                cellId,
                subject,
              });
              if (currentResult === null) {
                return { allowed: false, reason: "unauthenticated" };
              }
              const current = freezeWorkTogetherMembership(currentResult);
              if (current.membershipRevision !== expectedRevision) {
                return { allowed: false, reason: "forbidden" };
              }
              // Registry-issued client-WS pairs (reauthorize + exact standard
              // detail targets) are allowed for both owner and member after
              // membership/revision recheck. Public HTTP stays unchanged.
              if (
                isRegistryIssuedClientWebsocketAuthorization(action, resource)
              ) {
                return { allowed: true };
              }
              return decidePublicHttpAuthorization({
                role: current.role,
                action,
                resource,
              });
            } catch {
              return { allowed: false, reason: "unauthenticated" };
            }
          },
        };
        return Object.freeze(session);
      } catch (error) {
        if (error instanceof WorkTogetherPrincipalAssertionError) {
          throw error;
        }
        rejectWorkTogetherPrincipalAssertion();
      }
    },
  };
}

function assertNoForbiddenIdentityHeaders(request: PrincipalRequest): void {
  for (const name of FORBIDDEN_IDENTITY_HEADERS) {
    const value = request.getHeader(name);
    if (value !== undefined) {
      rejectWorkTogetherPrincipalAssertion();
    }
  }
}

function readAssertionToken(request: PrincipalRequest): string {
  const value = request.getHeader(WORK_TOGETHER_PRINCIPAL_ASSERTION_HEADER);
  if (typeof value !== "string" || value.length < 1) {
    rejectWorkTogetherPrincipalAssertion();
  }
  if (value.includes(",")) {
    rejectWorkTogetherPrincipalAssertion();
  }
  return value;
}
