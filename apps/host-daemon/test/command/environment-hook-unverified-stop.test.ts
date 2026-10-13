import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { dispatchOnlineRpcCommand } from "../../src/command-dispatch.js";
import {
  cleanupTempDirs,
  createHarness,
  makeTempDir,
} from "./dispatch-helpers.js";

vi.mock("../../src/environment-lifecycle-script.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../src/environment-lifecycle-script.js")
    >();
  return {
    ...actual,
    runSetupScript: (args: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        args.signal?.addEventListener("abort", () =>
          reject(
            new actual.LifecycleScriptTerminationUnverifiedError(
              ".bb-env-setup.sh",
            ),
          ),
        );
      }),
  };
});

afterEach(cleanupTempDirs);

it("answers unknown when a cancelled hook's processes could not be confirmed stopped", async () => {
  const path = await makeTempDir("bb-hook-unverified-");
  await writeFile(join(path, ".bb-env-setup.sh"), "sleep 120\n");
  const options = createHarness().dispatchOptions({ dataDir: path });
  const run = dispatchOnlineRpcCommand(
    {
      type: "environment.hook.run",
      contributedEnv: [],
      resumeOnly: false,
      operationId: "hook-unverified",
      path,
      kind: "setup",
      timeoutMs: 5000,
    },
    options,
  );
  const runFailure = expect(run).rejects.toThrow(
    "could not confirm that all of its processes exited",
  );
  await Promise.resolve();
  await expect(
    dispatchOnlineRpcCommand(
      { type: "environment.hook.cancel", operationId: "hook-unverified" },
      options,
    ),
  ).resolves.toEqual({ status: "unknown" });
  await runFailure;
});
