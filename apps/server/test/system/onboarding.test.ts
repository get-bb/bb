import type {
  ProviderCliStatus,
  ProviderUsageResponse,
} from "@bb/host-daemon-contract";
import { describe, expect, it } from "vitest";
import { getOnboardingAgentOverview } from "../../src/services/system/onboarding.js";
import { registerHostRpcResponder } from "../helpers/host-rpc.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

const CONNECTED_USAGE: ProviderUsageResponse = {
  codex: {
    status: "ok",
    accountEmail: null,
    planLabel: "Plus",
    windows: [],
  },
  claudeCode: {
    status: "ok",
    accountEmail: null,
    planLabel: "Max",
    windows: [],
  },
  cursor: {
    status: "ok",
    accountEmail: null,
    planLabel: "Pro",
    windows: [],
  },
};

function installedCli(
  displayName: string,
  executableName: string,
): ProviderCliStatus {
  return {
    displayName,
    executableName,
    executablePath: `/usr/local/bin/${executableName}`,
    installed: true,
    installSource: "external",
    currentVersion: "1.0.0",
    latestVersion: null,
    minimumSupportedVersion: null,
    npmPackageName: null,
    npmGlobalPackageVersion: null,
    installAction: null,
    needsUpdate: false,
    versionUnsupported: false,
  };
}

describe("getOnboardingAgentOverview", () => {
  it("orders connected agents like the model picker", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: (request) => {
          switch (request.command.type) {
            case "provider.usage":
              return { ok: true, result: CONNECTED_USAGE };
            case "provider_cli.status":
              return {
                ok: true,
                result: {
                  codex: installedCli("Codex", "codex"),
                  claudeCode: installedCli("Claude Code", "claude"),
                  cursor: installedCli("Cursor", "agent"),
                },
              };
            case "known_acp_agents.status":
              return {
                ok: true,
                result: {
                  agents: request.command.agents.map((agent) => ({
                    ...agent,
                    installed: agent.id === "acp-opencode",
                    executablePath:
                      agent.id === "acp-opencode"
                        ? "/usr/local/bin/opencode"
                        : null,
                  })),
                },
              };
            default:
              throw new Error(`Unexpected command ${request.command.type}`);
          }
        },
      });

      const overview = await getOnboardingAgentOverview(harness.deps, {
        hostId: host.id,
      });

      expect(overview.agents.map((agent) => agent.providerId)).toEqual([
        "codex",
        "claude-code",
        "acp-cursor",
        "acp-opencode",
      ]);
      expect(
        overview.agents.filter((agent) => agent.status === "connected")[0]
          ?.providerId,
      ).toBe("codex");
    });
  });

  it("resolves a reused environment to its own host", async () => {
    await withTestHarness(async (harness) => {
      const primary = seedHostSession(harness.deps, {
        id: "host-primary",
        name: "Primary",
      });
      const remote = seedHostSession(harness.deps, {
        id: "host-remote",
        name: "Remote",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: remote.host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: remote.host.id,
        projectId: project.id,
      });
      let primaryCalls = 0;
      let remoteCalls = 0;

      registerHostRpcResponder(harness, {
        hostId: primary.host.id,
        sessionId: primary.session.id,
        handle: () => {
          primaryCalls += 1;
          throw new Error("Primary host should not be queried");
        },
      });
      registerHostRpcResponder(harness, {
        hostId: remote.host.id,
        sessionId: remote.session.id,
        handle: (request) => {
          remoteCalls += 1;
          switch (request.command.type) {
            case "provider.usage":
              return { ok: true, result: CONNECTED_USAGE };
            case "provider_cli.status":
              return {
                ok: true,
                result: {
                  codex: installedCli("Codex", "codex"),
                  claudeCode: installedCli("Claude Code", "claude"),
                  cursor: installedCli("Cursor", "agent"),
                },
              };
            case "known_acp_agents.status":
              return {
                ok: true,
                result: {
                  agents: request.command.agents.map((agent) => ({
                    ...agent,
                    installed: false,
                    executablePath: null,
                  })),
                },
              };
            default:
              throw new Error(`Unexpected command ${request.command.type}`);
          }
        },
      });

      const overview = await getOnboardingAgentOverview(harness.deps, {
        environmentId: environment.id,
      });

      expect(overview.agents[0]?.providerId).toBe("codex");
      expect(primaryCalls).toBe(0);
      expect(remoteCalls).toBe(3);
    });
  });
});
