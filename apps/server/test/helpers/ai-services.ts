import type {
  ExperimentalAiInferenceCompleteInput,
  ExperimentalAiInferenceCompleteOutput,
  ExperimentalAiVoiceTranscribeInput,
  ExperimentalAiVoiceTranscribeOutput,
} from "@get-bb/plugin-sdk/ai-services";
import type { PluginAiServiceKind } from "@get-bb/plugin-sdk";
import type {
  AiServiceCallOptions,
  AiServiceRegistry,
} from "../../src/services/ai/ai-service-registry.js";

/**
 * A fake AI service registered straight into the harness registry: the
 * in-process stand-in for a plugin's host entry, so a test drives core's
 * routing, retry, and fallback policy without a daemon in the loop.
 */
export interface FakeAiServiceCall<Input> {
  input: Input;
  options: AiServiceCallOptions;
}

export function registerFakeAiService(
  registry: AiServiceRegistry,
  args: {
    id?: string;
    kinds?: readonly PluginAiServiceKind[];
    completeInference?: (
      input: ExperimentalAiInferenceCompleteInput,
    ) =>
      | ExperimentalAiInferenceCompleteOutput
      | Promise<ExperimentalAiInferenceCompleteOutput>;
    transcribeVoice?: (
      input: ExperimentalAiVoiceTranscribeInput,
    ) =>
      | ExperimentalAiVoiceTranscribeOutput
      | Promise<ExperimentalAiVoiceTranscribeOutput>;
  } = {},
): {
  inferenceCalls: FakeAiServiceCall<ExperimentalAiInferenceCompleteInput>[];
  voiceCalls: FakeAiServiceCall<ExperimentalAiVoiceTranscribeInput>[];
  dispose(): void;
} {
  const inferenceCalls: FakeAiServiceCall<ExperimentalAiInferenceCompleteInput>[] = [];
  const voiceCalls: FakeAiServiceCall<ExperimentalAiVoiceTranscribeInput>[] = [];
  const registration = registry.register({
    id: args.id ?? "codex",
    displayName: "Fake service",
    kinds: args.kinds ?? ["inference", "voice"],
    pluginId: "provider-fake",
    async completeInference(input, options) {
      inferenceCalls.push({ input, options });
      if (!args.completeInference) {
        throw new Error("fake AI service has no inference handler");
      }
      return args.completeInference(input);
    },
    async transcribeVoice(input, options) {
      voiceCalls.push({ input, options });
      if (!args.transcribeVoice) {
        throw new Error("fake AI service has no voice handler");
      }
      return args.transcribeVoice(input);
    },
  });
  return { inferenceCalls, voiceCalls, dispose: registration.dispose };
}
