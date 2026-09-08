import {
  createConnection,
  migrate,
  getPluginKvValue,
  setPluginKvValue,
  deletePluginKvValue,
  listPluginKvKeys,
} from "@bb/db";
import type { JsonValue } from "@get-bb/plugin-sdk";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";
import { createDigitalOceanPlugin } from "./server.js";
import { allocationName, type Droplet, type Vendor } from "./vendor.js";

const context = () => ({
  key: "creation-key",
  attempt: 1,
  project: null,
  gitRemote: null,
  inputs: { region: "nyc3", size: "s-2vcpu-4gb" },
  report: { step: vi.fn(), log: vi.fn() },
  signal: new AbortController().signal,
  checkpoint: vi.fn(async (_resource: JsonValue) => {}),
});
const droplet = (): Droplet => ({
  id: 42,
  name: allocationName("creation-key"),
  tags: [allocationName("creation-key")],
  status: "active",
});

async function setup(now: () => number = Date.now) {
  let allocated: Droplet | null = null;
  const snapshots: import("./vendor.js").Snapshot[] = [];
  const api = {
    snapshots: vi.fn(async () => snapshots),
    snapshot: vi.fn(async (_id: number, name: string) => {
      snapshots.push({
        id: String(snapshots.length + 1),
        name,
        size_gigabytes: 1,
        created_at: new Date().toISOString(),
        resource_id: "42",
      });
    }),
    deleteSnapshot: vi.fn(async (id: string) => {
      const index = snapshots.findIndex((item) => item.id === id);
      if (index >= 0) snapshots.splice(index, 1);
    }),
    inventory: vi.fn(async () => ({
      droplet: null,
      sizes: [],
      snapshots,
      reservedIps: [],
    })),
    find: vi.fn(async () => allocated),
    get: vi.fn(async () => allocated),
    create: vi.fn(async () => {
      allocated = droplet();
      return allocated;
    }),
    power: vi.fn(async (_id: number, action: "shutdown" | "power_on") => {
      if (allocated)
        allocated.status = action === "shutdown" ? "off" : "active";
    }),
    destroy: vi.fn(async () => {
      allocated = null;
    }),
  } satisfies Vendor;
  const fake = createFakePluginHost({
    pluginId: "machine-digitalocean",
    settings: { DIGITALOCEAN_TOKEN: "token-secret" },
  });
  const db = createConnection(":memory:");
  migrate(db);
  Object.assign(fake.bb.storage.kv, {
    async get(key: string) {
      const value = getPluginKvValue(db, "digitalocean", key);
      return value === undefined ? undefined : JSON.parse(value);
    },
    async set(key: string, value: unknown) {
      setPluginKvValue(db, "digitalocean", key, JSON.stringify(value));
    },
    async delete(key: string) {
      deletePluginKvValue(db, "digitalocean", key);
    },
    async list(prefix?: string) {
      return listPluginKvKeys(db, "digitalocean", prefix);
    },
  });
  fake.bb.onDispose(() => {
    db.$client.close();
  });
  const prepare = vi.fn(async (_request: { key: string }) => ({
    id: "enrollment-1",
    hostId: "host-1",
    state: "pending",
    bootstrap: { credential: "credential-secret" },
  }));
  const waitForConnection = vi.fn(async () => ({ hostId: "host-1" }));
  const installerCommand = vi.fn(() => ({
    command: ["sh", "-c", "install-and-enroll"],
    stdin: "credential-secret",
  }));
  Object.assign(fake.bb.experimental_machines, {
    enrollments: { prepare, waitForConnection },
    installerCommand,
  });
  const sleep = vi.fn(async (_signal: AbortSignal) => {});
  await createDigitalOceanPlugin({ vendor: () => api, sleep, now })(fake.bb);
  const provider =
    fake.harness.registrations.machineProviders.get("digitalocean");
  if (!provider) throw new Error("missing provider");
  return {
    ...fake,
    api,
    provider,
    prepare,
    waitForConnection,
    installerCommand,
    sleep,
  };
}

