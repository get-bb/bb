import type { ReadChange } from "@bb/domain";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CORE_CHANGE_SCOPE,
  createLiveKeyedQueryOwner,
  applyQueryChange,
  KeyedCollection,
  optimisticKeyedUpdate,
  optimisticQueryUpdate,
  runLiveMutation,
  runLiveRead,
  liveQueryOptions,
} from "../src/index.js";

type Data = { value: number; dependencies: readonly ReadChange[] };
const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const collection = new KeyedCollection<number>("rows");
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
  scope = CORE_CHANGE_SCOPE,
) {
  const fn = vi.fn(read);
  const observer = new QueryObserver(client, {
    queryKey: [key],
    staleTime: Infinity,
    ...liveQueryOptions<Data>(client, [key], {
      scope,
      dependenciesOf: (data) => data?.dependencies,
    }),
    queryFn: ({ queryKey }) => runLiveRead(client, queryKey, fn),
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
    const read = async () => ({ value, dependencies: changesOf(["item:a"]) });
    const matched = observe(client, "a", read);
    const inactive = observe(client, "inactive", read);
    const unrelated = observe(client, "b", async () => ({
      value,
      dependencies: changesOf(["item:b"]),
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
    await applyChanges(client, CORE_CHANGE_SCOPE, changesOf(["item:a"]));
    expect(matched.value()).toBe(2);
    for (const item of [inactive, unrelated, otherScope, otherClient])
      expect(item.value()).toBe(1);
    expect(client.getQueryState(["inactive"])?.isInvalidated).toBe(true);
  });

  it.each([true, false])(
    "only repeats an initial read when its returned dependencies overlap (%s)",
    async (overlap) => {
      const client = setup();
      const first = deferred<Data>();
      const second = deferred<Data>();
      const read = observe(client, "a", () => first.promise);
      read.fn.mockImplementationOnce(() => second.promise);
      let settled = false;
      const mutation = runLiveMutation(
        (dependencies) => applyChanges(client, CORE_CHANGE_SCOPE, dependencies),
        async () => ({ result: "saved", changes: changesOf(["item:a"]) }),
      ).then((result) => {
        settled = true;
        return result;
      });
      await Promise.resolve();
      first.resolve({
        value: 1,
        dependencies: changesOf([overlap ? "item:a" : "item:b"]),
      });
      if (overlap) {
        await vi.waitFor(() => expect(read.fn).toHaveBeenCalledTimes(2));
        expect(settled).toBe(true);
        second.resolve({ value: 2, dependencies: changesOf(["item:a"]) });
      }
      await expect(mutation).resolves.toBe("saved");
      await vi.waitFor(() => expect(read.value()).toBe(overlap ? 2 : 1));
      expect(read.fn).toHaveBeenCalledTimes(overlap ? 2 : 1);
    },
  );

  it("waits through overlapping invalidations during a refresh", async () => {
    const client = setup();
    const read = observe(client, "a", async () => ({
      value: 1,
      dependencies: changesOf(["item:a"]),
    }));
    await vi.waitFor(() => expect(read.value()).toBe(1));
    const stale = deferred<Data>();
    const fresh = deferred<Data>();
    read.fn
      .mockImplementationOnce(() => stale.promise)
      .mockImplementationOnce(() => fresh.promise);
    const invalidate = (dependencies: readonly ReadChange[]) =>
      applyChanges(client, CORE_CHANGE_SCOPE, dependencies);
    const first = invalidate(changesOf(["item:a"]));
    const mutation = runLiveMutation(invalidate, async () => ({
      result: "saved",
      changes: changesOf(["item:a"]),
    }));
    await Promise.resolve();
    stale.resolve({ value: 2, dependencies: changesOf(["item:a"]) });
    await vi.waitFor(() => expect(read.fn).toHaveBeenCalledTimes(3));
    fresh.resolve({ value: 3, dependencies: changesOf(["item:a"]) });
    await first;
    await mutation;
    expect(read.value()).toBe(3);
  });

  it("preserves cached data on refresh failure and clears the error after recovery", async () => {
    const client = setup();
    const read = observe(client, "a", async () => ({
      value: 1,
      dependencies: changesOf(["item:a"]),
    }));
    await vi.waitFor(() => expect(read.value()).toBe(1));
    read.fn.mockRejectedValueOnce(new Error("offline"));
    await expect(
      runLiveMutation(
        (dependencies) => applyChanges(client, CORE_CHANGE_SCOPE, dependencies),
        async () => ({ result: "saved", changes: changesOf(["item:a"]) }),
      ),
    ).resolves.toBe("saved");
    expect(read.value()).toBe(1);
    await vi.waitFor(() =>
      expect(read.observer.getCurrentResult().error?.message).toBe("offline"),
    );
    await applyChanges(client, CORE_CHANGE_SCOPE, changesOf(["item:a"]));
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
    read.fn.mockResolvedValue({
      value: 2,
      dependencies: changesOf(["item:a"]),
    });
    await applyChanges(client, CORE_CHANGE_SCOPE, changesOf(["item:a"]));
    expect(read.value()).toBe(2);
    expect(read.observer.getCurrentResult().error).toBeNull();
  });

  it("does not invalidate on rejected writes or empty tag lists", async () => {
    const invalidate = vi.fn(async () => {});
    await expect(
      runLiveMutation(invalidate, async () => {
        throw new Error("rejected");
      }),
    ).rejects.toThrow("rejected");
    await runLiveMutation(invalidate, async () => ({
      result: 1,
      changes: changesOf([]),
    }));
    expect(invalidate).not.toHaveBeenCalled();
  });
});

it("refreshes untagged reads on scoped invalidate-all", async () => {
  const client = setup();
  let value = 1;
  const read = observe(client, "untagged", async () => ({
    value,
    dependencies: changesOf([]),
  }));
  const other = observe(
    client,
    "other",
    async () => ({ value, dependencies: changesOf([]) }),
    "other",
  );
  await vi.waitFor(() => expect(read.value()).toBe(1));
  value = 2;
  await applyChanges(client, CORE_CHANGE_SCOPE, null);
  expect(read.value()).toBe(2);
  expect(other.value()).toBe(1);
});

it("shares one keyed observer, batches consumers, and retains data through refresh errors until retry succeeds", async () => {
  const client = setup();
  let value = 1;
  let failure = false;
  const requested: string[][] = [];
  const owner = createLiveKeyedQueryOwner({
    client,
    queryKey: ["keyed"],
    scope: CORE_CHANGE_SCOPE,
    collection,
    read: async (keys) => {
      requested.push([...keys]);
      if (failure) throw new Error("offline");
      return {
        result: Object.fromEntries(keys.map((key) => [key, value])),
        dependencies: changesOf([]),
        keyDependencies: Object.fromEntries(
          Object.entries(
            Object.fromEntries(keys.map((key) => [key, [`item:${key}`]])),
          ).map(([key, values]) => [key, changesOf(values)]),
        ),
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
  await applyChanges(client, CORE_CHANGE_SCOPE, changesOf(["item:a"]));
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
  const owner = createLiveKeyedQueryOwner({
    client,
    queryKey: ["dormant"],
    scope: CORE_CHANGE_SCOPE,
    collection,
    read: async () => {
      const captured = value;
      if (first) {
        first = false;
        await gate.promise;
      }
      return {
        result: { a: captured },
        dependencies: changesOf(["item:a"]),
        keyDependencies: {},
      };
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

it("refreshes only keys matched by key dependencies and all keys matched by response dependencies", async () => {
  const client = setup();
  const requested: string[][] = [];
  let value = 1;
  const owner = createLiveKeyedQueryOwner({
    client,
    queryKey: ["precise"],
    scope: CORE_CHANGE_SCOPE,
    collection,
    read: async (keys) => {
      requested.push([...keys]);
      return {
        result: Object.fromEntries(keys.map((key) => [key, value])),
        dependencies: changesOf(["board"]),
        keyDependencies: Object.fromEntries(
          Object.entries(
            Object.fromEntries(keys.map((key) => [key, [`item:${key}`]])),
          ).map(([key, values]) => [key, changesOf(values)]),
        ),
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
  await applyChanges(client, CORE_CHANGE_SCOPE, changesOf(["item:a"]));
  expect(requested).toEqual([["a"]]);
  expect(owner.observer.getCurrentResult().data).toEqual({
    result: { a: 2, b: 1 },
    dependencies: changesOf(["board"]),
    keyDependencies: Object.fromEntries(
      Object.entries({ a: ["item:a"], b: ["item:b"] }).map(([key, values]) => [
        key,
        changesOf(values),
      ]),
    ),
  });
  requested.length = 0;
  value = 3;
  await applyChanges(client, CORE_CHANGE_SCOPE, changesOf(["board"]));
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
      dependencies: changesOf([]),
      keyDependencies: Object.fromEntries(
        Object.entries(
          Object.fromEntries(keys.map((key) => [key, [`item:${key}`]])),
        ).map(([key, values]) => [key, changesOf(values)]),
      ),
    });
    const read = vi.fn(async (keys: readonly string[]) =>
      response(keys, value),
    );
    const owner = createLiveKeyedQueryOwner({
      client,
      queryKey: ["partial"],
      scope: CORE_CHANGE_SCOPE,
      collection,
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
    const first = applyChanges(
      client,
      CORE_CHANGE_SCOPE,
      changesOf(["item:a"]),
    );
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    value = 3;
    if (failure) read.mockRejectedValueOnce(new Error("offline"));
    const second = applyChanges(
      client,
      CORE_CHANGE_SCOPE,
      changesOf(["item:b"]),
    );
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
    dependencies: changesOf([]),
    keyDependencies: Object.fromEntries(
      Object.entries({ a: ["item:a"] }).map(([key, values]) => [
        key,
        changesOf(values),
      ]),
    ),
  }));
  read.mockRejectedValueOnce(new Error("transient"));
  const owner = createLiveKeyedQueryOwner({
    client,
    queryKey: ["defaults"],
    scope: CORE_CHANGE_SCOPE,
    collection,
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
    dependencies: changesOf([]),
    keyDependencies: Object.fromEntries(
      Object.entries(
        Object.fromEntries(keys.map((key) => [key, [`item:${key}`]])),
      ).map(([key, values]) => [key, changesOf(values)]),
    ),
  });
  const read = vi.fn(async (keys: readonly string[]) => response(keys, value));
  const owner = createLiveKeyedQueryOwner({
    client,
    queryKey: ["membership"],
    scope: CORE_CHANGE_SCOPE,
    collection,
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
  const invalidation = applyChanges(
    client,
    CORE_CHANGE_SCOPE,
    changesOf(["item:a"]),
  );
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

describe("optimistic tagged mutations", () => {
  const outcome = () => ({ result: "saved", changes: changesOf(["item:a"]) });
  function prediction(client: QueryClient, value: number) {
    return {
      client,
      optimistic: [
        optimisticQueryUpdate<Data>(["a"], (current) => ({
          ...current,
          value,
        })),
      ],
    };
  }

  it("shares predictions immediately and holds them through other invalidations until all re-reads settle", async () => {
    const client = setup();
    let value = 1;
    const read = observe(client, "a", async () => ({
      value,
      dependencies: changesOf(["item:a"]),
    }));
    await vi.waitFor(() => expect(read.value()).toBe(1));
    const second = new QueryObserver(client, read.observer.options);
    const seen: number[] = [];
    disposers.push(
      second.subscribe((result) => {
        if (result.data) seen.push(result.data.value);
      }),
    );
    const write = deferred<ReturnType<typeof outcome>>();
    const mutation = runLiveMutation(
      (dependencies) => applyChanges(client, CORE_CHANGE_SCOPE, dependencies),
      () => write.promise,
      prediction(client, 2),
    );
    expect(read.value()).toBe(2);
    expect(second.getCurrentResult().data?.value).toBe(2);
    value = 3;
    await applyChanges(client, CORE_CHANGE_SCOPE, changesOf(["item:a"]));
    expect(read.value()).toBe(2);
    const fresh = deferred<Data>();
    read.fn.mockImplementationOnce(() => fresh.promise);
    write.resolve(outcome());
    await vi.waitFor(() => expect(read.fn).toHaveBeenCalledTimes(3));
    await expect(mutation).resolves.toBe("saved");
    expect(read.value()).toBe(2);
    expect(second.getCurrentResult().data?.value).toBe(2);
    fresh.resolve({ value: 4, dependencies: changesOf(["item:a"]) });
    await vi.waitFor(() => expect(read.value()).toBe(4));
    expect(second.getCurrentResult().data?.value).toBe(4);
    expect(seen.every((value) => value === 2 || value === 4)).toBe(true);
  });

  it("rolls back a rejected write and leaves the error for the caller", async () => {
    const client = setup();
    const read = observe(client, "a", async () => ({
      value: 1,
      dependencies: changesOf(["item:a"]),
    }));
    await vi.waitFor(() => expect(read.value()).toBe(1));
    const write = deferred<ReturnType<typeof outcome>>();
    const mutation = runLiveMutation(
      (dependencies) => applyChanges(client, CORE_CHANGE_SCOPE, dependencies),
      () => write.promise,
      prediction(client, 2),
    );
    expect(read.value()).toBe(2);
    write.reject(new Error("write offline"));
    await expect(mutation).rejects.toThrow("write offline");
    expect(read.value()).toBe(1);
  });

  it.each([0, 1])(
    "rolls back only the rejected field when overlapping settings settle in order %s",
    async (first) => {
      const client = setup();
      const queryKey = ["settings"];
      type Settings = { archive: boolean; delete: boolean };
      let settings = { archive: false, delete: false };
      const observer = new QueryObserver(client, {
        queryKey,
        ...liveQueryOptions<Settings>(client, queryKey, {
          scope: CORE_CHANGE_SCOPE,
          dependenciesOf: () => changesOf(["item:a"]),
        }),
        queryFn: () => runLiveRead(client, queryKey, async () => settings),
      });
      disposers.push(observer.subscribe(() => {}));
      await vi.waitFor(() =>
        expect(observer.getCurrentResult().data).toEqual({
          archive: false,
          delete: false,
        }),
      );
      const writes = [
        deferred<ReturnType<typeof outcome>>(),
        deferred<ReturnType<typeof outcome>>(),
      ];
      const mutations = writes.map((write, index) =>
        runLiveMutation(
          (dependencies) =>
            applyChanges(client, CORE_CHANGE_SCOPE, dependencies),
          () => write.promise,
          {
            client,
            optimistic: [
              optimisticQueryUpdate<Settings>(queryKey, (current) => ({
                ...current,
                [index === 0 ? "archive" : "delete"]: true,
              })),
            ],
          },
        ).catch(() => undefined),
      );
      expect(observer.getCurrentResult().data).toEqual({
        archive: true,
        delete: true,
      });
      const finish = async (index: number) => {
        if (index === 0) writes[0]!.reject(new Error("archive rejected"));
        else {
          settings = { archive: false, delete: true };
          writes[1]!.resolve(outcome());
        }
        await mutations[index];
      };
      await finish(first);
      expect(observer.getCurrentResult().data).toEqual({
        archive: first !== 0,
        delete: true,
      });
      await finish(1 - first);
      expect(observer.getCurrentResult().data).toEqual({
        archive: false,
        delete: true,
      });
    },
  );

  it("keeps accepted predictions and a refresh error until Retry reads fresh server data", async () => {
    const client = setup();
    const read = observe(client, "a", async () => ({
      value: 1,
      dependencies: changesOf(["item:a"]),
    }));
    await vi.waitFor(() => expect(read.value()).toBe(1));
    read.fn.mockRejectedValueOnce(new Error("read offline"));
    await runLiveMutation(
      (dependencies) => applyChanges(client, CORE_CHANGE_SCOPE, dependencies),
      async () => outcome(),
      prediction(client, 2),
    );
    expect(read.value()).toBe(2);
    await vi.waitFor(() =>
      expect(read.observer.getCurrentResult().error?.message).toBe(
        "read offline",
      ),
    );
    read.fn.mockResolvedValueOnce({
      value: 3,
      dependencies: changesOf(["item:a"]),
    });
    await read.observer.refetch();
    expect(read.value()).toBe(3);
    expect(read.observer.getCurrentResult().error).toBeNull();
  });

  it.each([
    [true, true, 0],
    [true, false, 0],
    [false, true, 0],
    [false, false, 0],
    [true, true, 1],
    [true, false, 1],
    [false, true, 1],
    [false, false, 1],
  ] as const)(
    "protects later predictions (earlier=%s later=%s first=%s)",
    async (earlier, later, first) => {
      const client = setup();
      let value = 0;
      const read = observe(client, "a", async () => ({
        value,
        dependencies: changesOf(["item:a"]),
      }));
      await vi.waitFor(() => expect(read.value()).toBe(0));
      const writes = [
        deferred<ReturnType<typeof outcome>>(),
        deferred<ReturnType<typeof outcome>>(),
      ];
      const mutations = writes.map((write, index) =>
        runLiveMutation(
          (dependencies) =>
            applyChanges(client, CORE_CHANGE_SCOPE, dependencies),
          () => write.promise,
          prediction(client, index + 1),
        ).then(
          () => true,
          () => false,
        ),
      );
      expect(read.value()).toBe(2);
      const success = [earlier, later];
      const finish = async (index: number) => {
        if (success[index]) {
          value = (index + 1) * 10;
          writes[index]!.resolve(outcome());
        } else writes[index]!.reject(new Error("rejected"));
        await expect(mutations[index]).resolves.toBe(success[index]);
      };
      await finish(first);
      await vi.waitFor(() =>
        expect(read.value()).toBe(first === 0 ? 2 : later ? 20 : 1),
      );
      await finish(1 - first);
      await vi.waitFor(() =>
        expect(read.value()).toBe(later ? 20 : earlier ? 10 : 0),
      );
      value = 99;
      await applyChanges(client, CORE_CHANGE_SCOPE, changesOf(["item:a"]));
      expect(read.value()).toBe(99);
    },
  );

  it("drops an unsubscribed stale row with an accepted prediction and reads it fresh on resubscribe", async () => {
    const client = setup();
    const queryKey = ["optimistic-rows"];
    let value = 1;
    let failure = false;
    const owner = createLiveKeyedQueryOwner({
      client,
      queryKey,
      scope: CORE_CHANGE_SCOPE,
      collection,
      read: async (keys) => {
        if (failure && keys.includes("a")) throw new Error("read offline");
        return {
          result: Object.fromEntries(keys.map((key) => [key, value])),
          dependencies: changesOf([]),
          keyDependencies: Object.fromEntries(
            Object.entries(
              Object.fromEntries(keys.map((key) => [key, [`item:${key}`]])),
            ).map(([key, values]) => [key, changesOf(values)]),
          ),
        };
      },
    });
    const stopA = owner.subscribe(["a"], () => {});
    disposers.push(
      stopA,
      owner.subscribe(["b"], () => {}),
    );
    await vi.waitFor(() =>
      expect(owner.observer.getCurrentResult().data?.result).toEqual({
        a: 1,
        b: 1,
      }),
    );
    failure = true;
    await runLiveMutation(
      (dependencies) => applyChanges(client, CORE_CHANGE_SCOPE, dependencies),
      async () => outcome(),
      {
        client,
        optimistic: [optimisticKeyedUpdate(collection, "a", () => 2)],
      },
    );
    expect(owner.observer.getCurrentResult().data?.result).toEqual({
      a: 2,
      b: 1,
    });
    stopA();
    value = 3;
    await applyChanges(client, CORE_CHANGE_SCOPE, changesOf(["item:b"]));
    expect(owner.observer.getCurrentResult().data?.result).toEqual({ b: 3 });
    failure = false;
    value = 4;
    disposers.push(owner.subscribe(["a"], () => {}));
    await vi.waitFor(() =>
      expect(owner.observer.getCurrentResult().data?.result).toEqual({
        a: 4,
        b: 3,
      }),
    );
  });
});

it("re-reads when a write completes between a read resolving and its cache commit", async () => {
  const client = setup();
  let value = 1;
  const read = observe(client, "commit-gap", async () => ({
    value,
    dependencies: changesOf(["item:a"]),
  }));
  await vi.waitFor(() => expect(read.value()).toBe(1));
  const old = deferred<Data>();
  const write = deferred<{ result: string; changes: ReadChange[] }>();
  read.fn.mockImplementationOnce(() => old.promise);
  const refreshing = read.observer.refetch();
  const mutation = runLiveMutation(
    (dependencies) => applyChanges(client, CORE_CHANGE_SCOPE, dependencies),
    () => write.promise,
    {
      client,
      optimistic: [
        optimisticQueryUpdate<Data>(["commit-gap"], (current) => ({
          ...current,
          value: 2,
        })),
      ],
    },
  );
  expect(read.value()).toBe(2);
  old.resolve({ value: 1, dependencies: changesOf(["item:a"]) });
  queueMicrotask(() => {
    value = 3;
    write.resolve({ result: "saved", changes: changesOf(["item:a"]) });
  });
  await mutation;
  await refreshing;
  await vi.waitFor(() => expect(read.value()).toBe(3));
});

it("does not show a row read that started before the write once a later batch refreshes", async () => {
  const client = setup();
  const queryKey = ["row-receipts"];
  let value = 1;
  const response = (keys: readonly string[], current: number) => ({
    result: Object.fromEntries(keys.map((key) => [key, current])),
    dependencies: changesOf([]),
    keyDependencies: Object.fromEntries(
      Object.entries(
        Object.fromEntries(keys.map((key) => [key, [`item:${key}`]])),
      ).map(([key, values]) => [key, changesOf(values)]),
    ),
  });
  const read = vi.fn(async (keys: readonly string[]) => response(keys, value));
  const owner = createLiveKeyedQueryOwner({
    client,
    queryKey,
    scope: CORE_CHANGE_SCOPE,
    collection,
    read,
  });
  const stopA = owner.subscribe(["a"], () => {});
  disposers.push(
    stopA,
    owner.subscribe(["b"], () => {}),
  );
  await vi.waitFor(() =>
    expect(owner.observer.getCurrentResult().data?.result).toEqual({
      a: 1,
      b: 1,
    }),
  );
  const write = deferred<{ result: string; changes: ReadChange[] }>();
  const mutation = runLiveMutation(
    (dependencies) => applyChanges(client, CORE_CHANGE_SCOPE, dependencies),
    () => write.promise,
    {
      client,
      optimistic: [optimisticKeyedUpdate(collection, "a", () => 2)],
    },
  );
  const old = deferred<ReturnType<typeof response>>();
  read.mockImplementationOnce(() => old.promise);
  const first = applyChanges(client, CORE_CHANGE_SCOPE, changesOf(["item:a"]));
  await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  stopA();
  const second = applyChanges(client, CORE_CHANGE_SCOPE, changesOf(["item:b"]));
  old.resolve(response(["a"], 1));
  queueMicrotask(() => {
    value = 3;
    write.resolve({ result: "saved", changes: changesOf(["item:a"]) });
  });
  await Promise.all([first, second, mutation]);
  expect(owner.observer.getCurrentResult().data?.result).toEqual({ b: 3 });
  disposers.push(owner.subscribe(["a"], () => {}));
  await vi.waitFor(() =>
    expect(owner.observer.getCurrentResult().data?.result).toEqual({
      a: 3,
      b: 3,
    }),
  );
});

function changesOf(values: readonly string[]): ReadChange[] {
  return values.map((entity) => ({ entity, changes: ["updated"] }));
}
async function applyChanges(
  client: QueryClient,
  scope: string,
  changes: readonly ReadChange[] | null,
) {
  if (changes === null) await applyQueryChange(client, scope, null);
  else
    await Promise.all(
      changes.map((change) => applyQueryChange(client, scope, change)),
    );
}
