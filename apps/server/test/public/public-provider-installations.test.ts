import type {
  HostDaemonOnlineRpcRequestMessage,
  ProviderCliStatusResponse,
} from "@bb/host-daemon-contract";
import { DEFAULT_BB_REQUEST_TIMEOUT_MS } from "@bb/sdk";
import {
  validatePluginProviderDeclaration,
} from "@get-bb/plugin-sdk/internal/host-policy";
import { describe, expect, it, vi } from "vitest";
import { COMMAND_TIMEOUT_MS } from "../../src/constants.js";
import { ApiError } from "../../src/errors.js";
import { buildPluginProviderRegistration } from "../../src/services/providers/plugin-provider-registration.js";
import { registerHostRpcResponder } from "../helpers/host-rpc.js";
import { readJson } from "../helpers/json.js";
import { seedHostSession } from "../helpers/seed.js";
import {
  type TestAppHarness,
  withTestHarness,
} from "../helpers/test-app.js";

const API = "/api/v1";

function registerInstallationProviders(
  harness: TestAppHarness,
  providerIds: readonly string[],
): void {
  const bridgeArtifact = harness.deps.pluginHostArtifacts.get("provider-acp");
  if (bridgeArtifact === undefined) {
    throw new Error("Expected the test ACP provider bridge artifact");
  }
  for (const providerId of providerIds) {
    const pluginId = `provider-${providerId}`;
    harness.deps.providerRegistry.register({
      ...buildPluginProviderRegistration({
        available: true,
        pluginId,
        declaration: validatePluginProviderDeclaration({
          id: providerId,
          displayName: providerId,
          capabilities: {
            experimental_providerHealth: false,
            experimental_providerUsage: false,
            experimental_providerInstallation: true,
            supportsServiceTier: false,
            supportsNativeUserQuestion: false,
            fork: "none",
            supportsManualCompaction: false,
            supportsThreadArchive: false,
            supportsThreadRename: false,
            permissionModes: ["full"],
            reasoningLevels: ["medium"],
          },
          composerActions: [],
        }),
        readSettings: () => ({}),
      }),
      pluginId,
    });
    harness.deps.pluginHostArtifacts.set(pluginId, bridgeArtifact);
  }
}

function installationStatus(providerId: string) {
  const executableName =
    providerId === "claude-code"
      ? "claude"
      : providerId === "acp-cursor"
        ? "cursor-agent"
        : "codex";
  return {
    executableName,
    executablePath: `/usr/local/bin/${executableName}`,
    installed: true,
    installSource: "external" as const,
    currentVersion: "1.0.0",
    latestVersion: "1.1.0",
    minimumSupportedVersion: null,
    npmPackageName: null,
    npmGlobalPackageVersion: null,
    installAction: {
      kind: "update" as const,
      label: "Update" as const,
      command: `${executableName} update`,
    },
    needsUpdate: true,
    versionUnsupported: false,
  };
}

function handleProviderInstallationRpc(
  request: HostDaemonOnlineRpcRequestMessage,
) {
  const { command } = request;
  if (command.type === "provider.health") {
    return {
      ok: true as const,
      result: {
        supported: true as const,
        health: {
          status: "not_installed" as const,
          statusMessage: null,
          accountEmail: null,
          planLabel: null,
          installedVersion: null,
          minimumSupportedVersion: null,
          canInstall: false,
          canUpdate: false,
          loginCommand: null,
        },
      },
    };
  }
  if (command.type === "provider.installation.status") {
    return {
      ok: true as const,
      result: installationStatus(command.providerId),
    };
  }
  if (command.type === "provider.installation.run") {
    return {
      ok: true as const,
      result: {
        events: [
          {
            type: "completed" as const,
            provider: command.providerId,
            exitCode: 0,
            signal: null,
            success: true,
          },
        ],
      },
    };
  }
  throw new Error(`Unexpected host RPC ${command.type}`);
}

