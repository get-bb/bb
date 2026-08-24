import type { ProviderComposerCommand } from "@bb/domain";
import type { ProviderRegistryService } from "./provider-registry.js";

/**
 * The provider's declared `plan` composer command, or null when it declares no
 * plan action. This is the single answer for plan-mode eligibility: the
 * timeline projection and the thread-list banner pre-filter both read it
 * instead of repeating a `claude-code || codex` test.
 *
 * An id with no registration answers null — a provider whose plugin is
 * disabled mid-thread offers no plan action, which is the safe reading.
 */
export function resolveProviderPlanCommand(
  registry: ProviderRegistryService,
  providerId: string,
): ProviderComposerCommand | null {
  const action = registry
    .get(providerId)
    ?.info.composerActions.find((entry) => entry.kind === "plan");
  return action?.kind === "plan" ? action.command : null;
}
