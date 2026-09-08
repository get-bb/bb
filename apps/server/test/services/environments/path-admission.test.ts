import { mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getEnvironment } from "@bb/db";
import { describe, expect, it, vi } from "vitest";
import {
  backfillEnvironmentPathIdentities,
  resolveEnvironmentPathIdentity,
} from "../../../src/services/environments/path-admission.js";
import { resolveProducedEnvironmentPlacement } from "../../../src/services/threads/thread-environment-placement.js";
import { onDaemonSocketOpen } from "../../../src/ws/daemon-protocol.js";
import { registerTestHostRpcCapture } from "../../helpers/commands.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
} from "../../helpers/seed.js";
import { withTestHarness } from "../../helpers/test-app.js";

describe("legacy environment path backfill", () => {
  it("isolates ELOOP and EACCES rows, retries failures and only logs once", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bb-path-backfill-"));
    const loop = join(directory, "loop");
    await symlink(loop, loop);
    try {
      await withTestHarness(async (harness) => {
        const { host, session } = seedHostSession(harness.deps);
        registerTestHostRpcCapture(harness, {
          hostId: host.id,
          sessionId: session.id,
        });
        const { project } = seedProjectWithSource(harness.deps, {
          hostId: host.id,
        });
        const denied = join(directory, "denied");
        const broken = [loop, denied].map((path) =>
          seedEnvironment(harness.deps, {
            hostId: host.id,
            projectId: project.id,
            path,
            status: "error",
            providerOwnsPath: true,
          }),
        );
        const healthy = seedEnvironment(harness.deps, {
          hostId: host.id,
          projectId: project.id,
          path: directory,
          environmentProviderId: "project-checkout",
        });
        const original = harness.hub.requestHostOnlineRpc.bind(harness.hub);
        let repaired = false;
        const attempts: string[] = [];
        const rpc = vi
          .spyOn(harness.hub, "requestHostOnlineRpc")
          .mockImplementation(async (args) => {
            const command = args.message.command;
            if (command.type === "host.canonical_path") {
              attempts.push(command.path);
              try {
                if (!repaired && command.path === loop) await realpath(loop);
                if (!repaired && command.path === denied)
                  throw new Error("EACCES: permission denied");
              } catch (error) {
                return {
                  type: "host-rpc.response",
                  requestId: args.message.requestId,
                  commandType: command.type,
                  ok: false,
                  errorCode: "command_failed",
                  errorMessage:
                    error instanceof Error ? error.message : String(error),
                };
              }
            }
            return original(args);
          });
        const warn = vi.fn();
        harness.deps.logger = { ...harness.deps.logger, warn };
        try {
          for (let request = 0; request < 2; request++) {
            const response = await harness.app.request(
              `/api/v1/environments?hostId=${host.id}&path=${encodeURIComponent(directory)}`,
            );
            expect(response.status).toBe(200);
            expect(await response.json()).toEqual([
              expect.objectContaining({ id: healthy.id }),
            ]);
          }
          expect(
            broken.map(
              (row) => getEnvironment(harness.db, row.id)?.canonicalPath,
            ),
          ).toEqual([null, null]);
          expect(attempts.filter((path) => path === loop)).toHaveLength(2);
          expect(attempts.filter((path) => path === denied)).toHaveLength(2);
          expect(warn).toHaveBeenCalledTimes(2);
          await expect(
            resolveProducedEnvironmentPlacement(harness.deps, {
              environmentProviderId: "project-checkout",
              inputs: null,
              projectId: project.id,
              producedEnvironment: {
                type: "host",
                hostId: host.id,
                path: directory,
                ownsPath: false,
              },
            }),
          ).resolves.toMatchObject({ environmentId: healthy.id });
          repaired = true;
          await resolveEnvironmentPathIdentity(
            harness.deps,
            host.id,
            directory,
          );
          expect(
            broken.map(
              (row) => getEnvironment(harness.db, row.id)?.canonicalPath,
            ),
          ).toEqual([loop, denied]);
          const before = attempts.filter((path) => path === loop).length;
          await resolveEnvironmentPathIdentity(
            harness.deps,
            host.id,
            directory,
          );
          expect(attempts.filter((path) => path === loop)).toHaveLength(before);
        } finally {
          rpc.mockRestore();
        }
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("backfills on daemon connection and shares an in-flight pass with requests", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      const socket = registerTestHostRpcCapture(harness, {
        hostId: host.id,
        sessionId: session.id,
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const row = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/startup-backfill",
      });
      const rpc = vi.spyOn(harness.hub, "requestHostOnlineRpc");
      try {
        onDaemonSocketOpen(harness.deps, {
          hostId: host.id,
          sessionId: session.id,
          socket,
        });
        await backfillEnvironmentPathIdentities(harness.deps, host.id);
        expect(getEnvironment(harness.db, row.id)?.canonicalPath).toBe(
          row.path,
        );
        expect(
          rpc.mock.calls.filter(
            ([args]) => args.message.command.type === "host.canonical_path",
          ),
        ).toHaveLength(1);
        await backfillEnvironmentPathIdentities(harness.deps, host.id);
        expect(
          rpc.mock.calls.filter(
            ([args]) => args.message.command.type === "host.canonical_path",
          ),
        ).toHaveLength(1);
      } finally {
        rpc.mockRestore();
      }
    });
  });

  it.each(["/tmp/unresolved", "/tmp/unresolved/child"])(
    "blocks unresolved raw ownership of %s before canonicalizing the candidate",
    async (candidate) => {
      await withTestHarness(async (harness) => {
        const { host, session } = seedHostSession(harness.deps);
        registerTestHostRpcCapture(harness, {
          hostId: host.id,
          sessionId: session.id,
        });
        const { project } = seedProjectWithSource(harness.deps, {
          hostId: host.id,
        });
        const row = seedEnvironment(harness.deps, {
          hostId: host.id,
          projectId: project.id,
          path: "/tmp/unresolved",
          status: "error",
          providerOwnsPath: true,
        });
        const original = harness.hub.requestHostOnlineRpc.bind(harness.hub);
        const rpc = vi
          .spyOn(harness.hub, "requestHostOnlineRpc")
          .mockImplementation(async (args) => {
            const command = args.message.command;
            if (
              command.type === "host.canonical_path" &&
              command.path === row.path
            )
              throw new Error("EACCES");
            return original(args);
          });
        try {
          await expect(
            resolveEnvironmentPathIdentity(harness.deps, host.id, candidate),
          ).rejects.toMatchObject({ status: 409 });
          expect(getEnvironment(harness.db, row.id)?.canonicalPath).toBeNull();
        } finally {
          rpc.mockRestore();
        }
      });
    },
  );
});
