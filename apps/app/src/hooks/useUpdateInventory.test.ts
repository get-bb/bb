import { describe, expect, it } from "vitest";
import type {
  ProviderCliStatus,
  ProviderCliStatusResponse,
} from "@bb/host-daemon-contract";
import { buildUpdateInventoryProviderIssues } from "./useUpdateInventory";

function providerStatus(
  displayName: string,
  overrides: Partial<ProviderCliStatus> = {},
): ProviderCliStatus {
  return {
    displayName,
    executableName: displayName.toLowerCase(),
    executablePath: `/usr/local/bin/${displayName.toLowerCase()}`,
    installed: true,
    installSource: "npmGlobal",
    currentVersion: "1.0.0",
    latestVersion: "1.0.0",
    minimumSupportedVersion: null,
    npmPackageName: null,
    npmGlobalPackageVersion: null,
    installAction: null,
    needsUpdate: false,
    versionUnsupported: false,
    ...overrides,
  };
}

describe("buildUpdateInventoryProviderIssues", () => {
  it("includes Cursor updates in the machine inventory", () => {
    const status: ProviderCliStatusResponse = {
      codex: providerStatus("Codex"),
      "claude-code": providerStatus("Claude Code"),
      "acp-cursor": providerStatus("Cursor", {
        latestVersion: "1.1.0",
        needsUpdate: true,
      }),
    };

    expect(buildUpdateInventoryProviderIssues(status)).toMatchObject([
      {
        provider: "acp-cursor",
        title: "Cursor update available",
      },
    ]);
  });
});
