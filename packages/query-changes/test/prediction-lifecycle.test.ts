import type { ReadChange } from "@bb/domain";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, expect, it } from "vitest";
import {
  CORE_CHANGE_SCOPE,
  optimisticQueryUpdate,
  runLiveMutation,
  runLiveRead,
  liveQueryOptions,
  type LiveMutationOutcome,
  type LiveQueryOptimisticUpdate,
} from "../src/index.js";

type Row = { id: string; pinnedAt: number | null; status: string };
const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

function client() {
  const result = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  disposers.push(() => result.clear());
  return result;
}

function write(client: QueryClient, optimistic: LiveQueryOptimisticUpdate[]) {
  let settle!: (outcome: LiveMutationOutcome<number> | Error) => void;
  const done = runLiveMutation(
    async () => {},
    () =>
      new Promise<LiveMutationOutcome<number>>((resolve, reject) => {
        settle = (outcome) =>
          outcome instanceof Error ? reject(outcome) : resolve(outcome);
      }),
    { client, optimistic },
  ).catch(() => {});
  return {
    accept: async (pinnedAt: number) => {
      settle({ result: pinnedAt, changes: changesOf([]) });
      await done;
    },
    fail: async () => {
      settle(new Error("refused"));
      await done;
    },
  };
}

const pinRow = (queryKey: string[], predicted: number) =>
  optimisticQueryUpdate<Row, number>(queryKey, (row, result) => ({
    ...row,
    pinnedAt: result?.value ?? predicted,
  }));

function observe(client: QueryClient, queryKey: string[], row: () => Row) {
  const observer = new QueryObserver<Row>(client, {
    queryKey,
    ...liveQueryOptions(client, queryKey, {
      scope: CORE_CHANGE_SCOPE,
      dependenciesOf: () => changesOf([]),
    }),
    queryFn: () =>
      runLiveRead(client, queryKey, async () => structuredClone(row())),
  });
  disposers.push(observer.subscribe(() => {}));
  return observer;
}

it("shows the acknowledged value in place of the prediction", async () => {
  const cache = client();
  const server: Row = { id: "a", pinnedAt: null, status: "idle" };
  await observe(cache, ["row", "first"], () => server).refetch();
  const pending = write(cache, [pinRow(["row", "first"], 100)]);

  await pending.accept(250);

  expect(cache.getQueryData<Row>(["row", "first"])?.pinnedAt).toBe(250);
});

it("keeps writes to a cache without a read and settles to the acknowledged value", async () => {
  const cache = new QueryClient();
  disposers.push(() => cache.clear());
  cache.setQueryData<Row>(["row"], { id: "a", pinnedAt: null, status: "idle" });
  const failed = write(cache, [pinRow(["row"], 100)]);
  cache.setQueryData<Row>(
    ["row"],
    (row) => row && { ...row, status: "running" },
  );
  await failed.fail();
  expect(cache.getQueryData(["row"])).toEqual({
    id: "a",
    pinnedAt: null,
    status: "running",
  });

  const accepted = write(cache, [pinRow(["row"], 100)]);
  await accepted.accept(300);
  cache.setQueryData<Row>(["row"], (row) => row && { ...row, status: "idle" });
  expect(cache.getQueryData(["row"])).toEqual({
    id: "a",
    pinnedAt: 300,
    status: "idle",
  });
});

it("leaves predictions alone when an observer selects from the query", async () => {
  const cache = client();
  const queryKey = ["row", "selected"];
  const server: Row = { id: "a", pinnedAt: null, status: "idle" };
  await observe(cache, queryKey, () => server).refetch();
  const selected = new QueryObserver<Row, Error, string>(cache, {
    queryKey,
    ...liveQueryOptions(cache, queryKey, {
      scope: CORE_CHANGE_SCOPE,
      dependenciesOf: () => changesOf([]),
    }),
    enabled: false,
    select: (row) => `${row.id}:${row.pinnedAt}`,
  });
  disposers.push(selected.subscribe(() => {}));
  const pending = write(cache, [pinRow(queryKey, 100)]);
  expect(selected.getCurrentResult().data).toEqual("a:100");

  await pending.fail();

  expect(cache.getQueryData(queryKey)).toEqual(server);
  expect(selected.getCurrentResult().data).toEqual("a:null");
});

it("lets a write after acknowledgement replace the acknowledged value", async () => {
  const cache = client();
  const queryKey = ["row", "ordered"];
  let read: Promise<Row> = Promise.resolve({
    id: "a",
    pinnedAt: null,
    status: "idle",
  });
  const observer = new QueryObserver<Row>(cache, {
    queryKey,
    ...liveQueryOptions(cache, queryKey, {
      scope: CORE_CHANGE_SCOPE,
      dependenciesOf: () => changesOf([]),
    }),
    queryFn: () => runLiveRead(cache, queryKey, () => read),
  });
  disposers.push(observer.subscribe(() => {}));
  await observer.refetch();
  const row = () => cache.getQueryData<Row>(queryKey);
  let finishStale!: (row: Row) => void;
  read = new Promise((resolve) => {
    finishStale = resolve;
  });
  const stale = observer.refetch();
  const pending = write(cache, [pinRow(queryKey, 100)]);
  await pending.accept(250);

  cache.setQueryData<Row>(
    queryKey,
    (current) => current && { ...current, pinnedAt: 260 },
  );
  expect(row()?.pinnedAt).toBe(260);

  finishStale({ id: "a", pinnedAt: null, status: "idle" });
  await stale;
  expect(row()?.pinnedAt).toBe(250);

  read = Promise.resolve({ id: "a", pinnedAt: 270, status: "idle" });
  await observer.refetch();
  expect(row()?.pinnedAt).toBe(270);
});

function changesOf(values: readonly string[]): ReadChange[] {
  return values.map((entity) => ({ entity, changes: ["updated"] }));
}
