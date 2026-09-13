import { extractErrorMessage, toRecord } from "@bb/core-ui";
import type { SystemVoiceTranscriptionResponse } from "@bb/server-contract";
import { apiClient, toRelativeUrl } from "./api-server";
import { appSurfaceRequestInit } from "./app-surface";
import {
  buildFilePreview,
  normalizeFilePreviewMimeType,
  type FilePreview,
  type FilePreviewTarget,
} from "@bb/client-core";
import {
  buildThreadHostFileContentUrl,
  buildThreadStorageContentUrl,
} from "./file-content-urls";

const HTML_DOCUMENT_PATTERN = /<!doctype html|<html[\s>]/i;

function normalizeErrorText(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

export function requestOptions(signal?: AbortSignal) {
  return signal ? { init: { signal } } : undefined;
}

export class HttpError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly body?: unknown;

  constructor(args: {
    status: number;
    message: string;
    code?: string;
    body?: unknown;
  }) {
    super(`HTTP ${args.status}: ${args.message}`);
    this.name = "HttpError";
    this.status = args.status;
    this.code = args.code;
    this.body = args.body;
  }
}

function parseHttpError(
  status: number,
  statusText: string,
  rawBody: string,
  contentType: string | null,
): { message: string; body: unknown } {
  const normalized = normalizeErrorText(rawBody);
  if (normalized.length === 0) {
    return { message: statusText || "Request failed", body: undefined };
  }
  const shouldParseAsJson =
    (contentType?.includes("application/json") ?? false) ||
    normalized.startsWith("{") ||
    normalized.startsWith("[");
  let body: unknown;
  if (shouldParseAsJson) {
    try {
      body = JSON.parse(normalized);
      const message = extractErrorMessage(body);
      if (message) {
        return { message, body };
      }
    } catch {}
  }
  if (HTML_DOCUMENT_PATTERN.test(normalized)) {
    if (status === 401 || status === 403) {
      return { message: "Authentication failed", body };
    }
    return { message: statusText || "Request failed", body };
  }
  return {
    message:
      (extractErrorMessage(normalized) ?? statusText) || "Request failed",
    body,
  };
}

function extractErrorCode(value: unknown): string | undefined {
  const record = toRecord(value);
  if (!record) {
    return undefined;
  }
  return typeof record.code === "string" && record.code.trim().length > 0
    ? record.code
    : undefined;
}

async function throwHttpError(res: Response): Promise<never> {
  const rawBody = await res.text().catch(() => "");
  const { message, body } = parseHttpError(
    res.status,
    res.statusText,
    rawBody,
    res.headers.get("content-type"),
  );
  throw new HttpError({
    status: res.status,
    message,
    code: extractErrorCode(body),
    body,
  });
}

async function requestResponse(
  responsePromise: Promise<Response>,
): Promise<Response> {
  const res = await responsePromise;
  if (!res.ok) {
    await throwHttpError(res);
  }
  return res;
}

export async function request<T>(
  responsePromise: Promise<Response>,
): Promise<T> {
  const res = await requestResponse(responsePromise);
  const text = await res.text();
  return JSON.parse(text) as T;
}

async function loadFilePreview(
  target: FilePreviewTarget,
  signal?: AbortSignal,
): Promise<FilePreview> {
  const response = await requestResponse(
    fetch(
      target.url,
      appSurfaceRequestInit({
        method: "GET",
        signal,
      }),
    ),
  );
  const contentBytes = new Uint8Array(await response.arrayBuffer());
  return buildFilePreview({
    contentBytes,
    mimeType: normalizeFilePreviewMimeType(
      response.headers.get("content-type"),
    ),
    name: target.name,
    path: target.path,
    url: target.url,
  });
}

async function postMultipart<T>(
  url: URL,
  file: File,
  signal?: AbortSignal,
  fields?: Record<string, string>,
): Promise<T> {
  const formData = new FormData();
  if (fields) {
    for (const [key, value] of Object.entries(fields)) {
      formData.set(key, value);
    }
  }
  formData.set("file", file, file.name);
  return request<T>(
    fetch(
      toRelativeUrl(url),
      appSurfaceRequestInit({
        method: "POST",
        body: formData,
        signal,
      }),
    ),
  );
}

export async function transcribeVoiceInput(
  file: File,
  prompt?: string,
  signal?: AbortSignal,
): Promise<SystemVoiceTranscriptionResponse> {
  const trimmedPrompt = prompt?.trim();
  return postMultipart<SystemVoiceTranscriptionResponse>(
    apiClient.system["voice-transcription"].$url(),
    file,
    signal,
    trimmedPrompt ? { prompt: trimmedPrompt } : undefined,
  );
}

export async function getThreadStorageFilePreview(
  id: string,
  path: string,
  signal?: AbortSignal,
): Promise<FilePreview> {
  return loadFilePreview(
    {
      path,
      url: buildThreadStorageContentUrl(id, path),
    },
    signal,
  );
}

export async function getThreadHostFilePreview(
  id: string,
  path: string,
  signal?: AbortSignal,
): Promise<FilePreview> {
  return loadFilePreview(
    {
      name: path.split("/").at(-1),
      path,
      url: buildThreadHostFileContentUrl(id, path),
    },
    signal,
  );
}
