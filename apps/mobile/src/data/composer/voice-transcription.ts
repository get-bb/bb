import { extractErrorMessage } from "@bb/core-ui";
import { BbHttpError } from "@bb/sdk/browser";
import type { MultipartRequest } from "./multipart-upload";

/**
 * `POST /system/voice-transcription` from a local recording (multipart field
 * `file`, optional `prompt` with the text before the caret as context), plus
 * the policy the web's `useVoiceInput` applies around it: a one-second
 * minimum, transcript whitespace normalization, and error wording.
 */

const VOICE_MIN_RECORDING_DURATION_MS = 1_000;

export type VoiceInputState = "idle" | "recording" | "transcribing" | "error";

export interface VoiceRecordingFile {
  uri: string;
  mimeType: string;
  name: string;
}

function buildVoiceTranscriptionUrl(serverUrl: string): string {
  return `${serverUrl.replace(/\/+$/u, "")}/api/v1/system/voice-transcription`;
}

export function buildVoiceTranscriptionRequest(args: {
  serverUrl: string;
  file: VoiceRecordingFile;
  prompt?: string;
}): MultipartRequest {
  const prompt = args.prompt?.trim() ?? "";
  return {
    url: buildVoiceTranscriptionUrl(args.serverUrl),
    fields: [
      ...(prompt.length > 0 ? [["prompt", prompt] as const] : []),
      [
        "file",
        { uri: args.file.uri, name: args.file.name, type: args.file.mimeType },
      ] as const,
    ],
  };
}

/** The recording file name/type for a picker URI (`.m4a` by default). */
export function voiceRecordingFileFromUri(uri: string): VoiceRecordingFile {
  const extension =
    uri.split(/[?#]/u)[0]?.split(".").pop()?.toLowerCase() ?? "";
  const known: Record<string, string> = {
    m4a: "audio/mp4",
    mp4: "audio/mp4",
    caf: "audio/x-caf",
    wav: "audio/wav",
    aac: "audio/aac",
    webm: "audio/webm",
    ogg: "audio/ogg",
  };
  const mimeType = known[extension] ?? "audio/mp4";
  const name = `recording.${known[extension] ? extension : "m4a"}`;
  return { uri, mimeType, name };
}

export function parseVoiceTranscription(body: unknown): string {
  if (typeof body === "object" && body !== null) {
    const text = (body as { text?: unknown }).text;
    if (typeof text === "string") return text;
  }
  throw new Error("Voice transcription returned an unexpected response.");
}

export function normalizeTranscript(rawText: string): string {
  return rawText.replace(/\s+/g, " ").trim();
}

/** True when the recording is long enough to send (web: 1 s minimum). */
export function isRecordingLongEnough(durationMs: number): boolean {
  return durationMs >= VOICE_MIN_RECORDING_DURATION_MS;
}

export const VOICE_TOO_SHORT_MESSAGE = "Recording too short (minimum 1 second)";
export const VOICE_PERMISSION_DENIED_MESSAGE = "Microphone permission denied";
export const VOICE_EMPTY_TRANSCRIPT_MESSAGE =
  "Voice transcription returned an empty result.";
const VOICE_GENERIC_FAILURE_MESSAGE = "Voice input failed";

const HTML_DOCUMENT_PATTERN = /<!doctype html|<html[\s>]/iu;

function sanitizeErrorMessage(raw: string): string | null {
  let normalized = raw.replace(/\s+/g, " ").trim();
  const htmlStart = normalized.search(HTML_DOCUMENT_PATTERN);
  if (htmlStart >= 0) normalized = normalized.slice(0, htmlStart).trim();
  normalized = normalized.replace(/^HTTP\s+\d{3}:\s*/iu, "").trim();
  return normalized.length > 0 ? normalized : null;
}

/** Port of the web's `resolveRecordingErrorMessage` for the native failure shapes. */
export function resolveVoiceErrorMessage(error: unknown): string {
  if (error instanceof BbHttpError) {
    return (
      extractErrorMessage(error.body) ??
      sanitizeErrorMessage(error.message) ??
      VOICE_GENERIC_FAILURE_MESSAGE
    );
  }
  if (typeof error === "object" && error !== null) {
    const name = (error as { name?: unknown }).name;
    if (name === "AbortError") return "Voice capture was aborted";
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return sanitizeErrorMessage(error.message) ?? VOICE_GENERIC_FAILURE_MESSAGE;
  }
  return VOICE_GENERIC_FAILURE_MESSAGE;
}
