import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CORE_TAG_SCOPE,
  createTaggedKeyedQueryOwner,
  invalidateTags,
  runTaggedMutation,
  runTaggedRead,
  taggedQueryMeta,
} from "../src/index.js";

type Data = { value: number; tags: string[] };
const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  disposers.push(() => client.clear());
  return client;
}
function observe(
  client: QueryClient,
  key: string,
  read: () => Promise<Data>,
  scope = CORE_TAG_SCOPE,
) {
  const fn = vi.fn(read);
  const observer = new QueryObserver(client, {
    queryKey: [key],
    staleTime: Infinity,
    meta: taggedQueryMeta<Data>({ scope, tagsOf: (data) => data.tags }),
    queryFn: ({ queryKey }) => runTaggedRead(client, queryKey, fn),
  });
  const stop = observer.subscribe(() => {});
  disposers.push(stop);
  return {
    observer,
    fn,
    stop,
    value: () => observer.getCurrentResult().data?.value,
  };
}

describe("tagged reads and mutations", () => {
  it("refreshes matching active reads, leaves inactive data stale and isolates clients and scopes", async () => {
    const client = setup();
    let value = 1;
    const read = async () => ({ value, tags: ["item:a"] });
    const matched = observe(client, "a", read);
    const inactive = observe(client, "inactive", read);
    const unrelated = observe(client, "b", async () => ({
      value,
      tags: ["item:b"],
    }));
    const otherScope = observe(client, "scope", read, "other");
    const otherClient = observe(setup(), "a", read);
    await vi.waitFor(() => {
      for (const item of [
        matched,
        inactive,
        unrelated,
        otherScope,
        otherClient,
      ])
        expect(item.value()).toBe(1);
    });
    inactive.stop();
    value = 2;
    await invalidateTags(client, CORE_TAG_SCOPE, ["item:a"]);
    expect(matched.value()).toBe(2);
    for (const item of [inactive, unrelated, otherScope, otherClient])
      expect(item.value()).toBe(1);
    expect(client.getQueryState(["inactive"])?.isInvalidated).toBe(true);
  });

  it.each([true, false])(
    "only repeats an initial read when its returned tags overlap (%s)",
    async (overlap) => {
      const client = setup();
      const first = deferred<Data>();
      const second = deferred<Data>();
      const read = observe(client, "a", () => first.promise);
      read.fn.mockImplementationOnce(() => second.promise);
      let settled = false;
      const mutation = runTaggedMutation(
        (tags) => invalidateTags(client, CORE_TAG_SCOPE, tags),
        async () => ({ result: "saved", invalidated: ["item:a"] }),
      ).then((result) => {
        settled = true;
        return result;
      });
      await Promise.resolve();
      first.resolve({ value: 1, tags: [overlap ? "item:a" : "item:b"] });
      if (overlap) {
        await vi.waitFor(() => expect(read.fn).toHaveBeenCalledTimes(2));
        expect(settled).toBe(false);
        second.resolve({ value: 2, tags: ["item:a"] });
      }
      await expect(mutation).resolves.toBe("saved");
      expect(read.value()).toBe(overlap ? 2 : 1);
      expect(read.fn).toHaveBeenCalledTimes(overlap ? 2 : 1);
    },
  );

  it("waits through overlapping invalidations during a refresh", async () => {
    const client = setup();
    const read = observe(client, "a", async () => ({
      value: 1,
      tags: ["item:a"],
    }));
    await vi.waitFor(() => expect(read.value()).toBe(1));
    const stale = deferred<Data>();
    const fresh = deferred<Data>();
    read.fn
      .mockImplementationOnce(() => stale.promise)
      .mockImplementationOnce(() => fresh.promise);
    const invalidate = (tags: readonly string[]) =>
      invalidateTags(client, CORE_TAG_SCOPE, tags);
    const first = invalidate(["item:a"]);
    const mutation = runTaggedMutation(invalidate, async () => ({
      result: "saved",
      invalidated: ["item:a"],
    }));
    await Promise.resolve();
    stale.resolve({ value: 2, tags: ["item:a"] });
    await vi.waitFor(() => expect(read.fn).toHaveBeenCalledTimes(3));
    fresh.resolve({ value: 3, tags: ["item:a"] });
    await first;
    await mutation;
    expect(read.value()).toBe(3);
  });

  it("preserves cached data on refresh failure and clears the error after recovery", async () => {
    const client = setup();
    const read = observe(client, "a", async () => ({
      value: 1,
      tags: ["item:a"],
    }));
    await vi.waitFor(() => expect(read.value()).toBe(1));
    read.fn.mockRejectedValueOnce(new Error("offline"));
    await expect(
      runTaggedMutation(
        (tags) => invalidateTags(client, CORE_TAG_SCOPE, tags),
        async () => ({ result: "saved", invalidated: ["item:a"] }),
      ),
    ).resolves.toBe("saved");
    expect(read.value()).toBe(1);
    expect(read.observer.getCurrentResult().error?.message).toBe("offline");
    await invalidateTags(client, CORE_TAG_SCOPE, ["item:a"]);
    expect(read.observer.getCurrentResult().error).toBeNull();
  });

  it("recovers a failed first load on the next invalidation", async () => {
    const client = setup();
    const read = observe(client, "a", async () => {
      throw new Error("offline");
    });
    await vi.waitFor(() =>
      expect(read.observer.getCurrentResult().isError).toBe(true),
    );
    read.fn.mockResolvedValue({ value: 2, tags: ["item:a"] });
    await invalidateTags(client, CORE_TAG_SCOPE, ["item:a"]);
    expect(read.value()).toBe(2);
    expect(read.observer.getCurrentResult().error).toBeNull();
  });

  it("does not invalidate on rejected writes or empty tag lists", async () => {
    const invalidate = vi.fn(async () => {});
    await expect(
      runTaggedMutation(invalidate, async () => {
        throw new Error("rejected");
      }),
    ).rejects.toThrow("rejected");
    await runTaggedMutation(invalidate, async () => ({
      result: 1,
      invalidated: [],
    }));
    expect(invalidate).not.toHaveBeenCalled();
  });
});

