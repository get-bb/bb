import { mobileAppDownloads } from "@bb/domain";
import type {
  MachineEnvironmentReplace,
  MachineEnvironmentSet,
  MachineEnvironmentList,
} from "@bb/server-contract";
import type {
  AppKeybindingOverrides,
  AppSettings,
  AppSettingsUpdate,
  ExperimentUpdates,
  Experiments,
  UiPreferenceKey,
  UiPreferenceValue,
} from "@bb/domain";
import type { ProviderUsageResponse } from "@bb/host-daemon-contract";
import type {
  SetAiServiceSelectionRequest,
  SystemAiServicesResponse,
  SystemAppUpdateAcknowledgeRequest,
  SystemAppUpdateApplyRequest,
  SystemAppUpdateQuery,
  SystemAppUpdateStatus,
  SystemCliCommandStatus,
  SystemAttentionResponse,
  SystemConfigReloadResponse,
  SystemConfigResponse,
  SystemMobileAppReleasesResponse,
  SystemExecutionOptionsQuery,
  SystemExecutionOptionsResponse,
  SystemCliSkillsStatusResponse,
  SystemInstallCliSkillsRequest,
  SystemInstallCliSkillsResponse,
  SystemProviderStatesResponse,
  SystemProvidersQuery,
  SystemUsageLimitsQuery,
  SystemVersionQuery,
  SystemVersionResponse,
  SystemVoiceTranscriptionResponse,
  RecordTelemetryEventRequest,
  TestAiServiceRequest,
  TestAiServiceResponse,
  UiPreferenceResponse,
  UiPreferencesResponse,
} from "@bb/server-contract";
import { systemVoiceTranscriptionResponseSchema } from "@bb/server-contract";
import { readExecutionOptions, type CreateSdkAreaArgs } from "./common.js";

export interface SystemAttentionArgs {
  signal?: AbortSignal;
}

export interface SystemConfigArgs {
  signal?: AbortSignal;
}

export interface SystemExecutionOptionsArgs extends Omit<
  SystemExecutionOptionsQuery,
  "preferCached"
> {
  preferCached?: boolean;
  signal?: AbortSignal;
}

export interface SystemUsageLimitsArgs extends Omit<
  SystemUsageLimitsQuery,
  "refresh"
> {
  refresh?: boolean;
  signal?: AbortSignal;
}

export interface SystemVersionArgs {
  force?: boolean;
  signal?: AbortSignal;
}

export interface SystemAppUpdateArgs {
  force?: boolean;
  signal?: AbortSignal;
}

export type SystemApplyAppUpdateArgs = SystemAppUpdateApplyRequest;
export type SystemAcknowledgeAppUpdateArgs = SystemAppUpdateAcknowledgeRequest;
export type SystemAppUpdateStatusResult = SystemAppUpdateStatus;

export interface SystemCliCommandArgs {
  signal?: AbortSignal;
}

export type SystemCliCommandStatusResult = SystemCliCommandStatus;

export interface SystemVoiceTranscriptionArgs {
  file: Blob;
  prompt?: string;
  signal?: AbortSignal;
}

export type SystemAttentionResult = SystemAttentionResponse;
export type SystemConfigResult = SystemConfigResponse;
export type SystemAiServicesResult = SystemAiServicesResponse;
export type SystemSetAiServiceSelectionArgs = SetAiServiceSelectionRequest;
export type SystemTestAiServiceArgs = TestAiServiceRequest;
export type SystemTestAiServiceResult = TestAiServiceResponse;
export type SystemRecordTelemetryEventArgs = RecordTelemetryEventRequest;
export interface SystemRecordTelemetryEventOptions {
  keepalive: boolean;
}
export interface SystemRecordTelemetryEventResult {
  ok: true;
}

export interface SystemAiServicesArgs {
  signal?: AbortSignal;
}
export type SystemExecutionOptionsResult = SystemExecutionOptionsResponse;
export type SystemReloadConfigResult = SystemConfigReloadResponse;
export type SystemInstallCliSkillsArgs = SystemInstallCliSkillsRequest;
export interface SystemCliSkillsStatusArgs {
  hostIds?: readonly string[];
  signal?: AbortSignal;
}
export type SystemCliSkillsStatusResult = SystemCliSkillsStatusResponse;
export type SystemInstallCliSkillsResult = SystemInstallCliSkillsResponse;
export type SystemVoiceTranscriptionResult = SystemVoiceTranscriptionResponse;
export type SystemUpdateExperimentsResult = Experiments;
export type SystemUpdateGeneralSettingsResult = AppSettings & {
  showUnhandledProviderEvents?: boolean;
};
export type SystemUpdateKeyboardSettingsResult = AppKeybindingOverrides;
export type SystemUsageLimitsResult = ProviderUsageResponse;
export interface SystemProviderStatesArgs extends SystemProvidersQuery {
  signal?: AbortSignal;
}
export type SystemProviderStatesResult = SystemProviderStatesResponse;
export type SystemVersionResult = SystemVersionResponse;

