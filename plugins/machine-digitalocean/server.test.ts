import type { JsonValue } from "@get-bb/plugin-sdk";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";
import { createDigitalOceanPlugin } from "./server.js";
import {
  VendorError,
  allocationName,
  type Droplet,
  type Vendor,
} from "./vendor.js";

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

async function setup() {
  let allocated: Droplet | null = null;
  const api = {
    find: vi.fn(async () => allocated),
    get: vi.fn(async () => allocated),
    create: vi.fn(async () => {
      allocated = droplet();
      return allocated;
    }),
    power: vi.fn(async (_id: number, action: "power_off" | "power_on") => {
      if (allocated)
        allocated.status = action === "power_off" ? "off" : "active";
    }),
    destroy: vi.fn(async () => {
      allocated = null;
    }),
  } satisfies Vendor;
  const fake = createFakePluginHost({
    pluginId: "machine-digitalocean",
    settings: { DIGITALOCEAN_TOKEN: "token-secret" },
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
  await createDigitalOceanPlugin({ vendor: () => api, sleep })(fake.bb);
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
      async checkpoint() {},
    };
    await test.provider.suspend?.(lifecycle);
    await test.provider.suspend?.(lifecycle);
    await test.provider.resume?.(lifecycle);
    expect(test.api.power.mock.calls.map((call) => call[1])).toEqual([
      "power_off",
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

it.each([400, 401, 403, 404, 422])(
  "settles definitive HTTP %s allocation rejection without reconciliation",
  async (status) => {
    const test = await setup();
    test.api.create.mockRejectedValueOnce(new VendorError(status));
    await expect(test.provider.create(context())).resolves.toMatchObject({
      status: "failed",
      failure: "terminal",
      allocation: "none",
    });
    const finds = test.api.find.mock.calls.length;
    await expect(
      test.provider.experimental_reconcileCleanup(context()),
    ).resolves.toEqual({ status: "removed" });
    await expect(test.provider.create(context())).resolves.toMatchObject({
      status: "failed",
      allocation: "none",
    });
    expect(test.api.find).toHaveBeenCalledTimes(finds);
    expect(test.api.create).toHaveBeenCalledOnce();
    expect(test.api.destroy).not.toHaveBeenCalled();
    await test.harness.lifecycle.dispose();
  },
);
