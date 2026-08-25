import { DEFAULTS } from "@bb/config/defaults";
import {
  defaultAppSettings,
  defaultAppTheme,
  defaultExperiments,
  defaultFeatureFlags,
} from "@bb/domain";
import type { SystemConfigResponse } from "@bb/server-contract";

/**
 * The system-config response a test or story serves: the server's defaults
 * with no registered AI services, no hosts, and no keybinding overrides.
 * The AI-service defaults come from `@bb/config` so a model-id bump never
 * has to be chased through fixtures.
 */
export function makeSystemConfig(
  overrides: Partial<SystemConfigResponse> = {},
): SystemConfigResponse {
  return {
    generalSettings: defaultAppSettings,
    keybindings: [],
    defaultKeybindings: [],
    keybindingOverrides: [],
    experiments: defaultExperiments,
    appearance: defaultAppTheme,
    customThemes: [],
    pluginThemes: [],
    featureFlags: defaultFeatureFlags,
    hostDaemonPort: null,
    localHelperPorts: [],
    serverUrl: "http://localhost:38886",
    primaryHostId: null,
    primaryHostPlatform: null,
    voiceTranscriptionEnabled: false,
    aiServices: {
      inference: DEFAULTS.inferenceModel,
      inferenceFallback: DEFAULTS.inferenceFallbackModel,
      transcription: DEFAULTS.transcriptionModel,
      services: [],
    },
    dataDir: "/tmp/bb-test",
    ...overrides,
  };
}
