import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { dispatchOnlineRpcCommand } from "../../src/command-dispatch.js";
import {
  cleanupTempDirs,
  createHarness,
  makeTempDir,
} from "./dispatch-helpers.js";

afterEach(cleanupTempDirs);

it("streams hook output and cancels the process before the run RPC settles", async () => {
  const harness = createHarness();
  const path = await makeTempDir("bb-hook-dispatch-");
  await writeFile(
    join(path, ".bb-env-setup.sh"),
    "echo running-hook\nsleep 120\n",
  );
  const output: string[] = [];
  const options = harness.dispatchOptions({ dataDir: path });
  options.emitEnvironmentHookProgress = (message) => {
    output.push(message.entry.text);
    if (message.entry.text === "running-hook")
      void dispatchOnlineRpcCommand(
        {
          type: "environment.hook.cancel",
          operationId: "hook-1",
        },
        options,
      );
  };
  await expect(
    dispatchOnlineRpcCommand(
      {
        type: "environment.hook.run",
        resumeOnly: false,
        operationId: "hook-1",
        path,
        kind: "setup",
        timeoutMs: 5000,
      },
      options,
    ),
  ).rejects.toThrow("cancelled");
  expect(output).toContain("running-hook");
  expect(output).toContain(".bb-env-setup.sh cancelled");
});

it("reconciles running and completed hook IDs without executing a second shell", async () => {
  const path = await makeTempDir("bb-hook-resume-");
  await writeFile(
    join(path, ".bb-env-setup.sh"),
    "echo once >> marker\nwhile [ ! -f proceed ]; do sleep 0.05; done\n",
  );
  const options = createHarness().dispatchOptions({ dataDir: path });
  const command = {
    type: "environment.hook.run" as const,
    resumeOnly: false,
    operationId: "resume",
    path,
    kind: "setup" as const,
    timeoutMs: 5000,
  };
  const first = dispatchOnlineRpcCommand(command, options);
  await expect
    .poll(async () => readFile(join(path, "marker"), "utf8").catch(() => ""))
    .toBe("once\n");
  const resumed = dispatchOnlineRpcCommand(
    { ...command, resumeOnly: true },
    options,
  );
  await writeFile(join(path, "proceed"), "");
  await Promise.all([first, resumed]);
  await dispatchOnlineRpcCommand({ ...command, resumeOnly: true }, options);
  expect(await readFile(join(path, "marker"), "utf8")).toBe("once\n");
});

it("persists never-started cancellation and rejects delayed dispatch after restart", async () => {
  const path = await makeTempDir("bb-hook-unknown-");
  await writeFile(join(path, ".bb-env-setup.sh"), "echo unsafe > marker\n");
  const options = createHarness().dispatchOptions({ dataDir: path });
  await expect(
    dispatchOnlineRpcCommand(
      {
        type: "environment.hook.run",
        resumeOnly: true,
        operationId: "unknown",
        path,
        kind: "setup",
        timeoutMs: 5000,
      },
      options,
    ),
  ).rejects.toThrow("never started");
  await expect(
    dispatchOnlineRpcCommand(
      { type: "environment.hook.cancel", operationId: "unknown" },
      options,
    ),
  ).resolves.toEqual({ status: "never-started" });
  await expect(
    dispatchOnlineRpcCommand(
      {
        type: "environment.hook.run",
        resumeOnly: false,
        operationId: "unknown",
        path,
        kind: "setup",
        timeoutMs: 5000,
      },
      createHarness().dispatchOptions({ dataDir: path }),
    ),
  ).rejects.toThrow("cancelled before dispatch");
  await expect(readFile(join(path, "marker"))).rejects.toThrow();
});

it("reconciles an interrupted persisted process group after daemon memory is lost", async () => {
  const path = await makeTempDir("bb-hook-daemon-restart-");
  await writeFile(
    join(path, ".bb-env-setup.sh"),
    "echo started > started\nsleep 120\necho unsafe > completed\n",
  );
  const firstOptions = createHarness().dispatchOptions({ dataDir: path });
  const command = {
    type: "environment.hook.run" as const,
    resumeOnly: false,
    operationId: "restart",
    path,
    kind: "setup" as const,
    timeoutMs: 5000,
  };
  const running = dispatchOnlineRpcCommand(command, firstOptions).catch(
    () => undefined,
  );
  await expect
    .poll(async () => readFile(join(path, "started"), "utf8").catch(() => ""))
    .toBe("started\n");
  const restored = createHarness().dispatchOptions({ dataDir: path });
  await expect(
    dispatchOnlineRpcCommand(
      { type: "environment.hook.cancel", operationId: "restart" },
      restored,
    ),
  ).resolves.toEqual({ status: "terminated" });
  await running;
  await expect(readFile(join(path, "completed"))).rejects.toThrow();
  await expect(dispatchOnlineRpcCommand(command, restored)).rejects.toThrow(
    "cancelled before dispatch",
  );
});
