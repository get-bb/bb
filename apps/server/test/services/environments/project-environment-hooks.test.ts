import { projects, updateHost } from "@bb/db";
import { expect, it } from "vitest";
import { runEnvironmentHook } from "../../../src/services/environments/environment-hooks.js";
import { setMachineEnvironmentVariable } from "../../../src/services/machines/environment-storage.js";
import { registerHostRpcResponder } from "../../helpers/host-rpc.js";
import { seedHostSession } from "../../helpers/seed.js";
import { withTestHarness } from "../../helpers/test-app.js";

it("resolves project overrides for teardown, including recovery dispatch", async () => {
  await withTestHarness(async (harness) => {
    const { host, session } = seedHostSession(harness.deps);
    updateHost(harness.db, harness.hub, host.id, {
      machineProviderId: "manual",
    });
    harness.db
      .insert(projects)
      .values({ id: "hook-project", name: "Hook", createdAt: 1, updatedAt: 1 })
      .run();
    await setMachineEnvironmentVariable(
      harness.db,
      harness.config.dataDir,
      { name: "REGION", value: "hook-region", note: null },
      "hook-project",
    );
    const captured: unknown[] = [];
    registerHostRpcResponder(harness, {
      hostId: host.id,
      sessionId: session.id,
      handle: async (request) => {
        if (request.command.type !== "environment.hook.run")
          throw new Error("Unexpected command");
        captured.push(request.command);
        return { ok: true, result: {} };
      },
    });
    for (const resumeOnly of [false, true]) {
      await runEnvironmentHook(harness.deps, {
        id: `hook-${resumeOnly}`,
        projectId: "hook-project",
        hostId: host.id,
        path: "/tmp/hook",
        kind: "teardown",
        resumeOnly,
        report: { step: () => undefined, log: () => undefined },
        signal: new AbortController().signal,
      });
    }
    expect(captured).toHaveLength(2);
    for (const command of captured)
      expect(command).toMatchObject({
        contributedEnv: expect.arrayContaining([
          expect.objectContaining({
            name: "REGION",
            value: "hook-region",
            source: { core: "project-environment" },
          }),
        ]),
      });
  });
});
