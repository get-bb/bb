import {
  notifyManager,
  replaceEqualDeep,
  type Query,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { tick } from "./clock.js";

export class KeyedCollection<Entity> {
  declare private readonly entity: Entity;
  constructor(readonly name: string) {}
}

export interface KeyedViewSlot {
  key: string;
  items: readonly unknown[];
}

export interface KeyedView<Entity> {
  collection: KeyedCollection<Entity>;
  slots(data: unknown): readonly KeyedViewSlot[] | undefined;
  rebuild(
    data: unknown,
    items: ReadonlyMap<string, readonly unknown[]>,
  ): unknown;
  keyOf(item: unknown): string | undefined;
  read(item: unknown, current: Entity | undefined, fresh: boolean): Entity;
  write(item: unknown, prior: unknown, current: Entity): Entity;
  render(item: unknown, entity: Entity): unknown;
  shows?(entity: Entity, queryKey: QueryKey): boolean;
}

type AnyView = KeyedView<unknown>;
type ViewResolver = (queryKey: QueryKey) => AnyView | undefined;

interface Layer {
  ids: Set<string>;
  apply(entity: unknown, id: string): unknown;
  acceptedAt: number | null;
}

interface Collection {
  base: Map<string, unknown>;
  visible: Map<string, unknown>;
  layers: Layer[];
  acknowledgedAt: Map<string, number>;
  views: Map<string, Set<Query>>;
}

interface Entry {
  id: string | null;
  item: unknown;
}

interface Skeleton {
  view: AnyView;
  collection: Collection;
  data: unknown;
  slots: Map<string, Entry[]>;
  slotsById: Map<string, Set<string>>;
}

type Materialized = Map<string, Map<string, unknown>>;

interface Insertion {
  slot: string;
  entry: Entry;
  at: number;
}

interface Store {
  client: QueryClient;
  collections: Map<KeyedCollection<unknown>, Collection>;
  resolvers: ViewResolver[];
  exact: Map<string, AnyView>;
  skeletons: Map<Query, Skeleton>;
  insertions: WeakMap<Query, Insertion[]>;
  materialized: WeakMap<Query, Materialized>;
  fetchStartedAt: WeakMap<Query, number>;
  receipts: WeakMap<Query, ReadonlyMap<string, number>>;
  rows: WeakMap<object, WeakMap<object, unknown>>;
  batching: number;
  dirtyIds: Map<Collection, Set<string>>;
  dirtyViews: Set<Query>;
}

const stores = new WeakMap<QueryClient, Store>();

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function collectionOf(
  store: Store,
  token: KeyedCollection<unknown>,
): Collection {
  let collection = store.collections.get(token);
  if (collection === undefined) {
    collection = {
      base: new Map(),
      visible: new Map(),
      layers: [],
      acknowledgedAt: new Map(),
      views: new Map(),
    };
    store.collections.set(token, collection);
  }
  return collection;
}

function readEntity(collection: Collection, id: string): unknown {
  const cached = collection.visible.get(id);
  if (cached !== undefined) return cached;
  let entity = collection.base.get(id);
  if (entity === undefined) return undefined;
  for (const layer of collection.layers)
    if (layer.ids.has(id)) entity = layer.apply(entity, id);
  collection.visible.set(id, entity);
  return entity;
}

function changed(
  store: Store,
  collection: Collection,
  ids: Iterable<string>,
): void {
  const dirty = new Set(ids);
  for (const id of dirty) collection.visible.delete(id);
  if (store.batching > 0) {
    const pending = store.dirtyIds.get(collection) ?? new Set<string>();
    for (const id of dirty) pending.add(id);
    store.dirtyIds.set(collection, pending);
    return;
  }
  const views = new Map<Query, Set<string>>();
  for (const id of dirty)
    for (const view of collection.views.get(id) ?? []) {
      const viewIds = views.get(view) ?? new Set<string>();
      viewIds.add(id);
      views.set(view, viewIds);
    }
  notifyManager.batch(() => {
    for (const [view, viewIds] of views) rematerialize(store, view, viewIds);
  });
}

function writeBase(
  store: Store,
  collection: Collection,
  id: string,
  update: (current: unknown) => unknown,
): void {
  const current = collection.base.get(id);
  const next = update(current);
  if (next === undefined || next === current) return;
  collection.base.set(id, next);
  changed(store, collection, [id]);
}

function dropAccepted(
  collection: Collection,
  id: string,
  acceptedBefore: number,
): boolean {
  let dropped = false;
  collection.layers = collection.layers.filter((layer) => {
    if (
      layer.acceptedAt === null ||
      layer.acceptedAt >= acceptedBefore ||
      !layer.ids.has(id)
    )
      return true;
    dropped = true;
    layer.ids.delete(id);
    return layer.ids.size > 0;
  });
  return dropped;
}

function ingest(
  store: Store,
  skeleton: Pick<Skeleton, "view" | "collection">,
  id: string,
  item: unknown,
  readStart: number,
): void {
  const { collection } = skeleton;
  const fresh = readStart > (collection.acknowledgedAt.get(id) ?? -1);
  writeBase(store, collection, id, (current) =>
    skeleton.view.read(item, current, fresh),
  );
  if (dropAccepted(collection, id, readStart)) changed(store, collection, [id]);
}

function materializeItem(
  store: Store,
  view: AnyView,
  item: unknown,
  entity: unknown,
): unknown {
  if (!isObject(item) || !isObject(entity)) return view.render(item, entity);
  let byEntity = store.rows.get(item);
  if (byEntity === undefined) {
    byEntity = new WeakMap();
    store.rows.set(item, byEntity);
  }
  const cached = byEntity.get(entity);
  if (cached !== undefined) return cached;
  const row = view.render(item, entity);
  byEntity.set(entity, row);
  return row;
}

function rematerialize(
  store: Store,
  query: Query,
  dirty?: ReadonlySet<string>,
): void {
  const skeleton = store.skeletons.get(query);
  if (skeleton === undefined) return;
  const { view, collection } = skeleton;
  const previous = store.materialized.get(query);
  const incremental = dirty !== undefined && previous !== undefined;
  const slotKeys = new Set<string>();
  if (incremental) {
    for (const id of dirty)
      for (const slot of skeleton.slotsById.get(id) ?? []) slotKeys.add(slot);
  } else for (const slot of skeleton.slots.keys()) slotKeys.add(slot);
  if (slotKeys.size === 0) return;
  const items = new Map<string, unknown[]>();
  const materialized: Materialized = new Map(previous);
  for (const slot of slotKeys) {
    const prior = previous?.get(slot);
    const visible = new Map<string, unknown>();
    const rows: unknown[] = [];
    for (const entry of skeleton.slots.get(slot) ?? []) {
      if (entry.id === null) {
        rows.push(entry.item);
        continue;
      }
      const entity = readEntity(collection, entry.id);
      if (
        entity !== undefined &&
        view.shows !== undefined &&
        !view.shows(entity, query.queryKey)
      )
        continue;
      const previousRow = incremental ? prior?.get(entry.id) : undefined;
      const row =
        previousRow !== undefined && dirty?.has(entry.id) === false
          ? previousRow
          : replaceEqualDeep(
              previousRow,
              entity === undefined
                ? entry.item
                : materializeItem(store, view, entry.item, entity),
            );
      visible.set(entry.id, row);
      rows.push(row);
    }
    const unchanged =
      prior !== undefined &&
      prior.size === rows.length &&
      [...prior.values()].every((row, index) => row === rows[index]);
    if (incremental && unchanged) continue;
    items.set(slot, rows);
    materialized.set(slot, visible);
  }
  if (items.size === 0) return;
  let next = view.rebuild(
    incremental ? query.state.data : skeleton.data,
    items,
  );
  if (!incremental) {
    next = replaceEqualDeep(query.state.data, next);
    for (const slot of view.slots(next) ?? []) {
      const visible = new Map<string, unknown>();
      for (const item of slot.items) {
        const id = view.keyOf(item);
        if (id !== undefined) visible.set(id, item);
      }
      materialized.set(slot.key, visible);
    }
  }
  store.materialized.set(query, materialized);
  if (next !== query.state.data) query.setState({ data: next });
}

function skeletonIds(skeleton: Skeleton | undefined): Set<string> {
  const ids = new Set<string>();
  for (const entries of skeleton?.slots.values() ?? [])
    for (const { id } of entries) if (id !== null) ids.add(id);
  return ids;
}

function setSkeleton(
  store: Store,
  query: Query,
  skeleton: Skeleton | undefined,
): void {
  const previous = store.skeletons.get(query);
  const previousIds = skeletonIds(previous);
  const nextIds = skeletonIds(skeleton);
  if (skeleton === undefined) {
    store.skeletons.delete(query);
    store.materialized.delete(query);
  } else store.skeletons.set(query, skeleton);
  const collection = skeleton?.collection ?? previous?.collection;
  if (collection === undefined) return;
  for (const id of nextIds) {
    let views = collection.views.get(id);
    if (views === undefined) {
      views = new Set();
      collection.views.set(id, views);
    }
    views.add(query);
  }
  for (const id of previousIds) {
    if (nextIds.has(id)) continue;
    const views = collection.views.get(id);
    views?.delete(query);
    if (views === undefined || views.size === 0) {
      collection.views.delete(id);
      collection.base.delete(id);
      collection.visible.delete(id);
      dropAccepted(collection, id, Number.POSITIVE_INFINITY);
    }
  }
}

function priorItem(
  materialized: Materialized | undefined,
  slot: string,
  id: string,
): unknown {
  const same = materialized?.get(slot)?.get(id);
  if (same !== undefined) return same;
  for (const visible of materialized?.values() ?? []) {
    const item = visible.get(id);
    if (item !== undefined) return item;
  }
  return undefined;
}

function isHidden(
  entry: Entry,
  visible: ReadonlyMap<string, unknown>,
): boolean {
  return entry.id !== null && !visible.has(entry.id);
}

function keepHiddenEntries(
  previous: readonly Entry[],
  next: Entry[],
  visible: ReadonlyMap<string, unknown>,
): Entry[] {
  if (!previous.some((entry) => isHidden(entry, visible))) return next;
  const result = [...next];
  let insertAt = result.length;
  for (let index = previous.length - 1; index >= 0; index--) {
    const entry = previous[index]!;
    const existing =
      entry.id === null ? -1 : result.findIndex(({ id }) => id === entry.id);
    if (existing >= 0) insertAt = existing;
    else if (isHidden(entry, visible)) result.splice(insertAt, 0, entry);
  }
  return result;
}

function keptInsertions(
  store: Store,
  query: Query,
  slot: string,
  readStart: number,
): Insertion[] {
  const insertions = (store.insertions.get(query) ?? []).filter(
    (insertion) => insertion.at > readStart,
  );
  store.insertions.set(query, insertions);
  return insertions.filter((insertion) => insertion.slot === slot);
}

function batch(store: Store, run: () => void): void {
  store.batching++;
  try {
    notifyManager.batch(run);
  } finally {
    store.batching--;
  }
  if (store.batching > 0) return;
  const full = new Set(store.dirtyViews);
  const partial = new Map<Query, Set<string>>();
  for (const [collection, ids] of store.dirtyIds)
    for (const id of ids)
      for (const view of collection.views.get(id) ?? []) {
        if (full.has(view)) continue;
        const viewIds = partial.get(view) ?? new Set<string>();
        viewIds.add(id);
        partial.set(view, viewIds);
      }
  store.dirtyIds.clear();
  store.dirtyViews.clear();
  notifyManager.batch(() => {
    for (const view of full) rematerialize(store, view);
    for (const [view, ids] of partial) rematerialize(store, view, ids);
  });
}

function onViewWritten(
  store: Store,
  query: Query,
  view: AnyView,
  manual: boolean,
): void {
  const data = query.state.data;
  const slots = data === undefined ? undefined : view.slots(data);
  if (slots === undefined) {
    setSkeleton(store, query, undefined);
    return;
  }
  const collection = collectionOf(store, view.collection);
  const target = { view, collection };
  const previous = store.skeletons.get(query);
  const materialized = manual ? store.materialized.get(query) : undefined;
  const readStart = manual ? -1 : (store.fetchStartedAt.get(query) ?? 0);
  const receipt = manual ? undefined : store.receipts.get(query);
  if (receipt !== undefined) store.receipts.delete(query);
  batch(store, () => {
    const nextSlots = new Map<string, Entry[]>();
    const slotsById = new Map<string, Set<string>>();
    for (const slot of slots) {
      const entries: Entry[] = [];
      for (const item of slot.items) {
        const id = view.keyOf(item);
        entries.push({ id: id ?? null, item });
        if (id === undefined) continue;
        const prior = priorItem(materialized, slot.key, id);
        if (prior !== undefined) {
          if (prior !== item)
            writeBase(store, collection, id, (current) =>
              current === undefined
                ? current
                : view.write(item, prior, current),
            );
          continue;
        }
        const start = receipt === undefined ? readStart : receipt.get(id);
        if (start !== undefined) ingest(store, target, id, item, start);
        else if (!collection.base.has(id))
          ingest(store, target, id, item, readStart);
      }
      const previousEntries = previous?.slots.get(slot.key);
      const visible = materialized?.get(slot.key);
      const kept =
        previousEntries !== undefined && visible !== undefined
          ? keepHiddenEntries(previousEntries, entries, visible)
          : entries;
      if (!manual)
        for (const insertion of keptInsertions(
          store,
          query,
          slot.key,
          readStart,
        ))
          if (!kept.some(({ id }) => id === insertion.entry.id))
            kept.push(insertion.entry);
      nextSlots.set(slot.key, kept);
      for (const { id } of kept) {
        if (id === null) continue;
        const slotKeys = slotsById.get(id) ?? new Set<string>();
        slotKeys.add(slot.key);
        slotsById.set(id, slotKeys);
      }
    }
    setSkeleton(store, query, {
      view,
      collection,
      data,
      slots: nextSlots,
      slotsById,
    });
    store.dirtyViews.add(query);
  });
}

function viewOf(store: Store, query: Query): AnyView | undefined {
  const exact = store.exact.get(query.queryHash);
  if (exact !== undefined) return exact;
  for (const resolve of store.resolvers) {
    const view = resolve(query.queryKey);
    if (view !== undefined) return view;
  }
  return undefined;
}

function storeOf(client: QueryClient): Store {
  const existing = stores.get(client);
  if (existing !== undefined) return existing;
  const store: Store = {
    client,
    collections: new Map(),
    resolvers: [],
    exact: new Map(),
    skeletons: new Map(),
    insertions: new WeakMap(),
    materialized: new WeakMap(),
    fetchStartedAt: new WeakMap(),
    receipts: new WeakMap(),
    rows: new WeakMap(),
    batching: 0,
    dirtyIds: new Map(),
    dirtyViews: new Set(),
  };
  stores.set(client, store);
  client.getQueryCache().subscribe((event) => {
    const { query } = event;
    if (event.type === "removed") {
      if (store.skeletons.has(query)) setSkeleton(store, query, undefined);
      return;
    }
    if (event.type !== "updated") return;
    const { type } = event.action;
    if (type !== "fetch" && type !== "success") return;
    const view = viewOf(store, query);
    if (view === undefined) return;
    if (event.action.type === "fetch") {
      store.fetchStartedAt.set(query, tick());
      return;
    }
    if (event.action.type === "success")
      onViewWritten(store, query, view, event.action.manual === true);
  });
  return store;
}

function adopt(store: Store, matches: (query: Query) => AnyView | undefined) {
  for (const query of store.client.getQueryCache().getAll()) {
    const view = matches(query);
    if (view !== undefined && query.state.data !== undefined)
      onViewWritten(store, query, view, true);
  }
}

export function registerKeyedViews(
  client: QueryClient,
  resolve: ViewResolver,
): void {
  const store = storeOf(client);
  if (store.resolvers.includes(resolve)) return;
  store.resolvers.push(resolve);
  adopt(store, (query) =>
    store.exact.has(query.queryHash) ? undefined : resolve(query.queryKey),
  );
}

export function registerKeyedView<Entity>(
  client: QueryClient,
  queryKey: QueryKey,
  view: KeyedView<Entity>,
): void {
  const store = storeOf(client);
  const { queryHash } = client.defaultQueryOptions({ queryKey });
  if (store.exact.has(queryHash)) return;
  store.exact.set(queryHash, view);
  adopt(store, (query) => (query.queryHash === queryHash ? view : undefined));
}

export function recordKeyedRead(
  client: QueryClient,
  queryKey: QueryKey,
  startedAt: ReadonlyMap<string, number>,
): void {
  const query = client
    .getQueryCache()
    .get(client.defaultQueryOptions({ queryKey }).queryHash);
  if (query !== undefined) storeOf(client).receipts.set(query, startedAt);
}

export function readKeyedEntity<Entity>(
  client: QueryClient,
  collection: KeyedCollection<Entity>,
  id: string,
): Entity | undefined {
  const store = storeOf(client);
  return readEntity(collectionOf(store, collection), id) as Entity | undefined;
}

export function keyedEntities<Entity>(
  client: QueryClient,
  collection: KeyedCollection<Entity>,
): Entity[] {
  const state = collectionOf(storeOf(client), collection);
  return [...state.base.keys()].map((id) => readEntity(state, id) as Entity);
}

export function writeKeyedEntity<Entity>(
  client: QueryClient,
  collection: KeyedCollection<Entity>,
  id: string,
  update: (current: Entity | undefined) => Entity | undefined,
): void {
  const store = storeOf(client);
  writeBase(store, collectionOf(store, collection), id, (current) =>
    update(current as Entity | undefined),
  );
}

export function confirmKeyedEntity<Entity>(
  client: QueryClient,
  collection: KeyedCollection<Entity>,
  id: string,
  update: (current: Entity) => Entity | undefined,
): boolean {
  const store = storeOf(client);
  const state = collectionOf(store, collection);
  const current = state.base.get(id) as Entity | undefined;
  const next = current === undefined ? undefined : update(current);
  if (current !== undefined && next === undefined) return false;
  batch(store, () => {
    if (next !== undefined) writeBase(store, state, id, () => next);
    if (dropAccepted(state, id, Number.POSITIVE_INFINITY))
      changed(store, state, [id]);
  });
  return true;
}

export function insertKeyedEntry<Entity>(
  client: QueryClient,
  queryKey: QueryKey,
  collection: KeyedCollection<Entity>,
  id: string,
  place: (
    data: unknown,
    entity: Entity,
  ) => { slot: string; item: unknown } | undefined,
): void {
  const store = storeOf(client);
  const query = client
    .getQueryCache()
    .get(client.defaultQueryOptions({ queryKey }).queryHash);
  const skeleton = query === undefined ? undefined : store.skeletons.get(query);
  const entity = readKeyedEntity(client, collection, id);
  if (query === undefined || skeleton === undefined || entity === undefined)
    return;
  const existingSlot = skeleton.slotsById.get(id)?.values().next().value;
  const placed =
    existingSlot === undefined ? place(skeleton.data, entity) : undefined;
  const slot = existingSlot ?? placed?.slot;
  const entries = slot === undefined ? undefined : skeleton.slots.get(slot);
  if (slot === undefined || entries === undefined) return;
  const entry = entries.find((candidate) => candidate.id === id) ?? {
    id,
    item: placed?.item,
  };
  store.insertions.set(query, [
    ...(store.insertions.get(query) ?? []),
    { slot, entry, at: tick() },
  ]);
  if (existingSlot !== undefined) return;
  const slots = new Map(skeleton.slots);
  slots.set(slot, [...entries, entry]);
  const slotsById = new Map(skeleton.slotsById);
  slotsById.set(id, new Set([slot]));
  setSkeleton(store, query, { ...skeleton, slots, slotsById });
  notifyManager.batch(() => rematerialize(store, query));
}

export function predictKeyed(
  client: QueryClient,
  token: KeyedCollection<unknown>,
  ids: ReadonlySet<string>,
  apply: (entity: unknown, id: string) => unknown,
): { accept(): void; remove(): void } {
  const store = storeOf(client);
  const collection = collectionOf(store, token);
  const layer: Layer = { ids: new Set(ids), apply, acceptedAt: null };
  collection.layers.push(layer);
  changed(store, collection, ids);
  const live = () =>
    layer.acceptedAt === null && collection.layers.includes(layer);
  return {
    accept() {
      if (!live()) return;
      const at = tick();
      for (const id of ids) collection.acknowledgedAt.set(id, at);
      layer.acceptedAt = at;
    },
    remove() {
      if (!live()) return;
      collection.layers = collection.layers.filter((other) => other !== layer);
      changed(store, collection, ids);
    },
  };
}
