import type {
  ThreadEvent,
  ThreadEventItem,
  ThreadEventTokenUsageBreakdown,
} from "@bb/domain";
import { threadScope, turnScope } from "@bb/domain";
import {
  getOrCreateScopedItemId,
  resolveCompletedScopedItemId,
} from "./scoped-item-ids.js";
import { UNSTAMPED_THREAD_ID } from "./unstamped-thread-id.js";

const DEFAULT_PROVIDER_TURN_STATE_MAX_ENTRIES = 256;
const DEFAULT_PROVIDER_TURN_ID_PREFIX = "turn-";

export interface ProviderTurnState {
  assistantMessageCounter: number;
  counter: number;
  currentTurnId: string | undefined;
  cumulativeTokens: ThreadEventTokenUsageBreakdown;
  openAssistantMessageIdsByScope: Map<string, string>;
  openReasoningItemIdsByScope: Map<string, string>;
  toolItemsByCallId: Map<string, ThreadEventItem>;
}

export interface CreateProviderTurnStateRegistryOptions<
  TState extends ProviderTurnState,
> {
  createState: () => TState;
  /**
   * When provided, idle entries for which this returns false are skipped by
   * LRU pruning — e.g. threads whose state tracks open background tasks that
   * outlive turns. Entries with an active turn are never pruned regardless.
   */
  isEvictable?: (state: TState) => boolean;
  maxEntries?: number;
  onTurnFinish?: (args: FinishProviderTurnArgs<TState>) => void;
  onTurnStart?: (
    args: EnsureProviderTurnStartedArgs<TState> & { turnId: string },
  ) => void;
  turnIdPrefix?: string;
}

export interface ProviderTurnStateRegistry<TState extends ProviderTurnState> {
  buildErrorEvents(args: BuildProviderErrorEventsArgs): ThreadEvent[];
  ensureTurnStarted(args: EnsureProviderTurnStartedArgs<TState>): string;
  finishTurn(args: FinishProviderTurnArgs<TState>): void;
  get(args: GetProviderTurnStateArgs): TState | null;
  getCurrentOrLastTurnId(
    args: GetCurrentOrLastProviderTurnIdArgs<TState>,
  ): string;
  getOrCreate(args: GetProviderTurnStateArgs): TState;
  getOrCreateAssistantMessageId(
    args: GetOrCreateAssistantMessageIdArgs<TState>,
  ): string;
  resolveCompletedAssistantMessageId(
    args: ResolveCompletedAssistantMessageIdArgs<TState>,
  ): string;
}

export interface EnsureProviderTurnStartedArgs<
  TState extends ProviderTurnState,
> {
  events: ThreadEvent[];
  state: TState;
  threadId: string;
}

export interface FinishProviderTurnArgs<TState extends ProviderTurnState> {
  state: TState;
  threadId: string;
}

export interface BuildProviderErrorEventsArgs {
  contextThreadId?: string;
  detail: string;
}

export interface GetProviderTurnStateArgs {
  threadId: string;
}

export interface FinishOpenProviderTurnArgs<TState extends ProviderTurnState> {
  registry: ProviderTurnStateRegistry<TState>;
  threadId: string;
}

export interface GetCurrentOrLastProviderTurnIdArgs<
  TState extends ProviderTurnState,
> {
  state: TState;
}

export interface GetOrCreateAssistantMessageIdArgs<
  TState extends ProviderTurnState,
> {
  assistantIdPrefix: string;
  parentToolCallId?: string;
  state: TState;
}

export interface ResolveCompletedAssistantMessageIdArgs<
  TState extends ProviderTurnState,
> {
  assistantIdPrefix: string;
  parentToolCallId?: string;
  providerMessageId?: string;
  state: TState;
}

interface ProviderTurnStateRegistryEntry<TState extends ProviderTurnState> {
  state: TState;
}

export function createProviderTurnStateRegistry<
  TState extends ProviderTurnState,
