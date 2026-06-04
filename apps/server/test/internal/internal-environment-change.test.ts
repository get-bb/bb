import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  resolveApplicationManifestPath,
  resolveApplicationPath,
  resolveApplicationPublicPath,
} from "@bb/config/app-storage-paths";
import { getEnvironment } from "@bb/db";
import type { AppManifest } from "@bb/server-contract";
import { describe, expect, it, vi } from "vitest";
import { onDaemonSocketMessage } from "../../src/ws/daemon-protocol.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";
import { createMockHubSocket } from "../helpers/mock-hub-socket.js";

interface TestDaemonSocket {
  close: (code?: number, reason?: string) => void;
  send: (data: string) => void;
}

function createTestDaemonSocket(): TestDaemonSocket {
  return {
    close: vi.fn(),
    send: vi.fn(),
  };
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 1_000,
): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function writeApplication(
  dataDir: string,
  manifest: AppManifest,
): Promise<void> {
  await mkdir(resolveApplicationPublicPath(dataDir, manifest.id), {
    recursive: true,
  });
  await writeFile(
    resolveApplicationManifestPath(dataDir, manifest.id),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(resolveApplicationPublicPath(dataDir, manifest.id), "index.html"),
    "<!doctype html><title>External App</title>",
    "utf8",
  );
}

