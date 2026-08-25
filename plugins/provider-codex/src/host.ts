/**
 * The codex plugin's `bb.host` artifact: the provider bridge (run by the
 * runtime's bridge bootstrap, which imports `experimental_providerBridge`)
 * and the host entry the plugin host worker imports as the default export.
 * The host entry serves two contracts at once: bb's AI services
 * (`ai.inference.complete`, `ai.voice.transcribe`) and the native-roots
 * resolver (`resolveNativeRoots`) that tells bb where codex keeps its skills
 * on this host. One artifact, three consumers.
 */
import os from "node:os";
import { defineRpcContract } from "@get-bb/plugin-sdk";
import {
  experimental_aiServicesHostContract,
  type ExperimentalAiInferenceCompleteOutput,
  type ExperimentalAiVoiceTranscribeOutput,
} from "@get-bb/plugin-sdk/ai-services";
import {
  experimental_defineHostEntry,
  experimental_nativeRootsHostContract,
  type ExperimentalNativeRootsResolveAnswer,
} from "@get-bb/plugin-sdk/host";
import { completeCodexInference, transcribeCodexVoice } from "./ai/chatgpt-client.js";
import { toAiServiceFailure } from "./ai/failure.js";
import { resolveCodexNativeRoots } from "./native-roots.js";

export { experimental_providerBridge } from "./bridge/bridge.js";

/** The AI service this plugin registers; every call names it. */
export const CODEX_AI_SERVICE_ID = "codex";

/** Both contracts are plain method records, so one entry can serve them together. */
const codexHostContract = defineRpcContract({
  ...experimental_aiServicesHostContract,
  ...experimental_nativeRootsHostContract,
});

export default experimental_defineHostEntry({
  contract: codexHostContract,
  handlers: {
    // Codex keeps every host-only root in the user's home (`$CODEX_HOME`,
    // installed plugins); the workspace does not change the answer.
    resolveNativeRoots: (): Promise<ExperimentalNativeRootsResolveAnswer> =>
      resolveCodexNativeRoots({ homeDir: os.homedir(), env: process.env }),
    "ai.inference.complete": async (input): Promise<ExperimentalAiInferenceCompleteOutput> => {
      if (input.serviceId !== CODEX_AI_SERVICE_ID) {
        return {
          ok: false,
          code: "request_failed",
          message: `This plugin serves no AI service "${input.serviceId}".`,
        };
      }
      try {
        return await completeCodexInference(input);
      } catch (error) {
        return toAiServiceFailure(error);
      }
    },
    "ai.voice.transcribe": async (input): Promise<ExperimentalAiVoiceTranscribeOutput> => {
      if (input.serviceId !== CODEX_AI_SERVICE_ID) {
        return {
          ok: false,
          code: "request_failed",
          message: `This plugin serves no AI service "${input.serviceId}".`,
        };
      }
      try {
        return await transcribeCodexVoice(input);
      } catch (error) {
        return toAiServiceFailure(error);
      }
    },
  },
});
