import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createConnection,
  migrate,
  getPluginKvValue,
  setPluginKvValue,
  deletePluginKvValue,
  listPluginKvKeys,
} from "@bb/db";
import type { PluginKvStorage } from "@get-bb/plugin-sdk";
import {
  computeCost,
  createDevboxStore,
  latestScheduledAction,
  pruneSnapshots,
  sleepWithBackup,
} from "./devbox.js";
import type { Droplet, Snapshot, Vendor } from "./vendor.js";

const databases: ReturnType<typeof createConnection>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.$client.close();
});
function setup() {
  const db = createConnection(":memory:");
  migrate(db);
  databases.push(db);
  const kv: PluginKvStorage = {
    async get<T>(key: string): Promise<T | undefined> {
      const raw = getPluginKvValue(db, "digitalocean", key);
      return raw === undefined ? undefined : JSON.parse(raw);
    },
    async set(key, value) {
      setPluginKvValue(db, "digitalocean", key, JSON.stringify(value));
    },
    async delete(key) {
      deletePluginKvValue(db, "digitalocean", key);
    },
    async list(prefix) {
      return listPluginKvKeys(db, "digitalocean", prefix);
    },
  };
  const store = createDevboxStore(kv, () => 1_000_000);
  const order: string[] = [];
  const droplet: Droplet = { id: 42, name: "test", tags: [], status: "active" };
  const snapshots: Snapshot[] = [];
  const api = {
    get: vi.fn(async () => ({ ...droplet })),
    find: vi.fn(async () => ({ ...droplet })),
    create: vi.fn(async () => ({ ...droplet })),
    power: vi.fn(async () => {
      order.push("shutdown");
      droplet.status = "off";
    }),
    snapshots: vi.fn(async () => [...snapshots]),
    snapshot: vi.fn(async (_id: number, name: string) => {
      order.push("snapshot");
      expect(droplet.status).toBe("off");
      snapshots.push({
        id: "new",
        name,
        size_gigabytes: 2.5,
        created_at: "2026-09-07T12:00:00Z",
        resource_id: "42",
      });
    }),
    deleteSnapshot: vi.fn(async (id: string) => {
      order.push(`delete:${id}`);
      snapshots.splice(
        snapshots.findIndex((item) => item.id === id),
        1,
      );
    }),
    destroy: vi.fn(async () => {}),
    inventory: vi.fn(async () => ({
      droplet: null,
      sizes: [],
      snapshots,
      reservedIps: [],
    })),
  } satisfies Vendor;
  return {
    kv,
    store,
    order,
    droplet,
    snapshots,
    api,
    args: {
      hostId: "host-test",
      dropletId: 42,
      api,
      store,
      signal: new AbortController().signal,
      now: () => 1_000_000,
    },
  };
}
const snapshot = (
  id: string,
  name = `bb-devbox-host-test-${id}`,
  resource_id = "42",
): Snapshot => ({
  id,
  name,
  resource_id,
  size_gigabytes: 1,
  created_at: `2026-09-0${id}T12:00:00Z`,
});

