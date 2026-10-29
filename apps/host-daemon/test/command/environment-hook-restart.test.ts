import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeTempDir } from "@bb/test-helpers";
import { describe, expect, it } from "vitest";
import {
  dispatchCommand,
  dispatchOnlineRpcCommand,
} from "../../src/command-dispatch.js";
import { createTestResourceLedger } from "../resource-ledger-fixture.js";
import { createHarness } from "./dispatch-helpers.js";

const posixOnly = process.platform === "win32" ? describe.skip : describe;

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

posixOnly("environment hooks across a daemon restart", () => {
  it("stops a hook the previous daemon left running and answers for it", async () => {
    const path = await makeTempDir("bb-hook-restart-");
    const ledgerDirectory = await makeTempDir("bb-hook-restart-ledger-");
    await writeFile(
      join(path, ".bb-env-teardown.sh"),
      "echo $$ > hook.pid\nexec sleep 120\n",
    );
    const operationId = "environment:env-1:key:teardown";
    const command = {
      type: "environment.hook.run" as const,
      contributedEnv: [],
      resumeOnly: false,
      operationId,
      path,
      kind: "teardown" as const,
      timeoutMs: 60_000,
    };
    const previousDaemon = createHarness({
      resourceLedger: createTestResourceLedger(ledgerDirectory),
    }).dispatchOptions({ dataDir: path });
    void dispatchOnlineRpcCommand(
      command,
      previousDaemon,
      new AbortController().signal,
    ).catch(() => undefined);
    let hookPid = 0;
    await expect
      .poll(async () => {
        hookPid = Number(
          await readFile(join(path, "hook.pid"), "utf8").catch(() => "0"),
        );
        return hookPid > 0 && alive(hookPid);
      })
      .toBe(true);

    const ledger = createTestResourceLedger(ledgerDirectory);
    await ledger.reconcile();
    expect(alive(hookPid)).toBe(false);
    expect(ledger.previousOperationTermination(operationId)).toBe("confirmed");

    const nextDaemon = createHarness({
      resourceLedger: ledger,
    }).dispatchOptions({ dataDir: path });
    await expect(
      dispatchOnlineRpcCommand(
        { ...command, resumeOnly: true },
        nextDaemon,
        new AbortController().signal,
      ),
    ).rejects.toThrow("interrupted when the host daemon restarted");
    await expect(
      dispatchOnlineRpcCommand(
        { type: "environment.hook.cancel", operationId },
        nextDaemon,
        new AbortController().signal,
      ),
    ).resolves.toEqual({ status: "terminated" });
  });

  it("stops a running setup script when the daemon shuts down", async () => {
    const path = await makeTempDir("bb-provision-setup-shutdown-");
    await writeFile(
      join(path, ".bb-env-setup.sh"),
      "echo $$ > hook.pid\nexec sleep 120\n",
    );
    const harness = createHarness({ workspacePath: path });
    const attach = dispatchCommand(
      {
        type: "environment.attach",
        contributedEnv: [],
        environmentId: "env-setup-shutdown",
        initiator: null,
        path,
        setupScriptTimeoutMs: 60_000,
      },
      harness.dispatchOptions(),
    );
    let hookPid = 0;
    await expect
      .poll(async () => {
        hookPid = Number(
          await readFile(join(path, "hook.pid"), "utf8").catch(() => "0"),
        );
        return hookPid > 0 && alive(hookPid);
      })
      .toBe(true);

    await harness.manager.shutdownAll();

    await expect(attach).rejects.toThrow("cancelled");
    expect(alive(hookPid)).toBe(false);
  });

  it("answers unknown for a hook it has no record of", async () => {
    const options = createHarness().dispatchOptions({
      dataDir: await makeTempDir("bb-hook-restart-unknown-"),
    });
    await expect(
      dispatchOnlineRpcCommand(
        { type: "environment.hook.cancel", operationId: "missing" },
        options,
        new AbortController().signal,
      ),
    ).resolves.toEqual({ status: "unknown" });
  });
});
