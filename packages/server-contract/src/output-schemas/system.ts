import {
  appKeybindingOverridesSchema,
  appSettingsSchema,
  appThemeSchema,
  experimentsSchema,
  providerInfoSchema,
} from "@bb/domain";
import { providerUsageResponseSchema } from "@bb/host-daemon-contract";
import { z } from "zod";
import { machineEnvironmentListSchema } from "../api/machine-environment.js";
import { systemEnvironmentProvidersResponseSchema } from "../api/system-environment-providers.js";
import { systemVoiceTranscriptionResponseSchema } from "../api/system-voice.js";
import {
  systemAiServicesResponseSchema,
  systemAppUpdateStatusSchema,
  systemAttentionResponseSchema,
  systemCliCommandStatusSchema,
  systemCliSkillsStatusResponseSchema,
  systemConfigReloadResponseSchema,
  systemConfigResponseSchema,
  systemExecutionOptionsResponseSchema,
  systemInstallCliSkillsResponseSchema,
  systemMachineProvidersResponseSchema,
  systemMobileAppReleasesResponseSchema,
  systemSetupGuideResponseSchema,
  systemProviderCatalogEntrySchema,
  systemProviderStatesResponseSchema,
  systemVersionResponseSchema,
  testAiServiceResponseSchema,
  themeCatalogResponseSchema,
} from "../api/system.js";
import {
  uiPreferenceResponseSchema,
  uiPreferencesResponseSchema,
} from "../api/ui-preferences.js";
import type { GroupOutputSchemas } from "../public-operations.js";

const okSchema = z.object({ ok: z.literal(true) });
const generalSettingsSchema = appSettingsSchema.extend({
  showUnhandledProviderEvents: z.boolean().optional(),
});
const providerCatalogSchema = z.array(systemProviderCatalogEntrySchema);

export const systemOutputSchemas: GroupOutputSchemas<"system"> = {
  "system.setMachineEnvironmentVariable": machineEnvironmentListSchema,
  "system.deleteMachineEnvironmentVariable": machineEnvironmentListSchema,
  "system.machineEnvironment": machineEnvironmentListSchema,
  "system.replaceMachineEnvironment": machineEnvironmentListSchema,
  "system.attention": systemAttentionResponseSchema,
  "system.mobileAppReleases": systemMobileAppReleasesResponseSchema,
  "system.setupGuide": systemSetupGuideResponseSchema,
  "system.config": systemConfigResponseSchema,
  "system.aiServices": systemAiServicesResponseSchema,
  "system.setAiServiceSelection": systemAiServicesResponseSchema,
  "system.testAiService": testAiServiceResponseSchema,
  "system.recordTelemetryEvent": okSchema,
  "system.generalSettings": generalSettingsSchema,
  "system.keyboardSettings": appKeybindingOverridesSchema,
  "system.experiments": experimentsSchema,
  "system.appearance": appThemeSchema,
  "system.uiPreferences": uiPreferencesResponseSchema,
  "system.updateUiPreference": uiPreferenceResponseSchema,
  "system.resetUiPreference": uiPreferenceResponseSchema,
  "system.themes": themeCatalogResponseSchema,
  "system.resolveTheme": appThemeSchema,
  "system.reloadConfig": systemConfigReloadResponseSchema,
  "system.cliSkillsStatus": systemCliSkillsStatusResponseSchema,
  "system.installCliSkills": systemInstallCliSkillsResponseSchema,
  "system.executionOptions": systemExecutionOptionsResponseSchema,
  "system.environmentProviders": systemEnvironmentProvidersResponseSchema,
  "system.machineProviders": systemMachineProvidersResponseSchema,
  "system.providers": z.array(providerInfoSchema),
  "system.providerCatalog": providerCatalogSchema,
  "system.providerEnabled": providerCatalogSchema,
  "system.providerLogo": null,
  "system.providerStates": systemProviderStatesResponseSchema,
  "system.usageLimits": providerUsageResponseSchema,
  "system.voiceTranscription": systemVoiceTranscriptionResponseSchema,
  "system.version": systemVersionResponseSchema,
  "system.appUpdate": systemAppUpdateStatusSchema,
  "system.applyAppUpdate": systemAppUpdateStatusSchema,
  "system.acknowledgeAppUpdate": systemAppUpdateStatusSchema,
  "system.scheduleAppUpdate": systemAppUpdateStatusSchema,
  "system.cancelScheduledAppUpdate": systemAppUpdateStatusSchema,
  "system.setAppUpdateAuto": systemAppUpdateStatusSchema,
  "system.cliCommand": systemCliCommandStatusSchema,
  "system.installCliCommand": systemCliCommandStatusSchema,
  "system.removeCliCommand": systemCliCommandStatusSchema,
};
