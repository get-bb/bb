import { open, readFile } from "node:fs/promises";
import {
  BrowserImportError,
  cookieScope,
  type ImportedCookie,
} from "./cookie-database.js";

const APPLE_EPOCH_OFFSET_SECONDS = 978_307_200;
const COOKIE_PAGE_HEADER_SIZE = 12;
const COOKIE_RECORD_HEADER_SIZE = 56;
const FLAG_SECURE = 0x1;
const FLAG_HTTP_ONLY = 0x4;

function malformed(): BrowserImportError {
  return new BrowserImportError("readFailed", "Safari cookie jar is malformed");
}

function readCString(buffer: Buffer, start: number): string {
  const end = buffer.indexOf(0, start);
  return buffer.toString("utf8", start, end === -1 ? buffer.length : end);
}

export function parseBinaryCookies(buffer: Buffer): ImportedCookie[] {
  if (buffer.length < 8 || buffer.toString("latin1", 0, 4) !== "cook")
    throw malformed();
  const pageCount = buffer.readUInt32BE(4);
  if (8 + pageCount * 4 > buffer.length) throw malformed();
  const pageSizes: number[] = [];
  for (let index = 0; index < pageCount; index += 1)
    pageSizes.push(buffer.readUInt32BE(8 + index * 4));
  const cookies: ImportedCookie[] = [];
  let pageStart = 8 + pageCount * 4;
  for (const pageSize of pageSizes) {
    if (
      pageSize < COOKIE_PAGE_HEADER_SIZE ||
      pageStart + pageSize > buffer.length
    )
      throw malformed();
    const page = buffer.subarray(pageStart, pageStart + pageSize);
    pageStart += pageSize;
    const cookieCount = page.readUInt32LE(4);
    const offsetTableEnd = COOKIE_PAGE_HEADER_SIZE + cookieCount * 4;
    if (offsetTableEnd > page.length) throw malformed();
    const accepted: Array<[number, number]> = [];
    for (let index = 0; index < cookieCount; index += 1) {
      const cookieStart = page.readUInt32LE(8 + index * 4);
      if (
        cookieStart < offsetTableEnd ||
        cookieStart + COOKIE_RECORD_HEADER_SIZE > page.length
      )
        throw malformed();
      const recordSize = page.readUInt32LE(cookieStart);
      const cookieEnd = cookieStart + recordSize;
      if (
        recordSize < COOKIE_RECORD_HEADER_SIZE ||
        cookieEnd > page.length ||
        accepted.some(([start, end]) => cookieStart < end && cookieEnd > start)
      )
        throw malformed();
      accepted.push([cookieStart, cookieEnd]);
      const cookie = page.subarray(cookieStart, cookieEnd);
      const flags = cookie.readUInt32LE(8);
      const urlOffset = cookie.readUInt32LE(16);
      const nameOffset = cookie.readUInt32LE(20);
      const pathOffset = cookie.readUInt32LE(24);
      const valueOffset = cookie.readUInt32LE(28);
      const expiry = cookie.readDoubleLE(40);
      if (
        [urlOffset, nameOffset, pathOffset, valueOffset].some(
          (offset) =>
            offset < COOKIE_RECORD_HEADER_SIZE || offset >= cookie.length,
        )
      )
        throw malformed();
      const domain = readCString(cookie, urlOffset);
      const name = readCString(cookie, nameOffset);
      const path = readCString(cookie, pathOffset) || "/";
      const value = readCString(cookie, valueOffset);
      if (domain === "" || name === "") continue;
      const secure = (flags & FLAG_SECURE) !== 0;
      cookies.push({
        ...cookieScope(domain, path, secure),
        name,
        value,
        path,
        secure,
        httpOnly: (flags & FLAG_HTTP_ONLY) !== 0,
        expirationDate:
          expiry > 0
            ? Math.floor(expiry) + APPLE_EPOCH_OFFSET_SECONDS
            : undefined,
        sameSite: "lax",
      });
    }
  }
  const trailer = buffer.length - pageStart;
  const validTrailer =
    trailer === 0 ||
    trailer === 8 ||
    (trailer >= 12 && trailer === 8 + 4 + buffer.readUInt32BE(pageStart + 8));
  if (!validTrailer) throw malformed();
  return cookies;
}

function isPermissionDenied(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "EPERM"
  );
}

export async function safariAccessDenied(cookiePath: string): Promise<boolean> {
  try {
    const handle = await open(cookiePath, "r");
    await handle.close();
    return false;
  } catch (error) {
    return isPermissionDenied(error);
  }
}

export async function readSafariCookies(
  cookiePath: string,
): Promise<ImportedCookie[]> {
  let contents: Buffer;
  try {
    contents = await readFile(cookiePath);
  } catch (error) {
    throw new BrowserImportError(
      isPermissionDenied(error) ? "needsFullDiskAccess" : "readFailed",
      `Could not read Safari cookies at ${cookiePath}`,
      { cause: error },
    );
  }
  return parseBinaryCookies(contents);
}
