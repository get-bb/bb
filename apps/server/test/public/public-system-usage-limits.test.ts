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
  if (request.command.type === "known_acp_agents.status") {
    return {
      ok: true as const,
      result: {
        agents: request.command.agents.map((agent) => ({
          ...agent,
          installed: false,
          executablePath: null,
        })),
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
      expect(responder.requests).toHaveLength(5);
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
      expect(responder.requests.map((request) => request.command.type)).toEqual(
        [
          "known_acp_agents.status",
          "provider.usage",
          "provider.usage",
          "provider.usage",
          "provider.usage",
        ],
      );
    });
  });
});
