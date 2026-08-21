import { describe, expect, it } from "vitest";
import type { HostDaemonAcpLaunchSpec } from "@bb/host-daemon-contract";
import {
  bridgeLaunchProcessKey,
  fingerprintAcpLaunchSpec,
} from "./acp-launch-spec-fingerprint.js";
import type { AgentRuntimeBridgeLaunch } from "./types.js";

describe("fingerprintAcpLaunchSpec", () => {
  it("is stable for semantically identical launch specs", () => {
    const first: HostDaemonAcpLaunchSpec = {
      displayName: "Custom ACP",
      command: "custom-agent",
      args: ["agent", "stdio"],
      env: { BETA: "2", ALPHA: "1" },
      reasoningCli: {
        flag: "--reasoning-effort",
        supportedLevels: ["low", "medium", "high"],
        levelValues: { xhigh: "high", none: "low" },
        defaultLevel: "high",
      },
    };
    const second: HostDaemonAcpLaunchSpec = {
      displayName: "Custom ACP",
      command: "custom-agent",
      args: ["agent", "stdio"],
      env: { ALPHA: "1", BETA: "2" },
      reasoningCli: {
        flag: "--reasoning-effort",
        supportedLevels: ["low", "medium", "high"],
        levelValues: { none: "low", xhigh: "high" },
        defaultLevel: "high",
      },
    };

    expect(fingerprintAcpLaunchSpec(first)).toBe(
      fingerprintAcpLaunchSpec(second),
    );
  });

  it("changes when launch-time permission behavior changes", () => {
    const base: HostDaemonAcpLaunchSpec = {
      displayName: "Custom ACP",
      command: "custom-agent",
      args: ["agent", "stdio"],
      env: {},
    };
    const fullAccess: HostDaemonAcpLaunchSpec = {
      ...base,
      permissionCli: {
        full: ["--always-approve"],
        insertAfterArgs: 1,
      },
    };

    expect(fingerprintAcpLaunchSpec(base)).not.toBe(
      fingerprintAcpLaunchSpec(fullAccess),
    );
  });
});

describe("bridgeLaunchProcessKey", () => {
  const base: AgentRuntimeBridgeLaunch = {
    pluginId: "provider-example",
    dataDir: "/tmp/provider-example",
    source: { kind: "daemon-bundled", id: "example" },
    capabilities: {
      experimental_providerInstallation: false,
      supportsServiceTier: false,
      permissionModes: ["full"],
      supportsThreadArchive: false,
      supportsThreadRename: false,
      fork: "none",
    },
    providerOptions: { launch: { command: "example" } },
    envPassthrough: [],
  };

  it("changes with provider-owned statics and ignores object key order", () => {
    expect(bridgeLaunchProcessKey(base)).toBe(
      bridgeLaunchProcessKey({
        ...base,
        providerOptions: { launch: { command: "example" } },
    envPassthrough: [],
      }),
    );
    expect(bridgeLaunchProcessKey(base)).not.toBe(
      bridgeLaunchProcessKey({
        ...base,
        providerOptions: { launch: { command: "other" } },
      }),
    );
  });
});
