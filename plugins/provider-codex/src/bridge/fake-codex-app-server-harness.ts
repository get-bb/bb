import { fileURLToPath } from "node:url";
import type { SessionSettingsApply } from "@get-bb/plugin-sdk/provider-bridge";
import { vi } from "vitest";

const FAKE_CODEX_APP_SERVER_PATH = fileURLToPath(
  new URL("./fake-codex-app-server.mjs", import.meta.url),
);

export const FULL_ACCESS_SESSION_OPTIONS = {
  permissionMode: "full",
  permissionScope: "full",
  approvalReviewer: null,
  permissionEscalation: null,
} as const;

export const NO_SESSION_SETTINGS_CHANGE = {
  settings: [],
  sessionOptions: [],
  providerOptions: [],
} satisfies SessionSettingsApply;

export function stubFakeCodexAppServer(scriptPath?: string): void {
  vi.stubEnv("BB_CODEX_BRIDGE_APP_SERVER_COMMAND", process.execPath);
  vi.stubEnv(
    "BB_CODEX_BRIDGE_APP_SERVER_ARGS",
    JSON.stringify(
      scriptPath === undefined
        ? [FAKE_CODEX_APP_SERVER_PATH]
        : [FAKE_CODEX_APP_SERVER_PATH, scriptPath],
    ),
  );
}
