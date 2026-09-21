import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HOST_DAEMON_PROTOCOL_VERSION,
  type HostDaemonOnlineRpcRequestMessage,
  type HostDaemonRpcCommand,
} from "@bb/host-daemon-contract";
import {
  extractServerArchive,
  readLastServerMoveFile,
  readServerMovedFile,
  writeLastServerMoveFile,
} from "@bb/server-archive";
import {
  serverMoveStatusResponseSchema,
  serverMoveStatusSchema,
} from "@bb/server-contract";
import { setExperiments } from "@bb/db";
import { defaultExperiments } from "@bb/domain";
import { createDeferredPromise } from "@bb/test-helpers";
import { afterEach, describe, expect, it } from "vitest";
import { readJson } from "../helpers/json.js";
import {
  inspectResult,
  registerFakeDaemon,
  type FakeDaemonReply,
} from "../helpers/server-move.js";
import { seedHost, seedPrimaryHost } from "../helpers/seed.js";
import {
  createTestDaemonHostKey,
  withTestHarness,
  type TestAppHarness,
} from "../helpers/test-app.js";

const API = "/api/v1";
const OLD = "host-old";
const NEW = "host-new";
const WORKER = "host-worker";
const DIRECT_URL = "https://desktop.example.test";
const tempDirs: string[] = [];

type PrepareCommand = Extract<
  HostDaemonRpcCommand,
  { type: "server_move.prepare" }
>;

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })),
  );
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "bb-server-move-routes-"));
  tempDirs.push(dir);
  return dir;
}

