import { createHash } from "node:crypto";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HostDaemonRpcCommand } from "@bb/host-daemon-contract";
import { createDeferredPromise } from "@bb/test-helpers";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { errorToResponse } from "../../src/errors.js";
import { setAuthenticatedDaemon } from "../../src/internal/auth.js";
import { registerInternalServerMoveRoutes } from "../../src/internal/server-move.js";
import { createServerMoveCoordinator } from "../../src/services/server-move/coordinator.js";
import {
  createTestServerMoveEnvironment,
  inspectResult,
  registerFakeDaemon,
  type FakeDaemonReply,
} from "../helpers/server-move.js";
import { seedHost, seedPrimaryHost } from "../helpers/seed.js";
import { testLogger, withTestHarness } from "../helpers/test-app.js";

type PrepareCommand = Extract<
  HostDaemonRpcCommand,
  { type: "server_move.prepare" }
>;

describe("server move downloads", () => {
  it("streams the archive and the full bb-app package with exact content lengths", () =>
    withTestHarness(async (harness) => {
      seedHost(harness.deps, { id: "host-old", name: "Laptop" });
      seedPrimaryHost(harness.deps, "host-old");
      seedHost(harness.deps, { id: "host-new", name: "Desktop" });
      const artifactDir = await mkdtemp(join(tmpdir(), "bb-app-artifact-"));
      try {
        const artifactPath = join(artifactDir, "bb-app-full.tgz");
        const artifactBytes = Buffer.from("full bb-app package bytes");
        await writeFile(artifactPath, artifactBytes);
        const { environment, events } = createTestServerMoveEnvironment(
          harness,
          {
            fullArtifact: {
              availability: async () => ({
                available: true,
                unpackedSizeBytes: artifactBytes.byteLength,
                version: harness.config.appVersion,
              }),
              build: async () => ({
                path: artifactPath,
                sha256: createHash("sha256")
                  .update(artifactBytes)
                  .digest("hex"),
                sizeBytes: artifactBytes.byteLength,
                version: harness.config.appVersion,
              }),
            },
          },
        );
        const coordinator = createServerMoveCoordinator(environment);
        const releasePrepare = createDeferredPromise<FakeDaemonReply>();
        const received: { prepare: PrepareCommand | null } = { prepare: null };
        registerFakeDaemon(harness, {
          events,
          hostId: "host-old",
          handle: (request) =>
            request.command.type === "server_move.probe"
              ? {
                  ok: true,
                  result: { reachable: true, message: null, state: "pending" },
                }
              : { ok: true, result: inspectResult() },
        });
        registerFakeDaemon(harness, {
          events,
          hostId: "host-new",
          handle: (request) => {
            switch (request.command.type) {
              case "server_move.inspect":
                return {
                  ok: true,
                  result: inspectResult({ bbAppVersion: "0.0.0-alpha.1" }),
                };
              case "server_move.prepare":
                received.prepare = request.command;
                return releasePrepare.promise;
              default:
                return { ok: true, result: { ok: true } };
            }
          },
        });
        const app = new Hono();
        app.onError((error) => errorToResponse(error, testLogger));
        app.use("*", async (context, next) => {
          setAuthenticatedDaemon(context, {
            hostId: context.req.header("x-test-host") ?? "",
            keyId: "test-key",
          });
          await next();
        });
        const internalApi = new Hono();
        registerInternalServerMoveRoutes(internalApi, harness.deps, {
          pending: null,
          serverMove: coordinator,
        });
        app.route("/internal", internalApi);

        await coordinator.start({
          targetHostId: "host-new",
          serverUrl: "https://desktop.example.test",
          stopRunningWork: true,
          archiveExistingTargetServerData: false,
        });
        await expect.poll(() => received.prepare !== null).toBe(true);
        const prepare = received.prepare;
        if (prepare === null || prepare.bbApp === null) {
          throw new Error("The target never received a bb-app download");
        }

        const bbApp = await app.request(prepare.bbApp.downloadPath, {
          headers: { "x-test-host": "host-new" },
        });
        expect(bbApp.status).toBe(200);
        expect(bbApp.headers.get("content-length")).toBe(
          String(artifactBytes.byteLength),
        );
        expect(Buffer.from(await bbApp.arrayBuffer())).toEqual(artifactBytes);
        expect(prepare.bbApp.sizeBytes).toBe(artifactBytes.byteLength);

        const archive = await app.request(prepare.archive.downloadPath, {
          headers: { "x-test-host": "host-new" },
        });
        expect(archive.status).toBe(200);
        expect(archive.headers.get("content-length")).toBe(
          String(prepare.archive.sizeBytes),
        );
        expect((await archive.arrayBuffer()).byteLength).toBe(
          prepare.archive.sizeBytes,
        );

        const forbidden = await app.request(prepare.bbApp.downloadPath, {
          headers: { "x-test-host": "host-old" },
        });
        expect(forbidden.status).toBe(403);
        expect((await stat(artifactPath)).size).toBe(artifactBytes.byteLength);
        coordinator.cancel();
        releasePrepare.resolve({
          ok: false,
          errorCode: "server_move_cancelled",
          errorMessage: "cancelled",
        });
      } finally {
        await rm(artifactDir, { force: true, recursive: true });
      }
    }));
});