describe("durable devbox backups", () => {
  it("confirms graceful shutdown before snapshot and persists metadata across store restart", async () => {
    const test = setup();
    await sleepWithBackup(test.args);
    expect(test.order).toEqual(["shutdown", "snapshot"]);
    expect(test.droplet.status).toBe("off");
    const restarted = createDevboxStore(test.kv);
    expect(await restarted.get("host-test")).toMatchObject({
      power: "off",
      backupStatus: "complete",
      snapshots: [
        { id: "new", size_gigabytes: 2.5, name: "bb-devbox-host-test-1000000" },
      ],
    });
  });
  it("keeps the previous snapshot and records off, backup failed after shutdown", async () => {
    const test = setup();
    const previous = snapshot("1");
    test.snapshots.push(previous);
    await test.store.set("host-test", {
      ...(await test.store.get("host-test")),
      snapshots: [previous],
    });
    test.api.snapshot.mockRejectedValueOnce(new Error("vendor failure"));
    await sleepWithBackup(test.args);
    expect(test.droplet.status).toBe("off");
    expect(await test.store.get("host-test")).toMatchObject({
      backupStatus: "off, backup failed",
      snapshots: [previous],
    });
    expect(test.api.deleteSnapshot).not.toHaveBeenCalled();
  });
  it("reconciles a successful but disconnected submission by its durable name", async () => {
    const test = setup();
    test.api.snapshot.mockImplementationOnce(async (_id, name) => {
      test.snapshots.push({ ...snapshot("1"), name });
      throw new Error("response lost");
    });
    await sleepWithBackup(test.args);
    await sleepWithBackup(test.args);
    expect(test.api.snapshot).toHaveBeenCalledOnce();
    expect((await test.store.get("host-test")).backupStatus).toBe("complete");
  });
  it("prunes old owned snapshots only, after recording the new snapshot", async () => {
    const test = setup();
    test.snapshots.push(
      snapshot("1"),
      snapshot("2"),
      snapshot("3", "user-backup"),
      snapshot("4", "bb-devbox-other-4", "90"),
    );
    test.api.deleteSnapshot.mockImplementation(async (id) => {
      expect(
        (await test.store.get("host-test")).snapshots.some(
          (item) => item.id === "new",
        ),
      ).toBe(true);
      test.order.push(`delete:${id}`);
    });
    await sleepWithBackup(test.args);
    expect(test.order).toEqual(["shutdown", "snapshot", "delete:1"]);
    expect(test.api.deleteSnapshot).toHaveBeenCalledOnce();
  });
  it("remove prunes owned snapshots while preserving user and other machine inventory", async () => {
    const test = setup();
    test.snapshots.push(
      snapshot("1"),
      snapshot("2", "manual"),
      snapshot("3", "bb-devbox-other-3", "90"),
    );
    await pruneSnapshots({ ...test.args, keep: 0 });
    expect(test.snapshots.map((item) => item.id)).toEqual(["2", "3"]);
  });
});

describe("weekday scheduling", () => {
  const schedule = {
    weekdays: [1, 2, 3, 4, 5],
    sleep: "19:00",
    wake: "08:00",
    timezone: "America/Los_Angeles",
  };
  it("fires in the explicit timezone and ignores an already completed minute", () => {
    const at = Date.parse("2026-09-08T02:00:00Z");
    expect(latestScheduledAction(schedule, at - 60_000, at)).toEqual({
      at,
      action: "sleep",
    });
    expect(latestScheduledAction(schedule, at, at)).toBeNull();
  });
  it("catches up only the latest missed action, bounded to eight days", () => {
    const now = Date.parse("2026-09-08T18:00:00Z");
    expect(latestScheduledAction(schedule, now - 4 * 86_400_000, now)).toEqual({
      at: Date.parse("2026-09-08T15:00:00Z"),
      action: "wake",
    });
  });
  it("skips nonexistent DST local times", () => {
    const spring = { ...schedule, weekdays: [0], wake: "02:30" };
    expect(
      latestScheduledAction(
        spring,
        Date.parse("2026-03-08T08:00:00Z"),
        Date.parse("2026-03-08T12:00:00Z"),
      ),
    ).toBeNull();
  });
});

it("estimates off compute, actual snapshot GB and account-wide unassigned IP charges", async () => {
  const test = setup();
  const state = await test.store.get("host-test");
  state.power = "off";
  state.powerSince = 0;
  const result = computeCost(
    {
      droplet: {
        ...test.droplet,
        status: "off",
        created_at: "1970-01-01T00:00:00Z",
        size_slug: "small",
      },
      sizes: [{ slug: "small", price_hourly: 0.006, price_monthly: 4 }],
      snapshots: [{ ...snapshot("1"), size_gigabytes: 20 }],
      reservedIps: [
        { ip: "192.0.2.1", droplet: null },
        { ip: "192.0.2.2", droplet: { id: 42 } },
      ],
    },
    state,
    "host-test",
    3_600_000,
  );
  expect(result).toMatchObject({
    dropletStatus: "off",
    offHoursObserved: 1,
    dropletAccruedEstimate: 0.01,
    snapshotMonthlyEstimate: 1.2,
    monthlyEstimate: 5.2,
    accountUnassignedIpMonthlyEstimate: 5,
  });
});
