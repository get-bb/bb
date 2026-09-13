import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { dispatchCommand } from "../../../../apps/host-daemon/src/command-dispatch.js";
import { createHarness } from "../../../../apps/host-daemon/test/command/dispatch-helpers.js";

const tempPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempPaths
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function createSetupPath(name: string, script: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), name));
  tempPaths.push(path);
  await writeFile(join(path, ".bb-env-setup.sh"), script);
  return path;
}

describe("environment attach recovery", () => {
  it("cancels an in-flight setup script before attaching the workspace", async () => {
    const path = await createSetupPath(
      "bb-attach-cancel-",
      "echo started > started\nsleep 120\necho unsafe > completed\n",
    );
    const harness = createHarness({ workspacePath: path });
    const options = harness.dispatchOptions({ dataDir: path });
    const provision = dispatchCommand(
      {
        type: "environment.attach",
        contributedEnv: [],
        environmentId: "env-setup-cancel",
        initiator: null,
        path,
        setupScriptTimeoutMs: 30_000,
      },
      options,
    );

    await expect
      .poll(() => readFile(join(path, "started"), "utf8").catch(() => ""))
      .toBe("started\n");
    await expect(
      dispatchCommand(
        {
          type: "environment.attach.cancel",
          environmentId: "env-setup-cancel",
        },
        options,
      ),
    ).resolves.toEqual({ aborted: true });
    await expect(provision).rejects.toMatchObject({
      code: "provision_cancelled",
    });
    expect(harness.provisions).toEqual([]);
    await expect(readFile(join(path, "completed"))).rejects.toThrow();
  });

  it("coalesces a repeated attach while setup is still running", async () => {
    const path = await createSetupPath(
      "bb-attach-coalesce-",
      "echo started >> started\nwhile [ ! -f proceed ]; do sleep 0.05; done\necho completed > completed\n",
    );
    const harness = createHarness({ workspacePath: path });
    const options = harness.dispatchOptions({ dataDir: path });
    const command = {
      type: "environment.attach" as const,
      contributedEnv: [],
      environmentId: "env-setup-coalesce",
      initiator: null,
      path,
      setupScriptTimeoutMs: 30_000,
    };

    const first = dispatchCommand(command, options);
    await expect
      .poll(() => readFile(join(path, "started"), "utf8").catch(() => ""))
      .toBe("started\n");
    const second = dispatchCommand(command, options);
    await writeFile(join(path, "proceed"), "");

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(await readFile(join(path, "started"), "utf8")).toBe("started\n");
    expect(await readFile(join(path, "completed"), "utf8")).toBe("completed\n");
    expect(harness.provisions).toHaveLength(1);
  });

  it("can retry attachment after setup fails", async () => {
    const path = await createSetupPath(
      "bb-attach-retry-",
      "echo failed > first-attempt\nexit 7\n",
    );
    const harness = createHarness({ workspacePath: path });
    const options = harness.dispatchOptions({ dataDir: path });
    const command = {
      type: "environment.attach" as const,
      contributedEnv: [],
      environmentId: "env-setup-retry",
      initiator: null,
      path,
      setupScriptTimeoutMs: 30_000,
    };

    await expect(dispatchCommand(command, options)).rejects.toThrow(
      "failed with exit code 7",
    );
    expect(harness.provisions).toEqual([]);
    await writeFile(
      join(path, ".bb-env-setup.sh"),
      "echo completed > second-attempt\n",
    );

    await expect(dispatchCommand(command, options)).resolves.toMatchObject({
      path,
    });
    expect(await readFile(join(path, "first-attempt"), "utf8")).toBe(
      "failed\n",
    );
    expect(await readFile(join(path, "second-attempt"), "utf8")).toBe(
      "completed\n",
    );
    expect(harness.provisions).toHaveLength(1);
  });
});
