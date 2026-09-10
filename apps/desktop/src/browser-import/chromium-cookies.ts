import { createDecipheriv, createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  resolveChromiumKeys,
  runSecretCommand,
  type ChromiumKeyMaterial,
  type SecretCommandRunner,
} from "./chromium-keys.js";
import {
  BrowserImportError,
  bareHost,
  cookieScope,
  withCookieDatabaseSnapshot,
  type CookieReadResult,
  type ImportedCookie,
} from "./cookie-database.js";

const AES_CBC_IV = Buffer.alloc(16, 0x20);
const WEBKIT_EPOCH_OFFSET_SECONDS = 11_644_473_600;
const DOMAIN_BOUND_SCHEMA_VERSION = 24;
const TOP_FRAME_SITE_KEY_SCHEMA_VERSION = 15;

interface CookieRow {
  host_key: string;
  name: string;
  value: string;
  encrypted_value: Uint8Array | null;
  path: string;
  expires_seconds: number;
  is_secure: number;
  is_httponly: number;
  samesite: number;
  top_frame_site_key: string;
}

function sameSiteFromColumn(value: number): ImportedCookie["sameSite"] {
  if (value === 0) return "no_restriction";
  if (value === 1) return "lax";
  if (value === 2) return "strict";
  return "unspecified";
}

function toUnixSeconds(webkitSeconds: number): number | undefined {
  if (webkitSeconds <= 0) return undefined;
  return webkitSeconds - WEBKIT_EPOCH_OFFSET_SECONDS;
}

function stripDomainBinding(
  plaintext: Buffer,
  domain: string,
  schemaVersion: number,
): Buffer | null {
  if (schemaVersion < DOMAIN_BOUND_SCHEMA_VERSION) return plaintext;
  const domainHash = createHash("sha256").update(domain).digest();
  return plaintext.length >= 32 && plaintext.subarray(0, 32).equals(domainHash)
    ? plaintext.subarray(32)
    : null;
}

function decryptCbc(
  payload: Buffer,
  key: Buffer,
  domain: string,
  schemaVersion: number,
): string | null {
  try {
    const decipher = createDecipheriv("aes-128-cbc", key, AES_CBC_IV);
    decipher.setAutoPadding(true);
    const plaintext = Buffer.concat([
      decipher.update(payload),
      decipher.final(),
    ]);
    return (
      stripDomainBinding(plaintext, domain, schemaVersion)?.toString("utf8") ??
      null
    );
  } catch {
    return null;
  }
}

export function decryptChromiumValue(
  encrypted: Uint8Array,
  keys: ChromiumKeyMaterial,
  domain: string,
  schemaVersion = 23,
): string | null {
  const buffer = Buffer.from(encrypted);
  if (buffer.length === 0) return "";
  const prefix = buffer.subarray(0, 3).toString("latin1");
  const payload = buffer.subarray(3);
  if (prefix === "v10") {
    if (!keys.cbcV10) return null;
    return (
      decryptCbc(payload, keys.cbcV10, domain, schemaVersion) ??
      (keys.cbcEmpty
        ? decryptCbc(payload, keys.cbcEmpty, domain, schemaVersion)
        : null)
    );
  }
  if (prefix === "v11") {
    if (!keys.cbcV11) return null;
    return (
      decryptCbc(payload, keys.cbcV11, domain, schemaVersion) ??
      (keys.cbcEmpty
        ? decryptCbc(payload, keys.cbcEmpty, domain, schemaVersion)
        : null)
    );
  }
  return (
    stripDomainBinding(buffer, domain, schemaVersion)?.toString("utf8") ?? null
  );
}

function readSchemaVersion(database: DatabaseSync): number {
  const row = database
    .prepare("select value from meta where key = 'version' limit 1")
    .get() as { value?: unknown } | undefined;
  const value = row?.value;
  if (typeof value === "number") return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  throw new BrowserImportError("readFailed", "Chromium meta table unreadable");
}

export function readChromiumCookieDatabase(
  database: DatabaseSync,
  keys: ChromiumKeyMaterial,
): CookieReadResult {
  const schemaVersion = readSchemaVersion(database);
  const topFrameColumn =
    schemaVersion >= TOP_FRAME_SITE_KEY_SCHEMA_VERSION
      ? "top_frame_site_key"
      : "'' as top_frame_site_key";
  const rows = database
    .prepare(
      `select host_key, name, value, encrypted_value, path,
              expires_utc / 1000000 as expires_seconds, is_secure, is_httponly,
              samesite, ${topFrameColumn} from cookies`,
    )
    .all() as unknown as CookieRow[];
  const cookies: ImportedCookie[] = [];
  let undecryptable = 0;
  const undecryptableHosts = new Set<string>();
  let sawKeyringRecord = false;
  for (const row of rows) {
    if (row.top_frame_site_key !== "") {
      undecryptable += 1;
      undecryptableHosts.add(bareHost(row.host_key));
      continue;
    }
    const encrypted = row.encrypted_value ?? new Uint8Array();
    if (
      encrypted.length >= 3 &&
      Buffer.from(encrypted.subarray(0, 3)).toString("latin1") === "v11"
    )
      sawKeyringRecord = true;
    const value =
      encrypted.length === 0
        ? row.value
        : decryptChromiumValue(encrypted, keys, row.host_key, schemaVersion);
    if (value === null) {
      undecryptable += 1;
      undecryptableHosts.add(bareHost(row.host_key));
      continue;
    }
    const secure = row.is_secure === 1;
    const scope = cookieScope(row.host_key, row.path, secure);
    cookies.push({
      url: scope.url,
      name: row.name,
      value,
      domain: scope.domain,
      path: row.path,
      secure,
      httpOnly: row.is_httponly === 1,
      expirationDate: toUnixSeconds(row.expires_seconds),
      sameSite: sameSiteFromColumn(row.samesite),
    });
  }
  if (cookies.length === 0 && keys.cbcV11Error && sawKeyringRecord)
    throw keys.cbcV11Error;
  return {
    cookies,
    undecryptable,
    undecryptableHosts: [...undecryptableHosts],
  };
}

export interface ChromiumCookieSource {
  cookieDatabasePath: string;
  keychainService: string | undefined;
  keychainAccount: string | undefined;
  linuxSecretApplication: string | undefined;
  platform: NodeJS.Platform;
}

export async function readChromiumCookies(
  source: ChromiumCookieSource,
  run: SecretCommandRunner = runSecretCommand,
): Promise<CookieReadResult> {
  const keys = await resolveChromiumKeys(
    {
      platform: source.platform,
      keychainService: source.keychainService,
      keychainAccount: source.keychainAccount,
      linuxSecretApplication: source.linuxSecretApplication,
    },
    run,
  );
  try {
    return await withCookieDatabaseSnapshot(
      source.cookieDatabasePath,
      (database) => readChromiumCookieDatabase(database, keys),
    );
  } catch (error) {
    if (error instanceof BrowserImportError) throw error;
    throw new BrowserImportError(
      "readFailed",
      `Could not read Chromium cookies at ${source.cookieDatabasePath}`,
      { cause: error },
    );
  }
}
