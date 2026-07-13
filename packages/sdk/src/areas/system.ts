import type {
  AppKeybindingOverrides,
  AppSettings,
  Experiments,
} from "@bb/domain";
import type {
  SystemExecutionOptionsQuery,
  SystemVersionQuery,
} from "@bb/server-contract";
import { systemVoiceTranscriptionResponseSchema } from "@bb/server-contract";
import type { CreateSdkAreaArgs, PublicApiOutput } from "./common.js";

export interface SystemVersionArgs {
  force?: boolean;
}

export interface SystemVoiceTranscriptionArgs {
  file: Blob;
  prompt?: string;
}

export interface SystemArea {
  attention(): Promise<PublicApiOutput<"/system/attention", "$get">>;
  config(): Promise<PublicApiOutput<"/system/config", "$get">>;
  executionOptions(
    args?: SystemExecutionOptionsQuery,
  ): Promise<PublicApiOutput<"/system/execution-options", "$get">>;
  reloadConfig(): Promise<PublicApiOutput<"/system/config/reload", "$post">>;
  transcribeVoice(
    args: SystemVoiceTranscriptionArgs,
  ): Promise<PublicApiOutput<"/system/voice-transcription", "$post">>;
  updateExperiments(
    args: Experiments,
  ): Promise<PublicApiOutput<"/settings/experiments", "$put">>;
  updateGeneralSettings(
    args: AppSettings,
  ): Promise<PublicApiOutput<"/settings/general", "$put">>;
  updateKeyboardSettings(
    args: AppKeybindingOverrides,
  ): Promise<PublicApiOutput<"/settings/keyboard", "$put">>;
  usageLimits(): Promise<PublicApiOutput<"/system/usage-limits", "$get">>;
  version(
    args?: SystemVersionArgs,
  ): Promise<PublicApiOutput<"/system/version", "$get">>;
}

function versionQuery(args: SystemVersionArgs | undefined): SystemVersionQuery {
  return args?.force === undefined
    ? {}
    : { force: args.force ? "true" : "false" };
}

export function createSystemArea(args: CreateSdkAreaArgs): SystemArea {
  const { transport } = args;
  return {
    async attention() {
      return transport.readJson(transport.api.v1.system.attention.$get());
    },
    async config() {
      return transport.readJson(transport.api.v1.system.config.$get());
    },
    async executionOptions(input = {}) {
      return transport.readJson(
        transport.api.v1.system["execution-options"].$get({ query: input }),
      );
    },
    async reloadConfig() {
      return transport.readJson(transport.api.v1.system.config.reload.$post());
    },
    async transcribeVoice(input) {
      const form = new FormData();
      form.set("file", input.file);
      if (input.prompt !== undefined) form.set("prompt", input.prompt);
      const baseUrl = transport.baseUrl.replace(/\/$/u, "");
      const response = await transport.resolve(
        transport.fetch(`${baseUrl}/api/v1/system/voice-transcription`, {
          method: "POST",
          body: form,
        }),
      );
      return systemVoiceTranscriptionResponseSchema.parse(
        await response.json(),
      );
    },
    async updateExperiments(input) {
      return transport.readJson(
        transport.api.v1.settings.experiments.$put({ json: input }),
      );
    },
    async updateGeneralSettings(input) {
      return transport.readJson(
        transport.api.v1.settings.general.$put({ json: input }),
      );
    },
    async updateKeyboardSettings(input) {
      return transport.readJson(
        transport.api.v1.settings.keyboard.$put({ json: input }),
      );
    },
    async usageLimits() {
      return transport.readJson(transport.api.v1.system["usage-limits"].$get());
    },
    async version(input) {
      return transport.readJson(
        transport.api.v1.system.version.$get({ query: versionQuery(input) }),
      );
    },
  };
}
