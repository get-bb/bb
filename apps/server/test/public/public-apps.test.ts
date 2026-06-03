import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  resolveApplicationAssetsPath,
  resolveApplicationDataPath,
  resolveApplicationManifestPath,
  resolveApplicationPath,
  resolveAppsRootPath,
} from "@bb/config/app-storage-paths";
import {
  appDetailSchema,
  appSummarySchema,
  type AppManifest,
} from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

const VALID_APP_ID = "app_valid";
const VALID_MANIFEST: AppManifest = {
  manifestVersion: 1,
  id: VALID_APP_ID,
  name: "Valid App",
  icon: "ListTodo",
  entry: "index.html",
  capabilities: ["data", "message"],
};

async function writeApplication(
  dataDir: string,
  manifest: AppManifest,
): Promise<void> {
  await mkdir(resolveApplicationAssetsPath(dataDir, manifest.id), {
    recursive: true,
  });
  await mkdir(resolveApplicationDataPath(dataDir, manifest.id), {
    recursive: true,
  });
  await writeFile(
    resolveApplicationManifestPath(dataDir, manifest.id),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(resolveApplicationAssetsPath(dataDir, manifest.id), "index.html"),
    "<!doctype html><title>Valid App</title>",
    "utf8",
  );
}

describe("public global app routes", () => {
  it("lists and gets valid global apps by application id", async () => {
    await withTestHarness(async (harness) => {
      await writeApplication(harness.config.dataDir, VALID_MANIFEST);
      await mkdir(
        resolveApplicationPath(harness.config.dataDir, "app_invalid"),
        { recursive: true },
      );
      await writeFile(
        resolveApplicationManifestPath(harness.config.dataDir, "app_invalid"),
        JSON.stringify({
          ...VALID_MANIFEST,
          id: "app_other",
          name: "Invalid",
        }),
        "utf8",
      );

      const listResponse = await harness.app.request("/api/v1/apps");
      expect(listResponse.status).toBe(200);
      const apps = appSummarySchema.array().parse(await readJson(listResponse));
      expect(apps.map((app) => app.applicationId)).toEqual([VALID_APP_ID]);

      const getResponse = await harness.app.request(
        `/api/v1/apps/${VALID_APP_ID}`,
      );
      expect(getResponse.status).toBe(200);
      const detail = appDetailSchema.parse(await readJson(getResponse));
      expect(detail).toMatchObject({
        applicationId: VALID_APP_ID,
        name: "Valid App",
        appRootPath: resolveApplicationPath(
          harness.config.dataDir,
          VALID_APP_ID,
        ),
        appDataPath: resolveApplicationDataPath(
          harness.config.dataDir,
          VALID_APP_ID,
        ),
      });
    });
  });

  it("returns app_missing and invalid_manifest distinctly", async () => {
    await withTestHarness(async (harness) => {
      const missingResponse = await harness.app.request(
        "/api/v1/apps/app_missing",
      );
      expect(missingResponse.status).toBe(404);
      await expect(readJson(missingResponse)).resolves.toMatchObject({
        code: "app_missing",
      });

      await mkdir(
        resolveApplicationPath(harness.config.dataDir, "app_invalid"),
        { recursive: true },
      );
      await writeFile(
        resolveApplicationManifestPath(harness.config.dataDir, "app_invalid"),
        JSON.stringify({ ...VALID_MANIFEST, id: "app_other" }),
        "utf8",
      );

      const invalidResponse = await harness.app.request(
        "/api/v1/apps/app_invalid",
      );
      expect(invalidResponse.status).toBe(422);
      await expect(readJson(invalidResponse)).resolves.toMatchObject({
        code: "invalid_manifest",
      });
    });
  });

  it("creates and deletes apps atomically on the filesystem", async () => {
    await withTestHarness(async (harness) => {
      const createResponse = await harness.app.request("/api/v1/apps", {
        method: "POST",
        body: JSON.stringify({ name: "Created App" }),
      });
      expect(createResponse.status).toBe(201);
      const created = appDetailSchema.parse(await readJson(createResponse));
      expect(created.applicationId).toMatch(/^app_[A-Za-z0-9_-]+$/u);
      expect(created.name).toBe("Created App");

      const manifestText = await readFile(
        resolveApplicationManifestPath(
          harness.config.dataDir,
          created.applicationId,
        ),
        "utf8",
      );
      expect(JSON.parse(manifestText)).toMatchObject({
        id: created.applicationId,
        name: "Created App",
      });
      const appRootEntries = await readdir(resolveAppsRootPath(harness.config.dataDir));
      expect(appRootEntries.some((entry) => entry.startsWith(".tmp-app_"))).toBe(
        false,
      );

      const deleteResponse = await harness.app.request(
        `/api/v1/apps/${created.applicationId}`,
        { method: "DELETE" },
      );
      expect(deleteResponse.status).toBe(200);
      const deletedGetResponse = await harness.app.request(
        `/api/v1/apps/${created.applicationId}`,
      );
      expect(deletedGetResponse.status).toBe(404);
    });
  });

  it("requires an explicit message target outside an iframe session", async () => {
    await withTestHarness(async (harness) => {
      await writeApplication(harness.config.dataDir, VALID_MANIFEST);

      const response = await harness.app.request(
        `/api/v1/apps/${VALID_APP_ID}/message`,
        {
          method: "POST",
          body: JSON.stringify({ payload: "hello" }),
        },
      );

      expect(response.status).toBe(400);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "message_target_required",
      });
    });
  });

  it("accepts explicit targetThreadId for non-iframe app messages", async () => {
    await withTestHarness(async (harness) => {
      await writeApplication(harness.config.dataDir, VALID_MANIFEST);
      const { host } = seedHostSession(harness.deps, {
        id: "host-app-message",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/app-message",
        status: "ready",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
      });
      seedThreadRuntimeState(harness.deps, {
        environmentId: environment.id,
        providerThreadId: "provider-app-message",
        threadId: thread.id,
      });

      const response = await harness.app.request(
        `/api/v1/apps/${VALID_APP_ID}/message`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            payload: "hello",
            targetThreadId: thread.id,
          }),
        },
      );

      expect(response.status).toBe(202);
    });
  });
});
