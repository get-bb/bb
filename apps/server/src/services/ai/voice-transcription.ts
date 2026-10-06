import type { LoggedWorkSessionDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import { isAiTaskAvailable, runAiTask } from "./ai-tasks.js";

interface TranscribeVoiceInputArgs {
  file: File;
  prompt?: string;
  signal: AbortSignal;
}

const VOICE_TRANSCRIPTION_MAX_BYTES = 25 * 1024 * 1024;

export function resolveVoiceTranscriptionEnabled(
  deps: LoggedWorkSessionDeps,
): boolean {
  return isAiTaskAvailable(deps, "voice");
}

function trimPrompt(prompt: string | undefined): string | null {
  const trimmed = prompt?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

export async function transcribeVoiceInput(
  deps: LoggedWorkSessionDeps,
  args: TranscribeVoiceInputArgs,
): Promise<string> {
  if (args.file.size === 0) {
    throw new ApiError(400, "invalid_request", "Audio file must not be empty");
  }
  if (args.file.size > VOICE_TRANSCRIPTION_MAX_BYTES) {
    throw new ApiError(400, "invalid_request", "Audio file exceeds 25MB limit");
  }

  const hint = trimPrompt(args.prompt);
  const outcome = await runAiTask(deps, {
    task: "voice",
    label: "Voice transcription",
    signal: args.signal,
    call: (service, signal) => {
      if (service.transcribe === null) {
        throw new Error("This service does not transcribe audio");
      }
      return service.transcribe(args.file, { signal, hint });
    },
    accept: (raw) => (typeof raw === "string" ? raw.trim() : null),
  });
  if (outcome.ok) {
    return outcome.value;
  }
  switch (outcome.reason) {
    case "off":
    case "unavailable":
      throw new ApiError(501, "not_configured", outcome.message);
    case "timeout":
      throw new ApiError(
        504,
        "transcription_timeout",
        "Voice transcription timed out",
        true,
      );
    case "failed":
      throw new ApiError(502, "provider_rpc_error", outcome.message);
    case "cancelled":
      throw new ApiError(400, "cancelled", "Voice transcription was cancelled");
  }
}
