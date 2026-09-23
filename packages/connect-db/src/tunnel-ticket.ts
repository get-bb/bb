export const TUNNEL_TICKET_PREFIX = "bbtkt_";
export const TUNNEL_TICKET_TTL_MS = 5 * 60 * 1000;
export const TUNNEL_TICKET_CLOCK_SKEW_MS = 60 * 1000;
const TUNNEL_TICKET_KEY_LABEL = "bb-connect-tunnel-ticket:v1";

export interface TunnelTicketPayload {
  sid: string;
  exp: number;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/gu, "");
}

function base64UrlToBytes(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/u.test(value)) return null;
  try {
    const base64 = value.replace(/-/gu, "+").replace(/_/gu, "/");
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

async function tunnelTicketKey(secret: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      info: new TextEncoder().encode(TUNNEL_TICKET_KEY_LABEL),
    },
    material,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign"],
  );
}

async function signPayload(
  payload: string,
  secret: string,
): Promise<Uint8Array> {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await tunnelTicketKey(secret),
    new TextEncoder().encode(payload),
  );
  return new Uint8Array(signature);
}

function constantTimeEqualBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left[index] ^ right[index];
  }
  return diff === 0;
}

export async function createTunnelTicket(
  serverId: string,
  secret: string,
  now: number = Date.now(),
): Promise<{ ticket: string; expiresAt: number }> {
  const expiresAt = now + TUNNEL_TICKET_TTL_MS;
  const body: TunnelTicketPayload = { sid: serverId, exp: expiresAt };
  const payload = bytesToBase64Url(
    new TextEncoder().encode(JSON.stringify(body)),
  );
  const signature = bytesToBase64Url(await signPayload(payload, secret));
  return {
    ticket: `${TUNNEL_TICKET_PREFIX}${payload}.${signature}`,
    expiresAt,
  };
}

export function isTunnelTicket(value: string): boolean {
  return value.startsWith(TUNNEL_TICKET_PREFIX);
}

function parsePayload(bytes: Uint8Array): TunnelTicketPayload | null {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  if (
    typeof value !== "object" ||
    value === null ||
    !("sid" in value) ||
    typeof value.sid !== "string" ||
    value.sid === "" ||
    !("exp" in value) ||
    typeof value.exp !== "number" ||
    !Number.isSafeInteger(value.exp)
  ) {
    return null;
  }
  return { sid: value.sid, exp: value.exp };
}

export async function verifyTunnelTicket(
  ticket: string,
  secret: string,
  now: number = Date.now(),
): Promise<TunnelTicketPayload | null> {
  if (!isTunnelTicket(ticket)) return null;
  const body = ticket.slice(TUNNEL_TICKET_PREFIX.length);
  const dot = body.indexOf(".");
  if (dot <= 0 || dot !== body.lastIndexOf(".")) return null;
  const payload = body.slice(0, dot);
  const presented = base64UrlToBytes(body.slice(dot + 1));
  if (presented === null) return null;
  if (!constantTimeEqualBytes(presented, await signPayload(payload, secret))) {
    return null;
  }
  const payloadBytes = base64UrlToBytes(payload);
  if (payloadBytes === null) return null;
  const parsed = parsePayload(payloadBytes);
  if (parsed === null) return null;
  if (parsed.exp <= now) return null;
  if (parsed.exp > now + TUNNEL_TICKET_TTL_MS + TUNNEL_TICKET_CLOCK_SKEW_MS) {
    return null;
  }
  return parsed;
}
