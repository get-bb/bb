import path from "node:path";
import { markThreadDeleted } from "@bb/db";
import type { HostDaemonOnlineRpcRequestMessage } from "@bb/host-daemon-contract";
import { describe, expect, it } from "vitest";
import { removeOrphanedThreadStorage } from "../../src/services/threads/thread-storage-orphans.js";
import { registerHostRpcResponder } from "../helpers/host-rpc.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

const ORPHANED_THREAD_ID = "thr_abcdefghij";
const THREAD_ID_ALPHABET = "23456789abcdefghijkmnpqrstuvwxyz";

function orphanedThreadIdAt(index: number): string {
  let suffix = "";
  for (let value = index; suffix.length < 10; value = Math.floor(value / 32)) {
    suffix = THREAD_ID_ALPHABET[value % 32] + suffix;
  }
  return `thr_${suffix}`;
}

describe("thread storage orphan cleanup", () => {
  it("continues removing orphaned directories after a removal fails", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      const rootPath = path.join(session.dataDir, "thread-storage");
      const rejectedPath = path.join(rootPath, "thr_2222222222");
      const removablePath = path.join(rootPath, "thr_3333333333");
      const attemptedPaths: string[] = [];
      const responder = registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: (request) => {
          if (request.command.type === "host.browse_directory") {
            return {
              ok: true,
              result: {
                directory: rootPath,
                parent: session.dataDir,
                entries: [rejectedPath, removablePath].map((entryPath) => ({
                  kind: "directory",
                  name: path.basename(entryPath),
                  path: entryPath,
                })),
              },
            };
          }
          if (request.command.type === "host.remove_path") {
            attemptedPaths.push(request.command.path);
            if (request.command.path === rejectedPath) {
              return {
                ok: false,
                errorCode: "invalid_path",
                errorMessage: `Path "${rejectedPath}" must not be a symbolic link`,
              };
            }
            return { ok: true, result: { ok: true } };
          }
          throw new Error(`Unexpected command ${request.command.type}`);
        },
      });

      try {
        await removeOrphanedThreadStorage(harness.deps, {
          hostId: host.id,
          isStopped: () => false,
        });
        expect(attemptedPaths).toEqual([rejectedPath, removablePath]);
      } finally {
        responder.unregister();
      }
    });
  });

  it("removes only thread-shaped directories that have no thread record", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const liveThread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
      });
      const deletedThread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
      });
      markThreadDeleted(harness.db, harness.hub, {
        threadId: deletedThread.id,
      });
      const rootPath = path.join(session.dataDir, "thread-storage");
      const directory = (name: string) => ({
        kind: "directory" as const,
        name,
        path: path.join(rootPath, name),
      });
      const leadingOrphanIds = Array.from({ length: 1_000 }, (_, index) =>
        orphanedThreadIdAt(index),
      );
      const removedPaths: string[] = [];
      const responder = registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: (request: HostDaemonOnlineRpcRequestMessage) => {
          if (request.command.type === "host.browse_directory") {
            expect(request.command.path).toBe(rootPath);
            return {
              ok: true,
              result: {
                directory: rootPath,
                parent: session.dataDir,
                entries: [
                  ...leadingOrphanIds.map(directory),
                  directory(liveThread.id),
                  directory(deletedThread.id),
                  directory(ORPHANED_THREAD_ID),
                  directory("workflows"),
                  {
                    kind: "file",
                    name: "thr_bcdefghijk",
                    path: path.join(rootPath, "thr_bcdefghijk"),
                  },
                ],
              },
            };
          }
          if (request.command.type === "host.remove_path") {
            expect(request.command).toMatchObject({
              recursive: true,
              rootPath,
            });
            removedPaths.push(request.command.path);
            return { ok: true, result: { ok: true } };
          }
          throw new Error(`Unexpected command ${request.command.type}`);
        },
      });

      await removeOrphanedThreadStorage(harness.deps, {
        hostId: host.id,
        isStopped: () => false,
      });
      responder.unregister();

      expect(removedPaths).toEqual(
        [...leadingOrphanIds, ORPHANED_THREAD_ID].map((threadId) =>
          path.join(rootPath, threadId),
        ),
      );
    });
  });
});