describe("internal environment change websocket hints", () => {
  it("does not resolve host RPC waiters from a different daemon session", async () => {
    await withTestHarness(async (harness) => {
      const hostA = seedHostSession(harness.deps, {
        id: "host-rpc-response-a",
      });
      const hostB = seedHostSession(harness.deps, {
        id: "host-rpc-response-b",
      });
      const wait = harness.hub.requestHostOnlineRpc({
        hostId: hostA.host.id,
        timeoutMs: 1_000,
        message: {
          type: "host-rpc.request",
          requestId: "rpc-protocol-session-scoped",
          command: { type: "provider.list" },
        },
      });
      let resolved = false;
      const observed = wait.then((response) => {
        resolved = true;
        return response;
      });
      const socket = createTestDaemonSocket();

      onDaemonSocketMessage(harness.deps, {
        hostId: hostB.host.id,
        sessionId: hostB.session.id,
        socket,
        raw: JSON.stringify({
          type: "host-rpc.response",
          requestId: "rpc-protocol-session-scoped",
          commandType: "provider.list",
          ok: true,
          result: { providers: [] },
        }),
      });

      await Promise.resolve();
      expect(resolved).toBe(false);
      expect(socket.close).not.toHaveBeenCalled();

      onDaemonSocketMessage(harness.deps, {
        hostId: hostA.host.id,
        sessionId: hostA.session.id,
        socket,
        raw: JSON.stringify({
          type: "host-rpc.response",
          requestId: "rpc-protocol-session-scoped",
          commandType: "provider.list",
          ok: true,
          result: { providers: [] },
        }),
      });

      await expect(observed).resolves.toEqual({
        type: "host-rpc.response",
        requestId: "rpc-protocol-session-scoped",
        commandType: "provider.list",
        ok: true,
        result: { providers: [] },
      });
      expect(socket.close).not.toHaveBeenCalled();
    });
  });

  it.each([
    "work-status-changed",
    "thread-storage-changed",
    "git-refs-changed",
  ] as const)(
    "notifies clients for %s hints without mutating rows",
    async (change) => {
      await withTestHarness(async (harness) => {
        const { host, session } = seedHostSession(harness.deps, {
          id: `host-env-change-${change}`,
        });
        const { project } = seedProjectWithSource(harness.deps, {
          hostId: host.id,
        });
        const environment = seedEnvironment(harness.deps, {
          hostId: host.id,
          projectId: project.id,
          path: `/tmp/env-change-${change}`,
          status: "ready",
        });
        const before = getEnvironment(harness.db, environment.id);
        const notifyEnvironmentSpy = vi.spyOn(harness.hub, "notifyEnvironment");
        const socket = createTestDaemonSocket();

        onDaemonSocketMessage(harness.deps, {
          hostId: host.id,
          sessionId: session.id,
          socket,
          raw: JSON.stringify({
            type: "environment-change",
            environmentId: environment.id,
            change,
          }),
        });

        expect(notifyEnvironmentSpy).toHaveBeenCalledWith(environment.id, [
          change,
        ]);
        expect(getEnvironment(harness.db, environment.id)).toEqual(before);
        expect(socket.close).not.toHaveBeenCalled();
      });
    },
  );

  it("ignores hints for environments owned by a different host", async () => {
    await withTestHarness(async (harness) => {
      const hostA = seedHostSession(harness.deps, { id: "host-env-change-a" });
      const hostB = seedHostSession(harness.deps, { id: "host-env-change-b" });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: hostB.host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: hostB.host.id,
        projectId: project.id,
        path: "/tmp/env-change-other-host",
        status: "ready",
      });
      const notifyEnvironmentSpy = vi.spyOn(harness.hub, "notifyEnvironment");
      const socket = createTestDaemonSocket();

      onDaemonSocketMessage(harness.deps, {
        hostId: hostA.host.id,
        sessionId: hostA.session.id,
        socket,
        raw: JSON.stringify({
          type: "environment-change",
          environmentId: environment.id,
          change: "work-status-changed",
        }),
      });

      expect(notifyEnvironmentSpy).not.toHaveBeenCalled();
      expect(socket.close).not.toHaveBeenCalled();
    });
  });

  it("ignores hints for unknown or destroyed environments", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-env-change-ignored",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const destroyedEnvironment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/env-change-destroyed",
        status: "destroyed",
      });
      const notifyEnvironmentSpy = vi.spyOn(harness.hub, "notifyEnvironment");
      const socket = createTestDaemonSocket();

      for (const environmentId of ["env-missing", destroyedEnvironment.id]) {
        onDaemonSocketMessage(harness.deps, {
          hostId: host.id,
          sessionId: session.id,
          socket,
          raw: JSON.stringify({
            type: "environment-change",
            environmentId,
            change: "work-status-changed",
          }),
        });
      }

      expect(notifyEnvironmentSpy).not.toHaveBeenCalled();
      expect(socket.close).not.toHaveBeenCalled();
    });
  });

  it("closes the daemon websocket for invalid environment change kinds", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-env-change-invalid",
      });
      const notifyEnvironmentSpy = vi.spyOn(harness.hub, "notifyEnvironment");
      const socket = createTestDaemonSocket();

      onDaemonSocketMessage(harness.deps, {
        hostId: host.id,
        sessionId: session.id,
        socket,
        raw: JSON.stringify({
          type: "environment-change",
          environmentId: "env-1",
          change: "status-changed",
        }),
      });

      expect(socket.close).toHaveBeenCalledWith(1008, "invalid-message");
      expect(notifyEnvironmentSpy).not.toHaveBeenCalled();
    });
  });

  it("notifies app list clients when a daemon watcher reports an externally added app", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-app-added",
      });
      const notifySystemSpy = vi.spyOn(harness.hub, "notifySystem");
      const socket = createTestDaemonSocket();

      await writeApplication(harness.config.dataDir, {
        manifestVersion: 1,
        id: "external-added",
        name: "External Added",
        entry: "index.html",
        capabilities: [],
      });

      onDaemonSocketMessage(harness.deps, {
        hostId: host.id,
        sessionId: session.id,
        socket,
        raw: JSON.stringify({
          type: "application-storage-changed",
        }),
      });

      await waitFor(() =>
        notifySystemSpy.mock.calls.some(([changes]) =>
          changes.includes("apps-changed"),
        ),
      );
      expect(socket.close).not.toHaveBeenCalled();
    });
  });

  it("notifies app list clients when a daemon watcher reports an externally removed app", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-app-removed",
      });
      await writeApplication(harness.config.dataDir, {
        manifestVersion: 1,
        id: "external-removed",
        name: "External Removed",
        entry: "index.html",
        capabilities: [],
      });
      const notifySystemSpy = vi.spyOn(harness.hub, "notifySystem");
      const socket = createTestDaemonSocket();

      await rm(
        resolveApplicationPath(harness.config.dataDir, "external-removed"),
        { recursive: true, force: true },
      );
      onDaemonSocketMessage(harness.deps, {
        hostId: host.id,
        sessionId: session.id,
        socket,
        raw: JSON.stringify({
          type: "application-storage-changed",
        }),
      });

      await waitFor(() =>
        notifySystemSpy.mock.calls.some(([changes]) =>
          changes.includes("apps-changed"),
        ),
      );
      expect(socket.close).not.toHaveBeenCalled();
    });
  });

  it("broadcasts app-scoped content changes from a daemon watcher without an apps-changed system hint", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-app-content-changed",
      });
      const notifySystemSpy = vi.spyOn(harness.hub, "notifySystem");
      const clientSocket = createMockHubSocket();
      harness.hub.subscribe(clientSocket, "app");
      const socket = createTestDaemonSocket();

      onDaemonSocketMessage(harness.deps, {
        hostId: host.id,
        sessionId: session.id,
        socket,
        raw: JSON.stringify({
          type: "application-content-changed",
          applicationId: "external-content",
        }),
      });

      expect(
        clientSocket.messages.map((message) => JSON.parse(message)),
      ).toEqual([
        {
          type: "changed",
          entity: "app",
          id: "external-content",
          changes: ["content-changed"],
        },
      ]);
      // Give any erroneously triggered async app-list refresh a chance to run
      // before asserting no system-level apps-changed broadcast happened.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(notifySystemSpy).not.toHaveBeenCalled();
      expect(socket.close).not.toHaveBeenCalled();
    });
  });
});