it("refreshes untagged reads on scoped invalidate-all", async () => {
  const client = setup();
  let value = 1;
  const read = observe(client, "untagged", async () => ({ value, tags: [] }));
  const other = observe(
    client,
    "other",
    async () => ({ value, tags: [] }),
    "other",
  );
  await vi.waitFor(() => expect(read.value()).toBe(1));
  value = 2;
  await invalidateTags(client, CORE_TAG_SCOPE, null);
  expect(read.value()).toBe(2);
  expect(other.value()).toBe(1);
});

it("shares one keyed observer, batches consumers, and retains data through refresh errors until retry succeeds", async () => {
  const client = setup();
  let value = 1;
  let failure = false;
  const requested: string[][] = [];
  const owner = createTaggedKeyedQueryOwner({
    client,
    queryKey: ["keyed"],
    scope: CORE_TAG_SCOPE,
    read: async (keys) => {
      requested.push([...keys]);
      if (failure) throw new Error("offline");
      return {
        result: Object.fromEntries(keys.map((key) => [key, value])),
        tags: [],
        keyTags: Object.fromEntries(keys.map((key) => [key, [`item:${key}`]])),
      };
    },
  });
  disposers.push(
    owner.subscribe(["a"], () => {}),
    owner.subscribe(["a", "b"], () => {}),
  );
  await vi.waitFor(() =>
    expect(owner.observer.getCurrentResult().data?.result).toEqual({
      a: 1,
      b: 1,
    }),
  );
  expect(client.getQueryCache().getAll()[0]?.getObserversCount()).toBe(1);
  expect(requested.every((keys) => new Set(keys).size === keys.length)).toBe(
    true,
  );
  failure = true;
  await invalidateTags(client, CORE_TAG_SCOPE, ["item:a"]);
  expect(owner.observer.getCurrentResult().data?.result).toEqual({
    a: 1,
    b: 1,
  });
  expect(owner.observer.getCurrentResult().error?.message).toBe("offline");
  failure = false;
  value = 2;
  await owner.observer.refetch();
  expect(owner.observer.getCurrentResult().data?.result).toEqual({
    a: 2,
    b: 1,
  });
  expect(owner.observer.getCurrentResult().error).toBeNull();
});

