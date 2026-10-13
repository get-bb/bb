import type {
  ProviderUsage,
  ProviderUsageResponse,
} from "@bb/host-daemon-contract";
import { describe, expect, it } from "vitest";
import { registerHostRpcResponder } from "../helpers/host-rpc.js";
import { readJson } from "../helpers/json.js";
import { minimalProviderRegistration } from "../helpers/provider-registry.js";
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
  it("shares concurrent usage requests but refreshes on explicit reload and reconnect", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "shared-usage",
      });
      const responder = registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        async handle(request) {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return handleUsageRequest(request);
        },
      });
      const read = async (refresh = false) => {
        const response = await harness.app.request(
          `/api/v1/system/usage-limits?hostId=${host.id}&refresh=${refresh}`,
        );
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual(USAGE_RESPONSE);
      };
      const count = () =>
        responder.requests.filter(
          (request) => request.command.type === "provider.usage",
        ).length;
      try {
        await Promise.all(Array.from({ length: 8 }, read));
        expect(count()).toBe(3);
        await read();
        expect(count()).toBe(3);
        await Promise.all(Array.from({ length: 8 }, () => read(true)));
        expect(count()).toBe(6);
        await read();
        expect(count()).toBe(6);
        harness.hub.notifyHost(host.id, ["host-connected"]);
        await read();
        expect(count()).toBe(9);
      } finally {
        responder.unregister();
      }
    });
  });

  it("retries provider usage errors instead of retaining them", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "retry-usage",
      });
      let probes = 0;
      const responder = registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle(request) {
          if (request.command.type === "provider.usage" && ++probes === 1) {
            return {
              ok: true,
              result: {
                supported: true,
                usage: {
                  status: "error",
                  message: "offline",
                  accountEmail: null,
                  planLabel: null,
                },
              },
            };
          }
          return handleUsageRequest(request);
        },
      });
      try {
        const url = `/api/v1/system/usage-limits?hostId=${host.id}&providerId=codex`;
        const failed = await harness.app.request(url);
        expect(await failed.json()).toEqual({
          codex: {
            status: "error",
            message: "offline",
            accountEmail: null,
            planLabel: null,
          },
        });
        const recovered = await harness.app.request(url);
        expect(await recovered.json()).toEqual({ codex: USAGE_RESPONSE.codex });
        expect(probes).toBe(2);
      } finally {
        responder.unregister();
      }
    });
  });

  it("does not start a usage probe the provider did not declare", async () => {
    await withTestHarness(async (harness) => {
      harness.deps.providerRegistry.register(
        minimalProviderRegistration({
          pluginId: "provider-no-usage",
          info: {
            id: "no-usage",
            pluginId: "provider-no-usage",
            displayName: "No Usage",
            logoUrl: null,
            available: true,
            maintenance: { health: false, usage: false, installation: false },
            capabilities: {
              supportsThreadArchive: false,
              supportsThreadRename: false,
              supportsServiceTier: false,
              supportsNativeUserQuestion: false,
              supportsFork: false,
              supportsSessionRewind: false,
              modelCatalogScope: "workspace",
              permissionModes: ["full"],
            },
            composerActions: [],
            completedTurnDisplay: "collapse",
          },
          serverCapabilities: {
            reasoningLevels: ["medium"],
            fork: "none",
            supportsManualCompaction: false,
          },
        }),
      );
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
        responder.requests.flatMap((request) =>
          request.command.type === "provider.health"
            ? [request.command.providerId]
            : [],
        ),
      ).toEqual(["acp-opencode"]);
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