describe("DigitalOcean machine provider", () => {
  it("declares checkout picker sugar without requiring a project for machine creation", async () => {
    const test = await setup();
    expect(test.provider.environmentRow).toEqual({
      displayName: "DigitalOcean",
      environmentProviderId: "project-checkout",
    });
    expect(test.provider.requires?.gitRemote ?? false).toBe(false);
    const request = context();
    expect(await test.provider.create(request)).toMatchObject({
      status: "created",
    });
    expect(test.api.create).toHaveBeenCalledWith(
      expect.objectContaining({ region: "nyc3", size: "s-2vcpu-4gb" }),
      expect.any(AbortSignal),
    );
    await test.harness.lifecycle.dispose();
  });

  it("allocates once and keeps cloud-init secrets out of resource/progress", async () => {
    const test = await setup();
    const request = context();
    const first = await test.provider.create(request);
    const second = await test.provider.create(request);
    expect(first).toMatchObject({
      status: "created",
      hostId: "host-1",
      resource: { dropletId: 42, version: 1 },
    });
    expect(second).toEqual(first);
    expect(test.api.create).toHaveBeenCalledOnce();
    expect(test.installerCommand).toHaveBeenCalledOnce();
    expect(
      JSON.stringify([
        first,
        request.report.step.mock.calls,
        request.report.log.mock.calls,
      ]),
    ).not.toMatch(/token-secret|credential-secret/);
    expect(test.provider.policy).toMatchObject({
      idleSuspendMs: null,
      retire: { after: "never" },
    });
    await test.harness.lifecycle.dispose();
  });

  it.each(["create", "lookup"])(
    "checkpoints a %s result despite cancellation so core can remove without enrollment",
    async (phase) => {
      const test = await setup();
      const controller = new AbortController();
      const allocate = async () => {
        controller.abort(new Error("cancelled"));
        return droplet();
      };
      if (phase === "create") test.api.create.mockImplementationOnce(allocate);
      else test.api.find.mockImplementationOnce(allocate);
      const request = { ...context(), signal: controller.signal };
      await expect(test.provider.create(request)).rejects.toThrow("cancelled");
      const resource = request.checkpoint.mock.calls[0]?.[0];
      expect(resource).toEqual({
        version: 1,
        key: request.key,
        dropletId: 42,
        enrollmentId: "enrollment-1",
      });
      expect(test.waitForConnection).not.toHaveBeenCalled();
      expect(test.prepare.mock.invocationCallOrder[0]).toBeLessThan(
        test.api.find.mock.invocationCallOrder[0]!,
      );
      if (resource === undefined) throw new Error("missing checkpoint");
      test.api.get.mockResolvedValue(droplet());
      await test.provider.remove({ ...context(), hostId: "host-1", resource });
      expect(test.api.destroy).toHaveBeenCalledWith(
        42,
        expect.any(AbortSignal),
      );
      expect(test.prepare).toHaveBeenCalledOnce();
      await test.harness.lifecycle.dispose();
    },
  );

  it("does not wait for enrollment when checkpoint persistence fails", async () => {
    const test = await setup();
    const request = context();
    request.checkpoint.mockRejectedValueOnce(new Error("checkpoint failed"));
    expect(await test.provider.create(request)).toMatchObject({
      status: "failed",
      failure: "transient",
    });
    expect(test.waitForConnection).not.toHaveBeenCalled();
    expect(test.api.destroy).not.toHaveBeenCalled();
    expect(await test.provider.create(context())).toMatchObject({
      status: "created",
    });
    expect(test.api.create).toHaveBeenCalledOnce();
    await test.harness.lifecycle.dispose();
  });

  it("reconciles unknown create outcomes by tag without posting twice", async () => {
    const test = await setup();
    test.api.create.mockRejectedValueOnce(
      new Error("connection lost after POST"),
    );
    expect(await test.provider.create(context())).toMatchObject({
      status: "failed",
      failure: "transient",
    });
    test.api.find.mockResolvedValueOnce(droplet());
    expect(await test.provider.create(context())).toMatchObject({
      status: "created",
    });
    expect(test.api.create).toHaveBeenCalledOnce();
    await test.harness.lifecycle.dispose();
  });

  it("reports an unresolved intent instead of allocating another droplet", async () => {
    const test = await setup();
    await test.bb.storage.kv.set(
      `allocation/${allocationName("creation-key")}`,
      { dropletId: null },
    );
    test.sleep.mockRejectedValueOnce(new Error("reconciliation deadline"));
    expect(await test.provider.create(context())).toMatchObject({
      status: "failed",
      message: expect.stringContaining("no second create"),
    });
    expect(test.api.create).not.toHaveBeenCalled();
    await test.harness.lifecycle.dispose();
  });

  it("powers off/on, waits for the enrolled machine, and destroys idempotently", async () => {
    const test = await setup();
    const created = await test.provider.create(context());
    if (created.status !== "created") throw new Error("creation failed");
    const lifecycle = {
      ...context(),
      hostId: created.hostId,
      resource: created.resource,
      checkpoint() {},
    };
    await test.provider.suspend?.(lifecycle);
    await test.provider.suspend?.(lifecycle);
    await test.provider.resume?.(lifecycle);
    expect(test.api.power.mock.calls.map((call) => call[1])).toEqual([
      "shutdown",
      "power_on",
    ]);
    expect(test.waitForConnection).toHaveBeenCalledTimes(2);
    await test.provider.remove(lifecycle);
    await test.provider.remove(lifecycle);
    expect(test.api.destroy).toHaveBeenCalledOnce();
    await test.harness.lifecycle.dispose();
  });

  it("refuses to destroy a droplet whose vendor ownership tag changed", async () => {
    const test = await setup();
    test.api.get.mockResolvedValue({ ...droplet(), tags: [] });
    await expect(
      test.provider.remove({
        ...context(),
        hostId: "host-1",
        resource: {
          version: 1,
          key: "creation-key",
          dropletId: 42,
          enrollmentId: "enrollment-1",
        },
      }),
    ).rejects.toThrow("ownership");
    expect(test.api.destroy).not.toHaveBeenCalled();
    await test.harness.lifecycle.dispose();
  });
});