export interface SystemUiPreferencesArgs {
  signal?: AbortSignal;
}
export type SystemUiPreferencesResult = UiPreferencesResponse;
export interface SystemUpdateUiPreferenceArgs<Key extends UiPreferenceKey> {
  expectedRevision: number;
  key: Key;
  value: UiPreferenceValue<Key>;
}
export interface SystemResetUiPreferenceArgs<Key extends UiPreferenceKey> {
  key: Key;
}
export type SystemUiPreferenceResult<Key extends UiPreferenceKey> =
  UiPreferenceResponse<Key>;

export interface SystemUiPreferencesArea {
  list(args?: SystemUiPreferencesArgs): Promise<SystemUiPreferencesResult>;
  set<Key extends UiPreferenceKey>(
    args: SystemUpdateUiPreferenceArgs<Key>,
  ): Promise<SystemUiPreferenceResult<Key>>;
  reset<Key extends UiPreferenceKey>(
    args: SystemResetUiPreferenceArgs<Key>,
  ): Promise<SystemUiPreferenceResult<Key>>;
}

export interface SystemArea {
  setMachineEnvironmentVariable(
    input: MachineEnvironmentSet,
  ): Promise<MachineEnvironmentList>;
  deleteMachineEnvironmentVariable(input: {
    name: string;
  }): Promise<MachineEnvironmentList>;
  machineEnvironment(): Promise<MachineEnvironmentList>;
  replaceMachineEnvironment(
    input: MachineEnvironmentReplace,
  ): Promise<MachineEnvironmentList>;
  aiServices(args?: SystemAiServicesArgs): Promise<SystemAiServicesResult>;
  attention(args?: SystemAttentionArgs): Promise<SystemAttentionResult>;
  config(args?: SystemConfigArgs): Promise<SystemConfigResult>;
  executionOptions(
    args?: SystemExecutionOptionsArgs,
  ): Promise<SystemExecutionOptionsResult>;
  cliSkillsStatus(
    args?: SystemCliSkillsStatusArgs,
  ): Promise<SystemCliSkillsStatusResult>;
  installCliSkills(
    args: SystemInstallCliSkillsArgs,
  ): Promise<SystemInstallCliSkillsResult>;
  experimental_recordTelemetryEvent(
    args: SystemRecordTelemetryEventArgs,
    options?: SystemRecordTelemetryEventOptions,
  ): Promise<SystemRecordTelemetryEventResult>;
  reloadConfig(): Promise<SystemReloadConfigResult>;
  setAiServiceSelection(
    args: SystemSetAiServiceSelectionArgs,
  ): Promise<SystemAiServicesResult>;
  testAiService(
    args: SystemTestAiServiceArgs,
  ): Promise<SystemTestAiServiceResult>;
  transcribeVoice(
    args: SystemVoiceTranscriptionArgs,
  ): Promise<SystemVoiceTranscriptionResult>;
  uiPreferences: SystemUiPreferencesArea;
  mobileAppDownloads(): typeof mobileAppDownloads;
  mobileAppReleases(): Promise<SystemMobileAppReleasesResponse>;
  updateExperiments(
    args: ExperimentUpdates,
  ): Promise<SystemUpdateExperimentsResult>;
  updateGeneralSettings(
    args: AppSettingsUpdate,
  ): Promise<SystemUpdateGeneralSettingsResult>;
  updateKeyboardSettings(
    args: AppKeybindingOverrides,
  ): Promise<SystemUpdateKeyboardSettingsResult>;
  providerStates(
    args?: SystemProviderStatesArgs,
  ): Promise<SystemProviderStatesResult>;
  usageLimits(args?: SystemUsageLimitsArgs): Promise<SystemUsageLimitsResult>;
  version(args?: SystemVersionArgs): Promise<SystemVersionResult>;
  appUpdate(args?: SystemAppUpdateArgs): Promise<SystemAppUpdateStatusResult>;
  applyAppUpdate(
    args: SystemApplyAppUpdateArgs,
  ): Promise<SystemAppUpdateStatusResult>;
  acknowledgeAppUpdate(
    args: SystemAcknowledgeAppUpdateArgs,
  ): Promise<SystemAppUpdateStatusResult>;
  experimental_scheduleAppUpdate(): Promise<SystemAppUpdateStatusResult>;
  experimental_cancelScheduledAppUpdate(): Promise<SystemAppUpdateStatusResult>;
  experimental_setAppUpdateAuto(args: {
    enabled: boolean;
  }): Promise<SystemAppUpdateStatusResult>;
  experimental_cliCommand(
    args?: SystemCliCommandArgs,
  ): Promise<SystemCliCommandStatusResult>;
  experimental_installCliCommand(): Promise<SystemCliCommandStatusResult>;
  experimental_removeCliCommand(): Promise<SystemCliCommandStatusResult>;
}

