import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getThread } from "@bb/db";
import { describe, expect, it, vi } from "vitest";
import { seedThreadFixture } from "../helpers/seed.js";
import { startTestServer, withTestHarness } from "../helpers/test-app.js";

describe("archive request logging", () => {
  it("logs each archive and unarchive with the request source", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness, {
        thread: { status: "idle" },
      });
      const info = vi.spyOn(harness.deps.logger, "info");

      const fromApp = await harness.app.request(
        `/api/v1/threads/${thread.id}/archive-all`,
        { method: "POST", headers: { "x-bb-app-surface": "desktop" } },
      );
      expect(fromApp.status).toBe(200);
      const archivedAt = getThread(harness.db, thread.id)?.archivedAt;
      expect(archivedAt).toEqual(expect.any(Number));

      const fromCli = await harness.app.request(
        `/api/v1/threads/${thread.id}/archive-all`,
        {
          method: "POST",
          headers: { "x-bb-cli": "1", "x-bb-caller-thread": "thr_parent" },
        },
      );
      expect(fromCli.status).toBe(200);

      const unarchive = await harness.app.request(
        `/api/v1/threads/${thread.id}/unarchive`,
        { method: "POST" },
      );
      expect(unarchive.status).toBe(200);

      const environmentArchive = await harness.app.request(
        `/api/v1/environments/${environment.id}/archive-threads`,
        { method: "POST", headers: { "x-bb-cli": "1" } },
      );
      expect(environmentArchive.status).toBe(200);

      expect(info.mock.calls).toEqual(
        expect.arrayContaining([
          [
            {
              threadId: thread.id,
              alreadyArchivedAt: null,
              archivedThreadIds: [thread.id],
              source: { kind: "app", surface: "desktop" },
            },
            "Thread archived",
          ],
          [
            {
              threadId: thread.id,
              alreadyArchivedAt: archivedAt,
              archivedThreadIds: [],
              source: { kind: "cli", callerThreadId: "thr_parent" },
            },
            "Archive requested for an already-archived thread",
          ],
          [
            {
              threadId: thread.id,
              archivedAt,
              source: { kind: "api" },
            },
            "Thread unarchived",
          ],
          [
            {
              environmentId: environment.id,
              archivedThreadIds: [thread.id],
              source: { kind: "cli", callerThreadId: null },
            },
            "Environment threads archived",
          ],
        ]),
      );
    });
  });

  it("attributes archives made through a plugin's bb.sdk to that plugin", async () => {
    const server = await startTestServer();
    const workDir = await mkdtemp(join(tmpdir(), "bb-archive-source-"));
    try {
      const { thread } = seedThreadFixture(server, {
        thread: { status: "idle" },
      });
      server.pluginService.bindSdk({ baseUrl: server.baseUrl });
      const rootDir = join(workDir, "bb-plugin-archiver");
      await mkdir(rootDir, { recursive: true });
      await writeFile(
        join(rootDir, "package.json"),
        JSON.stringify({
          name: "bb-plugin-archiver",
          version: "0.1.0",
          bb: {
            name: "Archiver",
            description: "Archive source fixture.",
            branding: { icon: "Zap" },
            server: "./server.ts",
          },
        }),
      );
      await writeFile(
        join(rootDir, "server.ts"),
        "export default function plugin() {}",
      );
      await server.pluginService.installPath(rootDir);
      const api = server.pluginService.getApi("archiver");
      if (!api) throw new Error("archiver plugin is not running");
      const info = vi.spyOn(server.deps.logger, "info");

      await api.sdk.threads.archive({ threadId: thread.id });

      expect(info).toHaveBeenCalledWith(
        {
          threadId: thread.id,
          alreadyArchivedAt: null,
          archivedThreadIds: [thread.id],
          source: { kind: "plugin", pluginId: "archiver" },
        },
        "Thread archived",
      );
    } finally {
      await server.pluginService.stop();
      await rm(workDir, { recursive: true, force: true });
      await server.close();
    }
  });
});
