import type { Query, QueryClient, QueryKey } from "@tanstack/react-query";

export const CORE_TAG_SCOPE = "core";

export interface TaggedQueryRegistration<Data> {
  scope: string;
  tagsOf(data: Data): readonly string[];
}

export interface TaggedMutationOutcome<Result> {
  result: Result;
  invalidated: readonly string[];
}

const registrations = new WeakMap<object, TaggedQueryRegistration<unknown>>();
const reads = new WeakMap<Query, { tags: Set<string>; restart: boolean }>();

export function taggedQueryMeta<Data>(
  registration: TaggedQueryRegistration<Data>,
): Record<string, unknown> {
  const meta = {};
  registrations.set(meta, {
    scope: registration.scope,
    tagsOf: (data) => registration.tagsOf(data as Data),
  });
  return meta;
}

function registrationOf(query: Query) {
  return query.meta === undefined ? undefined : registrations.get(query.meta);
}

export async function runTaggedRead<Data>(
  client: QueryClient,
  queryKey: QueryKey,
  read: () => Promise<Data>,
): Promise<Data> {
  const query = client
    .getQueryCache()
    .get(client.defaultQueryOptions({ queryKey }).queryHash);
  if (query === undefined) return read();
  const registration = registrationOf(query);
  for (;;) {
    const pending = { tags: new Set<string>(), restart: false };
    reads.set(query, pending);
    try {
      const result = await read();
      if (
        pending.restart ||
        registration?.tagsOf(result).some((tag) => pending.tags.has(tag))
      )
        continue;
      return result;
    } catch (error) {
      if (pending.restart) continue;
      throw error;
    } finally {
      if (reads.get(query) === pending) reads.delete(query);
    }
  }
}

export async function invalidateTags(
  client: QueryClient,
  scope: string,
  tags: readonly string[],
): Promise<void> {
  if (tags.length === 0) return;
  const matched = new Set<Query>();
  const pendingReads: Promise<unknown>[] = [];
  for (const query of client.getQueryCache().getAll()) {
    const registration = registrationOf(query);
    if (registration?.scope !== scope) continue;
    const pending = reads.get(query);
    const matches =
      (query.state.data === undefined && pending === undefined) ||
      (query.state.data !== undefined &&
        registration
          .tagsOf(query.state.data)
          .some((tag) => tags.includes(tag)));
    if (pending !== undefined) {
      if (matches) pending.restart = true;
      else for (const tag of tags) pending.tags.add(tag);
      if (query.isActive() && query.promise !== undefined)
        pendingReads.push(query.promise);
    }
    if (matches) matched.add(query);
  }
  await Promise.allSettled([
    client.invalidateQueries(
      { predicate: (query) => matched.has(query) },
      { cancelRefetch: false },
    ),
    ...pendingReads,
  ]);
}

export async function runTaggedMutation<Result>(
  invalidate: (tags: readonly string[]) => Promise<void>,
  call: () => Promise<TaggedMutationOutcome<Result>>,
): Promise<Result> {
  const { result, invalidated } = await call();
  if (invalidated.length > 0) await invalidate(invalidated);
  return result;
}
