import { spawnSync } from "node:child_process";
import { access, realpath, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  environmentHookOperations,
  getEnvironment,
  getEnvironmentLaunch,
} from "@bb/db";
import { eq } from "drizzle-orm";
import { threadSchema } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { withHarness } from "../../helpers/harness.js";
import { createProjectFixture } from "./shared.js";
import {
  waitForThreadStatus,
  waitForEnvironmentStatus,
} from "../../helpers/assertions.js";

const hasRift = spawnSync("rift", ["--help"]).status === 0;

describe("Rift environment integration", () => {
  it.runIf(hasRift)(
    "runs a thread in an owned copy with independent Git state",
    () =>
      withHarness({ builtinPlugins: ["environment-rift"] }, async (harness) => {
        await writeFile(
          join(harness.repoDir, ".rift.toml"),
          'version = 1\n[[hooks.postcreate]]\nrun = "echo rift > hook-order"\n',
        );
        await writeFile(
          join(harness.repoDir, ".bb-env-setup.sh"),
          'test "$(cat hook-order)" = rift && echo core-setup >> hook-order\n',
        );
        const project = await createProjectFixture(harness, "Rift integration");
        const response = await harness.api.threads.$post({
          json: {
            projectId: project.id,
            providerId: "fake",
            model: "fake-model",
            origin: "app",
            startedOnBehalfOf: null,
            originKind: null,
            environment: {
              type: "provider",
              environmentProviderId: "rift",
              machine: { type: "existing", hostId: harness.hostId },
              inputs: {
                branch: { kind: "named", name: "bb/rift-integration" },
                copy: "all",
              },
            },
            input: [
              { type: "text", text: "Reply with rift ready", mentions: [] },
            ],
          },
        });
        expect(response.status, await response.clone().text()).toBe(201);
        const thread = threadSchema.parse(await response.json());
        const idle = await waitForThreadStatus(
          harness.api,
          thread.id,
          "idle",
          30_000,
        );
        if (idle.environmentId === null)
          throw new Error("Rift environment missing");
        const environment = await waitForEnvironmentStatus(
          harness.api,
          idle.environmentId,
          "ready",
          30_000,
        );
        expect(environment.environmentProviderId).toBe("rift");
        expect(environment.isWorktree).toBe(false);
        expect(environment.managed).toBe(true);
        expect(environment.branchName).toBe("bb/rift-integration");
        if (environment.path === null) throw new Error("Rift copy missing");
        await access(environment.path);
        expect(
          await readFile(join(environment.path, "hook-order"), "utf8"),
        ).toBe("rift\ncore-setup\n");
        const hooks = harness.db
          .select()
          .from(environmentHookOperations)
          .where(eq(environmentHookOperations.path, environment.path))
          .all();
        expect(hooks).toHaveLength(1);
        expect(hooks[0]).toMatchObject({ kind: "setup", error: null });
        expect(hooks[0]?.finishedAt).toBeTypeOf("number");
        const canonicalPath = await realpath(environment.path);
        expect(getEnvironment(harness.db, environment.id)?.canonicalPath).toBe(
          canonicalPath,
        );
        expect(getEnvironmentLaunch(harness.db, thread.id)?.claimPath).toBe(
          canonicalPath,
        );
      }),
  );
});
