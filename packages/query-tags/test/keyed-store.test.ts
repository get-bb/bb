import { QueryClient } from "@tanstack/react-query";
import { afterEach, expect, it } from "vitest";
import {
  beginOptimisticMutation,
  confirmKeyedEntity,
  KeyedCollection,
  optimisticKeyedUpdate,
  readKeyedEntity,
  registerKeyedViews,
  type KeyedView,
} from "../src/index.js";

interface Row {
  id: string;
  status: string;
  version: number;
}

const rows = new KeyedCollection<Row>("versioned-rows");
const view: KeyedView<Row> = {
  collection: rows,
  slots: (data) => [{ key: "rows", items: (data as { rows: Row[] }).rows }],
  rebuild: (data, items) => ({ ...(data as object), rows: items.get("rows") }),
  keyOf: (item) => (item as Row).id,
  read(item, current, fresh) {
    const row = item as Row;
    if (
      current === undefined ||
      row.version > current.version ||
      (row.version === current.version && fresh)
    )
      return { ...row };
    return current;
  },
  write: (item, _prior, current) => ({ ...current, ...(item as Row) }),
  render: (_item, entity) => entity,
};

const clients: QueryClient[] = [];
afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
});

async function setup(row: Row) {
  const client = new QueryClient();
  clients.push(client);
  registerKeyedViews(client, (queryKey) =>
    queryKey[0] === "rows" ? view : undefined,
  );
  const read = (next: Row) =>
    client.fetchQuery({
      queryKey: ["rows"],
      queryFn: async () => ({ rows: [next] }),
      staleTime: 0,
    });
  await read(row);
  return {
    client,
    read,
    visible: () => readKeyedEntity(client, rows, row.id),
    predict: (change: (row: Row) => Row) =>
      beginOptimisticMutation(client, [
        optimisticKeyedUpdate(rows, row.id, change),
      ]),
  };
}

it("lets a read that started after acceptance replace an accepted prediction that changed the row's version", async () => {
  const s = await setup({ id: "a", status: "active", version: 1 });
  const write = s.predict((row) => ({
    ...row,
    status: "stopping",
    version: 9,
  }));
  write.accept();
  expect(s.visible()?.status).toBe("stopping");

  await s.read({ id: "a", status: "idle", version: 2 });
  expect(s.visible()).toEqual({ id: "a", status: "idle", version: 2 });
});

it("keeps server data that landed while the write was pending once a later read confirms the write", async () => {
  const s = await setup({ id: "a", status: "active", version: 1 });
  const write = s.predict((row) => ({ ...row, status: "stopping" }));
  await s.read({ id: "a", status: "idle", version: 2 });
  write.accept();
  expect(s.visible()?.status).toBe("stopping");

  await s.read({ id: "a", status: "idle", version: 2 });
  expect(s.visible()).toEqual({ id: "a", status: "idle", version: 2 });
});

it("replaces an accepted prediction with a server row confirmed directly and keeps it when the row cannot confirm", async () => {
  const s = await setup({ id: "a", status: "idle", version: 1 });
  const write = s.predict((row) => ({ ...row, status: "pinned" }));
  write.accept();

  expect(confirmKeyedEntity(s.client, rows, "a", () => undefined)).toBe(false);
  expect(s.visible()?.status).toBe("pinned");

  expect(
    confirmKeyedEntity(s.client, rows, "a", (current) => ({
      ...current,
      status: "pinned-on-server",
      version: 2,
    })),
  ).toBe(true);
  expect(s.visible()).toEqual({
    id: "a",
    status: "pinned-on-server",
    version: 2,
  });
});
