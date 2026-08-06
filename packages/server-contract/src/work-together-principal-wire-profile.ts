/**
 * Shared Work Together Principal assertion wire profile.
 *
 * Constants and claim-key contract only — no crypto. Verifiers live in the
 * server auth adapter and must treat these values as exact.
 */

/** HTTP header carrying the compact JWS assertion. */
export const WORK_TOGETHER_PRINCIPAL_ASSERTION_HEADER =
  "x-work-together-principal" as const;

/** Protected header `typ` value. */
export const WORK_TOGETHER_PRINCIPAL_JWT_TYP =
  "work-together-principal+jwt" as const;

/** Protected header `alg` value. */
export const WORK_TOGETHER_PRINCIPAL_JWT_ALG = "EdDSA" as const;

/** Maximum `exp - iat` lifetime in seconds. */
export const WORK_TOGETHER_PRINCIPAL_MAX_LIFETIME_SECONDS = 60 as const;

/** Allowed clock skew in seconds for `iat`/`nbf`/`exp` checks. */
export const WORK_TOGETHER_PRINCIPAL_CLOCK_SKEW_SECONDS = 5 as const;

/**
 * Exact required claim keys. Verifiers must reject any missing or extra key.
 *
 * `membership_revision` is a canonical positive PostgreSQL bigint decimal
 * string. `request_target` is a v1 canonical internal request target
 * (path plus optional query).
 */
export const WORK_TOGETHER_PRINCIPAL_CLAIM_KEYS = [
  "iss",
  "aud",
  "sub",
  "jti",
  "iat",
  "nbf",
  "exp",
  "workspace_id",
  "membership_revision",
  "principal_kind",
  "display_name",
  "request_method",
  "request_target",
  "transport",
] as const;

export type WorkTogetherPrincipalClaimKey =
  (typeof WORK_TOGETHER_PRINCIPAL_CLAIM_KEYS)[number];

export type WorkTogetherPrincipalClaims = {
  readonly iss: string;
  readonly aud: string;
  readonly sub: string;
  readonly jti: string;
  readonly iat: number;
  readonly nbf: number;
  readonly exp: number;
  readonly workspace_id: string;
  readonly membership_revision: string;
  readonly principal_kind: "human";
  readonly display_name: string;
  readonly request_method: string;
  readonly request_target: string;
  readonly transport: "http" | "websocket";
};
