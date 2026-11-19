import { accessCredentialKindSchema } from "@bb/domain";
import { z } from "zod";

export const APP_SHELL_ACCESS_ELEMENT_ID = "bb-access";

export const appShellAccessStateSchema = z
  .object({ authenticated: z.literal(false) })
  .strict();
export type AppShellAccessState = z.infer<typeof appShellAccessStateSchema>;

export const ACCESS_UNAUTHENTICATED_ERROR_CODE = "unauthenticated";
export const ACCESS_CREDENTIAL_REQUIRES_HTTPS_ERROR_CODE =
  "credential_requires_https";

export const accessSessionResponseSchema = z
  .object({
    authenticated: z.boolean(),
    via: z.enum(["local", "connect", "credential", "machine"]).nullable(),
    credentialId: z.string().nullable(),
    problem: z.literal(ACCESS_CREDENTIAL_REQUIRES_HTTPS_ERROR_CODE).nullable(),
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

export const redeemAccessPairingResponseSchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("browser"), credential: accessCredentialSchema })
    .strict(),
  z
    .object({
      kind: z.literal("device"),
      credential: accessCredentialSchema,
      token: z.string(),
      cookieName: z.string(),
    })
    .strict(),
]);
export type RedeemAccessPairingResponse = z.infer<
  typeof redeemAccessPairingResponseSchema
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
