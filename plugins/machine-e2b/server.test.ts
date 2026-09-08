import type { JsonValue } from "@get-bb/plugin-sdk";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";
import { createE2BPlugin } from "./server.js";
import type { Vendor } from "./vendor.js";

const context = () => ({
  key: "key-1",
  attempt: 1,
  project: null,
  gitRemote: null,
  inputs: null,
  report: { step: vi.fn(), log: vi.fn() },
  signal: new AbortController().signal,
  checkpoint: vi.fn(async (_resource: JsonValue) => {}),
});
async function setup() {
  const handle = {
    sandboxId: "sandbox-1",
    executor: {
      exec: vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" })),
    },
  };
  const api = {
    find: vi.fn(async (): Promise<string | null> => null),
    create: vi.fn(async () => handle),
    connect: vi.fn(async () => handle),
    pause: vi.fn(async () => {}),
    kill: vi.fn(async () => {}),
  } satisfies Vendor;
  const fake = createFakePluginHost({
    pluginId: "machine-e2b",
    settings: { E2B_API_KEY: "api-secret", template: "bb-node22" },
  });
  const bootstrap = vi.fn(async () => ({ hostId: "host-1" }));
  const prepareEnrollment = vi.fn(async () => ({
    id: "enrollment-1",
    hostId: "host-1",
    state: "pending",
    bootstrap: { credential: "bootstrap-secret" },
  }));
  Object.assign(fake.bb.experimental_machines, {
    bootstrap,
    prepareEnrollment,
  });
  const sleep = vi.fn(async (_signal: AbortSignal) => {});
  await createE2BPlugin({ vendor: () => api, sleep })(fake.bb);
  const provider = fake.harness.registrations.machineProviders.get("e2b");
  if (!provider) throw new Error("missing provider");
  return {
    ...fake,
    api,
    provider,
    handle,
    bootstrap,
    prepareEnrollment,
    sleep,
  };
}