>(
  options: CreateProviderTurnStateRegistryOptions<TState>,
): ProviderTurnStateRegistry<TState> {
  const entries = new Map<string, ProviderTurnStateRegistryEntry<TState>>();
  const maxEntries =
    options.maxEntries ?? DEFAULT_PROVIDER_TURN_STATE_MAX_ENTRIES;
  const turnIdPrefix = options.turnIdPrefix ?? DEFAULT_PROVIDER_TURN_ID_PREFIX;

  function createTurnId(counter: number): string {
    return `${turnIdPrefix}${counter}`;
  }

  function clearTransientTurnState(state: TState): void {
    state.openAssistantMessageIdsByScope.clear();
    state.openReasoningItemIdsByScope.clear();
    state.toolItemsByCallId.clear();
  }

  function touchEntry(
    args: GetProviderTurnStateArgs,
  ): ProviderTurnStateRegistryEntry<TState> | undefined {
    const existing = entries.get(args.threadId);
    if (!existing) {
      return undefined;
    }
    entries.delete(args.threadId);
    entries.set(args.threadId, existing);
    return existing;
  }

  function pruneInactiveEntries(): void {
    while (entries.size > maxEntries) {
      let removed = false;
      for (const [threadId, entry] of entries) {
        if (entry.state.currentTurnId !== undefined) {
          continue;
        }
        if (options.isEvictable?.(entry.state) === false) {
          continue;
        }
        entries.delete(threadId);
        removed = true;
        break;
      }
      if (!removed) {
        return;
      }
    }
  }

  function createAssistantMessageId(
    args: GetOrCreateAssistantMessageIdArgs<TState>,
  ): string {
    args.state.assistantMessageCounter += 1;
    return `${args.assistantIdPrefix}-${args.state.assistantMessageCounter}`;
  }

  function ensureTurnStarted(
    args: EnsureProviderTurnStartedArgs<TState>,
  ): string {
    if (!args.state.currentTurnId) {
      clearTransientTurnState(args.state);
      args.state.counter += 1;
      args.state.currentTurnId = createTurnId(args.state.counter);
      args.events.push({
        type: "turn/started",
        threadId: args.threadId,
        providerThreadId: "",
        scope: turnScope(args.state.currentTurnId),
      });
      options.onTurnStart?.({ ...args, turnId: args.state.currentTurnId });
    }
    return args.state.currentTurnId;
  }

  function finishTurn(args: FinishProviderTurnArgs<TState>): void {
    options.onTurnFinish?.(args);
    clearTransientTurnState(args.state);
    args.state.currentTurnId = undefined;
    touchEntry({ threadId: args.threadId });
    pruneInactiveEntries();
  }

  function getOrCreate(args: GetProviderTurnStateArgs): TState {
    const existing = touchEntry(args);
    if (existing) {
      return existing.state;
    }
    const entry = { state: options.createState() };
    entries.set(args.threadId, entry);
    pruneInactiveEntries();
    return entry.state;
  }

  function buildErrorEvents(args: BuildProviderErrorEventsArgs): ThreadEvent[] {
    const events: ThreadEvent[] = [];
    const stateKey = args.contextThreadId;
    const state = stateKey ? getOrCreate({ threadId: stateKey }) : null;
    const turnId = state
      ? ensureTurnStarted({
          events,
          state,
          threadId: UNSTAMPED_THREAD_ID,
        })
      : undefined;

    events.push({
      type: "provider/error",
      threadId: UNSTAMPED_THREAD_ID,
      providerThreadId: "",
      scope: turnId ? turnScope(turnId) : threadScope(),
      message: "Provider error",
      detail: args.detail,
    });

    if (stateKey && state && turnId) {
      events.push({
        type: "turn/completed",
        threadId: UNSTAMPED_THREAD_ID,
        providerThreadId: "",
        scope: turnScope(turnId),
        status: "failed",
      });
      finishTurn({ state, threadId: stateKey });
    }
    return events;
  }

  return {
    buildErrorEvents,
    ensureTurnStarted,
    finishTurn,

    get(args) {
      return touchEntry(args)?.state ?? null;
    },

    getCurrentOrLastTurnId(args) {
      return (
        args.state.currentTurnId ??
        (args.state.counter > 0 ? createTurnId(args.state.counter) : "")
      );
    },

    getOrCreate,
    getOrCreateAssistantMessageId(args) {
      return getOrCreateScopedItemId({
        createItemId: () => createAssistantMessageId(args),
        openItemIdsByScope: args.state.openAssistantMessageIdsByScope,
        parentToolCallId: args.parentToolCallId,
        scopeId: "assistant",
      });
    },

    resolveCompletedAssistantMessageId(args) {
      return resolveCompletedScopedItemId({
        createItemId: () => createAssistantMessageId(args),
        openItemIdsByScope: args.state.openAssistantMessageIdsByScope,
        parentToolCallId: args.parentToolCallId,
        providerItemId: args.providerMessageId,
        scopeId: "assistant",
      });
    },
  };
}

export function finishOpenProviderTurn<TState extends ProviderTurnState>(
  args: FinishOpenProviderTurnArgs<TState>,
): void {
  const state = args.registry.getOrCreate({ threadId: args.threadId });
  if (!state.currentTurnId) {
    return;
  }
  args.registry.finishTurn({ state, threadId: args.threadId });
}
