import {
  matchQuery,
  notifyManager,
  replaceEqualDeep,
  type Query,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { tick } from "./clock.js";
import { predictKeyed, type KeyedCollection } from "./keyed-store.js";

export interface TaggedOptimisticUpdate {
  queryKey: QueryKey;
  path: readonly string[];
  update(current: unknown, result: { value: unknown } | undefined): unknown;
}

export interface KeyedOptimisticUpdate {
  collection: KeyedCollection<unknown>;
  key: string;
  update(current: unknown, result: { value: unknown } | undefined): unknown;
}

export type OptimisticUpdate = TaggedOptimisticUpdate | KeyedOptimisticUpdate;

export function optimisticKeyedUpdate<Entity, Result = unknown>(
  collection: KeyedCollection<Entity>,
  key: string,
  update: (current: Entity, result: { value: Result } | undefined) => Entity,
): KeyedOptimisticUpdate {
  return {
    collection,
    key,
    update: (current, result) =>
      update(current as Entity, result as { value: Result } | undefined),
  };
}

export function optimisticQueryUpdate<Value, Result = unknown>(
  queryKey: QueryKey,
  update: (current: Value, result: { value: Result } | undefined) => Value,
  path: readonly string[] = [],
): TaggedOptimisticUpdate {
  return {
    queryKey,
    path: [...path],
    update: (current, result) =>
      update(current as Value, result as { value: Result } | undefined),
  };
}

type Prediction = {
  owner: object;
  order: number;
  path: readonly string[];
  initial: unknown;
  update(current: unknown): unknown;
  acceptedAt: number | null;
  fresh: boolean;
  settled: boolean;
};
type PredictionState = {
  client: QueryClient;
  base: unknown;
  visible: unknown;
  layers: Prediction[];
  guards: Prediction[];
};
type Receipt = {
  data: unknown;
  started: number;
};
const predictions = new WeakMap<Query, PredictionState>();
const receipts = new WeakMap<Query, Receipt>();
const taggedMeta = new WeakSet<object>();
const syncedClients = new WeakMap<
  QueryClient,
  { queries: Set<Query>; unsubscribe: () => void }
>();

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

function confirmedValue(
  current: unknown,
  predicted: unknown,
  confirmed: unknown,
): unknown {
  if (Object.is(predicted, confirmed)) return current;
  if (
    typeof current !== "object" ||
    current === null ||
    typeof predicted !== "object" ||
    predicted === null ||
    typeof confirmed !== "object" ||
    confirmed === null ||
    Array.isArray(predicted) !== Array.isArray(confirmed) ||
    (Array.isArray(predicted) &&
      (!Array.isArray(confirmed) || predicted.length !== confirmed.length))
  )
    return confirmed;
  const next = Array.isArray(current) ? [...current] : { ...current };
  for (const key of new Set([
    ...Object.keys(predicted),
    ...Object.keys(confirmed),
  ])) {
    if (!Object.hasOwn(confirmed, key)) Reflect.deleteProperty(next, key);
    else
      Reflect.set(
        next,
        key,
        confirmedValue(
          Reflect.get(current, key),
          Reflect.get(predicted, key),
          Reflect.get(confirmed, key),
        ),
      );
  }
  return next;
}

function rebase(base: unknown, visible: unknown, next: unknown): unknown {
  if (Object.is(visible, next)) return base;
  if (
    typeof base !== "object" ||
    base === null ||
    typeof visible !== "object" ||
    visible === null ||
    typeof next !== "object" ||
    next === null ||
    Array.isArray(base) ||
    Array.isArray(visible) ||
    Array.isArray(next)
  )
    return next;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(base))
    if (!Object.hasOwn(visible, key) && !Object.hasOwn(next, key))
      result[key] = Reflect.get(base, key);
  for (const key of Object.keys(next))
    result[key] =
      Object.hasOwn(visible, key) && Object.hasOwn(base, key)
        ? rebase(
            Reflect.get(base, key),
            Reflect.get(visible, key),
            Reflect.get(next, key),
          )
        : Reflect.get(next, key);
  return result;
}

function projected(state: PredictionState): unknown {
  return state.layers.reduce((data, layer) => {
    const current = valueAt(data, layer.path);
    return replaceAt(
      data,
      layer.path,
      layer.update(current === undefined ? layer.initial : current.value),
    );
  }, state.base);
}

const predictionListeners = new WeakMap<Query, Set<() => void>>();

