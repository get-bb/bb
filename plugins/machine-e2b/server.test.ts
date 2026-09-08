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
  Object.assign(fake.bb.experimental_machines, { bootstrap });
  const sleep = vi.fn(async (_signal: AbortSignal) => {});
  await createE2BPlugin({ vendor: () => api, sleep })(fake.bb);
  const provider = fake.harness.registrations.machineProviders.get("e2b");
  if (!provider) throw new Error("missing provider");
  return { ...fake, api, provider, handle, bootstrap, sleep };
}

describe("E2B machine provider", () => {
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
  it("retains the allocation handle when cancellation races the create response", async () => {
    const test = await setup();
    const controller = new AbortController();
    test.api.create.mockImplementationOnce(async () => {
      controller.abort(new Error("cancelled"));
      return test.handle;
    });
    await expect(
      test.provider.create({ ...context(), signal: controller.signal }),
    ).rejects.toThrow("cancelled");
    expect(await test.bb.storage.kv.get("allocation/key-1")).toEqual({
      sandboxId: "sandbox-1",
    });
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
