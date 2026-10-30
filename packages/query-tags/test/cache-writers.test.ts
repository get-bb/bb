// @vitest-environment jsdom
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";
import {
  optimisticQueryUpdate,
  runTaggedRead,
  taggedQueryOptions,
  type TaggedMutationOutcome,
} from "../src/index.js";
import { mutateOnce } from "./mutate-once.js";

const TEST_SCOPE = "test";

type Row = { id: string; pinnedAt: number | null; status: string };
const queryKey = ["row"];
const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

async function setup(row: Row) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  let server = row;
  const observer = new QueryObserver<Row>(client, {
    queryKey,
    ...taggedQueryOptions(client, queryKey, {
      scope: TEST_SCOPE,
      tagsOf: () => ["row"],
    }),
    queryFn: () =>
      runTaggedRead(client, queryKey, async () => structuredClone(server)),
  });
  disposers.push(
    observer.subscribe(() => {}),
    () => client.clear(),
  );
  await observer.refetch();
  return {
    client,
    row: () => client.getQueryData<Row>(queryKey),
    setServer(next: Row) {
      server = next;
    },
    refetch: () => observer.refetch(),
  };
}

function pin(client: QueryClient, pinnedAt: number) {
  let fail!: (error: Error) => void;
  let accept!: () => void;
  const outcome = new Promise<TaggedMutationOutcome<undefined>>(
    (resolve, reject) => {
      fail = reject;
      accept = () => resolve({ result: undefined, invalidated: [] });
    },
  );
  const write = mutateOnce(
    async () => {},
    () => outcome,
    {
      client,
      optimistic: [
        optimisticQueryUpdate<Row>(queryKey, (row) => ({ ...row, pinnedAt })),
      ],
    },
  ).catch(() => {});
  return {
    fail: async () => {
      fail(new Error("refused"));
      await write;
    },
    accept: async () => {
      accept();
      await write;
    },
  };
}

const patch = (change: Partial<Row>) => (row?: Row) =>
  row && { ...row, ...change };

describe("cache writes under a prediction", () => {
  it("rolls back a prediction under an unrelated cache write", async () => {
    const cache = await setup({ id: "a", pinnedAt: null, status: "idle" });
    const write = pin(cache.client, 100);
    cache.client.setQueryData(queryKey, patch({ status: "running" }));
    expect(cache.row()).toEqual({ id: "a", pinnedAt: 100, status: "running" });

    await write.fail();

    expect(cache.row()).toEqual({ id: "a", pinnedAt: null, status: "running" });
  });

  it("keeps a foreign write to the predicted field after rollback", async () => {
    const cache = await setup({ id: "a", pinnedAt: null, status: "idle" });
    const write = pin(cache.client, 100);
    cache.client.setQueryData(queryKey, patch({ pinnedAt: 200 }));

    await write.fail();

    expect(cache.row()).toEqual({ id: "a", pinnedAt: 200, status: "idle" });
  });

  it("rolls back a prediction under a restored snapshot taken while it was visible", async () => {
    const cache = await setup({ id: "a", pinnedAt: null, status: "idle" });
    const write = pin(cache.client, 100);
    const snapshot = cache.row();
    cache.client.setQueryData(queryKey, patch({ status: "running" }));
    cache.client.setQueryData(queryKey, snapshot);

    await write.fail();

    expect(cache.row()).toEqual({ id: "a", pinnedAt: null, status: "idle" });
  });

  it("replaces an accepted prediction with the next confirmed read", async () => {
    const cache = await setup({ id: "a", pinnedAt: null, status: "idle" });
    const write = pin(cache.client, 100);
    cache.client.setQueryData(queryKey, patch({ status: "running" }));
    await write.accept();
    cache.setServer({ id: "a", pinnedAt: 150, status: "running" });

    await cache.refetch();

    expect(cache.row()).toEqual({ id: "a", pinnedAt: 150, status: "running" });
  });
});
