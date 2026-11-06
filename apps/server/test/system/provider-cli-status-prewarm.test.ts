import type {
  HostDaemonOnlineRpcRequestMessage,
  ProviderCliStatusResponse,
} from "@bb/host-daemon-contract";
import { createDeferredPromise } from "@bb/test-helpers";
import { describe, expect, it, vi } from "vitest";
import { installProviderCliStatusPrewarm } from "../../src/services/system/provider-cli-status-prewarm.js";
import { PROVIDER_INSTALLATION_STATUS_FRESH_MS } from "../../src/services/system/provider-installations.js";
import {
  registerHostRpcResponder,
  type HostRpcHandlerResult,
} from "../helpers/host-rpc.js";
import { captureLogLines } from "../helpers/provider-model-catalogs.js";
import { seedHostSession } from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const PASS_FINISHED = "Provider CLI status prewarm pass finished";
const INSTALLATION_PROVIDER_IDS = ["acp-cursor", "claude-code", "codex", "pi"];

type StatusCommand = Extract<
  HostDaemonOnlineRpcRequestMessage["command"],
  { type: "provider.installation.status" }
>;

function statusAnswer(providerId: string): HostRpcHandlerResult {
  return {
    ok: true,
    result: {
      executableName: providerId,
      executablePath: `/usr/local/bin/${providerId}`,
      installed: true,
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

function registerStatusResponder(
  harness: TestAppHarness,
  hostId: string,
  answer: (
    command: StatusCommand,
  ) => HostRpcHandlerResult | Promise<HostRpcHandlerResult>,
) {
  const { host, session } = seedHostSession(harness.deps, { id: hostId });
  const { requests } = registerHostRpcResponder(harness, {
    hostId: host.id,
    sessionId: session.id,
    handle: ({ command }) => {
      if (command.type !== "provider.installation.status") {
        throw new Error(`Unexpected RPC command ${command.type}`);
      }
      return answer(command);
    },
  });
  return {
    hostId: host.id,
    probedProviderIds: () =>
      requests
        .flatMap(({ command }) =>
          command.type === "provider.installation.status"
            ? [command.providerId]
            : [],
        )
        .sort(),
  };
}

async function readStatus(harness: TestAppHarness, hostId: string) {
  const response = await harness.app.request(
    `/api/v1/hosts/${hostId}/provider-clis/status`,
  );
  expect(response.status).toBe(200);
  const body: ProviderCliStatusResponse = await response.json();
  return Object.keys(body).sort();
}

describe("provider CLI status prewarm", () => {
  it("probes each provider once for a burst of connects, and a read during the probe joins it", async () => {
    await withTestHarness(async (harness) => {
      const logLines = captureLogLines(harness);
      const gate = createDeferredPromise<void>();
      const host = registerStatusResponder(
        harness,
        "cli-status-prewarm-burst",
        async (command) => {
          await gate.promise;
          return statusAnswer(command.providerId);
        },
      );
      const prewarm = installProviderCliStatusPrewarm(harness.deps);
      try {
        await vi.waitFor(() =>
          expect(host.probedProviderIds()).toHaveLength(3),
        );
        harness.hub.notifyHost(host.hostId, ["host-connected"]);
        harness.hub.notifyHost(host.hostId, ["host-connected"]);
        const read = readStatus(harness, host.hostId);
        gate.resolve();

        expect(await read).toEqual(INSTALLATION_PROVIDER_IDS);
        await vi.waitFor(() => expect(logLines(PASS_FINISHED)).toHaveLength(2));
        expect(host.probedProviderIds()).toEqual(INSTALLATION_PROVIDER_IDS);
        expect(await readStatus(harness, host.hostId)).toEqual(
          INSTALLATION_PROVIDER_IDS,
        );
        expect(host.probedProviderIds()).toEqual(INSTALLATION_PROVIDER_IDS);
      } finally {
        prewarm.stop();
      }
    });
  });

  it("probes on a reconnect only the providers with no cached status, however old the cached ones are", async () => {
    await withTestHarness(async (harness) => {
      const logLines = captureLogLines(harness);
      let codexFails = true;
      const host = registerStatusResponder(
        harness,
        "cli-status-prewarm-reconnect",
        (command) =>
          command.providerId === "codex" && codexFails
            ? {
                ok: false,
                errorCode: "provider_status_failed",
                errorMessage: "provider status failed",
              }
            : statusAnswer(command.providerId),
      );
      let clock = Date.now();
      const dateNow = vi.spyOn(Date, "now").mockImplementation(() => clock);
      const prewarm = installProviderCliStatusPrewarm(harness.deps);
      try {
        await vi.waitFor(() => expect(logLines(PASS_FINISHED)).toHaveLength(1));
        expect(host.probedProviderIds()).toEqual(INSTALLATION_PROVIDER_IDS);

        clock += PROVIDER_INSTALLATION_STATUS_FRESH_MS * 10;
        codexFails = false;
        harness.hub.notifyHost(host.hostId, ["host-connected"]);
        await vi.waitFor(() => expect(logLines(PASS_FINISHED)).toHaveLength(2));
        expect(host.probedProviderIds()).toEqual(
          [...INSTALLATION_PROVIDER_IDS, "codex"].sort(),
        );

        harness.hub.notifyHost(host.hostId, ["host-connected"]);
        await vi.waitFor(() => expect(logLines(PASS_FINISHED)).toHaveLength(3));
        expect(host.probedProviderIds()).toHaveLength(5);
      } finally {
        prewarm.stop();
        dateNow.mockRestore();
      }
    });
  });
});
