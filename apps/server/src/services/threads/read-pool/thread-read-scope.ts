import { getThreadEventRewriteGeneration } from "@bb/db";
import type { AppDeps } from "../../../types.js";
import { resolveProviderPlanCommand } from "../../providers/provider-plan-command.js";
import type {
  ThreadReadProviderFacts,
  ThreadReadScope,
} from "./thread-read.js";

type ProviderRegistry = AppDeps["providerRegistry"];

const providerFactsByRegistry = new WeakMap<
  ProviderRegistry,
  { revision: number; providers: Record<string, ThreadReadProviderFacts> }
>();

function providerFacts(
  registry: ProviderRegistry,
): Record<string, ThreadReadProviderFacts> {
  const revision = registry.getRegistrationRevision();
  const cached = providerFactsByRegistry.get(registry);
  if (cached?.revision === revision) return cached.providers;
  const providers: Record<string, ThreadReadProviderFacts> = {};
  for (const { info } of registry.list()) {
    providers[info.id] = {
      completedTurnDisplay: info.completedTurnDisplay,
      displayName: info.displayName,
      extensionStateKinds: Object.entries(info.extensionKinds ?? {}).flatMap(
        ([kind, declared]) => (declared.state ? [kind] : []),
      ),
      planCommand: resolveProviderPlanCommand(registry, info.id),
      supportsManualCompaction: registry.supportsManualCompaction(info.id),
    };
  }
  providerFactsByRegistry.set(registry, { revision, providers });
  return providers;
}

export function resolveThreadReadScope(
  deps: Pick<AppDeps, "providerRegistry">,
  threadId: string,
): ThreadReadScope {
  return {
    providers: providerFacts(deps.providerRegistry),
    rewriteGeneration: getThreadEventRewriteGeneration(threadId),
    threadId,
  };
}
