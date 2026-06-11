import { Buffer } from "node:buffer";
import { setTimeout as delay } from "node:timers/promises";
import { jsonValueSchema, type JsonObject, type JsonValue } from "@bb/domain";
import {
  parseProviderModelConfig,
  type ProviderModelInfo,
} from "@bb/config/inference-model";
import type { LoggedWorkSessionDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import { runLiveCommandAndWait } from "../hosts/live-command-wait.js";
import { requireConnectedPrimaryHostId } from "../hosts/primary-host.js";
import { runtimeErrorLogFields } from "../lib/error-log-fields.js";
import { backsHostDaemonAiServices } from "./host-daemon-ai-provider.js";

interface TranscribeVoiceInputArgs {
  file: File;
  prompt?: string;
}

type OptionalJsonValue = JsonValue | null | undefined;

const OPENAI_TRANSCRIPTION_PROVIDER = "openai";
const VOICE_TRANSCRIPTION_MAX_BYTES = 25 * 1024 * 1024;
const CODEX_VOICE_TRANSCRIPTION_ATTEMPT_TIMEOUT_MS = 10_000;
const CODEX_VOICE_TRANSCRIPTION_MAX_ATTEMPTS = 2;
const CODEX_VOICE_TRANSCRIPTION_RETRY_DELAY_MS = 250;
const OPENAI_VOICE_TRANSCRIPTION_TIMEOUT_MS = 10_000;

function parseTranscriptionModel(model: string): ProviderModelInfo {
  return parseProviderModelConfig({
    name: "BB_TRANSCRIPTION",
    value: model,
  });
}

function isCodexVoiceTranscriptionAvailable(
  deps: LoggedWorkSessionDeps,
): boolean {
  try {
    requireConnectedPrimaryHostId(deps);
    return true;
  } catch {
    return false;
  }
}

export function resolveVoiceTranscriptionEnabled(
  deps: LoggedWorkSessionDeps,
): boolean {
  const modelInfo = parseTranscriptionModel(deps.config.transcriptionModel);
  if (backsHostDaemonAiServices(modelInfo.provider)) {
    return isCodexVoiceTranscriptionAvailable(deps);
  }
  if (modelInfo.provider === OPENAI_TRANSCRIPTION_PROVIDER) {
    return deps.config.openAiApiKey.length > 0;
  }
  return false;
}

function trimPrompt(prompt: string | undefined): string | null {
  const trimmed = prompt?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function jsonObjectFromValue(value: OptionalJsonValue): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value;
}

function jsonStringProperty(
  value: OptionalJsonValue,
  propertyName: string,
): string | null {
  const object = jsonObjectFromValue(value);
  const propertyValue = object?.[propertyName];
  return typeof propertyValue === "string" ? propertyValue : null;
}

function openAiErrorMessage(payload: OptionalJsonValue): string {
  const object = jsonObjectFromValue(payload);
  const error = object?.error;
  return jsonStringProperty(error, "message") ?? "Voice transcription failed";
}

async function readJsonValue(response: Response): Promise<JsonValue | null> {
  const text = await response.text();
  if (text.trim().length === 0) {
    return null;
  }
  try {
    return jsonValueSchema.parse(JSON.parse(text));
  } catch {
    return null;
  }
}

function shouldTreatAsVoiceTimeout(error: Error): boolean {
  return (
    error instanceof ApiError &&
    (error.body.code === "command_timeout" ||
      error.body.code === "codex_request_timeout")
  );
}

function shouldRetryCodexVoiceTranscription(error: Error): boolean {
  return (
    error instanceof ApiError &&
    (error.body.code === "codex_rate_limited" ||
      error.body.code === "codex_request_timeout" ||
      error.body.code === "command_timeout")
  );
}

function buildTranscriptionTimeoutError(): ApiError {
  return new ApiError(
    504,
    "transcription_timeout",
    "Voice transcription timed out",
    true,
  );
}

function buildTranscriptionUnavailableError(): ApiError {
  return new ApiError(
    503,
    "transcription_unavailable",
    "Voice transcription is temporarily unavailable. Please try again in a moment.",
    true,
  );
}

async function transcribeWithCodexHostDaemon(
  deps: LoggedWorkSessionDeps,
  modelInfo: ProviderModelInfo,
  args: TranscribeVoiceInputArgs,
): Promise<string> {
  const hostId = requireConnectedPrimaryHostId(deps);
  const audioBase64 = Buffer.from(await args.file.arrayBuffer()).toString(
    "base64",
  );
  const prompt = trimPrompt(args.prompt);
  for (
    let attempt = 1;
    attempt <= CODEX_VOICE_TRANSCRIPTION_MAX_ATTEMPTS;
    attempt += 1
  ) {
    try {
      const result = await runLiveCommandAndWait(deps, {
        hostId,
        timeoutMs: CODEX_VOICE_TRANSCRIPTION_ATTEMPT_TIMEOUT_MS,
        command: {
          type: "codex.voice.transcribe",
          model: modelInfo.modelId,
          audioBase64,
          mimeType: args.file.type || "application/octet-stream",
          filename: args.file.name || "voice-input",
          prompt,
          timeoutMs: CODEX_VOICE_TRANSCRIPTION_ATTEMPT_TIMEOUT_MS,
        },
      });
      return result.text;
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error;
      }

      if (!shouldRetryCodexVoiceTranscription(error)) {
        throw error;
      }

      if (attempt < CODEX_VOICE_TRANSCRIPTION_MAX_ATTEMPTS) {
        deps.logger.info(
          {
            attempt,
            errorCode:
              error instanceof ApiError ? error.body.code : error.name,
            maxAttempts: CODEX_VOICE_TRANSCRIPTION_MAX_ATTEMPTS,
            timeoutMs: CODEX_VOICE_TRANSCRIPTION_ATTEMPT_TIMEOUT_MS,
          },
          "Voice transcription failed transiently; retrying",
        );
        await delay(CODEX_VOICE_TRANSCRIPTION_RETRY_DELAY_MS);
        continue;
      }

      if (shouldTreatAsVoiceTimeout(error)) {
        throw buildTranscriptionTimeoutError();
      }
      if (
        error instanceof ApiError &&
        error.body.code === "codex_rate_limited"
      ) {
        throw buildTranscriptionUnavailableError();
      }
      throw error;
    }
  }

  throw buildTranscriptionTimeoutError();
}

