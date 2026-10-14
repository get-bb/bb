import { base64DecodedLength } from "@bb/mobile-bridge";
import {
  isExternallyOpenable,
  isShellNavigation,
  parseServerUrl,
} from "./shell-url";

const MAX_FILE_NAME_LENGTH = 180;
const FALLBACK_FILE_NAME = "download";
const UNSAFE_FILE_NAME_CHARACTERS = /[\u0000-\u001f\u007f/\\:]/gu;

export function sanitizeSaveFileName(name: string): string {
  const cleaned = name
    .replace(UNSAFE_FILE_NAME_CHARACTERS, "_")
    .trim()
    .replace(/^\.+/u, "");
  if (cleaned.length === 0) return FALLBACK_FILE_NAME;
  if (cleaned.length <= MAX_FILE_NAME_LENGTH) return cleaned;
  const dot = cleaned.lastIndexOf(".");
  const extension =
    dot > 0 && cleaned.length - dot <= 16 ? cleaned.slice(dot) : "";
  return `${cleaned.slice(0, MAX_FILE_NAME_LENGTH - extension.length)}${extension}`;
}

export function resolveServerFileUrl(
  url: string,
  serverUrl: string,
): string | null {
  const server = parseServerUrl(serverUrl);
  if (server === null) return null;
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return null;
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") return null;
  if (target.username !== "" || target.password !== "") return null;
  if (target.origin !== server.origin) return null;
  return target.href;
}

export function isServerApiUrl(url: string, serverUrl: string): boolean {
  if (resolveServerFileUrl(url, serverUrl) === null) return false;
  const server = parseServerUrl(serverUrl);
  if (server === null) return false;
  const { pathname } = new URL(url);
  return (
    pathname.startsWith("/api/") ||
    (server.prefix.length > 0 && pathname.startsWith(`${server.prefix}/api/`))
  );
}

export function buildCookieHeader(
  cookies: Record<string, { name: string; value: string }>,
): string | null {
  const pairs = Object.values(cookies).map(
    (cookie) => `${cookie.name}=${cookie.value}`,
  );
  return pairs.length === 0 ? null : pairs.join("; ");
}

export interface FileTransferSink {
  append(base64: string): void;
  discard(): void;
}

interface FileTransferEntry<Sink extends FileTransferSink> {
  sink: Sink;
  size: number;
  received: number;
  touchedAt: number;
}

export interface FileTransferRegistryOptions {
  maxTransfers: number;
  idleMs: number;
  now(): number;
}

export interface FileTransferRegistry<Sink extends FileTransferSink> {
  readonly size: number;
  start(size: number, createSink: (transferId: string) => Sink): string;
  append(transferId: string, offset: number, data: string): number;
  finish(transferId: string): Sink;
  discard(transferId: string): void;
  clear(): void;
}

export function createFileTransferRegistry<Sink extends FileTransferSink>(
  options: FileTransferRegistryOptions,
): FileTransferRegistry<Sink> {
  const entries = new Map<string, FileTransferEntry<Sink>>();
  let nextId = 0;

  const discard = (transferId: string): void => {
    const entry = entries.get(transferId);
    if (entry === undefined) return;
    entries.delete(transferId);
    entry.sink.discard();
  };

  const sweep = (): void => {
    const cutoff = options.now() - options.idleMs;
    for (const [transferId, entry] of entries) {
      if (entry.touchedAt < cutoff) discard(transferId);
    }
  };

  const requireEntry = (transferId: string): FileTransferEntry<Sink> => {
    sweep();
    const entry = entries.get(transferId);
    if (entry === undefined) throw new Error("Unknown file transfer");
    return entry;
  };

  return {
    get size() {
      return entries.size;
    },
    start(size, createSink) {
      sweep();
      if (entries.size >= options.maxTransfers) {
        throw new Error("Too many files are being saved at once");
      }
      nextId += 1;
      const transferId = `t${nextId.toString(36)}_${options.now().toString(36)}`;
      entries.set(transferId, {
        sink: createSink(transferId),
        size,
        received: 0,
        touchedAt: options.now(),
      });
      return transferId;
    },
    append(transferId, offset, data) {
      const entry = requireEntry(transferId);
      const length = base64DecodedLength(data);
      if (offset !== entry.received || entry.received + length > entry.size) {
        discard(transferId);
        throw new Error("File transfer chunk out of order");
      }
      try {
        entry.sink.append(data);
      } catch (error) {
        discard(transferId);
        throw error;
      }
      entry.received += length;
      entry.touchedAt = options.now();
      return entry.received;
    },
    finish(transferId) {
      const entry = requireEntry(transferId);
      entries.delete(transferId);
      if (entry.received !== entry.size) {
        entry.sink.discard();
        throw new Error("File transfer is incomplete");
      }
      return entry.sink;
    },
    discard,
    clear() {
      for (const transferId of [...entries.keys()]) discard(transferId);
    },
  };
}

export type OpenWindowAction = "save" | "navigate" | "external" | "ignore";

export function resolveOpenWindowAction(
  url: string,
  serverUrl: string,
): OpenWindowAction {
  if (resolveServerFileUrl(url, serverUrl) === null) {
    return isExternallyOpenable(url) ? "external" : "ignore";
  }
  if (isServerApiUrl(url, serverUrl)) return "save";
  return isShellNavigation(url, serverUrl) ? "navigate" : "external";
}

const SUBFRAME_LOCAL_PROTOCOLS = new Set(["about:", "blob:", "data:"]);

export function allowsSubframeLoad(url: string, serverUrl: string): boolean {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return false;
  }
  if (SUBFRAME_LOCAL_PROTOCOLS.has(target.protocol)) return true;
  return resolveServerFileUrl(url, serverUrl) !== null;
}

export function describeDownloadFailure(message: string): string {
  const detail = message
    .replace(/\s*\(at [^)]*\)\s*$/u, "")
    .replace(/^.*Unable to download a file:\s*/u, "")
    .trim();
  const status = /(?:status|HTTP) (\d{3})\b/u.exec(detail);
  if (status !== null) return `The server answered ${status[1]}.`;
  return detail.length > 0 ? detail : "The download failed.";
}
