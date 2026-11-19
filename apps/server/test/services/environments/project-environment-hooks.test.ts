import { environmentHookOperations, projects, updateHost } from "@bb/db";
import { expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  reportEnvironmentHookProgress,
  runEnvironmentHook,
  runEnvironmentTeardownHook,
} from "../../../src/services/environments/environment-hooks.js";
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
      await runEnvironmentTeardownHook(harness.deps, {
        id: `hook-${resumeOnly}`,
        projectId: "hook-project",
        hostId: host.id,
        path: "/tmp/hook",
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

it("runs setup through the hook runner with fresh project env each time, progress and failure", async () => {
  await withTestHarness(async (harness) => {
    const { host, session } = seedHostSession(harness.deps);
    updateHost(harness.db, harness.hub, host.id, {
      machineProviderId: "manual",
    });
    harness.db
      .insert(projects)
      .values({
        id: "setup-project",
        name: "Setup",
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
    const captured: unknown[] = [];
    let fail = false;
    registerHostRpcResponder(harness, {
      hostId: host.id,
      sessionId: session.id,
      handle: async (request) => {
        if (request.command.type !== "environment.hook.run")
          throw new Error("Unexpected command");
        captured.push(request.command);
        reportEnvironmentHookProgress(harness.deps, host.id, {
          type: "environment.hook.progress",
          operationId: request.command.operationId,
          entry: {
            type: "output",
            key: "setup-output-1",
            text: "installing",
            status: null,
            startedAt: null,
            metadata: null,
          },
        });
        return fail
          ? {
              ok: false,
              errorCode: "setup_script_failed",
              errorMessage: "Setup script failed with exit code 1",
            }
          : { ok: true, result: {} };
      },
    });
    const entries: unknown[] = [];
    const run = (id: string) =>
      runEnvironmentHook(harness.deps, {
        id,
        projectId: "setup-project",
        hostId: host.id,
        path: "/tmp/warm",
        kind: "setup",
        resumeOnly: false,
        onProgress: (entry) => entries.push(entry),
        signal: new AbortController().signal,
      });
    const operation = (id: string) =>
      harness.db
        .select()
        .from(environmentHookOperations)
        .where(eq(environmentHookOperations.id, id))
        .get();

    for (const [index, value] of [
      "first-secret",
      "refreshed-secret",
    ].entries()) {
      await setMachineEnvironmentVariable(
        harness.db,
        harness.config.dataDir,
        { name: "REGION", value, note: null },
        "setup-project",
      );
      await run(`setup-${index}`);
      expect(captured.at(-1)).toMatchObject({
        kind: "setup",
        path: "/tmp/warm",
        resumeOnly: false,
        contributedEnv: expect.arrayContaining([
          expect.objectContaining({ name: "REGION", value }),
        ]),
      });
      expect(JSON.stringify(operation(`setup-${index}`))).not.toContain(value);
      expect(operation(`setup-${index}`)).toMatchObject({
        finishedAt: expect.any(Number),
        error: null,
      });
    }
    await run("setup-0");
    expect(captured).toHaveLength(3);
    expect(captured.at(-1)).toMatchObject({
      operationId: "setup-0",
      resumeOnly: false,
    });
    fail = true;
    await expect(run("setup-failing")).rejects.toThrow(
      "Setup script failed with exit code 1",
    );
    expect(operation("setup-failing")).toMatchObject({
      finishedAt: expect.any(Number),
      error: "Setup script failed with exit code 1",
    });
    expect(entries).toContainEqual({
      type: "output",
      key: "setup-output-1",
      text: "installing",
    });
  });
});
