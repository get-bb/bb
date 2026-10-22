export const NEXT_BASE_DOMAIN = "next.getbb.app";
export const FRP_WEBSOCKET_PATH = "/~!frp";
export const FRP_CREDENTIAL_META = "credential";
export const FRP_VERSION = "0.71.0";
export const FRP_LOGIN_REFUSED_REASON =
  "bb connect refused this server credential";

export const GATE_ASSERTION_HEADER = "x-bb-gate-assertion";
export const GATE_RESOLVE_PATH = "/api/gate/resolve";
export const GATE_PRESENCE_PATH = "/api/gate/presence";
export const GATE_RESOLVE_BATCH_PATH = "/api/gate/resolve/batch";
export const GATE_PRESENCE_BATCH_PATH = "/api/gate/presence/batch";
export const GATE_RESOLVE_BATCH_MAX = 50;
export const GATE_PRESENCE_BATCH_MAX = 500;
export const GATE_KEYS_PATH = "/.well-known/bb-connect-gate-keys.json";
export const GATE_ASSERTION_TTL_SECONDS = 60;
export const GATE_ASSERTION_CLOCK_SKEW_SECONDS = 30;

export const GATE_PUBLIC_PATHS: ReadonlySet<string> = new Set([
  "/install.sh",
  "/install.ps1",
  "/install/version",
  "/install/bb-app.tgz",
]);

export type GateAssertionKind = "session" | "machine" | "oauth" | "public";

export interface GateAssertionOAuth {
  scope: string;
  grantId: string;
  clientName: string;
}

export interface GateAssertionClaims {
  v: 1;
  kid: string;
  aud: string;
  sub: string;
  kind: GateAssertionKind;
  htm: string;
  htu: string;
  target: string | null;
  oauth: GateAssertionOAuth | null;
  iat: number;
  exp: number;
  jti: string;
}

export interface GatePublicKey {
  kid: string;
  kty: "OKP";
  crv: "Ed25519";
  x: string;
}

export interface GateKeySet {
  keys: GatePublicKey[];
}

export interface GateSigningKey {
  kid: string;
  privateKey: CryptoKey;
}

export type GateAssertionFailure =
  | "malformed"
  | "unknown_key"
  | "bad_signature"
  | "expired"
  | "not_yet_valid"
  | "wrong_audience"
  | "wrong_method"
  | "wrong_path";

export type GateAssertionResult =
  | { ok: true; claims: GateAssertionClaims }
  | { ok: false; reason: GateAssertionFailure };

export interface GateResolveRequest {
  label: string;
  session: string | null;
  desktopSession: string | null;
  credential: string | null;
  machineCredential: string | null;
  oauth: { token: string; resource: string } | null;
}

export type GateResolvedLabel =
  | {
      kind: "server";
      serverId: string;
      userId: string;
      revoked: boolean;
      lastSeenAt: number | null;
    }
  | {
      kind: "machine";
      machineId: string;
      userId: string;
      accountHandle: string;
      routingKey: string;
      revoked: boolean;
      lastSeenAt: number | null;
    };

export interface GateResolveResponse {
  label: GateResolvedLabel | null;
  session: { userId: string; needsRefresh: boolean } | null;
  desktopSession: { userId: string; setCookie: string | null } | null;
  credential: boolean | null;
  machine: { machineId: string; userId: string } | null;
  oauth: GateAssertionOAuth | null;
}

export interface GatePresenceRequest {
  label: string;
  state: "connected" | "disconnected";
  region: string;
  gateMachineId: string;
  at: number;
}

export interface GatePresenceResponse {
  recorded: boolean;
}

export interface GateResolveBatchRequest {
  requests: GateResolveRequest[];
}

export interface GateResolveBatchResponse {
  answers: (GateResolveResponse | null)[];
}

export interface GatePresenceBatchRequest {
  reports: GatePresenceRequest[];
}

export type GatePresenceResult = "recorded" | "unchanged" | "unknown_label";

export interface GatePresenceBatchResponse {
  results: GatePresenceResult[];
}

const ED25519 = { name: "Ed25519" } as const;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/u, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/u.test(text)) return null;
  const padded = text.replace(/-/gu, "+").replace(/_/gu, "/");
  try {
    const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseOAuth(value: unknown): GateAssertionOAuth | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const { scope, grantId, clientName } = value;
  if (
    typeof scope !== "string" ||
    typeof grantId !== "string" ||
    typeof clientName !== "string"
  ) {
    return undefined;
  }
  return { scope, grantId, clientName };
}

function parseClaims(value: unknown): GateAssertionClaims | null {
  if (!isRecord(value)) return null;
  const { v, kid, aud, sub, kind, htm, htu, target, iat, exp, jti } = value;
  const oauth = parseOAuth(value.oauth);
  if (
    v !== 1 ||
    typeof kid !== "string" ||
    typeof aud !== "string" ||
    typeof sub !== "string" ||
    (kind !== "session" &&
      kind !== "machine" &&
      kind !== "oauth" &&
      kind !== "public") ||
    typeof htm !== "string" ||
    typeof htu !== "string" ||
    (target !== null && typeof target !== "string") ||
    oauth === undefined ||
    typeof iat !== "number" ||
    typeof exp !== "number" ||
    typeof jti !== "string"
  ) {
    return null;
  }
  return { v, kid, aud, sub, kind, htm, htu, target, oauth, iat, exp, jti };
}

export function gateAudienceForServer(serverId: string): string {
  return `server:${serverId}`;
}

