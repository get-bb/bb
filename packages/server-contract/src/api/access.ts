import { accessCredentialKindSchema } from "@bb/domain";
import { z } from "zod";

export const APP_SHELL_ACCESS_ELEMENT_ID = "bb-access";

export const appShellAccessStateSchema = z
  .object({ authenticated: z.boolean() })
  .strict();
export type AppShellAccessState = z.infer<typeof appShellAccessStateSchema>;

export const ACCESS_UNAUTHENTICATED_ERROR_CODE = "unauthenticated";
export const ACCESS_CREDENTIAL_REQUIRES_HTTPS_ERROR_CODE =
  "credential_requires_https";
export const ACCESS_TOKEN_EXPIRED_ERROR_CODE = "access_token_expired";
export const ACCESS_INVALID_DPOP_PROOF_ERROR_CODE = "invalid_dpop_proof";
export const ACCESS_PROBLEM_CODES = [
  ACCESS_CREDENTIAL_REQUIRES_HTTPS_ERROR_CODE,
  ACCESS_TOKEN_EXPIRED_ERROR_CODE,
  ACCESS_INVALID_DPOP_PROOF_ERROR_CODE,
] as const;
export const accessProblemSchema = z.enum(ACCESS_PROBLEM_CODES);
export type AccessProblemCode = z.infer<typeof accessProblemSchema>;

export const accessSessionResponseSchema = z
  .object({
    authenticated: z.boolean(),
    via: z
      .enum(["local", "plugin", "connect", "credential", "machine", "open"])
      .nullable(),
    credentialId: z.string().nullable(),
    problem: accessProblemSchema.nullable(),
    requireSignIn: z.boolean(),
  })
  .strict();
export type AccessSessionResponse = z.infer<typeof accessSessionResponseSchema>;

export const accessPairingSchema = z
  .object({
    code: z.string(),
    expiresAt: z.number().int(),
  })
  .strict();
export type AccessPairing = z.infer<typeof accessPairingSchema>;

export const accessCredentialSchema = z
  .object({
    id: z.string(),
    kind: accessCredentialKindSchema,
    label: z.string(),
    origin: z.string(),
    secureOnly: z.boolean(),
    createdAt: z.number().int(),
    lastUsedAt: z.number().int(),
    expiresAt: z.number().int(),
    deviceBound: z.boolean(),
    current: z.boolean(),
  })
  .strict();
export type AccessCredential = z.infer<typeof accessCredentialSchema>;

export const ACCESS_CREDENTIAL_LABEL_MAX_LENGTH = 80;

export const redeemAccessPairingRequestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("browser"), code: z.string().min(1) }).strict(),
  z
    .object({
      kind: z.literal("device"),
      code: z.string().min(1),
      label: z.string().trim().min(1).max(ACCESS_CREDENTIAL_LABEL_MAX_LENGTH),
    })
    .strict(),
]);
export type RedeemAccessPairingRequest = z.infer<
  typeof redeemAccessPairingRequestSchema
>;

export const deviceAccessTokenSchema = z
  .object({
    accessToken: z.string(),
    accessTokenExpiresAt: z.number().int(),
  })
  .strict();
export type DeviceAccessToken = z.infer<typeof deviceAccessTokenSchema>;

export const redeemAccessPairingResponseSchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("browser"), credential: accessCredentialSchema })
    .strict(),
  z
    .object({
      kind: z.literal("device"),
      credential: accessCredentialSchema,
      accessToken: z.string(),
      accessTokenExpiresAt: z.number().int(),
    })
    .strict(),
]);
export type RedeemAccessPairingResponse = z.infer<
  typeof redeemAccessPairingResponseSchema
>;

export const renewAccessTokenResponseSchema = deviceAccessTokenSchema
  .extend({ sessionExpiresAt: z.number().int() })
  .strict();
export type RenewAccessTokenResponse = z.infer<
  typeof renewAccessTokenResponseSchema
>;

export const sessionCookieResponseSchema = z
  .object({
    credential: accessCredentialSchema,
    token: z.string(),
    cookieName: z.string(),
    expiresAt: z.number().int(),
  })
  .strict();
export type SessionCookieResponse = z.infer<typeof sessionCookieResponseSchema>;

export const createLocalSessionRequestSchema = z
  .object({
    label: z.string().trim().min(1).max(ACCESS_CREDENTIAL_LABEL_MAX_LENGTH),
  })
  .strict();
export type CreateLocalSessionRequest = z.infer<
  typeof createLocalSessionRequestSchema
>;

export const websocketTicketResponseSchema = z
  .object({ ticket: z.string(), expiresAt: z.number().int() })
  .strict();
export type WebsocketTicketResponse = z.infer<
  typeof websocketTicketResponseSchema
>;

export const accessCredentialListResponseSchema = z
  .object({ credentials: z.array(accessCredentialSchema) })
  .strict();
export type AccessCredentialListResponse = z.infer<
  typeof accessCredentialListResponseSchema
>;

export const revokeAccessCredentialResponseSchema = z
  .object({ revoked: z.literal(true) })
  .strict();
export type RevokeAccessCredentialResponse = z.infer<
  typeof revokeAccessCredentialResponseSchema
>;

export const accessSignOutResponseSchema = z
  .object({ signedOut: z.boolean() })
  .strict();
export type AccessSignOutResponse = z.infer<typeof accessSignOutResponseSchema>;

export const ACCESS_SIGN_IN_THIS_DEVICE_FIRST_ERROR_CODE =
  "sign_in_this_device_first";

export const setRequireSignInRequestSchema = z
  .object({ enabled: z.boolean() })
  .strict();
export type SetRequireSignInRequest = z.infer<
  typeof setRequireSignInRequestSchema
>;

export const setRequireSignInResponseSchema = z
  .object({
    requireSignIn: z.boolean(),
    signedInThisBrowser: accessCredentialSchema.nullable(),
  })
  .strict();
export type SetRequireSignInResponse = z.infer<
  typeof setRequireSignInResponseSchema
>;