function versionQuery(args: SystemVersionArgs | undefined): SystemVersionQuery {
  return args?.force === undefined
    ? {}
    : { force: args.force ? "true" : "false" };
}

function appUpdateQuery(
  args: SystemAppUpdateArgs | undefined,
): SystemAppUpdateQuery {
  return args?.force === undefined
    ? {}
    : { force: args.force ? "true" : "false" };
}

export function createSystemArea(args: CreateSdkAreaArgs): SystemArea {
  const { operations } = args;
  const { call } = operations;
  const uiPreferences: SystemUiPreferencesArea = {
    list: (input) =>
      call("system.uiPreferences", {}, { signal: input?.signal }),
    async set(input) {
      const body = await call("system.updateUiPreference", {
        key: input.key,
        expectedRevision: input.expectedRevision,
        value: input.value,
      });
      return body as UiPreferenceResponse<typeof input.key>;
    },
    async reset(input) {
      const body = await call("system.resetUiPreference", { key: input.key });
      return body as UiPreferenceResponse<typeof input.key>;
    },
  };
  return {
    uiPreferences,
    setMachineEnvironmentVariable: (input) =>
      call("system.setMachineEnvironmentVariable", input),
    deleteMachineEnvironmentVariable: (input) =>
      call("system.deleteMachineEnvironmentVariable", input),
    machineEnvironment: () => call("system.machineEnvironment", {}),
    replaceMachineEnvironment: (input) =>
      call("system.replaceMachineEnvironment", input),
    attention: (input) =>
      call("system.attention", {}, { signal: input?.signal }),
    aiServices: (input) =>
      call("system.aiServices", {}, { signal: input?.signal }),
    setAiServiceSelection: (input) =>
      call("system.setAiServiceSelection", input),
    testAiService: (input) => call("system.testAiService", input),
    config: (input) => call("system.config", {}, { signal: input?.signal }),
    executionOptions: (input = {}) => readExecutionOptions(operations, input),
    cliSkillsStatus: (input = {}) =>
      call(
        "system.cliSkillsStatus",
        input.hostIds === undefined ? {} : { hostIds: input.hostIds.join(",") },
        { signal: input.signal },
      ),
    installCliSkills: (input) => call("system.installCliSkills", input),
    experimental_recordTelemetryEvent: (input, options) =>
      call(
        "system.recordTelemetryEvent",
        input,
        options === undefined ? {} : { keepalive: options.keepalive },
      ),
    reloadConfig: () => call("system.reloadConfig", {}),
    async transcribeVoice(input) {
      if (input.file.size === 0) {
        throw new Error("Audio file must not be empty");
      }
      return systemVoiceTranscriptionResponseSchema.parse(
        await call(
          "system.voiceTranscription",
          {
            file: input.file,
            ...(input.prompt === undefined ? {} : { prompt: input.prompt }),
          },
          { signal: input.signal },
        ),
      );
    },
    mobileAppReleases: () => call("system.mobileAppReleases", {}),
    mobileAppDownloads() {
      return { ...mobileAppDownloads };
    },
    updateExperiments: (input) => call("system.experiments", input),
    updateGeneralSettings: (input) => call("system.generalSettings", input),
    updateKeyboardSettings: (input) =>
      call("system.keyboardSettings", { overrides: input }),
    providerStates: (input = {}) =>
      call(
        "system.providerStates",
        { environmentId: input.environmentId, hostId: input.hostId },
        { signal: input.signal },
      ),
    usageLimits: (input = {}) =>
      call(
        "system.usageLimits",
        {
          hostId: input.hostId,
          providerId: input.providerId,
          refresh:
            input.refresh === undefined
              ? undefined
              : input.refresh
                ? "true"
                : "false",
        },
        { signal: input.signal },
      ),
    version: (input) =>
      call("system.version", versionQuery(input), { signal: input?.signal }),
    appUpdate: (input) =>
      call("system.appUpdate", appUpdateQuery(input), {
        signal: input?.signal,
      }),
    applyAppUpdate: (input) => call("system.applyAppUpdate", input),
    acknowledgeAppUpdate: (input) => call("system.acknowledgeAppUpdate", input),
    experimental_scheduleAppUpdate: () => call("system.scheduleAppUpdate", {}),
    experimental_cancelScheduledAppUpdate: () =>
      call("system.cancelScheduledAppUpdate", {}),
    experimental_setAppUpdateAuto: (input) =>
      call("system.setAppUpdateAuto", input),
    experimental_cliCommand: (input) =>
      call("system.cliCommand", {}, { signal: input?.signal }),
    experimental_installCliCommand: () => call("system.installCliCommand", {}),
    experimental_removeCliCommand: () => call("system.removeCliCommand", {}),
  };
}
