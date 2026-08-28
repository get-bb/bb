import { deriveConnectBaseUrl } from "./urls.js";
import { z } from "zod";

export interface MobilePairingPayload {
  code: string;
  serverUrl: string;
  apex: string;
  expiresAt: number;
}

const mobilePairingPayloadSchema = z.object({
  code: z.string().min(1),
  serverUrl: z.string(),
  apex: z.string(),
  expiresAt: z.number().int(),
});

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

function isHttpUrl(value: string): boolean {
  if (value.length === 0) return false;
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
  const parsed = mobilePairingPayloadSchema.safeParse(raw);
  if (!parsed.success) return null;
  if (!isHttpUrl(parsed.data.serverUrl) || !isHttpUrl(parsed.data.apex)) {
    return null;
  }
  return parsed.data;
}