describe("E2B machine provider", () => {
  it("declares checkout picker sugar without requiring a project for machine creation", async () => {
    const test = await setup();
    expect(test.provider.environmentRow).toEqual({
      displayName: "E2B",
      environmentProviderId: "project-checkout",
    });
    expect(test.provider.requires?.gitRemote ?? false).toBe(false);
    const request = context();
    expect(test.provider.inputs).toBeNull();
    expect(await test.provider.create(request)).toMatchObject({
      status: "created",
    });
    await test.harness.lifecycle.dispose();
  });

  it("uses the same allocation and core key across create retries", async () => {
    const test = await setup();
    const request = context();
    const first = await test.provider.create(request);
    expect(await test.provider.create(request)).toEqual(first);
    expect(test.api.create).toHaveBeenCalledOnce();
    expect(test.api.connect).toHaveBeenCalledWith(
      "sandbox-1",
      3_600_000,
      expect.any(AbortSignal),
    );
    expect(test.bootstrap).toHaveBeenCalledWith(
      expect.objectContaining({
        key: request.key,
        executor: test.handle.executor,
        daemon: { kind: "install" },
      }),
    );
    expect(
      JSON.stringify([
        first,
        request.report.log.mock.calls,
        request.report.step.mock.calls,
      ]),
    ).not.toContain("api-secret");
    await test.harness.lifecycle.dispose();
  });
  it("discovers an existing paused allocation without creating another", async () => {
    const test = await setup();
    test.api.find.mockResolvedValue("sandbox-1");
    expect(await test.provider.create(context())).toMatchObject({
      status: "created",
    });
    expect(test.api.create).not.toHaveBeenCalled();
    expect(test.api.connect).toHaveBeenCalledOnce();
    await test.harness.lifecycle.dispose();
  });
  it.each(["create", "lookup"])(
    "checkpoints a %s result despite cancellation so core can remove without reconnecting",
    async (phase) => {
      const test = await setup();
      const controller = new AbortController();
      if (phase === "create")
        test.api.create.mockImplementationOnce(async () => {
          controller.abort(new Error("cancelled"));
          return test.handle;
        });
      else
        test.api.find.mockImplementationOnce(async () => {
          controller.abort(new Error("cancelled"));
          return test.handle.sandboxId;
        });
      const request = { ...context(), signal: controller.signal };
      await expect(test.provider.create(request)).rejects.toThrow("cancelled");
      const resource = request.checkpoint.mock.calls[0]?.[0];
      expect(resource).toEqual({
        version: 1,
        key: request.key,
        sandboxId: "sandbox-1",
      });
      expect(test.bootstrap).not.toHaveBeenCalled();
      expect(test.api.connect).not.toHaveBeenCalled();
      expect(test.prepareEnrollment.mock.invocationCallOrder[0]).toBeLessThan(
        test.api.find.mock.invocationCallOrder[0]!,
      );
      if (resource === undefined) throw new Error("missing checkpoint");
      await test.provider.remove({ ...context(), hostId: "host-1", resource });
      expect(test.api.kill).toHaveBeenCalledWith(
        "sandbox-1",
        expect.any(AbortSignal),
      );
      expect(test.prepareEnrollment).toHaveBeenCalledOnce();
      await test.harness.lifecycle.dispose();
    },
  );
  it("stops before bootstrap when checkpoint persistence fails and retains allocation for retry", async () => {
    const test = await setup();
    const request = context();
    request.checkpoint.mockRejectedValueOnce(new Error("checkpoint failed"));
    await expect(test.provider.create(request)).rejects.toThrow(
      "checkpoint failed",
    );
    expect(test.bootstrap).not.toHaveBeenCalled();
    expect(test.api.kill).not.toHaveBeenCalled();
    test.api.find.mockResolvedValue("sandbox-1");
    expect(await test.provider.create(context())).toMatchObject({
      status: "created",
    });
    expect(test.api.create).toHaveBeenCalledOnce();
    await test.harness.lifecycle.dispose();
  });
  it("does not submit another create after an unresolved request", async () => {
    const test = await setup();
    test.api.create.mockRejectedValueOnce(new Error("lost response"));
    await expect(test.provider.create(context())).rejects.toThrow(
      "lost response",
    );
    test.sleep.mockRejectedValueOnce(new Error("deadline"));
    expect(await test.provider.create(context())).toMatchObject({
      status: "failed",
      message: expect.stringContaining("no second create"),
    });
    expect(test.api.create).toHaveBeenCalledOnce();
    await test.harness.lifecycle.dispose();
  });
  it("pauses, resumes via core bootstrap, and kills without resuming", async () => {
    const test = await setup();
    const created = await test.provider.create(context());
    if (created.status !== "created") throw new Error("create failed");
    const lifecycle = {
      ...context(),
      hostId: created.hostId,
      resource: created.resource,
      checkpoint() {},
    };
    await test.provider.suspend?.(lifecycle);
    await test.provider.resume?.(lifecycle);
    expect(test.api.pause).toHaveBeenCalledWith("sandbox-1", lifecycle.signal);
    expect(test.bootstrap).toHaveBeenLastCalledWith(
      expect.objectContaining({
        key: "key-1",
        daemon: { kind: "preinstalled" },
      }),
    );
    test.bootstrap.mockResolvedValueOnce({ hostId: "different-host" });
    await expect(test.provider.resume?.(lifecycle)).rejects.toThrow(
      "different machine identity",
    );
    test.api.connect.mockClear();
    await test.provider.remove(lifecycle);
    expect(test.api.connect).not.toHaveBeenCalled();
    expect(test.api.kill).toHaveBeenCalledWith("sandbox-1", lifecycle.signal);
    await test.harness.lifecycle.dispose();
  });
});

it("reconciles uncertain metadata allocations without create or bootstrap", async () => {
  const test = await setup();
  const request = context();
  expect(await test.provider.experimental_reconcileCleanup(request)).toEqual({
    status: "removed",
  });
  await test.bb.storage.kv.set(`allocation/${request.key}`, {
    sandboxId: null,
  });
  expect(
    await test.provider.experimental_reconcileCleanup(request),
  ).toMatchObject({ status: "failed" });
  test.api.find.mockResolvedValue("sandbox-uncertain");
  expect(await test.provider.experimental_reconcileCleanup(request)).toEqual({
    status: "removed",
  });
  expect(test.api.kill).toHaveBeenCalledWith(
    "sandbox-uncertain",
    request.signal,
  );
  test.api.find.mockResolvedValue(null);
  await test.provider.experimental_reconcileCleanup(request);
  expect(test.api.kill).toHaveBeenCalledTimes(2);
  expect(test.api.create).not.toHaveBeenCalled();
  expect(test.api.connect).not.toHaveBeenCalled();
  expect(test.bootstrap).not.toHaveBeenCalled();
  expect(test.prepareEnrollment).not.toHaveBeenCalled();
  await test.harness.lifecycle.dispose();
});
