import { describe, expect, it, vi } from "vitest";
import { riftInputsSchema } from "./server.js";
import { createProviderFixture } from "./test-helpers.js";

const HOST_ID = "host-a";
const THREAD_ID = "thr_1";
const RIFT_PATH = "/data/plugins/environment-git-rift/rifts/thr_1/bb";

function setup(
  callHost: Parameters<typeof createProviderFixture>[0] = (call) => {
    if (call.method === "resolvePath") return { path: RIFT_PATH };
    if (call.method === "create") {
      return {
        status: "created",
        path: RIFT_PATH,
        mergeBaseBranch: "main",
      };
    }
    if (call.method === "remove") return { status: "removed" };
    throw new Error(`unexpected host method ${call.method}`);
  },
) {
  return createProviderFixture(callHost);
}

describe("Rift provider", () => {
  it("defaults to all files and sends create to the selected host", async () => {
    const f = await setup();
    expect(riftInputsSchema.parse({})).toEqual({
      branch: { kind: "default" },
      copy: "all",
    });
    expect(f.provider.policy.pathKeys).toBe("per-attempt");
    expect(f.provider.policy.retireGraceMs).toBe(300_000);
    expect(await f.provider.create(f.context)).toEqual({
      status: "created",
      path: RIFT_PATH,
      ownsPath: true,
      mergeBaseBranch: "main",
    });
    expect(f.harness.experimental_hostRpcCalls[1]).toMatchObject({
      hostId: HOST_ID,
      method: "create",
      input: { copy: "all", branchName: "bb/test", pathKey: THREAD_ID },
    });
  });
  it("preserves named branch and filtered selection across replay", async () => {
    const f = await setup();
    const context = {
      ...f.context,
      inputs: { branch: { kind: "named", name: "feature" }, copy: "filtered" },
    };
    await f.provider.create(context);
    await f.provider.create(context);
    expect(
      f.harness.experimental_hostRpcCalls
        .filter((c) => c.method === "create")
        .map((c) => c.input),
    ).toEqual([
      expect.objectContaining({
        branchName: "feature",
        copy: "filtered",
        pathKey: THREAD_ID,
      }),
      expect.objectContaining({
        branchName: "feature",
        copy: "filtered",
        pathKey: THREAD_ID,
      }),
    ]);
  });
  it("retries admission before invoking host creation", async () => {
    const f = await setup();
    const claim = vi
      .fn()
      .mockRejectedValueOnce(new Error("Host disconnected"))
      .mockResolvedValueOnce(true);
    const context = { ...f.context, experimental_claimPath: claim };
    expect(await f.provider.create(context)).toMatchObject({
      status: "failed",
      failure: "transient",
    });
    expect(await f.provider.create(context)).toMatchObject({
      status: "created",
    });
    expect(claim.mock.calls).toEqual([[RIFT_PATH], [RIFT_PATH]]);
  });
  it("refuses creation when the path claim is held elsewhere", async () => {
    const f = await setup();
    expect(
      await f.provider.create({
        ...f.context,
        experimental_claimPath: async () => false,
      }),
    ).toEqual({
      status: "failed",
      failure: "terminal",
      message: "The Rift workspace path is already in use",
    });
    expect(
      f.harness.experimental_hostRpcCalls.map((call) => call.method),
    ).toEqual(["resolvePath"]);
  });
  it.each([true, false])(
    "checks host CLI availability: %s",
    async (installed) => {
      const f = await setup(() => ({ installed }));
      expect(
        await f.provider.availability?.({
          project: f.context.project,
          host: f.context.host,
          projectCheckout: f.context.projectCheckout,
          gitRemote: null,
        }),
      ).toEqual(
        installed
          ? { status: "available" }
          : {
              status: "setup-required",
              message:
                "Install Rift on this machine: npm install -g rift-snapshot",
            },
      );
    },
  );
  it("does not remove a path that was never admitted", async () => {
    const f = await setup();
    expect(
      await f.provider.remove({
        environment: null,
        hostId: HOST_ID,
        path: null,
        pathKey: THREAD_ID,
        resource: null,
        attempt: 1,
        report: f.report,
        signal: f.signal,
      }),
    ).toEqual({ status: "removed" });
    expect(f.harness.experimental_hostRpcCalls).toEqual([]);
  });
});
