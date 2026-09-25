import { Buffer } from "node:buffer";
import type { BbPluginApi, PluginAiServiceStatus } from "@get-bb/plugin-sdk";
import {
  codexAiHostContract,
  type CodexAiFailureCode,
  type CodexAiTextResult,
} from "./ai/host-contract.js";

const CODEX_TEXT_MODEL = "gpt-5.6-luna";
const CODEX_CHATGPT_FALLBACK_MODEL = "gpt-5.6-terra";
const CODEX_API_KEY_FALLBACK_MODEL = "gpt-5.4-mini";
const CODEX_TRANSCRIPTION_MODEL = "gpt-transcribe";
const COMPLETE_TIMEOUT_MS = 5_000;
const TRANSCRIBE_TIMEOUT_MS = 10_000;
const TRANSCRIBE_MAX_BYTES = 20 * 1024 * 1024;
const HOST_CALL_GRACE_MS = 1_000;
const RETRY_WITH_NEXT_MODEL: ReadonlySet<CodexAiFailureCode> = new Set([
  "rate_limited",
  "service_unavailable",
  "invalid_response",
]);

export function registerCodexAiService(bb: BbPluginApi): void {
  const host = bb.hosts.experimental_client({ contract: codexAiHostContract });

  async function primaryHostId(): Promise<string | null> {
    return (await bb.sdk.system.config()).primaryHostId;
  }

  async function requirePrimaryHostId(): Promise<string> {
    const hostId = await primaryHostId();
    if (hostId === null) {
      throw new Error("No primary machine is connected");
    }
    return hostId;
  }

  function textOrThrow(result: CodexAiTextResult): string {
    if (result.ok) return result.text;
    throw new Error(result.message);
  }

  bb.experimental_aiServices.register({
    id: "codex",
    displayName: "Codex",
    async complete(prompt, { signal }) {
      const hostId = await requirePrimaryHostId();
      const completeWithModel = (model: string): Promise<CodexAiTextResult> =>
        host.call(
          "codex.ai.complete",
          { model, prompt, timeoutMs: COMPLETE_TIMEOUT_MS },
          {
            hostId,
            signal,
            timeoutMs: COMPLETE_TIMEOUT_MS + HOST_CALL_GRACE_MS,
          },
        );
      let result = await completeWithModel(CODEX_TEXT_MODEL);
      if (
        !result.ok &&
        RETRY_WITH_NEXT_MODEL.has(result.code) &&
        !signal.aborted
      ) {
        const status = await host.call(
          "codex.ai.status",
          {},
          { hostId, signal, timeoutMs: 5_000 },
        );
        if (status.ready && !signal.aborted) {
          result = await completeWithModel(
            status.authMode === "chatgpt"
              ? CODEX_CHATGPT_FALLBACK_MODEL
              : CODEX_API_KEY_FALLBACK_MODEL,
          );
        }
      }
      return textOrThrow(result);
    },
    async transcribe(audio, { signal, hint }) {
      if (audio.size > TRANSCRIBE_MAX_BYTES) {
        throw new Error(
          `Recordings over ${TRANSCRIBE_MAX_BYTES / (1024 * 1024)} MB are too large to transcribe`,
        );
      }
      const hostId = await requirePrimaryHostId();
      return textOrThrow(
        await host.call(
          "codex.ai.transcribe",
          {
            model: CODEX_TRANSCRIPTION_MODEL,
            audioBase64: Buffer.from(await audio.arrayBuffer()).toString(
              "base64",
            ),
            mimeType: audio.type || "application/octet-stream",
            filename: audio.name || "voice-input",
            hint,
            timeoutMs: TRANSCRIBE_TIMEOUT_MS,
          },
          {
            hostId,
            signal,
            timeoutMs: TRANSCRIBE_TIMEOUT_MS + HOST_CALL_GRACE_MS,
          },
        ),
      );
    },
    async status(): Promise<PluginAiServiceStatus> {
      const hostId = await primaryHostId();
      if (hostId === null) {
        return { ready: false, message: "No primary machine is connected" };
      }
      return host.call("codex.ai.status", {}, { hostId, timeoutMs: 5_000 });
    },
  });
}
