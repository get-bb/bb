import { serve } from "@hono/node-server";
import { once } from "node:events";
import { access } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { join } from "node:path";
import { DatabaseReadService } from "../../src/services/database/database-read-service.js";
import { archiveThread } from "@bb/db";
import { threadSearchResponseSchema } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { readJson } from "../helpers/json.js";
import {
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("public thread search route", () => {
  it("returns active and archived search result groups", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const activeThread = seedThread(harness.deps, {
        projectId: project.id,
        title: "routeactive",
        titleFallback: "routeactive",
      });
      const archivedThread = seedThread(harness.deps, {
        projectId: project.id,
        title: "routearchived",
        titleFallback: "routearchived",
      });
      archiveThread(harness.deps.db, harness.deps.hub, archivedThread.id);
      const hiddenThread = seedThread(harness.deps, {
        projectId: project.id,
        title: "routehidden",
        titleFallback: "routehidden",
        visibility: "hidden",
      });
      const hiddenArchivedThread = seedThread(harness.deps, {
        projectId: project.id,
        title: "routehiddenarchived",
        titleFallback: "routehiddenarchived",
        visibility: "hidden",
      });
      archiveThread(harness.deps.db, harness.deps.hub, hiddenArchivedThread.id);

      const response = await harness.app.request(
        "/api/v1/threads/search?query=route&limitPerGroup=10",
      );

      expect(response.status).toBe(200);
      const body = threadSearchResponseSchema.parse(await readJson(response));
      expect(body.active.results.map((result) => result.thread.id)).toContain(
        activeThread.id,
      );
      expect(body.archived.results.map((result) => result.thread.id)).toContain(
        archivedThread.id,
      );
      expect(
        [...body.active.results, ...body.archived.results].map(
          (result) => result.thread.id,
        ),
      ).not.toContain(hiddenThread.id);
      expect(
        [...body.active.results, ...body.archived.results].map(
          (result) => result.thread.id,
        ),
      ).not.toContain(hiddenArchivedThread.id);
    });
  }, 15_000); // Includes migrated fixture setup and cold worker startup.

  it("validates required query and limit parameters before the thread-id route", async () => {
    await withTestHarness(async (harness) => {
      const missingQueryResponse = await harness.app.request(
        "/api/v1/threads/search",
      );
      expect(missingQueryResponse.status).toBe(400);

      const shortQueryResponse = await harness.app.request(
        "/api/v1/threads/search?query=x",
      );
      expect(shortQueryResponse.status).toBe(400);

      const badLimitResponse = await harness.app.request(
        "/api/v1/threads/search?query=valid&limitPerGroup=bad",
      );
      expect(badLimitResponse.status).toBe(400);
    });
  });
});

describe("search responsiveness", () => {
  it("serves an unrelated API and heartbeat timers during a slow native search", async () => {
    await withTestHarness(async (harness) => {
      await harness.deps.databaseReads.close();
      const databasePath = join(harness.config.dataDir, "bb.db");
      harness.deps.databaseReads = new DatabaseReadService({
        databasePath,
        logger: harness.deps.logger,
        executionTimeoutMs: 700,
        workerEntry: new URL(
          "../fixtures/slow-database-reader.mjs",
          import.meta.url,
        ),
      });
      let heartbeatCount = 0;
      let maxGapMs = 0;
      let previous = performance.now();
      const heartbeat = setInterval(() => {
        const now = performance.now();
        maxGapMs = Math.max(maxGapMs, now - previous);
        previous = now;
        heartbeatCount++;
      }, 10);
      try {
        const slow = harness.app.request("/api/v1/threads/search?query=slow");
        const end = performance.now() + 2000;
        while (true) {
          try {
            await access(databasePath + ".reader-ready");
            break;
          } catch {}
          if (performance.now() > end)
            throw new Error("The slow SQLite search did not start.");
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        const started = performance.now();
        const unrelated = await harness.app.request("/api/v1/projects");
        expect(unrelated.status).toBe(200);
        expect(performance.now() - started).toBeLessThan(250);
        const result = await slow;
        expect(result.status).toBe(504);
        expect(heartbeatCount).toBeGreaterThan(10);
        expect(maxGapMs).toBeLessThan(250);
      } finally {
        clearInterval(heartbeat);
      }
    });
  });

  it("cancels a disconnected HTTP search and serves the next search", async () => {
    await withTestHarness(async (harness) => {
      await harness.deps.databaseReads.close();
      const databasePath = join(harness.config.dataDir, "bb.db");
      harness.deps.databaseReads = new DatabaseReadService({
        databasePath,
        logger: harness.deps.logger,
        executionTimeoutMs: 500,
        workerEntry: new URL(
          "../fixtures/slow-database-reader.mjs",
          import.meta.url,
        ),
      });
      const server = serve({
        fetch: harness.app.fetch,
        hostname: "127.0.0.1",
        port: 0,
      });
      try {
        if (!server.listening) await once(server, "listening");
        const address = server.address();
        if (address === null || typeof address === "string")
          throw new Error("The test listener did not start.");
        const origin = `http://127.0.0.1:${address.port}`;
        const abort = new AbortController();
        const slow = fetch(origin + "/api/v1/threads/search?query=slow", {
          signal: abort.signal,
        });
        const rejected = expect(slow).rejects.toMatchObject({
          name: "AbortError",
        });
        const end = performance.now() + 2000;
        while (true) {
          try {
            await access(databasePath + ".reader-ready");
            break;
          } catch {}
          if (performance.now() > end)
            throw new Error("The slow SQLite search did not start.");
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        abort.abort();
        await rejected;
        expect(
          (await fetch(origin + "/api/v1/threads/search?query=next")).status,
        ).toBe(200);
      } finally {
        if ("closeAllConnections" in server) server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    });
  });
});
