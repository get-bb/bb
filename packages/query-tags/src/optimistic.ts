import {
  notifyManager,
  replaceEqualDeep,
  type Query,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";

export interface TaggedOptimisticUpdate {
  queryKey: QueryKey;
  path: readonly string[];
  update(current: unknown): unknown;
}

export function optimisticQueryUpdate<Value>(
  queryKey: QueryKey,
  update: (current: Value) => Value,
  path: readonly string[] = [],
): TaggedOptimisticUpdate {
  return {
    queryKey,
    path: [...path],
    update: (current) => update(current as Value),
  };
}

type Prediction = {
  owner: object;
  order: number;
  path: readonly string[];
  value: unknown;
  acceptedAt: number | null;
  fresh: boolean;
  settled: boolean;
};
type PredictionState = { base: unknown; layers: Prediction[] };
const predictions = new WeakMap<Query, PredictionState>();
const receipts = new WeakMap<
  Query,
  {
    data: unknown;
    paths: readonly { path: readonly string[]; started: number }[];
  }
>();
let order = 0;

function valueAt(
  data: unknown,
  path: readonly string[],
): { value: unknown } | undefined {
  let value = data;
  for (const key of path) {
    if (
      typeof value !== "object" ||
      value === null ||
      !Object.hasOwn(value, key)
    )
      return;
    value = Reflect.get(value, key);
  }
  return value === undefined ? undefined : { value };
}

function replaceAt(
  data: unknown,
  path: readonly string[],
  value: unknown,
): unknown {
  const [key, ...rest] = path;
  if (key === undefined) return value;
  if (typeof data !== "object" || data === null) return data;
  const next = Array.isArray(data) ? [...data] : { ...data };
  Reflect.set(next, key, replaceAt(Reflect.get(data, key), rest, value));
  return next;
}

function prefix(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length <= right.length &&
    left.every((part, index) => part === right[index])
  );
}

function olderPending(state: PredictionState, layer: Prediction): boolean {
  return state.layers.some(
    (other) =>
      other.order < layer.order &&
      !other.settled &&
      (prefix(other.path, layer.path) || prefix(layer.path, other.path)),
  );
}

function projected(state: PredictionState): unknown {
  return state.layers.reduce(
    (data, layer) => replaceAt(data, layer.path, layer.value),
    state.base,
  );
}

function publish(query: Query, state: PredictionState): void {
  query.setState({
    data: replaceEqualDeep(query.state.data, projected(state)),
  });
  if (state.layers.length === 0) predictions.delete(query);
}

export function taggedReadReceipt(query: Query) {
  const paths: { path: readonly string[]; started: number }[] = [];
  return {
    start: () => ++order,
    record(started: number, loaded: readonly (readonly string[])[]) {
      paths.push(...loaded.map((path) => ({ path, started })));
    },
    commit(data: unknown) {
      receipts.set(query, { data, paths });
    },
  };
}

export function taggedStructuralSharing(
  client: QueryClient,
  queryKey: QueryKey,
  previous: unknown,
  next: unknown,
): unknown {
  const query = client
    .getQueryCache()
    .get(client.defaultQueryOptions({ queryKey }).queryHash);
  const state = query === undefined ? undefined : predictions.get(query);
  if (query !== undefined) {
    const receipt = receipts.get(query);
    if (receipt !== undefined && Object.is(receipt.data, next)) {
      receipts.delete(query);
      if (state !== undefined) {
        const refreshed = new Set<Prediction>();
        for (const layer of state.layers) {
          if (
            layer.acceptedAt !== null &&
            receipt.paths.some(
              ({ path, started }) =>
                started > layer.acceptedAt! && prefix(path, layer.path),
            )
          ) {
            layer.fresh = true;
            refreshed.add(layer);
          }
        }
        state.layers = state.layers.filter(
          (layer) =>
            !layer.settled ||
            !refreshed.has(layer) ||
            olderPending(state, layer),
        );
      }
    }
    if (state !== undefined) {
      state.base = next;
      next = projected(state);
      if (state.layers.length === 0) predictions.delete(query);
    }
  }
  const sharing = client.defaultQueryOptions({ queryKey }).structuralSharing;
  return sharing === false
    ? next
    : typeof sharing === "function"
      ? sharing(previous, next)
      : replaceEqualDeep(previous, next);
}

export function getTaggedReadData<Data>(
  client: QueryClient,
  queryKey: QueryKey,
): Data | undefined {
  const query = client
    .getQueryCache()
    .get(client.defaultQueryOptions({ queryKey }).queryHash);
  const state = query === undefined ? undefined : predictions.get(query);
  return (state === undefined ? query?.state.data : state.base) as
    | Data
    | undefined;
}

export function beginOptimisticMutation(
  client: QueryClient,
  updates: readonly TaggedOptimisticUpdate[],
) {
  const owner = {};
  const mutationOrder = ++order;
  let accepted = false;
  const affected = new Map<Query, PredictionState>();
  const rollback = () =>
    notifyManager.batch(() => {
      if (accepted) return;
      for (const [query, state] of affected) {
        state.layers = state.layers.filter((layer) => layer.owner !== owner);
        publish(query, state);
      }
    });
  try {
    notifyManager.batch(() => {
      for (const update of updates) {
        const query = client
          .getQueryCache()
          .get(
            client.defaultQueryOptions({ queryKey: update.queryKey }).queryHash,
          );
        if (query === undefined || query.state.data === undefined) continue;
        const state = predictions.get(query) ?? {
          base: query.state.data,
          layers: [],
        };
        const current = valueAt(projected(state), update.path);
        if (current === undefined) continue;
        const value = update.update(current.value);
        state.layers.push({
          owner,
          order: mutationOrder,
          path: update.path,
          value,
          acceptedAt: null,
          fresh: false,
          settled: false,
        });
        predictions.set(query, state);
        affected.set(query, state);
        publish(query, state);
      }
    });
  } catch (error) {
    rollback();
    throw error;
  }
  return {
    rollback,
    accept() {
      accepted = true;
      const acceptedAt = ++order;
      for (const state of affected.values())
        for (const layer of state.layers)
          if (layer.owner === owner) layer.acceptedAt = acceptedAt;
    },
    settle() {
      notifyManager.batch(() => {
        for (const [query, state] of affected) {
          state.layers = state.layers.filter((layer) => {
            if (layer.owner !== owner) return true;
            layer.settled = true;
            if (!layer.fresh) return true;
            if (!olderPending(state, layer)) return false;
            layer.value = valueAt(state.base, layer.path)?.value ?? layer.value;
            return true;
          });
          publish(query, state);
        }
      });
    },
  };
}
