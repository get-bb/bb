import {
  deriveConnectBaseUrl,
  parseMobilePairingPayload,
  serverUrlForHandle,
} from "@bb/connect-client";

/** Where `redeemMachineCredential` is called when nothing names another apex. */
export const DEFAULT_CONNECT_APEX_URL = "https://getbb.app";

/**
 * What a pairing QR code / deep link / pasted payload carries. Only `code`
 * is required: the apex echoes the paired server in the redeem response, so
 * `serverUrl` is a hint (it derives the apex for self-hosted gates and
 * pre-fills the form), and `expiresAt` is only shown to the user.
 */
export interface ConnectPairingInput {
  code: string;
  serverUrl: string | null;
  apexUrl: string | null;
  expiresAt: number | null;
}

const CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{3,63}$/u;

/** Codes are case-insensitive on the apex (`code.trim().toUpperCase()`). */
function normalizeConnectCode(raw: string): string {
  return raw.trim().toUpperCase();
}

function isValidConnectCode(code: string): boolean {
  return CODE_PATTERN.test(code);
}

function httpOrigin(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function epochMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function fromRecord(
  record: Record<string, unknown>,
): ConnectPairingInput | null {
  if (typeof record.code !== "string") return null;
  const code = normalizeConnectCode(record.code);
  if (!isValidConnectCode(code)) return null;
  return {
    code,
    serverUrl: httpOrigin(record.serverUrl),
    apexUrl: httpOrigin(record.apex ?? record.apexUrl),
    expiresAt: epochMs(record.expiresAt),
  };
}

/**
 * Parse whatever a QR scan, a deep link, or the clipboard produced:
 * - the `MobilePairingPayload` JSON the connect plugin encodes (web "Add
 *   mobile device" QR / `bb connect machine-code --json`), or a looser JSON
 *   object that at least carries `code`,
 * - a URL with those fields as query params (`bb://connect?code=…`,
 *   `https://getbb.app/…?code=…`),
 * - a bare code (`ABCD-EFGH`).
 * Returns null for anything else (the scanner keeps looking).
 */
export function parseConnectPairingPayload(
  raw: string,
): ConnectPairingInput | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.startsWith("{")) {
    const shared = parseMobilePairingPayload(trimmed);
    if (shared) {
      const code = normalizeConnectCode(shared.code);
      if (!isValidConnectCode(code)) return null;
      return {
        code,
        serverUrl: httpOrigin(shared.serverUrl),
        apexUrl: httpOrigin(shared.apex),
        expiresAt: shared.expiresAt,
      };
    }
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (typeof parsed !== "object" || parsed === null) return null;
      return fromRecord(parsed as Record<string, unknown>);
    } catch {
      return null;
    }
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(trimmed)) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      return null;
    }
    const params = url.searchParams;
    const code = params.get("code");
    if (code === null) return null;
    return fromRecord({
      code,
      serverUrl: params.get("serverUrl") ?? params.get("server") ?? undefined,
      apex: params.get("apex") ?? params.get("apexUrl") ?? undefined,
      expiresAt: params.get("expiresAt") ?? undefined,
    });
  }
  const code = normalizeConnectCode(trimmed);
  return isValidConnectCode(code)
    ? { code, serverUrl: null, apexUrl: null, expiresAt: null }
    : null;
}

export interface EnrollmentTargetInput {
  code: string;
  /**
   * What the user typed for the server: a handle (`bee`), a server URL
   * (`https://bee.getbb.app`), or nothing. Only used to derive the apex.
   */
  server: string;
  /** Explicit apex override (advanced / self-hosted); empty = derive. */
  apexUrl: string;
}

export type EnrollmentTarget =
  | {
      ok: true;
      code: string;
      apexUrl: string;
      /** `https://<handle>.<apex>` when the server was named, for the UI. */
      serverUrl: string | null;
    }
  | { ok: false; field: "code" | "server" | "apexUrl"; message: string };

/**
 * Turn the manual-entry form into the redeem call's arguments. The apex is,
 * in order: the explicit override, the apex derived from a server URL
 * (`https://bee.getbb.app` → `https://getbb.app`), or `https://getbb.app`.
 */
export function resolveEnrollmentTarget(
  input: EnrollmentTargetInput,
): EnrollmentTarget {
  const code = normalizeConnectCode(input.code);
  if (code.length === 0) {
    return { ok: false, field: "code", message: "Enter the pairing code." };
  }
  if (!isValidConnectCode(code)) {
    return {
      ok: false,
      field: "code",
      message:
        "That does not look like a pairing code (letters, digits, dashes).",
    };
  }
  const explicitApex = input.apexUrl.trim();
  let apexUrl: string | null = null;
  if (explicitApex.length > 0) {
    apexUrl = httpOrigin(explicitApex);
    if (apexUrl === null) {
      return {
        ok: false,
        field: "apexUrl",
        message: "The bb connect address must be an http(s) URL.",
      };
    }
  }
  const server = input.server.trim();
  let serverUrl: string | null = null;
  if (server.length > 0) {
    if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(server)) {
      serverUrl = httpOrigin(server);
      if (serverUrl === null) {
        return {
          ok: false,
          field: "server",
          message: "The server must be a handle or an http(s) URL.",
        };
      }
      apexUrl ??= deriveConnectBaseUrl(serverUrl);
    } else if (/^[a-z0-9-]+$/iu.test(server)) {
      apexUrl ??= DEFAULT_CONNECT_APEX_URL;
      serverUrl = serverUrlForHandle(apexUrl, server.toLowerCase());
    } else {
      return {
        ok: false,
        field: "server",
        message: "Enter the server's handle (like bee) or its URL.",
      };
    }
  }
  return {
    ok: true,
    code,
    apexUrl: apexUrl ?? DEFAULT_CONNECT_APEX_URL,
    serverUrl,
  };
}
