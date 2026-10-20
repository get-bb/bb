import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeTempDir } from "@bb/test-helpers";
import { expect, it, vi } from "vitest";
import { CommandRouter } from "../../src/command-router.js";
import { createHarness } from "./dispatch-helpers.js";

it.each([false, true])(
  "reports pre-dispatch hook cancellation without warnings (resumeOnly: %s)",
  async (resumeOnly) => {
    const path = await makeTempDir("bb-hook-rpc-cancel-");
    await writeFile(join(path, ".bb-env-setup.sh"), "echo unsafe > marker\n");
    const logger = { debug: vi.fn(), warn: vi.fn() };
    const router = new CommandRouter({
      ...createHarness().dispatchOptions({ dataDir: path }),
      logger,
    });

    await expect(
      router.handleOnlineRpcRequest({
        type: "host-rpc.request",
        requestId: "cancel-before-dispatch",
        command: { type: "environment.hook.cancel", operationId: "cancelled" },
      }),
    ).resolves.toMatchObject({ ok: true, result: { status: "unknown" } });

    for (const requestId of ["delayed-run", "repeated-run"]) {
      await expect(
        router.handleOnlineRpcRequest({
          type: "host-rpc.request",
          requestId,
          command: {
            type: "environment.hook.run",
            operationId: "cancelled",
            path,
            kind: "setup",
            contributedEnv: [],
            resumeOnly,
            timeoutMs: 5000,
          },
        }),
      ).resolves.toMatchObject({
        ok: false,
        errorCode: "command_failed",
        errorMessage: "Environment hook cancelled before dispatch",
      });
    }

    await expect(readFile(join(path, "marker"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledTimes(2);
    expect(logger.debug).toHaveBeenCalledWith(
      {
        commandType: "environment.hook.run",
        errorCode: "command_failed",
        handlerMs: expect.any(Number),
        ok: false,
      },
      "Online host RPC",
    );
  },
);

it("still warns when hook recovery has an unknown outcome", async () => {
  const path = await makeTempDir("bb-hook-rpc-unknown-");
  const logger = { debug: vi.fn(), warn: vi.fn() };
  const router = new CommandRouter({
    ...createHarness().dispatchOptions({ dataDir: path }),
    logger,
  });

  await expect(
    router.handleOnlineRpcRequest({
      type: "host-rpc.request",
      requestId: "unknown-recovery",
      command: {
        type: "environment.hook.run",
        operationId: "unknown",
        path,
        kind: "teardown",
        contributedEnv: [],
        resumeOnly: true,
        timeoutMs: 5000,
      },
    }),
  ).resolves.toMatchObject({
    ok: false,
    errorCode: "command_failed",
    errorMessage: "Environment hook outcome is unknown after daemon restart",
  });
  expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
    { type: "environment.hook.run", err: expect.any(Error) },
    "online host RPC failed",
  );
});