export function subscribeOptimisticQuery(
  query: Query | undefined,
  listener: () => void,
) {
  if (query === undefined) return () => {};
  let listeners = predictionListeners.get(query);
  if (listeners === undefined) {
    listeners = new Set();
    predictionListeners.set(query, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) predictionListeners.delete(query);
  };
}

function isTaggedQuery(query: Query): boolean {
  return query.meta !== undefined && taggedMeta.has(query.meta);
}

function applyLayer(data: unknown, layer: Prediction): unknown {
  const current = valueAt(data, layer.path);
  return replaceAt(
    data,
    layer.path,
    layer.update(current === undefined ? layer.initial : current.value),
  );
}

function confirmLayers(
  query: Query,
  state: PredictionState,
  ready: (layer: Prediction) => boolean,
): void {
  const tagged = isTaggedQuery(query);
  while (state.layers[0] !== undefined && ready(state.layers[0])) {
    const layer = state.layers.shift()!;
    state.base = applyLayer(state.base, layer);
    if (tagged && !layer.fresh) state.guards.push(layer);
  }
}

function confirmBeforeWrite(query: Query, state: PredictionState): void {
  confirmLayers(query, state, (layer) => layer.acceptedAt !== null);
}

function isIdle(state: PredictionState): boolean {
  return state.layers.length === 0 && state.guards.length === 0;
}

function untrack(query: Query, state: PredictionState): void {
  predictions.delete(query);
  const synced = syncedClients.get(state.client);
  if (synced === undefined) return;
  synced.queries.delete(query);
  if (synced.queries.size === 0) {
    synced.unsubscribe();
    syncedClients.delete(state.client);
  }
}

function track(query: Query, state: PredictionState): void {
  predictions.set(query, state);
  let synced = syncedClients.get(state.client);
  if (synced === undefined) {
    const queries = new Set<Query>();
    const unsubscribe = state.client.getQueryCache().subscribe((event) => {
      if (event.type !== "updated" || event.action.type !== "success") return;
      const current = predictions.get(event.query);
      if (current === undefined || isTaggedQuery(event.query)) return;
      const data = event.query.state.data;
      if (event.action.manual) {
        confirmBeforeWrite(event.query, current);
        current.base = rebase(current.base, current.visible, data);
      } else {
        current.base = data;
      }
      publish(event.query, current);
    });
    synced = { queries, unsubscribe };
    syncedClients.set(state.client, synced);
  }
  synced.queries.add(query);
}

function publish(query: Query, state: PredictionState): void {
  if (!isTaggedQuery(query))
    confirmLayers(query, state, (layer) => layer.settled);
  const data = replaceEqualDeep(query.state.data, projected(state));
  state.visible = data;
  query.setState({ data });
  if (isIdle(state)) untrack(query, state);
  for (const listener of predictionListeners.get(query) ?? []) listener();
}

export function markTaggedQueryMeta(meta: object): void {
  taggedMeta.add(meta);
}

export function commitTaggedReadReceipt(
  query: Query,
  data: unknown,
  started: number,
): void {
  receipts.set(query, { data, started });
}

function consumeReceipt(query: Query, next: unknown): Receipt | undefined {
  const receipt = receipts.get(query);
  if (receipt === undefined || !Object.is(receipt.data, next)) return;
  receipts.delete(query);
  return receipt;
}

