import { fileURLToPath } from "node:url";
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