async function transcribeWithOpenAi(
  deps: LoggedWorkSessionDeps,
  modelInfo: ProviderModelInfo,
  args: TranscribeVoiceInputArgs,
): Promise<string> {
  if (!deps.config.openAiApiKey) {
    throw new ApiError(
      501,
      "not_configured",
      "Voice transcription requires OPENAI_API_KEY for openai/* transcription",
    );
  }

  const formData = new FormData();
  formData.set("model", modelInfo.modelId);
  formData.set("file", args.file, args.file.name);
  const prompt = trimPrompt(args.prompt);
  if (prompt) {
    formData.set("prompt", prompt);
  }

  const abortController = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    abortController.abort();
  }, OPENAI_VOICE_TRANSCRIPTION_TIMEOUT_MS);
  timer.unref();

  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${deps.config.openAiApiKey}`,
      },
      body: formData,
      signal: abortController.signal,
    });
  } catch (error) {
    if (timedOut) {
      throw buildTranscriptionTimeoutError();
    }
    deps.logger.warn(
      runtimeErrorLogFields(deps.config, error),
      "OpenAI voice transcription request failed",
    );
    throw new ApiError(
      502,
      "provider_rpc_error",
      "Voice transcription request failed",
    );
  } finally {
    clearTimeout(timer);
  }

  const payload = await readJsonValue(response);
  if (!response.ok) {
    throw new ApiError(502, "provider_rpc_error", openAiErrorMessage(payload));
  }

  const text = jsonStringProperty(payload, "text");
  if (!text) {
    throw new ApiError(502, "provider_rpc_error", "Voice transcription failed");
  }

  return text;
}

export async function transcribeVoiceInput(
  deps: LoggedWorkSessionDeps,
  args: TranscribeVoiceInputArgs,
): Promise<string> {
  if (args.file.size > VOICE_TRANSCRIPTION_MAX_BYTES) {
    throw new ApiError(400, "invalid_request", "Audio file exceeds 25MB limit");
  }

  const modelInfo = parseTranscriptionModel(deps.config.transcriptionModel);
  if (backsHostDaemonAiServices(modelInfo.provider)) {
    return transcribeWithCodexHostDaemon(deps, modelInfo, args);
  }
  if (modelInfo.provider === OPENAI_TRANSCRIPTION_PROVIDER) {
    return transcribeWithOpenAi(deps, modelInfo, args);
  }

  throw new ApiError(
    501,
    "not_configured",
    `Voice transcription provider "${modelInfo.provider}" is not supported`,
  );
}
