export interface GetOrCreateScopedItemIdArgs {
  createItemId: () => string;
  openItemIdsByScope: Map<string, string>;
  parentToolCallId?: string;
  scopeId: string;
}

export interface ResolveCompletedScopedItemIdArgs {
  createItemId: () => string;
  openItemIdsByScope: Map<string, string>;
  parentToolCallId?: string;
  providerItemId?: string;
  scopeId: string;
}

interface CounterScopedItemIdState {
  openReasoningItemIdsByScope: Map<string, string>;
  reasoningItemCounter: number;
}

interface CounterScopedItemIdArgs<TState extends CounterScopedItemIdState> {
  parentToolCallId?: string;
  providerItemId?: string;
  scopeId: string | number;
  state: TState;
}

function toScopedItemKey(
  parentToolCallId: string | undefined,
  scopeId: string,
): string {
  return `${parentToolCallId ?? "root"}:${scopeId}`;
}

export function getOrCreateScopedItemId(
  args: GetOrCreateScopedItemIdArgs,
): string {
  const scopeKey = toScopedItemKey(args.parentToolCallId, args.scopeId);
  const existing = args.openItemIdsByScope.get(scopeKey);
  if (existing) {
    return existing;
  }

  const itemId = args.createItemId();
  args.openItemIdsByScope.set(scopeKey, itemId);
  return itemId;
}

export function resolveCompletedScopedItemId(
  args: ResolveCompletedScopedItemIdArgs,
): string {
  const scopeKey = toScopedItemKey(args.parentToolCallId, args.scopeId);
  const existing = args.openItemIdsByScope.get(scopeKey);
  if (existing) {
    args.openItemIdsByScope.delete(scopeKey);
    return existing;
  }

  return args.providerItemId ?? args.createItemId();
}

export function createScopedItemIdFactory(args: { prefix: string }) {
  const createId = (scopeId?: string | number): string => {
    const suffix = scopeId === undefined ? "" : String(scopeId);
    return suffix.length > 0 ? `${args.prefix}-${suffix}` : args.prefix;
  };
  const createCounterId = <TState extends CounterScopedItemIdState>(
    state: TState,
  ): string => {
    state.reasoningItemCounter += 1;
    return createId(state.reasoningItemCounter);
  };
  return {
    createId,
    getOrCreate<TState extends CounterScopedItemIdState>(
      item: CounterScopedItemIdArgs<TState>,
    ): string {
      return getOrCreateScopedItemId({
        createItemId: () => createCounterId(item.state),
        openItemIdsByScope: item.state.openReasoningItemIdsByScope,
        parentToolCallId: item.parentToolCallId,
        scopeId: String(item.scopeId),
      });
    },
    resolveCompleted<TState extends CounterScopedItemIdState>(
      item: CounterScopedItemIdArgs<TState>,
    ): string {
      return resolveCompletedScopedItemId({
        createItemId: () => createCounterId(item.state),
        openItemIdsByScope: item.state.openReasoningItemIdsByScope,
        parentToolCallId: item.parentToolCallId,
        providerItemId: item.providerItemId,
        scopeId: String(item.scopeId),
      });
    },
  };
}