it("reconciles uncertain tag allocations without create or enrollment", async () => {
  const test = await setup();
  const request = context();
  expect(await test.provider.experimental_reconcileCleanup(request)).toEqual({
    status: "removed",
  });
  await test.bb.storage.kv.set(`allocation/${allocationName(request.key)}`, {
    dropletId: null,
  });
  expect(
    await test.provider.experimental_reconcileCleanup(request),
  ).toMatchObject({ status: "failed" });
  test.api.find.mockResolvedValue(droplet());
  expect(await test.provider.experimental_reconcileCleanup(request)).toEqual({
    status: "removed",
  });
  expect(test.api.destroy).toHaveBeenCalledWith(42, request.signal);
  test.api.find.mockResolvedValue(null);
  expect(await test.provider.experimental_reconcileCleanup(request)).toEqual({
    status: "removed",
  });
  expect(test.api.create).not.toHaveBeenCalled();
  expect(test.prepare).not.toHaveBeenCalled();
  expect(test.installerCommand).not.toHaveBeenCalled();
  expect(test.waitForConnection).not.toHaveBeenCalled();
  await test.harness.lifecycle.dispose();
});

it("runs durable scheduled sleep and wake through core and retries a busy sleep", async () => {
  let time = Date.parse("2026-09-07T18:59:00Z");
  const test = await setup(() => time);
  const result = await test.provider.create(context());
  if (result.status !== "created") throw new Error("creation failed");
  let phase: "active" | "suspended" = "active";
  test.harness.sdk.stub("hosts.get", async () => ({
    id: "host-1",
    name: "Devbox",
    status: "connected",
    machineProviderId: "digitalocean",
    machineProviderSelection: { inputs: {} },
    maxPermissionMode: "full",
    lastSeenAt: time,
    lastRejectedProtocolVersion: null,
    createdAt: time,
    updatedAt: time,
    connectMachineId: null,
    lifecycle: {
      phase,
      suspendedAt: null,
      retireAt: null,
      progress: null,
      teardown: null,
    },
  }));
  const suspend = vi.fn(async () => {
    phase = "suspended";
    return { ok: true as const };
  });
  const resume = vi.fn(async () => {
    phase = "active";
    return { ok: true as const };
  });
  test.harness.sdk.stub("hosts.suspend", suspend);
  test.harness.sdk.stub("hosts.resume", resume);
  await test.harness.behavior.callRpc("configure", {
    hostId: "host-1",
    config: {
      idleMinutes: 5,
      retention: 2,
      schedule: {
        weekdays: [1],
        sleep: "19:00",
        wake: "19:02",
        timezone: "UTC",
      },
    },
  });
  expect(
    await test.provider.experimental_idleSuspendMs?.({
      hostId: "host-1",
      resource: result.resource,
    }),
  ).toBe(300_000);
  time += 60_000;
  suspend.mockRejectedValueOnce(new Error("machine busy"));
  await test.harness.behavior.runSchedule("devbox-schedules");
  expect(phase).toBe("active");
  time += 60_000;
  await test.harness.behavior.runSchedule("devbox-schedules");
  expect(suspend).toHaveBeenCalledTimes(2);
  expect(phase).toBe("suspended");
  await test.harness.behavior.runSchedule("devbox-schedules");
  expect(suspend).toHaveBeenCalledTimes(2);
  time += 60_000;
  await test.harness.behavior.runSchedule("devbox-schedules");
  expect(resume).toHaveBeenCalledOnce();
  expect(phase).toBe("active");
  expect(test.api.power).not.toHaveBeenCalled();
  await test.harness.lifecycle.dispose();
});
