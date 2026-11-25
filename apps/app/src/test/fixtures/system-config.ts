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
    serverId: "server_test",
    routes: [],
    serverAccess: {
      providers: [],
      effectiveUrl: null,
      urlSource: null,
      localNetwork: {
        bindHost: "127.0.0.1",
        addresses: [],
        listenerError: null,
      },
    },
    generalSettings: defaultAppSettings,
    keybindings: [],
    defaultKeybindings: [],
    keybindingOverrides: [],
    experiments: defaultExperiments,
    performanceDiagnosticsAvailable: false,
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
    dataDir: "/tmp/bb-test",
    ...overrides,
  };
}