it("re-reads after a dormant read completes without a subscription to changes", async () => {
  const client = setup();
  const gate = deferred<void>();
  let value = 1;
  let first = true;
  const owner = createTaggedKeyedQueryOwner({
    client,
    queryKey: ["dormant"],
    scope: CORE_TAG_SCOPE,
    read: async () => {
      const captured = value;
      if (first) {
        first = false;
        await gate.promise;
      }
      return { result: { a: captured }, tags: ["item:a"], keyTags: {} };
    },
  });
  const stop = owner.subscribe(["a"], () => {});
  await vi.waitFor(() => expect(first).toBe(false));
  stop();
  await Promise.resolve();
  gate.resolve();
  await vi.waitFor(() =>
    expect(
      client.getQueryData<{ result: { a: number } }>(["dormant"])?.result.a,
    ).toBe(1),
  );
  value = 2;
  disposers.push(owner.subscribe(["a"], () => {}));
  await vi.waitFor(() =>
    expect(owner.observer.getCurrentResult().data?.result.a).toBe(2),
  );
});

it("refreshes only keys matched by key tags and all keys matched by response tags", async () => {
  const client = setup();
  const requested: string[][] = [];
  let value = 1;
  const owner = createTaggedKeyedQueryOwner({
    client,
    queryKey: ["precise"],
    scope: CORE_TAG_SCOPE,
    read: async (keys) => {
      requested.push([...keys]);
      return {
        result: Object.fromEntries(keys.map((key) => [key, value])),
        tags: ["board"],
        keyTags: Object.fromEntries(keys.map((key) => [key, [`item:${key}`]])),
      };
    },
  });
  disposers.push(owner.subscribe(["a", "b"], () => {}));
  await vi.waitFor(() =>
    expect(owner.observer.getCurrentResult().data?.result).toEqual({
      a: 1,
      b: 1,
    }),
  );
  requested.length = 0;
  value = 2;
  await invalidateTags(client, CORE_TAG_SCOPE, ["item:a"]);
  expect(requested).toEqual([["a"]]);
  expect(owner.observer.getCurrentResult().data).toEqual({
    result: { a: 2, b: 1 },
    tags: ["board"],
    keyTags: { a: ["item:a"], b: ["item:b"] },
  });
  requested.length = 0;
  value = 3;
  await invalidateTags(client, CORE_TAG_SCOPE, ["board"]);
  expect(requested).toEqual([["a", "b"]]);
  expect(owner.observer.getCurrentResult().data?.result).toEqual({
    a: 3,
    b: 3,
  });
});