function postJson(
  harness: TestAppHarness,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return Promise.resolve(
    harness.app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

function postExport(
  harness: TestAppHarness,
  headers: Record<string, string> = {},
): Promise<Response> {
  return Promise.resolve(
    harness.app.request(`${API}/server/export`, { method: "POST", headers }),
  );
}

function daemonHeaders(hostId: string): Record<string, string> {
  return {
    authorization: `Bearer ${createTestDaemonHostKey({ hostId })}`,
  };
}

function probeReply(
  request: HostDaemonOnlineRpcRequestMessage,
): FakeDaemonReply {
  return request.command.type === "server_move.probe"
    ? { ok: true, result: { reachable: true, message: null, state: "pending" } }
    : { ok: true, result: inspectResult() };
}

function seedTopology(harness: TestAppHarness): void {
  seedHost(harness.deps, { id: OLD, name: "Laptop" });
  seedPrimaryHost(harness.deps, OLD);
  seedHost(harness.deps, { id: NEW, name: "Desktop" });
  seedHost(harness.deps, { id: WORKER, name: "Worker" });
  setExperiments(harness.db, { ...defaultExperiments, serverMove: true });
}

describe("server move routes", () => {
  it("refuses to check, start, export, or delete old copies while the serverMove experiment is off", () =>
    withTestHarness(async (harness) => {
      seedTopology(harness);
      setExperiments(harness.db, defaultExperiments);
      const gated = await Promise.all([
        postJson(harness, `${API}/server/move/check`, {
          targetHostId: NEW,
          serverUrl: DIRECT_URL,
        }),
        postJson(harness, `${API}/server/move`, {
          targetHostId: NEW,
          serverUrl: DIRECT_URL,
          stopRunningWork: true,
          archiveExistingTargetServerData: false,
        }),
        postExport(harness),
        harness.app.request(`${API}/hosts/${OLD}/old-server-copy`, {
          method: "DELETE",
        }),
      ]);
      for (const response of gated) {
        expect(response.status).toBe(403);
        expect(await readJson(response)).toMatchObject({
          code: "server_move_experiment_disabled",
        });
      }
      const status = await harness.app.request(`${API}/server/move`);
      expect(status.status).toBe(200);
      expect(
        serverMoveStatusResponseSchema.parse(await readJson(status)),
      ).toEqual({ move: null, lastMove: null });
    }));

  it("runs a move through the public routes, freezes writes, and serves the archive only to the target", () =>
    withTestHarness(async (harness) => {
      seedTopology(harness);
      const events: string[] = [];
      const releasePrepare = createDeferredPromise<void>();
      const received: { prepare: PrepareCommand | null } = { prepare: null };
      registerFakeDaemon(harness, { events, hostId: OLD, handle: probeReply });
      registerFakeDaemon(harness, {
        events,
        hostId: WORKER,
        handle: probeReply,
      });
      registerFakeDaemon(harness, {
        events,
        hostId: NEW,
        handle: async (request): Promise<FakeDaemonReply> => {
          switch (request.command.type) {
            case "server_move.inspect":
              return {
                ok: true,
                result: inspectResult({
                  bbAppVersion: harness.config.appVersion,
                }),
              };
            case "server_move.prepare":
              received.prepare = request.command;
              await releasePrepare.promise;
              return {
                ok: true,
                result: { localServerUrl: "http://127.0.0.1:3334", pid: 42 },
              };
            case "server_move.activate":
            case "server_move.abort":
              return { ok: true, result: { ok: true } };
            default:
              throw new Error(`Unexpected ${request.command.type}`);
          }
        },
      });

      const check = await postJson(harness, `${API}/server/move/check`, {
        targetHostId: NEW,
        serverUrl: DIRECT_URL,
      });
      expect(check.status).toBe(200);
      expect(await readJson(check)).toMatchObject({
        mode: "direct",
        requiresServerUrl: true,
        canMove: true,
      });

      const start = await postJson(harness, `${API}/server/move`, {
        targetHostId: NEW,
        serverUrl: DIRECT_URL,
        stopRunningWork: true,
        archiveExistingTargetServerData: false,
      });
      expect(start.status).toBe(200);
      const started = serverMoveStatusSchema.parse(await readJson(start));
      await expect.poll(() => received.prepare !== null).toBe(true);
      const prepareCommand = received.prepare;
      if (prepareCommand === null) {
        throw new Error("The target never received prepare");
      }

      const during = await harness.app.request(`${API}/server/move`);
      expect(await readJson(during)).toMatchObject({
        move: { moveId: started.moveId, state: "preparing", cancellable: true },
        lastMove: null,
      });
      const frozenWrite = await postJson(harness, `${API}/projects`, {
        name: "Blocked while moving",
      });
      expect(frozenWrite.status).toBe(503);
      expect(await readJson(frozenWrite)).toMatchObject({
        code: "server_moving",
        retryable: false,
      });
      expect((await harness.app.request(`${API}/hosts`)).status).toBe(200);
      for (const [path, body] of [
        ["/internal/hosts/enroll-key", {}],
        ["/internal/hosts/enroll", { hostId: "host-late", hostName: "Late" }],
      ] as const) {
        const enrollment = await postJson(harness, path, body, {
          authorization: "Bearer enroll-token",
        });
        expect(enrollment.status, path).toBe(503);
        expect(await readJson(enrollment)).toMatchObject({
          code: "server_moving",
        });
      }
      const checkDuringMove = await postJson(
        harness,
        `${API}/server/move/check`,
        {
          targetHostId: NEW,
          serverUrl: DIRECT_URL,
        },
      );
      expect(checkDuringMove.status).toBe(200);
      expect(await readJson(checkDuringMove)).toMatchObject({
        canMove: false,
        items: expect.arrayContaining([
          expect.objectContaining({ id: "move-in-progress" }),
        ]),
      });

      const archivePath = prepareCommand.archive.downloadPath;
      expect(archivePath).toBe(
        `/internal/server-move/${started.moveId}/archive`,
      );
      expect((await harness.app.request(archivePath)).status).toBe(401);
      const forbidden = await harness.app.request(archivePath, {
        headers: daemonHeaders(WORKER),
      });
      expect(forbidden.status).toBe(403);
      expect(await readJson(forbidden)).toMatchObject({
        code: "server_move_download_forbidden",
      });
      expect(
        (
          await harness.app.request(
            "/internal/server-move/other-move/archive",
            {
              headers: daemonHeaders(NEW),
            },
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await harness.app.request(
            `/internal/server-move/${started.moveId}/bb-app.tgz`,
            { headers: daemonHeaders(NEW) },
          )
        ).status,
      ).toBe(404);
      const download = await harness.app.request(archivePath, {
        headers: daemonHeaders(NEW),
      });
      expect(download.status).toBe(200);
      expect(download.headers.get("content-length")).toBe(
        String(prepareCommand.archive.sizeBytes),
      );
      const archiveBytes = Buffer.from(await download.arrayBuffer());
      expect(archiveBytes.byteLength).toBe(prepareCommand.archive.sizeBytes);
      expect(createHash("sha256").update(archiveBytes).digest("hex")).toBe(
        prepareCommand.archive.sha256,
      );
      const downloaded = join(await makeTempDir(), "server.tar.gz");
      await writeFile(downloaded, archiveBytes);
      const manifest = await extractServerArchive({
        archivePath: downloaded,
        destinationDir: await makeTempDir(),
      });
      expect(manifest.entries.map((entry) => entry.path)).toContain("bb.db");

      releasePrepare.resolve();
      await expect
        .poll(async () => {
          const response = await harness.app.request(`${API}/server/move`);
          return serverMoveStatusResponseSchema.parse(await readJson(response))
            .move?.state;
        })
        .toBe("completed");

      expect(
        (
          await harness.app.request(archivePath, {
            headers: daemonHeaders(NEW),
          })
        ).status,
      ).toBe(404);
      const cancel = await harness.app.request(`${API}/server/move/cancel`, {
        method: "POST",
      });
      expect(cancel.status).toBe(409);
      expect(await readJson(cancel)).toMatchObject({
        code: "server_move_not_cancellable",
      });
      const retry = await postJson(harness, `${API}/server/move`, {
        targetHostId: NEW,
        serverUrl: DIRECT_URL,
        stopRunningWork: true,
        archiveExistingTargetServerData: false,
      });
      expect(retry.status).toBe(200);
      expect(await readJson(retry)).toMatchObject({
        moveId: started.moveId,
        state: "completed",
      });
      const otherTarget = await postJson(harness, `${API}/server/move`, {
        targetHostId: WORKER,
        serverUrl: DIRECT_URL,
        stopRunningWork: true,
        archiveExistingTargetServerData: false,
      });
      expect(otherTarget.status).toBe(409);
      expect(await readJson(otherTarget)).toMatchObject({
        code: "server_move_in_progress",
      });
      const moved = await readServerMovedFile(harness.config.dataDir);
      expect(moved).toMatchObject({
        moveId: started.moveId,
        toHostId: NEW,
        serverUrl: DIRECT_URL,
      });
      const sessionOpen = await postJson(
        harness,
        "/internal/session/open",
        {
          hostId: WORKER,
          instanceId: "instance-worker",
          hostName: "Worker",
          hasMachineCredential: false,
          platform: "linux",
          dataDir: "/home/me/.bb-machines/laptop",
          localApiPort: 38_888,
          protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
          activeThreads: [],
          loadedEnvironments: [],
        },
        daemonHeaders(WORKER),
      );
      expect(sessionOpen.status).toBe(410);
      expect(await readJson(sessionOpen)).toMatchObject({
        code: "server_moved",
        details: {
          serverUrl: DIRECT_URL,
          toHostName: "Desktop",
          movedAt: moved?.movedAt,
        },
      });
      expect(events).toContain(`server.moved:${WORKER}`);
    }));

  it("refuses machine credentials on every server move route", () =>
    withTestHarness(async (harness) => {
      seedTopology(harness);
      const machine = { "x-bb-gate-auth": "machine" };
      const responses = await Promise.all([
        postJson(
          harness,
          `${API}/server/move/check`,
          { targetHostId: NEW, serverUrl: DIRECT_URL },
          machine,
        ),
        postJson(
          harness,
          `${API}/server/move`,
          {
            targetHostId: NEW,
            serverUrl: DIRECT_URL,
            stopRunningWork: true,
            archiveExistingTargetServerData: false,
          },
          machine,
        ),
        harness.app.request(`${API}/server/move`, { headers: machine }),
        harness.app.request(`${API}/server/move/cancel`, {
          method: "POST",
          headers: machine,
        }),
        postExport(harness, machine),
        harness.app.request(`${API}/hosts/${OLD}/old-server-copy`, {
          method: "DELETE",
          headers: machine,
        }),
      ]);
      for (const response of responses) {
        expect(response.status).toBe(403);
        expect(await readJson(response)).toMatchObject({
          code: "machine_host_management_forbidden",
        });
      }
    }));

  it("reports the last move and records old copy deletion even when the machine already removed it", () =>
    withTestHarness(async (harness) => {
      seedTopology(harness);
      const lastMove = {
        moveId: "move-1",
        fromHostId: OLD,
        fromHostName: "Laptop",
        toHostId: NEW,
        toHostName: "Desktop",
        completedAt: 1_000,
        oldCopyDeletedAt: null,
      };
      await writeLastServerMoveFile(harness.config.dataDir, {
        version: 1,
        ...lastMove,
      });
      expect(
        await readJson(await harness.app.request(`${API}/server/move`)),
      ).toEqual({ move: null, lastMove });

      const offline = await harness.app.request(
        `${API}/hosts/${OLD}/old-server-copy`,
        { method: "DELETE" },
      );
      expect(offline.status).toBe(502);
      expect(
        (await readLastServerMoveFile(harness.config.dataDir))
          ?.oldCopyDeletedAt,
      ).toBeNull();

      const wrongHost = await harness.app.request(
        `${API}/hosts/${WORKER}/old-server-copy`,
        { method: "DELETE" },
      );
      expect(wrongHost.status).toBe(404);
      expect(await readJson(wrongHost)).toMatchObject({
        code: "old_server_copy_not_found",
      });

      const daemon = registerFakeDaemon(harness, {
        events: [],
        hostId: OLD,
        handle: () => ({ ok: true, result: { deleted: false } }),
      });
      const deleted = await harness.app.request(
        `${API}/hosts/${OLD}/old-server-copy`,
        { method: "DELETE" },
      );
      expect(deleted.status).toBe(200);
      expect(await readJson(deleted)).toEqual({ deleted: false });
      expect(daemon.requests.map((request) => request.command)).toEqual([
        { type: "server_move.delete_old_copy" },
      ]);
      expect(
        (await readLastServerMoveFile(harness.config.dataDir))
          ?.oldCopyDeletedAt,
      ).toEqual(expect.any(Number));
    }));

  it("streams a gzip export with a dated file name and its SHA-256 digest", () =>
    withTestHarness(async (harness) => {
      seedTopology(harness);
      const response = await postExport(harness);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/gzip");
      expect(response.headers.get("content-disposition")).toMatch(
        /^attachment; filename="bb-server-\d{4}-\d{2}-\d{2}\.tar\.gz"$/u,
      );
      const bytes = Buffer.from(await response.arrayBuffer());
      expect(response.headers.get("x-bb-archive-sha256")).toBe(
        createHash("sha256").update(bytes).digest("hex"),
      );
      const exportPath = join(await makeTempDir(), "export.tar.gz");
      await writeFile(exportPath, bytes);
      const manifest = await extractServerArchive({
        archivePath: exportPath,
        destinationDir: await makeTempDir(),
      });
      expect(manifest).toMatchObject({
        sourceDataDir: harness.config.dataDir,
        sourceServerHostId: OLD,
      });
      expect(manifest.entries.map((entry) => entry.path)).toContain("bb.db");
      await expect
        .poll(
          async () =>
            (
              await readdir(
                join(harness.config.dataDir, "server-export"),
              ).catch(() => [])
            ).length,
        )
        .toBe(0);
    }));
});
