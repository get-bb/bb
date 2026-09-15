import { reportEnvironmentHookProgress } from "../../../src/services/environments/environment-hooks.js";
import { getProjectSourceByHost, projectSourceOwnsPath } from "@bb/db";
import { describe, expect, it, vi } from "vitest";
import { ensureProjectSourceOnHost } from "../../../src/services/projects/project-source-setup.js";
import {
  listQueuedCommands,
  reportQueuedCommandSuccess,
  reportQueuedCommandError,
  waitForQueuedCommand,
} from "../../helpers/commands.js";
import { seedHostSession, seedProjectWithSource } from "../../helpers/seed.js";
import { withTestHarness } from "../../helpers/test-app.js";

const remoteUrl = "https://example.test/team/project.git";
const targetPath = "/private/checkouts/project-id";

describe("automatic project source setup", () => {
  it.each(["missing", "recovered", "foreign"] as const)(
    "serializes concurrent setup of a %s target",
    async (target) => {
      await withTestHarness(async (harness) => {
        const original = seedHostSession(harness.deps, {
          id: "source-original",
        });
        const fresh = seedHostSession(harness.deps, { id: "source-fresh" });
        const { project } = seedProjectWithSource(harness.deps, {
          hostId: original.host.id,
        });
        const args = {
          projectId: project.id,
          projectName: project.name,
          hostId: fresh.host.id,
          remoteUrl,
        };
        const logs = [vi.fn(), vi.fn()];
        const setup = Promise.allSettled([
          ensureProjectSourceOnHost(harness.deps, {
            ...args,
            report: { log: logs[0]!, step: vi.fn() },
          }),
          ensureProjectSourceOnHost(harness.deps, {
            ...args,
            report: { log: logs[1]!, step: vi.fn() },
          }),
        ]);
        const defaultPath = await waitForQueuedCommand(
          harness,
          ({ command }) => command.type === "project.clone_default_path",
        );
        expect(defaultPath.command).toEqual({
          type: "project.clone_default_path",
          projectSlug: `project-${project.id}`,
        });
        expect(
          listQueuedCommands(harness, "project.clone_default_path"),
        ).toHaveLength(1);
        await reportQueuedCommandSuccess(harness, defaultPath, {
          path: targetPath,
        });
        const exists = await waitForQueuedCommand(
          harness,
          ({ command }) => command.type === "host.paths_exist",
        );
        await reportQueuedCommandSuccess(harness, exists, {
          existence: { [targetPath]: target !== "missing" },
        });
        if (target === "missing") {
          const clone = await waitForQueuedCommand(
            harness,
            ({ command }) => command.type === "project.clone",
          );
          expect(listQueuedCommands(harness, "project.clone")).toHaveLength(1);
          expect(clone.command).toMatchObject({ remoteUrl, targetPath });
          if (clone.command.type !== "project.clone")
            throw new Error("Expected clone");
          const progress = {
            type: "environment.hook.progress" as const,
            operationId: clone.command.operationId,
            entry: {
              type: "output" as const,
              text: "Receiving objects: 42%",
              status: null,
            },
          };
          reportEnvironmentHookProgress(
            harness.deps,
            original.host.id,
            progress,
          );
          for (const log of logs) expect(log).not.toHaveBeenCalled();
          reportEnvironmentHookProgress(harness.deps, fresh.host.id, progress);
          expect(logs[0]).toHaveBeenCalledExactlyOnceWith(
            "Receiving objects: 42%\n",
          );
          expect(logs[1]).not.toHaveBeenCalled();
          await reportQueuedCommandSuccess(harness, clone, {
            path: targetPath,
            gitRemoteUrl: remoteUrl,
          });
          await setup;
          reportEnvironmentHookProgress(harness.deps, fresh.host.id, progress);
          expect(logs[0]).toHaveBeenCalledTimes(1);
          expect(logs[1]).not.toHaveBeenCalled();
        } else {
          const inspect = await waitForQueuedCommand(
            harness,
            ({ command }) => command.type === "project.inspect",
          );
          expect(
            getProjectSourceByHost(harness.db, project.id, fresh.host.id),
          ).toBeNull();
          expect(listQueuedCommands(harness, "project.clone")).toEqual([]);
          await reportQueuedCommandSuccess(harness, inspect, {
            path: targetPath,
            gitRemoteUrl:
              target === "foreign"
                ? "https://example.test/unrelated.git"
                : remoteUrl,
          });
        }
        const results = await setup;
        expect(
          projectSourceOwnsPath(
            harness.db,
            project.id,
            fresh.host.id,
            targetPath,
          ),
        ).toBe(target === "missing");
        if (target === "foreign") {
          expect(results).toEqual([
            {
              status: "rejected",
              reason: expect.objectContaining({
                message: expect.stringContaining("does not match"),
              }),
            },
            {
              status: "rejected",
              reason: expect.objectContaining({
                message: expect.stringContaining("does not match"),
              }),
            },
          ]);
          expect(
            getProjectSourceByHost(harness.db, project.id, fresh.host.id),
          ).toBeNull();
          return;
        }
        const source = getProjectSourceByHost(
          harness.db,
          project.id,
          fresh.host.id,
        );
        expect(source).toMatchObject({ path: targetPath });
        expect(results).toEqual([
          { status: "fulfilled", value: source },
          { status: "fulfilled", value: source },
        ]);
        await expect(
          ensureProjectSourceOnHost(harness.deps, {
            ...args,
            projectName: "Renamed project",
          }),
        ).resolves.toEqual(source);
        expect(listQueuedCommands(harness, "project.clone")).toEqual([]);
        expect(
          listQueuedCommands(harness, "project.clone_default_path"),
        ).toEqual([]);
      });
    },
  );
});

it("does not register a checkout or dispatch a turn after private repository authentication fails", async () => {
  await withTestHarness(async (harness) => {
    const source = seedHostSession(harness.deps, { id: "private-source" });
    const target = seedHostSession(harness.deps, { id: "private-target" });
    const { project } = seedProjectWithSource(harness.deps, {
      hostId: source.host.id,
    });
    const log = vi.fn();
    const result = ensureProjectSourceOnHost(harness.deps, {
      projectId: project.id,
      projectName: project.name,
      hostId: target.host.id,
      report: { log, step: vi.fn() },
      remoteUrl,
    }).then(
      () => "unexpected success",
      () => "checkout failed",
    );
    const path = await waitForQueuedCommand(
      harness,
      ({ command }) => command.type === "project.clone_default_path",
    );
    await reportQueuedCommandSuccess(harness, path, { path: targetPath });
    const exists = await waitForQueuedCommand(
      harness,
      ({ command }) => command.type === "host.paths_exist",
    );
    await reportQueuedCommandSuccess(harness, exists, {
      existence: { [targetPath]: false },
    });
    const clone = await waitForQueuedCommand(
      harness,
      ({ command }) => command.type === "project.clone",
    );
    await reportQueuedCommandError(harness, clone, {
      errorCode: "git_auth_failed",
      errorMessage: "Repository access denied",
    });
    expect(await result).toBe("checkout failed");
    if (clone.command.type !== "project.clone")
      throw new Error("Expected clone");
    reportEnvironmentHookProgress(harness.deps, target.host.id, {
      type: "environment.hook.progress",
      operationId: clone.command.operationId,
      entry: { type: "output", text: "late output", status: null },
    });
    expect(log).not.toHaveBeenCalled();
    expect(
      getProjectSourceByHost(harness.db, project.id, target.host.id),
    ).toBeNull();
    expect(listQueuedCommands(harness, "thread.start")).toEqual([]);
  });
});
