import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { DesktopBrowserImportFailureReason } from "@bb/host-daemon-contract";

export interface ImportedCookie {
  url: string;
  name: string;
  value: string;
  domain: string | undefined;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  expirationDate: number | undefined;
  sameSite: "unspecified" | "no_restriction" | "lax" | "strict";
}

export interface CookieReadResult {
  cookies: ImportedCookie[];
  undecryptable: number;
  undecryptableHosts: string[];
}

export class BrowserImportError extends Error {
  readonly reason: DesktopBrowserImportFailureReason;
  constructor(
    reason: DesktopBrowserImportFailureReason,
    message?: string,
    options?: { cause?: unknown },
  ) {
    super(message ?? `Browser import failed: ${reason}`, options);
    this.name = "BrowserImportError";
    this.reason = reason;
  }
}

export function isBrowserImportError(
  value: unknown,
): value is BrowserImportError {
  return value instanceof BrowserImportError;
}

export function bareHost(host: string): string {
  return host.startsWith(".") ? host.slice(1) : host;
}

export function cookieScope(
  host: string,
  path: string,
  secure: boolean,
): { url: string; domain: string | undefined } {
  const isDomainCookie = host.startsWith(".");
  const unwrappedHost = bareHost(host);
  const authority =
    unwrappedHost.includes(":") &&
    !(unwrappedHost.startsWith("[") && unwrappedHost.endsWith("]"))
      ? `[${unwrappedHost}]`
      : unwrappedHost;
  return {
    url: `${secure ? "https" : "http"}://${authority}${path}`,
    domain: isDomainCookie ? host : undefined,
  };
}

export function openReadOnlyDatabase(path: string): DatabaseSync {
  return new DatabaseSync(path, { readOnly: true });
}

export async function withCookieDatabaseSnapshot<T>(
  cookiePath: string,
  use: (database: DatabaseSync) => T | Promise<T>,
): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "bb-cookie-import-"));
  const snapshotPath = join(directory, basename(cookiePath));
  try {
    const source = openReadOnlyDatabase(cookiePath);
    try {
      source.exec(`VACUUM INTO '${snapshotPath.replaceAll("'", "''")}'`);
    } finally {
      source.close();
    }
    const snapshot = openReadOnlyDatabase(snapshotPath);
    try {
      return await use(snapshot);
    } finally {
      snapshot.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export function countRows(path: string, query: string): number | undefined {
  try {
    const database = openReadOnlyDatabase(path);
    try {
      const row = database.prepare(query).get() as
        | { count?: unknown }
        | undefined;
      return typeof row?.count === "number" ? row.count : undefined;
    } finally {
      database.close();
    }
  } catch {
    return undefined;
  }
}
