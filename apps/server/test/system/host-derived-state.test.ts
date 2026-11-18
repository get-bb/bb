import type {
  HostDaemonOnlineRpcRequestMessage,
  ProviderCliStatusResponse,
} from "@bb/host-daemon-contract";
import { describe, expect, it, vi } from "vitest";
import {
  installHostDerivedStateBaseline,
  requestHostDerivedStateRefresh,
  requestHostDerivedStateRefreshForPluginChange,
} from "../../src/services/hosts/host-derived-state.js";
import { setPluginAgentContributions } from "../../src/services/plugins/plugin-agent-contributions.js";
import {
  registerHostRpcResponder,
  type HostRpcHandlerResult,
} from "../helpers/host-rpc.js";
import { seedHostSession } from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

type StatusCommand = Extract<
  HostDaemonOnlineRpcRequestMessage["command"],
  { type: "provider.installation.status" }
>;

function statusAnswer(
  command: StatusCommand,
  installed: boolean,
): HostRpcHandlerResult {
  return {
    ok: true,
    result: {
      executableName: command.providerId,
      executablePath: `/usr/local/bin/${command.providerId}`,
      installed,
      installSource: "external",
      currentVersion: "1.0.0",
      latestVersion: "1.0.0",
      minimumSupportedVersion: null,
      npmPackageName: null,
      npmGlobalPackageVersion: null,
      installAction: null,
      needsUpdate: false,
      versionUnsupported: false,
    },
  };
}

function seedHost(harness: TestAppHarness, hostId: string) {
  let installed = false;
  const { host, session } = seedHostSession(harness.deps, { id: hostId });
  const { requests } = registerHostRpcResponder(harness, {
    hostId: host.id,
    sessionId: session.id,
    handle: ({ command }) => {
      if (command.type !== "provider.installation.status") {
        throw new Error(`Unexpected RPC command ${command.type}`);
      }
      return statusAnswer(command, installed);
    },
  });
  const hostChanges: string[] = [];
  harness.hub.onChangedMessage((message) => {
    if (message.entity === "host" && message.id === host.id) {
      hostChanges.push(...message.changes);
    }
  });
  return {
    hostId: host.id,
    hostChanges,
    install: () => {
      installed = true;
    },
    probes: () =>
      requests.filter(
        ({ command }) => command.type === "provider.installation.status",
      ).length,
  };
}

async function codexInstalled(
  harness: TestAppHarness,
  hostId: string,
): Promise<boolean | undefined> {
  const response = await harness.app.request(
    `/api/v1/hosts/${hostId}/provider-clis/status`,
  );
  expect(response.status).toBe(200);
  const body: ProviderCliStatusResponse = await response.json();
  return body.codex?.installed;
}

describe("host-derived state owner", () => {
  it("re-probes a host when its toolchain changes and pushes the change without a client read", async () => {
    await withTestHarness(async (harness) => {
      const host = seedHost(harness, "host-derived-toolchain");
      expect(await codexInstalled(harness, host.hostId)).toBe(false);
      const probesAfterRead = host.probes();

      host.install();
      requestHostDerivedStateRefresh(harness.deps, host.hostId);

      await vi.waitFor(() =>
        expect(host.hostChanges.at(-1)).toBe("host-state-changed"),
      );
      expect(new Set(host.hostChanges)).toEqual(
        new Set(["provider-cli-status-changed", "host-state-changed"]),
      );
      expect(host.probes()).toBeGreaterThan(probesAfterRead);
      const probesAfterRefresh = host.probes();
      expect(await codexInstalled(harness, host.hostId)).toBe(true);
      expect(host.probes()).toBe(probesAfterRefresh);
    });
  });

  it("re-probes connected hosts when the machine environment changes", async () => {
    await withTestHarness(async (harness) => {
      const host = seedHost(harness, "host-derived-machine-env");
      expect(await codexInstalled(harness, host.hostId)).toBe(false);

      host.install();
      const response = await harness.app.request(
        "/api/v1/settings/machine-environment",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "BB_TEST_PATH_HINT", value: "1" }),
        },
      );
      expect(response.status).toBe(200);

      await vi.waitFor(() =>
        expect(host.hostChanges).toContain("host-state-changed"),
      );
      expect(host.hostChanges).toContain("provider-cli-status-changed");
      expect(await codexInstalled(harness, host.hostId)).toBe(true);
    });
  });

  it("re-probes after a plugin change only when it changes a provider's contributed env", async () => {
    await withTestHarness(async (harness) => {
      const host = seedHost(harness, "host-derived-plugin-env");
      let executable = "/opt/plugin/claude";
      setPluginAgentContributions({
        listSkillRootContributions: () => [],
        listAgentTools: () => [],
        listInstructionContributions: () => [],
        findAgentTool: () => undefined,
        resolveMention: async () => ({ ok: false, error: "unused" }),
        invokeAgentTool: async () => ({ success: false, contentItems: [] }),
        resolveProviderEnv: async ({ providerId }) => ({
          entries:
            providerId === "claude-code"
              ? [
                  {
                    name: "BB_CLAUDE_CODE_EXECUTABLE",
                    value: executable,
                    source: { plugin: "claude-pack" },
                    reason: "bundled",
                  },
                ]
              : [],
        }),
      });
      const baseline = installHostDerivedStateBaseline(harness.deps);
      try {
        await new Promise((resolve) => setTimeout(resolve, 50));
        requestHostDerivedStateRefreshForPluginChange(harness.deps);
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(host.probes()).toBe(0);

        executable = "/opt/plugin-v2/claude";
        requestHostDerivedStateRefreshForPluginChange(harness.deps);
        await vi.waitFor(() =>
          expect(host.hostChanges).toContain("host-state-changed"),
        );
        expect(host.probes()).toBeGreaterThan(0);
      } finally {
        baseline.stop();
        setPluginAgentContributions(undefined);
      }
    });
  });
});
