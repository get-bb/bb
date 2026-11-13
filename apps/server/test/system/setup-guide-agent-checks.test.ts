import type { ProviderHealth } from "@bb/host-daemon-contract";
import { getAppSettings, setAppSettings } from "@bb/db";
import { createDeferredPromise } from "@bb/test-helpers";
import { describe, expect, it } from "vitest";
import { getProviderStates } from "../../src/services/system/provider-states.js";
import { runSetupGuideAgentChecks } from "../../src/services/system/setup-guide-agent-checks.js";
import {
  registerHostRpcResponder,
  type HostRpcHandlerResult,
} from "../helpers/host-rpc.js";
import { seedHostSession } from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const INSTALLED_ONLY_PROVIDER_IDS = new Set([
  "acp-opencode",
  "acp-omp",
  "acp-grok",
  "acp-hermes-agent",
]);

function health(providerId: string): ProviderHealth {
  return {
    status: INSTALLED_ONLY_PROVIDER_IDS.has(providerId)
      ? "not_installed"
      : "ready",
    statusMessage: null,
    accountEmail: null,
    planLabel: null,
    installedVersion: "1.0.0",
    minimumSupportedVersion: null,
    canInstall: false,
    canUpdate: false,
    loginCommand: null,
  };
}

function healthAnswer(providerId: string): HostRpcHandlerResult {
  return { ok: true, result: { supported: true, health: health(providerId) } };
}

function connectHost(
  harness: TestAppHarness,
  answer: (
    providerId: string,
  ) => HostRpcHandlerResult | Promise<HostRpcHandlerResult> = healthAnswer,
) {
  const { host, session } = seedHostSession(harness.deps);
  const { requests } = registerHostRpcResponder(harness, {
    hostId: host.id,
    sessionId: session.id,
    handle: ({ command }) => {
      if (command.type !== "provider.health") {
        throw new Error(`Unexpected RPC command ${command.type}`);
      }
      return answer(command.providerId);
    },
  });
  const checkedProviderIds = () =>
    requests.flatMap(({ command }) =>
      command.type === "provider.health" ? [command.providerId] : [],
    );
  return { hostId: host.id, checkedProviderIds };
}

function countById(ids: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const id of ids) counts[id] = (counts[id] ?? 0) + 1;
  return counts;
}

describe("setup guide agent checks", () => {
  it("answers the guide's first agent list from the checks started when the computer connected", async () => {
    await withTestHarness(async (harness) => {
      const { hostId, checkedProviderIds } = connectHost(harness);

      const checks = runSetupGuideAgentChecks(harness.deps, hostId);
      const first = await getProviderStates(harness.deps, { hostId });
      await checks;

      expect(first.providers.map((state) => state.providerId)).toEqual([
        "codex",
        "claude-code",
        "pi",
        "acp-cursor",
      ]);
      expect(
        Object.values(countById(checkedProviderIds())).every(
          (count) => count === 1,
        ),
      ).toBe(true);

      const checkedBefore = checkedProviderIds().length;
      await getProviderStates(harness.deps, { hostId });
      expect(checkedProviderIds().length).toBeGreaterThan(checkedBefore);
    });
  });

  it("returns one agent's state as soon as its own connect-time check finishes", async () => {
    await withTestHarness(async (harness) => {
      const claude = createDeferredPromise<HostRpcHandlerResult>();
      const { hostId, checkedProviderIds } = connectHost(
        harness,
        (providerId) =>
          providerId === "claude-code"
            ? claude.promise
            : healthAnswer(providerId),
      );

      const checks = runSetupGuideAgentChecks(harness.deps, hostId);
      const codex = await getProviderStates(harness.deps, {
        hostId,
        providerId: "codex",
      });
      const hermes = await getProviderStates(harness.deps, {
        hostId,
        providerId: "acp-hermes-agent",
      });

      expect(codex.providers).toEqual([
        expect.objectContaining({ providerId: "codex", status: "ready" }),
      ]);
      expect(hermes.providers).toEqual([]);
      expect(countById(checkedProviderIds()).codex).toBe(1);

      claude.resolve(healthAnswer("claude-code"));
      await checks;
      expect(countById(checkedProviderIds())["claude-code"]).toBe(1);
    });
  });

  it("checks a single agent directly when no connect-time checks are held", async () => {
    await withTestHarness(async (harness) => {
      const { hostId, checkedProviderIds } = connectHost(harness);

      const result = await getProviderStates(harness.deps, {
        hostId,
        providerId: "pi",
      });

      expect(result.providers).toEqual([
        expect.objectContaining({ providerId: "pi", status: "ready" }),
      ]);
      expect(checkedProviderIds()).toEqual(["pi"]);
    });
  });

  it("does not check agents at connect once the setup guide is complete", async () => {
    await withTestHarness(async (harness) => {
      setAppSettings(harness.db, {
        ...getAppSettings(harness.db),
        onboardingCompletedAt: new Date().toISOString(),
      });
      const { hostId, checkedProviderIds } = connectHost(harness);

      await runSetupGuideAgentChecks(harness.deps, hostId);

      expect(checkedProviderIds()).toEqual([]);
    });
  });
});
