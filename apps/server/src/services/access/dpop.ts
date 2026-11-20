import { createHash, createPublicKey, verify } from "node:crypto";
import { z } from "zod";

export const DPOP_MAX_CLOCK_SKEW_SECONDS = 300;

const dpopPublicJwkSchema = z
  .object({
    kty: z.literal("EC"),
    crv: z.literal("P-256"),
    x: z.string().min(1),
    y: z.string().min(1),
  })
  .passthrough()
  .refine((jwk) => !("d" in jwk), "a DPoP header must not carry a private key");

const dpopHeaderSchema = z.object({
  typ: z.literal("dpop+jwt"),
  alg: z.literal("ES256"),
  jwk: dpopPublicJwkSchema,
});

const dpopPayloadSchema = z.object({
  htm: z.string().min(1),
  htu: z.string().min(1),
  jti: z.string().min(1).max(200),
  iat: z.number().int(),
  ath: z.string().optional(),
});

export type DpopFailure =
  | "missing_proof"
  | "malformed_proof"
  | "key_mismatch"
  | "request_mismatch"
  | "token_mismatch"
  | "time_window"
  | "invalid_signature"
  | "replay";

export type DpopVerification =
  | { ok: true; jkt: string; jti: string; iat: number }
  | { ok: false; failure: DpopFailure };

export interface VerifyDpopProofArgs {
  proof: string | undefined;
  method: string;
  url: string;
  nowSeconds: number;
  notBeforeSeconds: number;
  expectedJkt: string | null;
  accessToken: string | null;
}

function base64UrlSha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

export function dpopAccessTokenHash(accessToken: string): string {
  return base64UrlSha256(accessToken);
}

export function dpopJwkThumbprint(jwk: {
  crv: string;
  kty: string;
  x: string;
  y: string;
}): string {
  return base64UrlSha256(
    JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y }),
  );
}

export function normalizeDpopHtu(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol === "ws:") parsed.protocol = "http:";
  if (parsed.protocol === "wss:") parsed.protocol = "https:";
  parsed.hash = "";
  parsed.search = "";
  return parsed.toString();
}

function decodeJson(segment: string): unknown {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
}

export function verifyDpopProof(args: VerifyDpopProofArgs): DpopVerification {
  if (args.proof === undefined || args.proof.trim().length === 0) {
    return { ok: false, failure: "missing_proof" };
  }
  const parts = args.proof.trim().split(".");
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
    return { ok: false, failure: "malformed_proof" };
  }
  const [encodedHeader, encodedPayload, encodedSignature] = parts as [
    string,
    string,
    string,
  ];
  let header: z.infer<typeof dpopHeaderSchema>;
  let payload: z.infer<typeof dpopPayloadSchema>;
  try {
    const parsedHeader = dpopHeaderSchema.safeParse(decodeJson(encodedHeader));
    const parsedPayload = dpopPayloadSchema.safeParse(
      decodeJson(encodedPayload),
    );
    if (!parsedHeader.success || !parsedPayload.success) {
      return { ok: false, failure: "malformed_proof" };
    }
    header = parsedHeader.data;
    payload = parsedPayload.data;
  } catch {
    return { ok: false, failure: "malformed_proof" };
  }
  const jkt = dpopJwkThumbprint(header.jwk);
  if (args.expectedJkt !== null && jkt !== args.expectedJkt) {
    return { ok: false, failure: "key_mismatch" };
  }
  const htu = normalizeDpopHtu(args.url);
  if (
    payload.htm.toUpperCase() !== args.method.toUpperCase() ||
    htu === null ||
    payload.htu !== htu
  ) {
    return { ok: false, failure: "request_mismatch" };
  }
  if (
    args.accessToken !== null &&
    payload.ath !== dpopAccessTokenHash(args.accessToken)
  ) {
    return { ok: false, failure: "token_mismatch" };
  }
  let signatureValid = false;
  try {
    const key = createPublicKey({
      key: { kty: "EC", crv: "P-256", x: header.jwk.x, y: header.jwk.y },
      format: "jwk",
    });
    signatureValid = verify(
      "sha256",
      Buffer.from(`${encodedHeader}.${encodedPayload}`, "utf8"),
      { key, dsaEncoding: "ieee-p1363" },
      Buffer.from(encodedSignature, "base64url"),
    );
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) return { ok: false, failure: "invalid_signature" };
  if (
    Math.abs(args.nowSeconds - payload.iat) > DPOP_MAX_CLOCK_SKEW_SECONDS ||
    payload.iat < args.notBeforeSeconds
  ) {
    return { ok: false, failure: "time_window" };
  }
  return { ok: true, jkt, jti: payload.jti, iat: payload.iat };
}
