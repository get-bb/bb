import { z } from "zod";
import { deriveConnectBaseUrl } from "./urls.js";

const sealedPayloadSchema = z
  .object({
    serverKey: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
    fingerprint: z.string().regex(/^(?:[0-9A-F]{4}-){5}[0-9A-F]{4}$/u),
    deviceCode: z.string().regex(/^[A-Z2-9]{4}(?:-?[A-Z2-9]{4}){2}$/u),
  })
  .strict();

export interface MobilePairingSealedPayload {
  serverKey: string;
  fingerprint: string;
  deviceCode: string;
}

export interface MobilePairingPayload {
  code: string;
  serverUrl: string;
  apex: string;
  expiresAt: number;
  sealed?: MobilePairingSealedPayload;
}

export function mobilePairingPayload(
  machineCode: {
    code: string;
    serverUrl: string;
    expiresAt: number;
  },
  sealed?: MobilePairingSealedPayload,
): MobilePairingPayload {
  return {
    code: machineCode.code,
    serverUrl: machineCode.serverUrl,
    apex: deriveConnectBaseUrl(machineCode.serverUrl),
    expiresAt: machineCode.expiresAt,
    ...(sealed !== undefined ? { sealed } : {}),
  };
}

export function encodeMobilePairingPayload(
  payload: MobilePairingPayload,
): string {
  return JSON.stringify({
    code: payload.code,
    serverUrl: payload.serverUrl,
    apex: payload.apex,
    expiresAt: payload.expiresAt,
    ...(payload.sealed !== undefined ? { sealed: payload.sealed } : {}),
  });
}

function parseSealedPayload(value: unknown): MobilePairingSealedPayload | null {
  const parsed = sealedPayloadSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
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
    sealed?: unknown;
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
  const sealed =
    record.sealed === undefined ? null : parseSealedPayload(record.sealed);
  if (record.sealed !== undefined && sealed === null) return null;
  return {
    code: record.code,
    serverUrl: record.serverUrl,
    apex: record.apex,
    expiresAt: record.expiresAt,
    ...(sealed !== null ? { sealed } : {}),
  };
}