export function gateAudienceForMachine(machineId: string): string {
  return `machine:${machineId}`;
}

function exportedJwk(value: ArrayBuffer | JsonWebKey): JsonWebKey {
  if (value instanceof ArrayBuffer) {
    throw new Error("Ed25519 key export returned raw bytes, not a JWK");
  }
  return value;
}

export async function generateGateKeyPair(kid: string): Promise<{
  signingKey: GateSigningKey;
  publicKey: GatePublicKey;
  privateJwk: JsonWebKey & { kid: string };
}> {
  const pair = (await crypto.subtle.generateKey(ED25519, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const publicJwk = exportedJwk(
    await crypto.subtle.exportKey("jwk", pair.publicKey),
  );
  const privateJwk = exportedJwk(
    await crypto.subtle.exportKey("jwk", pair.privateKey),
  );
  if (typeof publicJwk.x !== "string") {
    throw new Error("Ed25519 public key export has no x");
  }
  return {
    signingKey: { kid, privateKey: pair.privateKey },
    publicKey: { kid, kty: "OKP", crv: "Ed25519", x: publicJwk.x },
    privateJwk: { ...privateJwk, kid },
  };
}

export async function importGateSigningKey(
  jwk: JsonWebKey & { kid?: string },
): Promise<GateSigningKey> {
  if (typeof jwk.kid !== "string" || jwk.kid === "") {
    throw new Error("gate signing key needs a kid");
  }
  const privateKey = await crypto.subtle.importKey("jwk", jwk, ED25519, false, [
    "sign",
  ]);
  return { kid: jwk.kid, privateKey };
}

export function parseGateKeySet(value: unknown): GateKeySet | null {
  if (!isRecord(value) || !Array.isArray(value.keys)) return null;
  const keys: GatePublicKey[] = [];
  for (const key of value.keys) {
    if (
      !isRecord(key) ||
      typeof key.kid !== "string" ||
      key.kty !== "OKP" ||
      key.crv !== "Ed25519" ||
      typeof key.x !== "string"
    ) {
      return null;
    }
    keys.push({ kid: key.kid, kty: "OKP", crv: "Ed25519", x: key.x });
  }
  return { keys };
}

export async function importGateKeySet(
  keySet: GateKeySet,
): Promise<Map<string, CryptoKey>> {
  const imported = new Map<string, CryptoKey>();
  for (const key of keySet.keys) {
    const publicKey = await crypto.subtle.importKey(
      "jwk",
      { kty: key.kty, crv: key.crv, x: key.x },
      ED25519,
      false,
      ["verify"],
    );
    imported.set(key.kid, publicKey);
  }
  return imported;
}

export interface SignGateAssertionInput {
  audience: string;
  subject: string;
  kind: GateAssertionKind;
  method: string;
  pathAndQuery: string;
  target: string | null;
  oauth: GateAssertionOAuth | null;
  nowSeconds: number;
}

export async function signGateAssertion(
  key: GateSigningKey,
  input: SignGateAssertionInput,
): Promise<string> {
  const claims: GateAssertionClaims = {
    v: 1,
    kid: key.kid,
    aud: input.audience,
    sub: input.subject,
    kind: input.kind,
    htm: input.method.toUpperCase(),
    htu: input.pathAndQuery,
    target: input.target,
    oauth: input.oauth,
    iat: input.nowSeconds,
    exp: input.nowSeconds + GATE_ASSERTION_TTL_SECONDS,
    jti: crypto.randomUUID(),
  };
  const payload = toBase64Url(encoder.encode(JSON.stringify(claims)));
  const signature = await crypto.subtle.sign(
    ED25519,
    key.privateKey,
    encoder.encode(payload),
  );
  return `${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

export interface VerifyGateAssertionInput {
  keys: ReadonlyMap<string, CryptoKey>;
  audience: string;
  method: string;
  pathAndQuery: string;
  nowSeconds: number;
}

export async function verifyGateAssertion(
  token: string,
  input: VerifyGateAssertionInput,
): Promise<GateAssertionResult> {
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, reason: "malformed" };
  const [payload = "", signaturePart = ""] = parts;
  const payloadBytes = fromBase64Url(payload);
  const signature = fromBase64Url(signaturePart);
  if (payloadBytes === null || signature === null) {
    return { ok: false, reason: "malformed" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(payloadBytes));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  const claims = parseClaims(parsed);
  if (claims === null) return { ok: false, reason: "malformed" };
  const key = input.keys.get(claims.kid);
  if (key === undefined) return { ok: false, reason: "unknown_key" };
  const valid = await crypto.subtle.verify(
    ED25519,
    key,
    signature,
    encoder.encode(payload),
  );
  if (!valid) return { ok: false, reason: "bad_signature" };
  const skew = GATE_ASSERTION_CLOCK_SKEW_SECONDS;
  if (claims.exp + skew < input.nowSeconds) {
    return { ok: false, reason: "expired" };
  }
  if (claims.iat - skew > input.nowSeconds) {
    return { ok: false, reason: "not_yet_valid" };
  }
  if (claims.aud !== input.audience) {
    return { ok: false, reason: "wrong_audience" };
  }
  if (claims.htm !== input.method.toUpperCase()) {
    return { ok: false, reason: "wrong_method" };
  }
  if (claims.htu !== input.pathAndQuery) {
    return { ok: false, reason: "wrong_path" };
  }
  return { ok: true, claims };
}
