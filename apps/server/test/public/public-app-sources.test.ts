import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveApplicationPath } from "@bb/config/app-storage-paths";
import {
  appSourceStatusSchema,
  appSummarySchema,
} from "@bb/server-contract";
import { readJson } from "../helpers/json.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const execFileAsync = promisify(execFile);

async function git(repoPath: string, ...args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, { cwd: repoPath });
  return result.stdout.trim();
}

describe("public app source routes", () => {
  let repoPath: string;
  let origin: string;

  beforeEach(async () => {
    repoPath = await mkdtemp(path.join(tmpdir(), "bb-app-sources-route-"));
    origin = `file://${repoPath}`;
    await git(repoPath, "init", "-q", "-b", "main");
    await git(repoPath, "config", "user.email", "test@example.com");
    await git(repoPath, "config", "user.name", "Test");
    const appPath = path.join(repoPath, "hello");
    await mkdir(path.join(appPath, "public"), { recursive: true });
    await writeFile(
      path.join(appPath, "manifest.json"),
      JSON.stringify({ manifestVersion: 1, id: "hello", entry: "index.html" }),
      "utf8",
    );
    await writeFile(
      path.join(appPath, "public", "index.html"),
      "<h1>v1</h1>",
      "utf8",
    );
    await git(repoPath, "add", "-A");
    await git(repoPath, "commit", "-qm", "one");
  });

  afterEach(async () => {
    await rm(repoPath, { recursive: true, force: true });
  });

  async function addSource(harness: TestAppHarness): Promise<Response> {
    return harness.app.request("/api/v1/app-sources", {
      method: "POST",
      body: JSON.stringify({ origin, name: "fixture" }),
      headers: { "content-type": "application/json" },
    });
  }

  it("adds a source, installs its apps, and exposes provenance", async () => {
    await withTestHarness(async (harness) => {
      const addResponse = await addSource(harness);
      expect(addResponse.status).toBe(201);
      const status = appSourceStatusSchema.parse(await readJson(addResponse));
      expect(status).toMatchObject({
        name: "fixture",
        origin,
        ref: null,
        lastError: null,
        syncing: false,
        apps: [{ applicationId: "hello", status: "installed", error: null }],
      });

      const listResponse = await harness.app.request("/api/v1/app-sources");
      expect(listResponse.status).toBe(200);
      const sources = appSourceStatusSchema
        .array()
        .parse(await readJson(listResponse));
      expect(sources).toHaveLength(1);

      const appsResponse = await harness.app.request("/api/v1/apps");
      const apps = appSummarySchema.array().parse(await readJson(appsResponse));
      expect(apps).toHaveLength(1);
      expect(apps[0].source).toEqual({
        name: "fixture",
        commitSha: status.lastCommitSha,
      });

      const entryResponse = await harness.app.request("/api/v1/apps/hello/");
      expect(entryResponse.status).toBe(200);
      expect(await entryResponse.text()).toContain("<h1>v1</h1>");

      // The provenance marker is never served as static content.
      const provenanceResponse = await harness.app.request(
        "/api/v1/apps/hello/.bb-app-source.json",
      );
      expect(provenanceResponse.status).toBe(404);
    });
  });

  it("rejects duplicate sources and unknown sync targets", async () => {
    await withTestHarness(async (harness) => {
      expect((await addSource(harness)).status).toBe(201);
      expect((await addSource(harness)).status).toBe(409);

      const unknownSync = await harness.app.request(
        "/api/v1/app-sources/unknown/sync",
        {
          method: "POST",
          body: JSON.stringify({ force: false }),
          headers: { "content-type": "application/json" },
        },
      );
      expect(unknownSync.status).toBe(404);

      const invalidName = await harness.app.request(
        "/api/v1/app-sources/Not%20A%20Slug/sync",
        {
          method: "POST",
          body: JSON.stringify({ force: false }),
          headers: { "content-type": "application/json" },
        },
      );
      expect(invalidName.status).toBe(400);
    });
  });

  it("syncs upstream changes through the route", async () => {
    await withTestHarness(async (harness) => {
      await addSource(harness);
      await writeFile(
        path.join(repoPath, "hello", "public", "index.html"),
        "<h1>v2</h1>",
        "utf8",
      );
      await git(repoPath, "add", "-A");
      await git(repoPath, "commit", "-qm", "two");

      const syncResponse = await harness.app.request(
        "/api/v1/app-sources/fixture/sync",
        {
          method: "POST",
          body: JSON.stringify({ force: false }),
          headers: { "content-type": "application/json" },
        },
      );
      expect(syncResponse.status).toBe(200);
      const status = appSourceStatusSchema.parse(await readJson(syncResponse));
      expect(status.lastError).toBeNull();

      const entryResponse = await harness.app.request("/api/v1/apps/hello/");
      expect(await entryResponse.text()).toContain("<h1>v2</h1>");
    });
  });

  it("guards managed apps from deletion until detached", async () => {
    await withTestHarness(async (harness) => {
      await addSource(harness);

      const deleteResponse = await harness.app.request("/api/v1/apps/hello", {
        method: "DELETE",
      });
      expect(deleteResponse.status).toBe(409);
      await expect(readJson(deleteResponse)).resolves.toMatchObject({
        code: "app_managed_by_source",
      });

      const detachResponse = await harness.app.request(
        "/api/v1/apps/hello/detach",
        { method: "POST" },
      );
      expect(detachResponse.status).toBe(200);

      const appsResponse = await harness.app.request("/api/v1/apps");
      const apps = appSummarySchema.array().parse(await readJson(appsResponse));
      expect(apps[0].source).toBeNull();

      const deleteAfterDetach = await harness.app.request(
        "/api/v1/apps/hello",
        { method: "DELETE" },
      );
      expect(deleteAfterDetach.status).toBe(200);
    });
  });

  it("removes a source and its managed apps", async () => {
    await withTestHarness(async (harness) => {
      await addSource(harness);

      const removeResponse = await harness.app.request(
        "/api/v1/app-sources/fixture",
        { method: "DELETE" },
      );
      expect(removeResponse.status).toBe(200);

      await expect(
        stat(resolveApplicationPath(harness.config.dataDir, "hello")),
      ).rejects.toMatchObject({ code: "ENOENT" });
      const listResponse = await harness.app.request("/api/v1/app-sources");
      await expect(readJson(listResponse)).resolves.toEqual([]);
    });
  });
});
