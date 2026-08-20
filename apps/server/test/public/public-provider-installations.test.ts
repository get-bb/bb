import type {
  HostDaemonOnlineRpcRequestMessage,
  ProviderCliStatusResponse,
} from "@bb/host-daemon-contract";
import { describe, expect, it } from "vitest";
import { registerHostRpcResponder } from "../helpers/host-rpc.js";
import { readJson } from "../helpers/json.js";
import { seedHostSession } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

const API = "/api/v1";

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
  if (command.type === "known_acp_agents.status") {
    return { ok: true as const, result: { agents: [] } };
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
