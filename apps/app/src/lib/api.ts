import { extractErrorMessage, toRecord } from "@bb/core-ui";
import type { SystemVoiceTranscriptionResponse } from "@bb/server-contract";
import { apiClient, toRelativeUrl } from "./api-server";
import { appSurfaceRequestInit } from "./app-surface";
import {
  FILE_PREVIEW_SAMPLE_BYTES,
  buildFilePreview,
  buildFilePreviewFromSample,
  normalizeFilePreviewMimeType,
  type FilePreview,
  type FilePreviewTarget,
} from "@bb/client-core";
import {
  buildThreadHostFileContentUrl,
  buildThreadStorageRawContentUrl,
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

const FILE_PREVIEW_SAMPLE_RANGE = `bytes=0-${FILE_PREVIEW_SAMPLE_BYTES - 1}`;
const EMPTY_RANGE_STATUS = 416;
const PARTIAL_CONTENT_STATUS = 206;

function parseContentRangeSize(value: string | null): number {
  const size = Number(value?.split("/")[1]);
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new Error("File response has no usable Content-Range size");
  }
  return size;
}

function responseMimeType(response: Response): string {
  return normalizeFilePreviewMimeType(response.headers.get("content-type"));
}

export async function loadFilePreview(
  target: FilePreviewTarget,
  signal?: AbortSignal,
): Promise<FilePreview> {
  const sample = await fetch(
    target.url,
    appSurfaceRequestInit({
      method: "GET",
      cache: "no-store",
      headers: { range: FILE_PREVIEW_SAMPLE_RANGE },
      signal,
    }),
  );
  if (sample.status === EMPTY_RANGE_STATUS) {
    return buildFilePreview({
      ...target,
      contentBytes: new Uint8Array(),
      mimeType: responseMimeType(sample),
    });
  }
  if (!sample.ok) {
    await throwHttpError(sample);
  }
  const sampleBytes = new Uint8Array(await sample.arrayBuffer());
  const sizeBytes =
    sample.status === PARTIAL_CONTENT_STATUS
      ? parseContentRangeSize(sample.headers.get("content-range"))
      : sampleBytes.byteLength;
  const mimeType = responseMimeType(sample);
  if (sampleBytes.byteLength >= sizeBytes) {
    return buildFilePreview({ ...target, contentBytes: sampleBytes, mimeType });
  }
  const samplePreview = buildFilePreviewFromSample({
    ...target,
    mimeType,
    sampleBytes,
    sizeBytes,
  });
  if (samplePreview !== null) {
    return samplePreview;
  }
  const response = await requestResponse(
    fetch(target.url, appSurfaceRequestInit({ method: "GET", signal })),
  );
  return buildFilePreview({
    ...target,
    contentBytes: new Uint8Array(await response.arrayBuffer()),
    mimeType: responseMimeType(response),
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
      url: buildThreadStorageRawContentUrl(id, path),
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
