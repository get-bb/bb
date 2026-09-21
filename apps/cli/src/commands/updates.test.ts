import { describe, expect, it } from "vitest";
import { UPDATE_STATE_PRESENTATION } from "@bb/domain/update-state";
import type { HostProviderCliStatusResponse } from "@bb/server-contract";
import { providerState } from "./updates.js";

type ProviderCliStatus = HostProviderCliStatusResponse[string];

function status(overrides: Partial<ProviderCliStatus>): ProviderCliStatus {
  return {
    displayName: "Codex",
    executableName: "codex",
    executablePath: "/usr/local/bin/codex",
    installed: true,
    installSource: null,
    currentVersion: "0.154.0",
    latestVersion: "0.154.0",
    minimumSupportedVersion: "0.100.0",
    npmPackageName: "@openai/codex",
    npmGlobalPackageVersion: null,
    installAction: null,
    needsUpdate: false,
    versionUnsupported: false,
    ...overrides,
  } as ProviderCliStatus;
}

describe("providerState", () => {
  it("reports up to date only when the latest version is known", () => {
    expect(providerState(status({}))).toBe("up-to-date");
  });

  it("does not claim up to date when the latest version could not be resolved", () => {
    expect(providerState(status({ latestVersion: null }))).toBe(
      "latest-unknown",
    );
    expect(UPDATE_STATE_PRESENTATION["latest-unknown"].label).not.toBe(
      UPDATE_STATE_PRESENTATION["up-to-date"].label,
    );
  });

  it("keeps a known update ahead of the unknown-latest branch", () => {
    expect(
      providerState(
        status({
          latestVersion: "0.155.1",
          needsUpdate: true,
          installAction: { kind: "update", label: "Update", command: "x" },
        } as Partial<ProviderCliStatus>),
      ),
    ).toBe("update-available");
    expect(
      providerState(status({ latestVersion: null, versionUnsupported: true })),
    ).toBe("update-manually");
  });

  it("still reports a missing CLI as not installed", () => {
    expect(
      providerState(
        status({ installed: false, currentVersion: null, latestVersion: null }),
      ),
    ).toBe("not-installed");
  });
});
