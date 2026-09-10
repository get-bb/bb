import { DEFAULTS } from "@bb/config/defaults";
import {
  DEFAULT_PLUGIN_TRANSCRIPTION_MAX_BYTES,
  DEFAULT_VOICE_RECORDING_BITRATE,
  DEFAULT_VOICE_TRANSCRIPTION_TIMEOUT_MAX_MS,
} from "@bb/config/voice-transcription-limit";
import {
  defaultAppSettings,
  defaultAppTheme,
  defaultExperiments,
  defaultFeatureFlags,
} from "@bb/domain";
import type { SystemConfigResponse } from "@bb/server-contract";

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
      transcriptionMaxBytes: DEFAULT_PLUGIN_TRANSCRIPTION_MAX_BYTES,
      transcriptionTimeoutMaxMs: DEFAULT_VOICE_TRANSCRIPTION_TIMEOUT_MAX_MS,
      recordingBitrate: DEFAULT_VOICE_RECORDING_BITRATE,
      services: [],
    },
    dataDir: "/tmp/bb-test",
    ...overrides,
  };
}
