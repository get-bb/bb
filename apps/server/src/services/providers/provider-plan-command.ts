import type { PromptInput, ProviderComposerCommand } from "@bb/domain";
import { ApiError } from "../../errors.js";
import type { ProviderRegistryService } from "./provider-registry.js";

export function resolveProviderPlanCommand(
  registry: ProviderRegistryService,
  providerId: string,
): ProviderComposerCommand | null {
  const action = registry
    .get(providerId)
    ?.info.composerActions.find((entry) => entry.kind === "plan");
  return action?.kind === "plan" ? action.command : null;
}

export function assertProviderAcceptsPromptActions(
  registry: ProviderRegistryService,
  args: { input: readonly PromptInput[]; providerId: string },
): void {
  const requestsPlan = args.input.some(
    (item) =>
      item.type === "text" &&
      item.mentions.some(
        (mention) =>
          mention.resource.kind === "command" &&
          mention.resource.origin === "builtin" &&
          mention.resource.trigger === "/" &&
          mention.resource.name === "plan",
      ),
  );
  if (
    !requestsPlan ||
    resolveProviderPlanCommand(registry, args.providerId) !== null
  ) {
    return;
  }
  const displayName =
    registry.get(args.providerId)?.info.displayName ?? args.providerId;
  throw new ApiError(
    400,
    "invalid_request",
    `${displayName} has no plan mode, so this message cannot be sent as a plan request. Send it without --plan.`,
  );
}
