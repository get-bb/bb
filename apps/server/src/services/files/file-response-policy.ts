import { Buffer } from "node:buffer";
import { filePreviewContentSecurityPolicy } from "@bb/server-contract";

const BIDI_CONTROL_PATTERN = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;
const MIME_TYPE_PATTERN =
  /^(?:application|audio|font|image|message|model|multipart|text|video)\/[!#$&^_.+\-A-Za-z0-9]+$/u;
const OCTET_STREAM_MIME_TYPE = "application/octet-stream";
const HTML_MIME_TYPE = "text/html";

type FileResponseDisposition = "attachment" | "inline";

interface BuildFileResponseHeadersArgs {
  cacheControl?: string;
  disposition: FileResponseDisposition;
  fileName: string;
  mimeType: string | null | undefined;
}

function encodeExtendedHeaderValue(value: string): string {
  let encoded = "";
  for (const byte of Buffer.from(value, "utf8")) {
    const character = String.fromCharCode(byte);
    encoded += /[A-Za-z0-9!#$&+\-.^_`|~]/u.test(character)
      ? character
      : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return encoded;
}

export function sanitizeFileResponseName(fileName: string): string {
  const baseName = fileName
    .normalize("NFC")
    .replaceAll("\\", "/")
    .split("/")
    .at(-1)
    ?.trim();
  let sanitized = (baseName ?? "")
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/gu, "_")
    .replace(BIDI_CONTROL_PATTERN, "_")
    .replace(/_+/gu, "_")
    .replace(/^\.+/u, "")
    .trim();
  while (Buffer.byteLength(sanitized, "utf8") > 180) {
    sanitized = sanitized.slice(0, -1);
  }
  return sanitized.length > 0 ? sanitized : "download";
}

export function buildFileContentDisposition(
  disposition: FileResponseDisposition,
  fileName: string,
): string {
  const safeName = sanitizeFileResponseName(fileName);
  const asciiFallback = safeName
    .replace(/[^\x20-\x7e]/gu, "-")
    .replace(/["\\]/gu, "_");
  return `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encodeExtendedHeaderValue(safeName)}`;
}

export function normalizeFileResponseMimeType(
  mimeType: string | null | undefined,
): string {
  const normalized = mimeType?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return MIME_TYPE_PATTERN.test(normalized)
    ? normalized
    : OCTET_STREAM_MIME_TYPE;
}

function safeInlineMimeType(mimeType: string | null | undefined): string {
  const normalized = normalizeFileResponseMimeType(mimeType);
  if (normalized === HTML_MIME_TYPE) {
    return `${HTML_MIME_TYPE}; charset=utf-8`;
  }
  if (
    normalized.startsWith("text/") ||
    normalized.startsWith("image/") ||
    normalized.startsWith("audio/") ||
    normalized.startsWith("video/") ||
    normalized === "application/pdf" ||
    normalized === "application/json" ||
    normalized === "application/typescript" ||
    normalized === "application/xml" ||
    normalized.endsWith("+json") ||
    normalized.endsWith("+xml")
  ) {
    return normalized;
  }
  return OCTET_STREAM_MIME_TYPE;
}

export function buildFileResponseHeaders({
  cacheControl,
  disposition,
  fileName,
  mimeType,
}: BuildFileResponseHeadersArgs): Headers {
  const contentType =
    disposition === "inline"
      ? safeInlineMimeType(mimeType)
      : normalizeFileResponseMimeType(mimeType);
  const headers = new Headers({
    "content-disposition": buildFileContentDisposition(disposition, fileName),
    "content-type": contentType,
    "x-content-type-options": "nosniff",
  });
  if (cacheControl !== undefined) {
    headers.set("cache-control", cacheControl);
  }
  const contentSecurityPolicy =
    disposition === "inline"
      ? filePreviewContentSecurityPolicy(contentType)
      : null;
  if (contentSecurityPolicy !== null) {
    headers.set("content-security-policy", contentSecurityPolicy);
  }
  return headers;
}
