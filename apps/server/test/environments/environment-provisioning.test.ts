import {
  environments,
  environmentHookOperations,
  getEnvironment,
  getThread,
  listEvents,
  threads,
} from "@bb/db";
import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { advanceEnvironmentProvisioning } from "../../src/services/environments/environment-engine.js";
import { registerHostRpcResponder } from "../helpers/host-rpc.js";
import { ApiError } from "../../src/errors.js";
import { runStartupRecoverySweep } from "../../src/services/system/periodic-sweeps.js";
import { createThreadFromRequest } from "../../src/services/threads/thread-create.js";
import {
  seedEnvironment,
  seedHost,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { textInput } from "../helpers/prompt-input.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("environment reprovisioning", () => {
  it("fails host-backed thread creation before creating provisioning state when the host is disconnected", async () => {
    await withTestHarness(async (harness) => {
      const host = seedHost(harness.deps, {
        id: "host-thread-create-offline",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/thread-create-offline-project",
      });

      let thrownError: ApiError | null = null;
      try {
        await createThreadFromRequest(harness.deps, {
          startedOnBehalfOf: null,
          environment: {
            type: "host",
            hostId: host.id,
            workspace: { type: "unmanaged", path: null },
          },
          input: textInput("offline create"),
          origin: "cli",
          projectId: project.id,
          providerId: "codex",
        });
      } catch (error) {
        if (error instanceof ApiError) {
          thrownError = error;
        } else {
          throw error;
        }
      }

      expect(thrownError).toMatchObject({
        body: {
          code: "host_unavailable",
          message: "Host is not connected",
        },
        status: 502,
      });
      expect(harness.db.select({ id: threads.id }).from(threads).all()).toEqual(
        [],
      );
      expect(
        harness.db.select({ id: environments.id }).from(environments).all(),
      ).toEqual([]);
    });
  });

  it("marks orphaned provisioning environments interrupted on startup recovery", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-orphaned-env-provision",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        status: "provisioning",
        environmentProviderId: "personal-workspace",
        isGitRepo: false,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "starting",
      });
      await runStartupRecoverySweep(harness.deps);

      expect(getEnvironment(harness.db, environment.id)?.status).toBe("error");
      expect(getThread(harness.db, thread.id)).toMatchObject({
        status: "error",
      });
      expect(
        listEvents(harness.db, { threadId: thread.id }).map(
          (event) => event.type,
        ),
      ).toEqual(["system/thread-provisioning", "system/error"]);
    });
  });
});

it("does not replace an unresolved RuntimeManager setup with a new successful attempt", async () => {
  await withTestHarness(async (harness) => {
    const { host, session } = seedHostSession(harness.deps, {
      id: "host-setup-retry",
    });
    const { project } = seedProjectWithSource(harness.deps, {
      hostId: host.id,
    });
    const environment = seedEnvironment(harness.deps, {
      hostId: host.id,
      projectId: project.id,
      status: "provisioning",
      environmentProviderId: "git-worktree",
      environmentProviderInstanceKey: "retry",
      providerOwnsPath: true,
    });
    const id = `environment:${environment.id}:retry:setup`;
    harness.db
      .insert(environmentHookOperations)
      .values({
        id,
        operationId: id,
        hostId: host.id,
        path: environment.path!,
        kind: "setup",
        startedAt: 1,
      })
      .run();
    const attach = vi.fn(async () => ({ ok: true as const, result: {} }));
    registerHostRpcResponder(harness, {
      hostId: host.id,
      sessionId: session.id,
      handle: attach,
    });
    await advanceEnvironmentProvisioning(harness.deps, {
      environmentId: environment.id,
      request: {
        command: {
          type: "environment.attach",
          environmentId: environment.id,
          path: environment.path!,
          setupScriptTimeoutMs: 1000,
          contributedEnv: [],
          initiator: null,
        },
      },
    });
    await expect
      .poll(() => getEnvironment(harness.db, environment.id)?.status)
      .toBe("error");
    expect(attach).not.toHaveBeenCalled();
    expect(
      harness.db.select().from(environmentHookOperations).get(),
    ).toMatchObject({ id, startedAt: 1, finishedAt: null });
  });
});

it.each([
  ["setup_script_failed", true],
  ["command_failed", false],
  ["host_rpc_timeout", false],
] as const)(
  "settles setup failure %s only when termination is confirmed",
  async (errorCode, retryable) => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        status: "provisioning",
        environmentProviderId: "git-worktree",
        environmentProviderInstanceKey: "failure-retry",
        providerOwnsPath: true,
      });
      let fail = true;
      const responder = registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: () =>
          fail
            ? { ok: false, errorCode, errorMessage: "Setup failed" }
            : {
                ok: true,
                result: {
                  path: environment.path!,
                  isGitRepo: false,
                  isWorktree: false,
                  branchName: null,
                  defaultBranch: null,
                },
              },
      });
      const request = {
        command: {
          type: "environment.attach" as const,
          environmentId: environment.id,
          path: environment.path!,
          setupScriptTimeoutMs: 1000,
          contributedEnv: [],
          initiator: null,
        },
      };
      await advanceEnvironmentProvisioning(harness.deps, {
        environmentId: environment.id,
        request,
      });
      await expect
        .poll(() => getEnvironment(harness.db, environment.id)?.status)
        .toBe("error");
      const operation = () =>
        harness.db.select().from(environmentHookOperations).get();
      if (retryable)
        expect(operation()?.finishedAt).toEqual(expect.any(Number));
      else expect(operation()?.finishedAt).toBeNull();
      fail = false;
      harness.db
        .update(environments)
        .set({ status: "provisioning" })
        .where(eq(environments.id, environment.id))
        .run();
      await advanceEnvironmentProvisioning(harness.deps, {
        environmentId: environment.id,
        request,
      });
      await expect
        .poll(() => getEnvironment(harness.db, environment.id)?.status)
        .toBe(retryable ? "ready" : "error");
      expect(
        responder.requests.filter(
          (request) => request.command.type === "environment.attach",
        ),
      ).toHaveLength(retryable ? 2 : 1);
      if (retryable)
        expect(operation()).toMatchObject({
          finishedAt: expect.any(Number),
          error: null,
        });
      else expect(operation()?.finishedAt).toBeNull();
    });
  },
);