function refreshedBy(receipt: Receipt, layer: Prediction): boolean {
  return layer.acceptedAt !== null && receipt.started > layer.acceptedAt;
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
  if (query !== undefined && Object.is(previous, query.state.data)) {
    const receipt = consumeReceipt(query, next);
    const state = predictions.get(query);
    if (state !== undefined) {
      if (receipt !== undefined) {
        const refreshed = new Set<Prediction>();
        for (const layer of state.layers) {
          if (refreshedBy(receipt, layer)) {
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
      if (receipt !== undefined) {
        state.guards = state.guards.filter(
          (guard) => !refreshedBy(receipt, guard),
        );
        state.base = state.guards.reduce(applyLayer, next);
      } else {
        confirmBeforeWrite(query, state);
        state.base = rebase(state.base, previous, next);
      }
      next = projected(state);
      state.visible = next;
      if (isIdle(state)) untrack(query, state);
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

function isKeyedUpdate(
  update: OptimisticUpdate,
): update is KeyedOptimisticUpdate {
  return "collection" in update;
}

function beginKeyedPredictions(
  client: QueryClient,
  updates: readonly KeyedOptimisticUpdate[],
  result: () => { value: unknown } | undefined,
) {
  const byCollection = new Map<
    KeyedCollection<unknown>,
    Map<string, KeyedOptimisticUpdate[]>
  >();
  for (const update of updates) {
    const byKey = byCollection.get(update.collection) ?? new Map();
    byKey.set(update.key, [...(byKey.get(update.key) ?? []), update]);
    byCollection.set(update.collection, byKey);
  }
  return [...byCollection].map(([collection, byKey]) =>
    predictKeyed(client, collection, new Set(byKey.keys()), (entity, key) =>
      (byKey.get(key) ?? []).reduce(
        (current, update) => update.update(current, result()),
        entity,
      ),
    ),
  );
}

export function beginOptimisticMutation(
  client: QueryClient,
  allUpdates: readonly OptimisticUpdate[],
) {
  const owner = {};
  const mutationOrder = tick();
  let accepted: { at: number; result: { value: unknown } } | undefined;
  let done = false;
  const updates = allUpdates.filter(
    (update): update is TaggedOptimisticUpdate => !isKeyedUpdate(update),
  );
  const keyed = beginKeyedPredictions(
    client,
    allUpdates.filter(isKeyedUpdate),
    () => (accepted?.result.value === undefined ? undefined : accepted.result),
  );
  const affected = new Map<Query, PredictionState>();
  const attached = new Map<TaggedOptimisticUpdate, Set<Query>>(
    updates.map((update) => [update, new Set()]),
  );
  const attach = (query: Query, update: TaggedOptimisticUpdate) => {
    const queries = attached.get(update)!;
    if (queries.has(query) || query.state.data === undefined) return;
    const state = predictions.get(query) ?? {
      client,
      base: query.state.data,
      visible: query.state.data,
      layers: [],
      guards: [],
    };
    const current = valueAt(projected(state), update.path);
    if (current === undefined) return;
    queries.add(query);
    const layer: Prediction = {
      owner,
      order: mutationOrder,
      path: update.path,
      initial: current.value,
      update: (value) => update.update(value, accepted?.result),
      acceptedAt: accepted?.at ?? null,
      fresh: false,
      settled: false,
    };
    const index = state.layers.findIndex((other) => other.order > layer.order);
    if (index < 0) state.layers.push(layer);
    else state.layers.splice(index, 0, layer);
    track(query, state);
    affected.set(query, state);
    publish(query, state);
  };
  const unsubscribe =
    updates.length === 0
      ? () => {}
      : client.getQueryCache().subscribe((event) => {
          if (event.type !== "updated" || event.action.type !== "success")
            return;
          for (const update of updates)
            if (
              matchQuery(
                { queryKey: update.queryKey, exact: true },
                event.query,
              )
            )
              attach(event.query, update);
        });
  const finish = () => {
    done = true;
    unsubscribe();
  };
  const rollback = () =>
    notifyManager.batch(() => {
      if (accepted !== undefined || done) return;
      finish();
      for (const prediction of keyed) prediction.remove();
      for (const [query, state] of affected) {
        state.layers = state.layers.filter((layer) => layer.owner !== owner);
        publish(query, state);
      }
    });
  try {
    notifyManager.batch(() => {
      for (const update of updates)
        for (const query of client.getQueryCache().findAll({
          queryKey: update.queryKey,
          exact: true,
        }))
          attach(query, update);
    });
  } catch (error) {
    rollback();
    throw error;
  }
  return {
    rollback,
    accept(result?: unknown) {
      accepted = { at: tick(), result: { value: result } };
      notifyManager.batch(() => {
        for (const prediction of keyed) prediction.accept();
        for (const [query, state] of affected) {
          for (const layer of state.layers)
            if (layer.owner === owner) layer.acceptedAt = accepted!.at;
          publish(query, state);
        }
      });
    },
    settle() {
      if (done) return;
      finish();
      notifyManager.batch(() => {
        for (const [query, state] of affected) {
          const tagged = isTaggedQuery(query);
          state.layers = state.layers.filter((layer) => {
            if (layer.owner !== owner) return true;
            layer.settled = true;
            if (!tagged) return true;
            if (!layer.fresh) return true;
            if (!olderPending(state, layer)) return false;
            const current = valueAt(state.base, layer.path);
            if (current !== undefined) {
              const update = layer.update;
              const predicted = update(current.value);
              layer.update = (value) =>
                confirmedValue(update(value), predicted, current.value);
            }
            return true;
          });
          publish(query, state);
        }
      });
    },
  };
}