describe("public provider installation routes", () => {
  it("lists installation-capable registered providers in registry order", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "provider-installation-status-host",
      });
      const responder = registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: handleProviderInstallationRpc,
      });

      const response = await harness.app.request(
        `${API}/hosts/${host.id}/provider-clis/status`,
      );

      expect(response.status).toBe(200);
      const body = (await readJson(response)) as ProviderCliStatusResponse;
      expect(Object.keys(body)).toEqual(["codex", "claude-code", "acp-cursor"]);
      expect(Object.values(body).map((status) => status.displayName)).toEqual([
        "Codex",
        "Claude Code",
        "Cursor",
      ]);
      expect(
        responder.requests
          .filter((request) => request.command.type === "provider.health")
          .map((request) =>
            request.command.type === "provider.health"
              ? request.command.providerId
              : null,
          ),
      ).toEqual([]);
      expect(
        responder.requests
          .filter(
            (request) =>
              request.command.type === "provider.installation.status",
          )
          .map((request) =>
            request.command.type === "provider.installation.status"
              ? request.command.providerId
              : null,
          ),
      ).toEqual(["codex", "claude-code", "acp-cursor"]);
    });
  });

  it("preserves healthy providers in registry order when one status request fails", async () => {
    await withTestHarness(async (harness) => {
      const warn = vi.fn();
      harness.deps.logger = { ...harness.deps.logger, warn };
      const { host, session } = seedHostSession(harness.deps, {
        id: "provider-installation-partial-status-host",
      });
      registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: (request) => {
          if (
            request.command.type === "provider.installation.status" &&
            request.command.providerId === "claude-code"
          ) {
            return {
              ok: false,
              errorCode: "provider_status_failed",
              errorMessage: "provider status failed",
            };
          }
          return handleProviderInstallationRpc(request);
        },
      });

      const response = await harness.app.request(
        `${API}/hosts/${host.id}/provider-clis/status`,
      );

      expect(response.status).toBe(200);
      const body = (await readJson(response)) as ProviderCliStatusResponse;
      expect(Object.keys(body)).toEqual(["codex", "acp-cursor"]);
      expect(Object.values(body).map((status) => status.displayName)).toEqual([
        "Codex",
        "Cursor",
      ]);
      expect(warn).toHaveBeenCalledWith(
        {
          failure: "status_request_failed",
          hostId: host.id,
          providerId: "claude-code",
        },
        "Failed to load provider installation status; omitting provider",
      );
    });
  });

  it("preserves the host unavailable route error when the target host is offline", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "provider-installation-offline-host",
      });
      harness.hub.unregisterDaemon(session.id);

      const response = await harness.app.request(
        `${API}/hosts/${host.id}/provider-clis/status`,
      );

      expect(response.status).toBe(502);
      expect(await readJson(response)).toMatchObject({
        code: "host_unavailable",
      });
    });
  });

  it("finishes stalled provider aggregation before the SDK request timeout", async () => {
    await withTestHarness(async (harness) => {
      registerInstallationProviders(
        harness,
        Array.from(
          { length: 7 },
          (_, index) => `stalled-installation-${index + 1}`,
        ),
      );
      const { host, session } = seedHostSession(harness.deps, {
        id: "provider-installation-deadline-host",
      });
      registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: handleProviderInstallationRpc,
      });
      const requestHostOnlineRpc = harness.hub.requestHostOnlineRpc.bind(
        harness.hub,
      );
      const statusTimeouts: number[] = [];
      vi.spyOn(harness.hub, "requestHostOnlineRpc").mockImplementation(
        async (args) => {
          if (args.message.command.type !== "provider.installation.status") {
            return requestHostOnlineRpc(args);
          }
          statusTimeouts.push(args.timeoutMs);
          return new Promise((_, reject) => {
            setTimeout(
              () =>
                reject(
                  new ApiError(
                    504,
                    "command_timeout",
                    "Timed out waiting for command result",
                  ),
                ),
              args.timeoutMs,
            );
          });
        },
      );

      vi.useFakeTimers();
      try {
        const startedAt = Date.now();
        let resolvedAt: number | null = null;
        const responsePromise = Promise.resolve(
          harness.app.request(
            `${API}/hosts/${host.id}/provider-clis/status`,
          ),
        ).then((response) => {
          resolvedAt = Date.now();
          return response;
        });

        await vi.advanceTimersByTimeAsync(150_000);
        const response = await responsePromise;

        expect(response.status).toBe(200);
        expect(await readJson(response)).toEqual({});
        expect(resolvedAt).not.toBeNull();
        expect(resolvedAt! - startedAt).toBeLessThan(
          DEFAULT_BB_REQUEST_TIMEOUT_MS,
        );
        expect(statusTimeouts).toHaveLength(9);
        expect(statusTimeouts.some((timeout) => timeout < COMMAND_TIMEOUT_MS))
          .toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it("dispatches install/update by registered provider id", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "provider-installation-run-host",
      });
      const responder = registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: handleProviderInstallationRpc,
      });

      const response = await harness.app.request(
        `${API}/hosts/${host.id}/provider-clis/install`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            provider: "claude-code",
            actionKind: "update",
          }),
        },
      );

      expect(response.status).toBe(200);
      expect(await response.text()).toContain(
        '"type":"completed","provider":"claude-code"',
      );
      expect(responder.requests.at(-1)?.command).toMatchObject({
        type: "provider.installation.run",
        providerId: "claude-code",
        action: "update",
      });

      const unsupported = await harness.app.request(
        `${API}/hosts/${host.id}/provider-clis/install`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ provider: "pi", actionKind: "install" }),
        },
      );
      expect(unsupported.status).toBe(404);
      expect(await readJson(unsupported)).toMatchObject({
        code: "provider_installation_unavailable",
      });
    });
  });
});
