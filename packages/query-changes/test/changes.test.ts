import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { type ReadChange, type ReadChangeReaction } from "@bb/domain";
import {
  applyQueryChange,
  createLiveKeyedQueryOwner,
  KeyedCollection,
  optimisticKeyedUpdate,
  liveQueryOptions,
  optimisticQueryUpdate,
  runLiveMutation,
  runLiveRead,
} from "../src/index.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const stop of cleanups.splice(0)) stop();
});

type Row = { value: number };
const react = (
  data: Row | undefined,
  change: ReadChange,
): ReadChangeReaction<Row> => {
  if (
    change.entity !== "row" ||
    change.id !== "a" ||
    !change.changes.includes("updated")
  )
    return undefined;
  return data && typeof change.value === "number"
    ? { action: "patch", data: { value: change.value } }
    : { action: "reload" };
};

it.each(["core", "plugin"])(
  "%s reads share payload patches, selective reloads and in-flight repair",
  async (surface) => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const read = vi.fn(async () => ({ value: 1 }));
    const key = [surface];
    const observer = new QueryObserver(client, {
      queryKey: key,
      staleTime: Infinity,
      ...liveQueryOptions<Row>(client, key, {
        scope: surface,
        dependenciesOf: () => [],
        reactToChange: react,
      }),
      queryFn: () => runLiveRead(client, key, read),
    });
    cleanups.push(
      observer.subscribe(() => {}),
      () => client.clear(),
    );
    const apply = (change: ReadChange) =>
      applyQueryChange(client, surface, change);
    await vi.waitFor(() =>
      expect(observer.getCurrentResult().data).toEqual({ value: 1 }),
    );
    await apply({ entity: "row", id: "b", changes: ["updated"], value: 8 });
    await apply({ entity: "row", id: "a", changes: ["renamed"], value: 8 });
    await apply({ entity: "row", id: "a", changes: ["updated"], value: 2 });
    expect(observer.getCurrentResult().data).toEqual({ value: 2 });
    expect(read).toHaveBeenCalledTimes(1);
    read.mockResolvedValue({ value: 3 });
    await apply({ entity: "row", id: "a", changes: ["updated"] });
    expect(observer.getCurrentResult().data).toEqual({ value: 3 });
    let release!: (row: Row) => void;
    read
      .mockImplementationOnce(
        () =>
          new Promise<Row>((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValue({ value: 5 });
    const pending = observer.refetch();
    const changed = apply({
      entity: "row",
      id: "a",
      changes: ["updated"],
      value: 5,
    });
    expect(observer.getCurrentResult().data).toEqual({ value: 5 });
    release({ value: 3 });
    await Promise.all([pending, changed]);
    expect(observer.getCurrentResult().data).toEqual({ value: 5 });
    expect(read).toHaveBeenCalledTimes(4);
  },
);

it.each(["accepted", "refused"])(
  "rebases pushed values beneath an optimistic edit (%s)",
  async (outcome) => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const key = ["optimistic"];
    const observer = new QueryObserver(client, {
      queryKey: key,
      staleTime: Infinity,
      ...liveQueryOptions<Row>(client, key, {
        scope: "plugin",
        dependenciesOf: () => [],
        reactToChange: react,
      }),
      queryFn: () => runLiveRead(client, key, async () => ({ value: 1 })),
    });
    cleanups.push(
      observer.subscribe(() => {}),
      () => client.clear(),
    );
    await vi.waitFor(() =>
      expect(observer.getCurrentResult().data).toEqual({ value: 1 }),
    );
    let reject!: (error: Error) => void;
    let accept!: (result: { result: null; changes: ReadChange[] }) => void;
    const write = runLiveMutation(
      async (changes) => {
        for (const change of changes)
          await applyQueryChange(client, "plugin", change);
      },
      () =>
        new Promise<{ result: null; changes: ReadChange[] }>((done, fail) => {
          accept = done;
          reject = fail;
        }),
      {
        client,
        optimistic: [optimisticQueryUpdate<Row>(key, () => ({ value: 10 }))],
      },
    ).catch((error: Error) => error);
    await applyQueryChange(client, "plugin", {
      entity: "row",
      id: "a",
      changes: ["updated"],
      value: 4,
    });
    expect(observer.getCurrentResult().data).toEqual({ value: 10 });
    if (outcome === "refused") {
      reject(new Error("write refused"));
      expect(await write).toBeInstanceOf(Error);
    } else {
      accept({
        result: null,
        changes: [{ entity: "row", id: "a", changes: ["updated"], value: 4 }],
      });
      await write;
      await vi.waitFor(() =>
        expect(observer.getCurrentResult().data).toEqual({ value: 4 }),
      );
    }
    expect(observer.getCurrentResult().data).toEqual({ value: 4 });
    await applyQueryChange(client, "plugin", {
      entity: "row",
      id: "a",
      changes: ["updated"],
      value: 5,
    });
    expect(observer.getCurrentResult().data).toEqual({ value: 5 });
  },
);

it("reports a failed reducer and reloads its read", async () => {
  const scope = "plugin";
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const failure = new Error("invalid change value");
  const report = vi.spyOn(console, "error").mockImplementation(() => {});
  const read = vi.fn(async () => ({ value: 1 }));
  const key = [scope, "failed-reducer"];
  const reducer = () => {
    throw failure;
  };
  const observer = new QueryObserver(client, {
    queryKey: key,
    staleTime: Infinity,
    ...liveQueryOptions<Row>(client, key, {
      scope,
      dependenciesOf: () => [],
      reactToChange: reducer,
    }),
    queryFn: () => runLiveRead(client, key, read),
  });
  const stop = observer.subscribe(() => {});
  try {
    await vi.waitFor(() =>
      expect(observer.getCurrentResult().data).toEqual({ value: 1 }),
    );
    read.mockResolvedValue({ value: 2 });
    const change = { entity: "row", id: "a", changes: ["updated"] };
    await applyQueryChange(client, scope, change);
    expect(observer.getCurrentResult().data).toEqual({ value: 2 });
    expect(read).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenCalledWith(
      "Read change reducer failed; reloading",
      change,
      failure,
    );
  } finally {
    stop();
    client.clear();
    report.mockRestore();
  }
});

it("rolls back a pending row field without losing a pushed field", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const collection = new KeyedCollection<{ x: number; y: number }>("patches");
  const owner = createLiveKeyedQueryOwner({
    client,
    collection,
    scope: "plugin",
    queryKey: ["pushed-row"],
    read: async () => ({
      result: { a: { x: 1, y: 2 } },
      dependencies: [],
      keyDependencies: {},
    }),
    reactToChange: (data, change) =>
      data && change.entity === "row"
        ? {
            action: "patch",
            data: {
              ...data,
              result: { ...data.result, a: { ...data.result.a, x: 3 } },
            },
          }
        : undefined,
  });
  const stop = owner.subscribe(["a"], () => {});
  let refuse!: (error: Error) => void;
  try {
    await vi.waitFor(() =>
      expect(owner.observer.getCurrentResult().data?.result.a).toEqual({
        x: 1,
        y: 2,
      }),
    );
    const write = runLiveMutation(
      async () => {},
      () =>
        new Promise<{ result: null; changes: ReadChange[] }>(
          (_resolve, reject) => {
            refuse = reject;
          },
        ),
      {
        client,
        optimistic: [
          optimisticKeyedUpdate(collection, "a", (row) => ({ ...row, y: 10 })),
        ],
      },
    ).catch((error) => error);
    expect(owner.observer.getCurrentResult().data?.result.a).toEqual({
      x: 1,
      y: 10,
    });
    await applyQueryChange(client, "plugin", {
      entity: "row",
      id: "a",
      changes: ["updated"],
    });
    expect(owner.observer.getCurrentResult().data?.result.a).toEqual({
      x: 3,
      y: 10,
    });
    refuse(new Error("refused"));
    await write;
    expect(owner.observer.getCurrentResult().data?.result.a).toEqual({
      x: 3,
      y: 2,
    });
  } finally {
    stop();
    client.clear();
  }
});
