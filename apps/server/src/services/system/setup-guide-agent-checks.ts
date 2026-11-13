import { getAppSettings } from "@bb/db";
import type { LoggedWorkSessionDeps } from "../../types.js";
import type { ProviderRegistryService } from "../providers/provider-registry.js";
import { runtimeErrorLogFields } from "../lib/error-log-fields.js";
import { checkProviderStatesForNextRead } from "./provider-states.js";

export const SETUP_GUIDE_AGENT_CHECKS_HOLD_MS = 30_000;

interface SetupGuideAgentChecks {
  sessionId: string;
  settled: Promise<void>;
}

const checksByRegistry = new WeakMap<
  ProviderRegistryService,
  Map<string, SetupGuideAgentChecks>
>();

export function runSetupGuideAgentChecks(
  deps: LoggedWorkSessionDeps,
  hostId: string,
): Promise<void> {
  if (getAppSettings(deps.db).onboardingCompletedAt !== null) {
    return Promise.resolve();
  }
  const sessionId = deps.hub.getDaemonSessionIdForHost(hostId);
  if (sessionId === null) return Promise.resolve();
  let checksByHost = checksByRegistry.get(deps.providerRegistry);
  if (checksByHost === undefined) {
    checksByHost = new Map();
    checksByRegistry.set(deps.providerRegistry, checksByHost);
  }
  const existing = checksByHost.get(hostId);
  if (existing?.sessionId === sessionId) return existing.settled;
  const startedAt = Date.now();
  const settled = checkProviderStatesForNextRead(deps, {
    hostId,
    sessionId,
    holdMs: SETUP_GUIDE_AGENT_CHECKS_HOLD_MS,
  }).then(
    (states) => {
      deps.logger.info(
        {
          hostId,
          providerCount: states.length,
          durationMs: Date.now() - startedAt,
        },
        "Setup guide agent checks finished",
      );
    },
    (error: unknown) => {
      deps.logger.warn(
        { hostId, ...runtimeErrorLogFields(deps.config, error) },
        "Setup guide agent checks failed",
      );
    },
  );
  checksByHost.set(hostId, { sessionId, settled });
  return settled;
}