it.each([false, true])(
  "preserves completed rows through partial invalidations and recovery (failure=%s)",
  async (failure) => {
    const client = setup();
    let value = 1;
    const response = (keys: readonly string[], current: number) => ({
      result: Object.fromEntries(keys.map((key) => [key, current])),
      tags: [],
      keyTags: Object.fromEntries(keys.map((key) => [key, [`item:${key}`]])),
    });
    const read = vi.fn(async (keys: readonly string[]) =>
      response(keys, value),
    );
    const owner = createTaggedKeyedQueryOwner({
      client,
      queryKey: ["partial"],
      scope: CORE_TAG_SCOPE,
      read,
    });
    disposers.push(owner.subscribe(["a", "b"], () => {}));
    await vi.waitFor(() =>
      expect(owner.observer.getCurrentResult().data?.result).toEqual({
        a: 1,
        b: 1,
      }),
    );
    const gate = deferred<ReturnType<typeof response>>();
    read.mockImplementationOnce(() => gate.promise);
    const first = invalidateTags(client, CORE_TAG_SCOPE, ["item:a"]);
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    value = 3;
    if (failure) read.mockRejectedValueOnce(new Error("offline"));
    const second = invalidateTags(client, CORE_TAG_SCOPE, ["item:b"]);
    gate.resolve(response(["a"], 2));
    await Promise.all([first, second]);
    if (failure) {
      expect(owner.observer.getCurrentResult().data?.result).toEqual({
        a: 1,
        b: 1,
      });
      expect(owner.observer.getCurrentResult().error?.message).toBe("offline");
      await owner.observer.refetch();
    }
    expect(read.mock.calls.map(([keys]) => keys)).toEqual([
      ["a", "b"],
      ["a"],
      ["b"],
      ...(failure ? [["a", "b"]] : []),
    ]);
    expect(owner.observer.getCurrentResult().data?.result).toEqual({
      a: failure ? 3 : 2,
      b: 3,
    });
  },
);

it("inherits retry and mount freshness defaults from the query client", async () => {
  const client = setup();
  client.setDefaultOptions({
    queries: {
      retry: 1,
      retryDelay: 0,
      staleTime: Infinity,
      refetchOnMount: false,
    },
  });
  const read = vi.fn(async () => ({
    result: { a: 1 },
    tags: [],
    keyTags: { a: ["item:a"] },
  }));
  read.mockRejectedValueOnce(new Error("transient"));
  const owner = createTaggedKeyedQueryOwner({
    client,
    queryKey: ["defaults"],
    scope: CORE_TAG_SCOPE,
    read,
  });
  const stop = owner.subscribe(["a"], () => {});
  await vi.waitFor(() =>
    expect(owner.observer.getCurrentResult().data?.result).toEqual({ a: 1 }),
  );
  expect(read).toHaveBeenCalledTimes(2);
  stop();
  await Promise.resolve();
  disposers.push(owner.subscribe(["a"], () => {}));
  await Promise.resolve();
  expect(owner.observer.getCurrentResult().isFetching).toBe(false);
  expect(read).toHaveBeenCalledTimes(2);
});

it("loads new subscribers without rereading other rows during a keyed invalidation", async () => {
  const client = setup();
  let value = 1;
  const response = (keys: readonly string[], current: number) => ({
    result: Object.fromEntries(keys.map((key) => [key, current])),
    tags: [],
    keyTags: Object.fromEntries(keys.map((key) => [key, [`item:${key}`]])),
  });
  const read = vi.fn(async (keys: readonly string[]) => response(keys, value));
  const owner = createTaggedKeyedQueryOwner({
    client,
    queryKey: ["membership"],
    scope: CORE_TAG_SCOPE,
    read,
  });
  disposers.push(owner.subscribe(["a", "b"], () => {}));
  await vi.waitFor(() =>
    expect(owner.observer.getCurrentResult().data?.result).toEqual({
      a: 1,
      b: 1,
    }),
  );
  const gate = deferred<ReturnType<typeof response>>();
  read.mockImplementationOnce(() => gate.promise);
  const invalidation = invalidateTags(client, CORE_TAG_SCOPE, ["item:a"]);
  await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  disposers.push(owner.subscribe(["c"], () => {}));
  value = 3;
  gate.resolve(response(["a"], 2));
  await invalidation;
  expect(read.mock.calls.map(([keys]) => keys)).toEqual([
    ["a", "b"],
    ["a"],
    ["c"],
  ]);
  expect(owner.observer.getCurrentResult().data?.result).toEqual({
    a: 2,
    b: 1,
    c: 3,
  });
});
