import type {
  PluginAiCompleteOptions,
  PluginAiServiceStatus,
  PluginAiTranscribeOptions,
} from "@get-bb/plugin-sdk";
import type { AiServiceRegistry } from "../../src/services/ai/ai-service-registry.js";

export interface FakeCompleteCall {
  prompt: string;
  options: PluginAiCompleteOptions;
}

export interface FakeTranscribeCall {
  audio: File;
  options: PluginAiTranscribeOptions;
}

export interface RegisterFakeAiServiceArgs {
  id?: string;
  displayName?: string;
  pluginId?: string;
  builtin?: boolean;
  complete?:
    | ((prompt: string, options: PluginAiCompleteOptions) => Promise<string>)
    | null;
  transcribe?:
    | ((audio: File, options: PluginAiTranscribeOptions) => Promise<string>)
    | null;
  status?: (() => Promise<PluginAiServiceStatus>) | null;
}

export function registerFakeAiService(
  registry: AiServiceRegistry,
  args: RegisterFakeAiServiceArgs = {},
): {
  completeCalls: FakeCompleteCall[];
  transcribeCalls: FakeTranscribeCall[];
  dispose(): void;
} {
  const completeCalls: FakeCompleteCall[] = [];
  const transcribeCalls: FakeTranscribeCall[] = [];
  const complete = args.complete;
  const transcribe = args.transcribe;
  const registration = registry.register({
    id: args.id ?? "fake-ai",
    displayName: args.displayName ?? "Fake AI",
    pluginId: args.pluginId ?? "fake-ai-plugin",
    builtin: args.builtin ?? false,
    complete:
      complete === null
        ? null
        : async (prompt, options) => {
            completeCalls.push({ prompt, options });
            if (complete === undefined) return "Fake reply";
            return complete(prompt, options);
          },
    transcribe:
      transcribe === null
        ? null
        : async (audio, options) => {
            transcribeCalls.push({ audio, options });
            if (transcribe === undefined) return "fake transcript";
            return transcribe(audio, options);
          },
    status: args.status ?? null,
  });
  return { completeCalls, transcribeCalls, dispose: registration.dispose };
}
