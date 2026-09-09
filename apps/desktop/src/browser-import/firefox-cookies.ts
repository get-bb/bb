import type { DatabaseSync } from "node:sqlite";
import {
  BrowserImportError,
  cookieScope,
  withCookieDatabaseSnapshot,
  type ImportedCookie,
} from "./cookie-database.js";

const SAMESITE_NONE = 0;
const SAMESITE_LAX = 1;
const SAMESITE_STRICT = 2;
const FIREFOX_RAW_SAMESITE_FIRST_SCHEMA = 10;
const FIREFOX_RAW_SAMESITE_LAST_SCHEMA = 14;
const FIREFOX_EXPIRY_MILLISECONDS_SCHEMA = 16;

interface CookieRow {
  host: string;
  name: string;
  value: string;
  path: string;
  expiry: number;
  isSecure: number;
  isHttpOnly: number;
  sameSite: number | null;
  rawSameSite: number | null;
}

function sameSiteFromColumn(
  value: number | null,
  rawValue: number | null,
): ImportedCookie["sameSite"] {
  if (value === null) return "unspecified";
  if (value === SAMESITE_LAX && rawValue === SAMESITE_NONE)
    return "unspecified";
  if (value === SAMESITE_NONE) return "no_restriction";
  if (value === SAMESITE_LAX) return "lax";
  if (value === SAMESITE_STRICT) return "strict";
  return "unspecified";
}

function expiryToSeconds(
  expiry: number,
  schemaVersion: number,
): number | undefined {
  if (expiry <= 0) return undefined;
  return schemaVersion >= FIREFOX_EXPIRY_MILLISECONDS_SCHEMA
    ? Math.floor(expiry / 1000)
    : expiry;
}

export function readFirefoxCookieDatabase(
  database: DatabaseSync,
): ImportedCookie[] {
  const versionRow = database.prepare("pragma user_version").get() as
    | { user_version?: unknown }
    | undefined;
  const schemaVersion =
    typeof versionRow?.user_version === "number" ? versionRow.user_version : 0;
  const hasRawSameSite =
    schemaVersion >= FIREFOX_RAW_SAMESITE_FIRST_SCHEMA &&
    schemaVersion <= FIREFOX_RAW_SAMESITE_LAST_SCHEMA;
  const rows = database
    .prepare(
      `select host, name, value, path, expiry, isSecure, isHttpOnly, sameSite,
              ${hasRawSameSite ? "rawSameSite" : "null as rawSameSite"}
         from moz_cookies
        where originAttributes = ''`,
    )
    .all() as unknown as CookieRow[];
  return rows.map((row) => {
    const secure = row.isSecure === 1;
    const scope = cookieScope(row.host, row.path, secure);
    return {
      url: scope.url,
      name: row.name,
      value: row.value,
      domain: scope.domain,
      path: row.path,
      secure,
      httpOnly: row.isHttpOnly === 1,
      expirationDate: expiryToSeconds(row.expiry, schemaVersion),
      sameSite: sameSiteFromColumn(row.sameSite, row.rawSameSite),
    };
  });
}

export async function readFirefoxCookies(
  cookieDatabasePath: string,
): Promise<ImportedCookie[]> {
  try {
    return await withCookieDatabaseSnapshot(
      cookieDatabasePath,
      readFirefoxCookieDatabase,
    );
  } catch (error) {
    throw new BrowserImportError(
      "readFailed",
      `Could not read Firefox cookies at ${cookieDatabasePath}`,
      { cause: error },
    );
  }
}
