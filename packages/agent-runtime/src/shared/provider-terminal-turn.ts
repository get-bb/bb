import type { ThreadEvent } from "@bb/domain";
import type { AcceptedUserMessageState } from "./accepted-user-messages.js";
import type {
  ProviderTurnState,
  ProviderTurnStateRegistry,
} from "./turn-state.js";

interface ResolveProviderTerminalTurnArgs<
  TState extends ProviderTurnState & AcceptedUserMessageState,
> {
  events: ThreadEvent[];
  registry: ProviderTurnStateRegistry<TState>;
  state: TState;
  threadId: string;
}

/**
 * Resolve the turn owned by a provider terminal signal. Accepted input can
 * finish before the provider emits an ordinary event that starts the turn.
 * The pending-input queue proves that the terminal signal still owns work;
 * once a turn starts or a session closes, that queue is drained instead.
 */
export function resolveProviderTerminalTurn<
  TState extends ProviderTurnState & AcceptedUserMessageState,
>(args: ResolveProviderTerminalTurnArgs<TState>): string | undefined {
  return (
    args.state.currentTurnId ??
    (args.state.pendingAcceptedUserMessages.length > 0
      ? args.registry.ensureTurnStarted(args)
      : undefined)
  );
}
