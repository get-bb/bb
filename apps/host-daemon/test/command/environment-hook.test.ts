import { environmentHookRecordStore } from "../../src/environment-hook-records.js";
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
        contributedEnv: [],
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
    contributedEnv: [],
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
        contributedEnv: [],
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
        contributedEnv: [],
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
    contributedEnv: [],
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

it.each(["setup", "teardown"] as const)(
  "injects %s contributions without leaking secrets into progress or durable records",
  async (kind) => {
    const path = await makeTempDir("bb-hook-environment-");
    const secret = "hook-secret-fixture";
    await writeFile(
      join(path, `.bb-env-${kind}.sh`),
      'test "$HOOK_PLAIN" = configured || exit 1\nprintf "%s" "$GH_TOKEN" > received\nprintf "%s\\n" "$GH_TOKEN"\nexit 1\n',
    );
    const options = createHarness().dispatchOptions({ dataDir: path });
    const output: string[] = [];
    options.emitEnvironmentHookProgress = (message) =>
      output.push(message.entry.text);
    const command = {
      type: "environment.hook.run" as const,
      contributedEnv: [
        {
          name: "GH_TOKEN",
          value: secret,
          secret: true,
          source: { core: "machine-environment" as const },
          reason: "test",
        },
        {
          name: "HOOK_PLAIN",
          value: "configured",
          secret: false,
          source: { core: "machine-environment" as const },
          reason: "test",
        },
      ],
      resumeOnly: false,
      operationId: `env-${kind}`,
      path,
      kind,
      timeoutMs: 5000,
    };
    if (kind === "setup")
      await expect(dispatchOnlineRpcCommand(command, options)).rejects.toThrow(
        "exit code 1",
      );
    else await dispatchOnlineRpcCommand(command, options);
    expect(await readFile(join(path, "received"), "utf8")).toBe(secret);
    expect(output.join("\n")).not.toContain(secret);
    expect(output.join("\n")).toContain("[redacted]");
    expect(
      JSON.stringify(
        environmentHookRecordStore(path, command.operationId).read(),
      ),
    ).not.toContain(secret);
    expect(process.env.GH_TOKEN).not.toBe(secret);
  },
);

it.each(["setup", "teardown"] as const)(
  "redacts multiline secrets before streaming %s hook lines",
  async (kind) => {
    const path = await makeTempDir("bb-hook-multiline-");
    await writeFile(
      join(path, `.bb-env-${kind}.sh`),
      'printf "%s\\n" "$MULTILINE" | while IFS= read -r line; do printf "%s\\n" "$line"; sleep 0.05; done\nprintf "%s\\n" "$MULTILINE" | while IFS= read -r line; do printf "%s\\n" "$line"; sleep 0.05; done >&2\n',
    );
    const output: string[] = [];
    const options = createHarness().dispatchOptions({ dataDir: path });
    options.emitEnvironmentHookProgress = (message) => {
      output.push(message.entry.text);
    };
    await dispatchOnlineRpcCommand(
      {
        type: "environment.hook.run",
        contributedEnv: [
          {
            name: "MULTILINE",
            value: "HEADER\nPRIVATE_BODY\nFOOTER",
            secret: true,
            source: { core: "machine-environment" as const },
            reason: "test",
          },
        ],
        resumeOnly: false,
        operationId: `redact-${kind}`,
        path,
        kind,
        timeoutMs: 5000,
      },
      options,
    );
    expect(output.join("\n")).not.toContain("PRIVATE_BODY");
    expect(output.join("\n")).toContain("[redacted]");
  },
);

it("applies hook NODE_ENV and PATH contributions after sanitizing inherited state", async () => {
  const path = await makeTempDir("bb-hook-overrides-");
  await writeFile(
    join(path, ".bb-env-setup.sh"),
    'printf "NODE_ENV=%s\\nPATH=%s\\n" "$NODE_ENV" "$PATH"; sleep 0.1\n',
  );
  const output: string[] = [];
  const options = createHarness().dispatchOptions({ dataDir: path });
  options.emitEnvironmentHookProgress = (message) => {
    output.push(message.entry.text);
  };
  const contributedEnv = Object.entries({
    NODE_ENV: "production",
    PATH: "/review-toolchain:/usr/bin:/bin",
  }).map(([name, value]) => ({
    name,
    value,
    secret: false,
    source: { core: "machine-environment" as const },
    reason: "test",
  }));
  await dispatchOnlineRpcCommand(
    {
      type: "environment.hook.run",
      contributedEnv,
      resumeOnly: false,
      operationId: "overrides",
      path,
      kind: "setup",
      timeoutMs: 5000,
    },
    options,
  );
  expect(output).toContain("NODE_ENV=production");
  expect(output).toContain("PATH=/review-toolchain:/usr/bin:/bin");
});
