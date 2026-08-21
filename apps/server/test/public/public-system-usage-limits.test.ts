import type {
  ProviderUsage,
  ProviderUsageResponse,
} from "@bb/host-daemon-contract";
import { describe, expect, it } from "vitest";
import { registerHostRpcResponder } from "../helpers/host-rpc.js";
import { readJson } from "../helpers/json.js";
import { seedHost, seedHostSession, seedPrimaryHost } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

const USAGE_RESPONSE: ProviderUsageResponse = {
  codex: {
    status: "ok",
    accountEmail: "codex@example.com",
    planLabel: "Plus",
    windows: [{ label: "5-hour", usedPercent: 42, resetsAt: null }],
  },
  "claude-code": { status: "unauthenticated" },
  "acp-cursor": { status: "unauthenticated" },
};

function providerUsage(providerId: string): ProviderUsage | null {
  return USAGE_RESPONSE[providerId] ?? null;
}

function handleUsageRequest(
  request: Parameters<
    Parameters<typeof registerHostRpcResponder>[1]["handle"]
  >[0],
) {
  if (request.command.type === "provider.health") {
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
  if (request.command.type === "provider.usage") {
    const usage = providerUsage(request.command.providerId);
    return usage === null
      ? { ok: true as const, result: { supported: false as const } }
      : {
          ok: true as const,
          result: { supported: true as const, usage },
        };
  }
  throw new Error(`Unexpected command ${request.command.type}`);
}

describe("GET /api/v1/system/usage-limits", () => {
  it("does not start a usage probe the provider did not declare", async () => {
    await withTestHarness(async (harness) => {
      harness.deps.providerRegistry.register({
        pluginId: "provider-no-usage",
        info: {
          id: "no-usage",
          displayName: "No Usage",
          logoUrl: null,
          available: true,
          experimental_providerHealth: false,
          experimental_providerUsage: false,
          experimental_providerInstallation: false,
          capabilities: {
            supportsThreadArchive: false,
            supportsThreadRename: false,
            supportsServiceTier: false,
            supportsNativeUserQuestion: false,
            supportsFork: false,
            supportsSessionRewind: false,
            permissionModes: ["full"],
          },
          composerActions: [],
        },
        serverCapabilities: {
          reasoningLevels: ["medium"],
          fork: "none",
          supportsManualCompaction: false,
        },
      });
      const primary = seedHostSession(harness.deps, { id: "host-primary" });
      seedPrimaryHost(harness.deps, primary.host.id);
      const responder = registerHostRpcResponder(harness, {
        hostId: primary.host.id,
        sessionId: primary.session.id,
        handle: handleUsageRequest,
      });

      const response = await harness.app.request("/api/v1/system/usage-limits");

      expect(response.status).toBe(200);
      expect(await readJson(response)).toEqual(USAGE_RESPONSE);
      expect(
        responder.requests.some(
          (request) =>
            request.command.type === "provider.usage" &&
            request.command.providerId === "no-usage",
        ),
      ).toBe(false);
      expect(
        responder.requests.some(
          (request) => request.command.type === "provider.health",
        ),
      ).toBe(false);
    });
  });

  it("loads one provider without waiting for its peers", async () => {
    await withTestHarness(async (harness) => {
      const primary = seedHostSession(harness.deps, { id: "host-primary" });
      seedPrimaryHost(harness.deps, primary.host.id);
      const responder = registerHostRpcResponder(harness, {
        hostId: primary.host.id,
        sessionId: primary.session.id,
        handle: handleUsageRequest,
      });

      const response = await harness.app.request(
        "/api/v1/system/usage-limits?providerId=codex",
      );

      expect(response.status).toBe(200);
      expect(await readJson(response)).toEqual({ codex: USAGE_RESPONSE.codex });
      expect(
        responder.requests.flatMap((request) =>
          request.command.type === "provider.usage"
            ? [request.command.providerId]
            : [],
        ),
      ).toEqual(["codex"]);
      expect(
        responder.requests.some(
          (request) => request.command.type === "provider.health",
        ),
      ).toBe(false);
    });
  });

  it("continues to use the primary machine when no host is selected", async () => {
    await withTestHarness(async (harness) => {
      const primary = seedHostSession(harness.deps, { id: "host-primary" });
      seedPrimaryHost(harness.deps, primary.host.id);
      const responder = registerHostRpcResponder(harness, {
        hostId: primary.host.id,
        sessionId: primary.session.id,
        handle: handleUsageRequest,
      });

      const response = await harness.app.request("/api/v1/system/usage-limits");

      expect(response.status).toBe(200);
      expect(await readJson(response)).toEqual(USAGE_RESPONSE);
      expect(
        responder.requests.flatMap((request) =>
          request.command.type === "provider.usage"
            ? [request.command.providerId]
            : [],
        ),
      ).toEqual(["codex", "claude-code", "acp-cursor"]);
    });
  });

  it("routes an explicit machine selection to that host daemon", async () => {
    await withTestHarness(async (harness) => {
      const primary = seedHost(harness.deps, { id: "host-primary" });
      seedPrimaryHost(harness.deps, primary.id);
      const remote = seedHostSession(harness.deps, {
        id: "host-remote",
        name: "builder",
      });
      const responder = registerHostRpcResponder(harness, {
        hostId: remote.host.id,
        sessionId: remote.session.id,
        handle: handleUsageRequest,
      });

      const response = await harness.app.request(
        `/api/v1/system/usage-limits?hostId=${remote.host.id}`,
      );

      expect(response.status).toBe(200);
      expect(await readJson(response)).toEqual(USAGE_RESPONSE);
      expect(
        responder.requests.flatMap((request) =>
          request.command.type === "provider.usage"
            ? [request.command.providerId]
            : [],
        ),
      ).toEqual(["codex", "claude-code", "acp-cursor"]);
    });
  });
});
