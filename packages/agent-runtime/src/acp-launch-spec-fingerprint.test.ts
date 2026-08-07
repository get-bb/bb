import { describe, expect, it } from "vitest";
import type { HostDaemonAcpLaunchSpec } from "@bb/host-daemon-contract";
import { fingerprintAcpLaunchSpec } from "./acp-launch-spec-fingerprint.js";

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

  it("changes when manual compaction support changes", () => {
    const base: HostDaemonAcpLaunchSpec = {
      displayName: "Custom ACP",
      command: "custom-agent",
      args: ["agent", "stdio"],
      env: {},
    };
    const compacting: HostDaemonAcpLaunchSpec = {
      ...base,
      manualCompaction: { method: "prompt", prompt: "/compact" },
    };

    expect(fingerprintAcpLaunchSpec(base)).not.toBe(
      fingerprintAcpLaunchSpec(compacting),
    );
  });
});
