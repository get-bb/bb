import { deriveConnectBaseUrl } from "./urls.js";

// What a paired bb shows (as a QR code and as text) so the bb mobile app can
// enroll itself as a connect machine. The producer side is the connect
// plugin ("Add mobile device" in Settings → Remote access and
// `bb connect machine-code`); the consumer is the phone's scanner / manual
// entry, which redeems `code` at `apex` and then talks to `serverUrl`.
//
// `apex` rides along even though it is derivable from `serverUrl`: the phone
// must not guess which cloud minted the code (self-hosted apexes, local Cloud
// during development), and the producer already knows it.
//
// Deliberately zod-free: the connect plugin's browser bundle encodes this and
// must not carry the validation stack for one object.
export interface MobilePairingPayload {
  /** One-time machine-pair code (`XXXX-XXXX`). */
  code: string;
  /** The bb this code targets, e.g. `https://<handle>.getbb.app`. */
  serverUrl: string;
  /** The connect apex that redeems the code, e.g. `https://getbb.app`. */
  apex: string;
  /** Epoch ms after which the apex refuses the code. */
  expiresAt: number;
}

/**
 * Build the pairing payload from a minted machine code. `apex` is derived
 * from the server URL the apex echoed, so both always name the same cloud.
 */
export function mobilePairingPayload(machineCode: {
  code: string;
  serverUrl: string;
  expiresAt: number;
}): MobilePairingPayload {
  return {
    code: machineCode.code,
    serverUrl: machineCode.serverUrl,
    apex: deriveConnectBaseUrl(machineCode.serverUrl),
    expiresAt: machineCode.expiresAt,
  };
}

/** The QR code contents: compact JSON with a fixed key order. */
export function encodeMobilePairingPayload(
  payload: MobilePairingPayload,
): string {
  return JSON.stringify({
    code: payload.code,
    serverUrl: payload.serverUrl,
    apex: payload.apex,
    expiresAt: payload.expiresAt,
  });
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Parse scanned QR text back into a payload, or null when it is not one
 * (another QR code, a bare URL, truncated JSON, wrong field types). Unknown
 * extra fields are ignored so an older phone can still read a newer payload.
 */
export function parseMobilePairingPayload(
  text: string,
): MobilePairingPayload | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const record = raw as {
    code?: unknown;
    serverUrl?: unknown;
    apex?: unknown;
    expiresAt?: unknown;
  };
  if (
    typeof record.code !== "string" ||
    record.code.length === 0 ||
    !isHttpUrl(record.serverUrl) ||
    !isHttpUrl(record.apex) ||
    typeof record.expiresAt !== "number" ||
    !Number.isInteger(record.expiresAt)
  ) {
    return null;
  }
  return {
    code: record.code,
    serverUrl: record.serverUrl,
    apex: record.apex,
    expiresAt: record.expiresAt,
  };
}
