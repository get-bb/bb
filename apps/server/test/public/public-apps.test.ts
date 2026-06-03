import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  resolveApplicationDataPath,
  resolveApplicationManifestPath,
  resolveApplicationPath,
  resolveApplicationPublicPath,
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

const VALID_APP_ID = "status";
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
  await mkdir(resolveApplicationPublicPath(dataDir, manifest.id), {
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
    path.join(resolveApplicationPublicPath(dataDir, manifest.id), "index.html"),
    "<!doctype html><title>Valid App</title>",
    "utf8",
  );
}

async function writeRawApplicationManifest(
  dataDir: string,
  applicationId: string,
  manifestContent: string,
): Promise<void> {
  await mkdir(resolveApplicationPublicPath(dataDir, applicationId), {
    recursive: true,
  });
  await writeFile(
    resolveApplicationManifestPath(dataDir, applicationId),
    manifestContent,
    "utf8",
  );
  await writeFile(
    path.join(
      resolveApplicationPublicPath(dataDir, applicationId),
      "index.html",
    ),
    "<!doctype html><title>Test App</title>",
    "utf8",
  );
}

async function writeApplicationPublicFile(
  dataDir: string,
  applicationId: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const filePath = path.join(
    resolveApplicationPublicPath(dataDir, applicationId),
    relativePath,
  );
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

function appRequestPath(resolvedUrl: URL): string {
  return `${resolvedUrl.pathname}${resolvedUrl.search}${resolvedUrl.hash}`;
}

describe("public global app routes", () => {
  it("lists and gets valid global apps by application id", async () => {
    await withTestHarness(async (harness) => {
      await writeApplication(harness.config.dataDir, VALID_MANIFEST);
      await mkdir(
        resolveApplicationPath(harness.config.dataDir, "invalid-app"),
        { recursive: true },
      );
      await writeFile(
        resolveApplicationManifestPath(harness.config.dataDir, "invalid-app"),
        JSON.stringify({
          ...VALID_MANIFEST,
          id: "other",
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

  it("uses manifest name for display with a slug fallback", async () => {
    await withTestHarness(async (harness) => {
      await writeRawApplicationManifest(
        harness.config.dataDir,
        "named-app",
        JSON.stringify({
          manifestVersion: 1,
          id: "named-app",
          name: "Named App",
          entry: "index.html",
        }),
      );
      await writeRawApplicationManifest(
        harness.config.dataDir,
        "missing-name",
        JSON.stringify({
          manifestVersion: 1,
          id: "missing-name",
          entry: "index.html",
        }),
      );
      await writeRawApplicationManifest(
        harness.config.dataDir,
        "empty-name",
        JSON.stringify({
          manifestVersion: 1,
          id: "empty-name",
          name: "",
          entry: "index.html",
        }),
      );

      const listResponse = await harness.app.request("/api/v1/apps");
      expect(listResponse.status).toBe(200);
      const apps = appSummarySchema.array().parse(await readJson(listResponse));
      expect(
        apps.map((app) => ({
          applicationId: app.applicationId,
          name: app.name,
        })),
      ).toEqual([
        { applicationId: "empty-name", name: "empty-name" },
        { applicationId: "missing-name", name: "missing-name" },
        { applicationId: "named-app", name: "Named App" },
      ]);
    });
  });

  it("returns app_missing and invalid_manifest distinctly", async () => {
    await withTestHarness(async (harness) => {
      const missingResponse = await harness.app.request("/api/v1/apps/missing");
      expect(missingResponse.status).toBe(404);
      await expect(readJson(missingResponse)).resolves.toMatchObject({
        code: "app_missing",
      });

      await mkdir(
        resolveApplicationPath(harness.config.dataDir, "invalid-app"),
        { recursive: true },
      );
      await writeFile(
        resolveApplicationManifestPath(harness.config.dataDir, "invalid-app"),
        JSON.stringify({ ...VALID_MANIFEST, id: "other" }),
        "utf8",
      );

      const invalidResponse = await harness.app.request(
        "/api/v1/apps/invalid-app",
      );
      expect(invalidResponse.status).toBe(422);
      await expect(readJson(invalidResponse)).resolves.toMatchObject({
        code: "invalid_manifest",
      });
    });
  });

  it("serves public web-root files from the app route", async () => {
    await withTestHarness(async (harness) => {
      const applicationId = "vite-spa";
      await writeApplication(harness.config.dataDir, {
        manifestVersion: 1,
        id: applicationId,
        name: "Vite SPA",
        entry: "index.html",
        capabilities: ["data"],
      });
      await writeApplicationPublicFile(
        harness.config.dataDir,
        applicationId,
        "index.html",
        [
          "<!doctype html>",
          "<html><head>",
          '<script type="module" src="./index-flat.js"></script>',
          '<script type="module" src="./assets/index-relative.js"></script>',
          '<link rel="stylesheet" href="./assets/index.css">',
          "</head><body></body></html>",
        ].join(""),
      );
      await writeApplicationPublicFile(
        harness.config.dataDir,
        applicationId,
        "index-flat.js",
        'import("./chunk.js"); window.flatAsset = true;',
      );
      await writeApplicationPublicFile(
        harness.config.dataDir,
        applicationId,
        "chunk.js",
        "window.dynamicChunk = true;",
      );
      await writeApplicationPublicFile(
        harness.config.dataDir,
        applicationId,
        "assets/index-relative.js",
        "window.relativeAsset = true;",
      );
      await writeApplicationPublicFile(
        harness.config.dataDir,
        applicationId,
        "assets/index.css",
        'body { background-image: url("./logo.svg"); }',
      );
      await writeApplicationPublicFile(
        harness.config.dataDir,
        applicationId,
        "assets/logo.svg",
        "<svg></svg>",
      );

      const entryResponse = await harness.app.request(
        `/api/v1/apps/${applicationId}/`,
      );
      expect(entryResponse.status).toBe(200);
      const html = await entryResponse.text();
      expect(html).not.toContain("<base");
      expect(html).toContain('src="./index-flat.js"');
      expect(html).toContain('src="./assets/index-relative.js"');
      expect(html).toContain('href="./assets/index.css"');

      const pageUrl = new URL(`http://bb.test/api/v1/apps/${applicationId}/`);
      const flatResponse = await harness.app.request(
        appRequestPath(new URL("./index-flat.js", pageUrl)),
      );
      const relativeResponse = await harness.app.request(
        appRequestPath(new URL("./assets/index-relative.js", pageUrl)),
      );
      const dynamicChunkResponse = await harness.app.request(
        appRequestPath(new URL("./chunk.js", pageUrl)),
      );
      const cssResponse = await harness.app.request(
        appRequestPath(new URL("./assets/index.css", pageUrl)),
      );
      const cssAssetResponse = await harness.app.request(
        appRequestPath(
          new URL("./logo.svg", new URL("./assets/index.css", pageUrl)),
        ),
      );

      expect(flatResponse.status).toBe(200);
      await expect(flatResponse.text()).resolves.toBe(
        'import("./chunk.js"); window.flatAsset = true;',
      );
      expect(relativeResponse.status).toBe(200);
      await expect(relativeResponse.text()).resolves.toBe(
        "window.relativeAsset = true;",
      );
      expect(dynamicChunkResponse.status).toBe(200);
      await expect(dynamicChunkResponse.text()).resolves.toBe(
        "window.dynamicChunk = true;",
      );
      expect(cssResponse.status).toBe(200);
      await expect(cssResponse.text()).resolves.toBe(
        'body { background-image: url("./logo.svg"); }',
      );
      expect(cssAssetResponse.status).toBe(200);
      await expect(cssAssetResponse.text()).resolves.toBe("<svg></svg>");
    });
  });

  it("serves markdown entries from the public web root", async () => {
    await withTestHarness(async (harness) => {
      const applicationId = "readme";
      await writeApplication(harness.config.dataDir, {
        manifestVersion: 1,
        id: applicationId,
        name: "Readme",
        entry: "docs/index.md",
        capabilities: [],
      });
      await writeApplicationPublicFile(
        harness.config.dataDir,
        applicationId,
        "docs/index.md",
        "# App Notes\n",
      );

      const detailResponse = await harness.app.request(
        `/api/v1/apps/${applicationId}`,
      );
      expect(detailResponse.status).toBe(200);
      const detail = appDetailSchema.parse(await readJson(detailResponse));
      expect(detail.entry).toEqual({
        kind: "md",
        path: "docs/index.md",
      });

      const markdownResponse = await harness.app.request(
        `/api/v1/apps/${applicationId}/docs/index.md`,
      );
      expect(markdownResponse.status).toBe(200);
      await expect(markdownResponse.text()).resolves.toBe("# App Notes\n");
    });
  });

  it("rejects traversal attempts for public static files", async () => {
    await withTestHarness(async (harness) => {
      await writeApplication(harness.config.dataDir, VALID_MANIFEST);

      const response = await harness.app.request(
        `/api/v1/apps/${VALID_APP_ID}/..%2Fmanifest.json`,
      );

      expect(response.status).toBe(400);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "invalid_path",
      });
    });
  });

  it("does not expose manifest or data files through the public static path", async () => {
    await withTestHarness(async (harness) => {
      const applicationId = "private-files";
      await writeApplication(harness.config.dataDir, {
        manifestVersion: 1,
        id: applicationId,
        name: "Private Files",
        entry: "index.html",
        capabilities: [],
      });
      await writeApplicationPublicFile(
        harness.config.dataDir,
        applicationId,
        "manifest.json",
        '{"leak":true}\n',
      );
      await writeFile(
        path.join(
          resolveApplicationDataPath(harness.config.dataDir, applicationId),
          "state.json",
        ),
        '{"secret":true}\n',
        "utf8",
      );

      const manifestResponse = await harness.app.request(
        `/api/v1/apps/${applicationId}/manifest.json`,
      );
      expect(manifestResponse.status).toBe(404);

      const dataApiResponse = await harness.app.request(
        `/api/v1/apps/${applicationId}/data/state.json`,
      );
      expect(dataApiResponse.status).toBe(200);
      await expect(readJson(dataApiResponse)).resolves.toMatchObject({
        path: "state.json",
        value: { secret: true },
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
      expect(created.applicationId).toBe("created-app");
      expect(created.name).toBe("Created App");

      const manifestText = await readFile(
        resolveApplicationManifestPath(
          harness.config.dataDir,
          created.applicationId,
        ),
        "utf8",
      );
      expect(JSON.parse(manifestText)).toMatchObject({
        id: "created-app",
        name: "Created App",
      });
      await expect(
        readFile(
          path.join(
            resolveApplicationPublicPath(
              harness.config.dataDir,
              created.applicationId,
            ),
            "index.html",
          ),
          "utf8",
        ),
      ).resolves.toContain("Created App");
      const appRootEntries = await readdir(
        resolveAppsRootPath(harness.config.dataDir),
      );
      expect(appRootEntries.some((entry) => entry.startsWith(".tmp-"))).toBe(
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

  it("creates explicit slug apps and defaults manifest name to the slug", async () => {
    await withTestHarness(async (harness) => {
      const createResponse = await harness.app.request("/api/v1/apps", {
        method: "POST",
        body: JSON.stringify({ applicationId: "review-board" }),
      });
      expect(createResponse.status).toBe(201);
      const created = appDetailSchema.parse(await readJson(createResponse));
      expect(created).toMatchObject({
        applicationId: "review-board",
        name: "review-board",
        appRootPath: resolveApplicationPath(
          harness.config.dataDir,
          "review-board",
        ),
        appDataPath: resolveApplicationDataPath(
          harness.config.dataDir,
          "review-board",
        ),
      });
      const manifestText = await readFile(
        resolveApplicationManifestPath(harness.config.dataDir, "review-board"),
        "utf8",
      );
      expect(JSON.parse(manifestText)).toMatchObject({
        id: "review-board",
        name: "review-board",
      });
    });
  });

  it("rejects duplicate app slugs", async () => {
    await withTestHarness(async (harness) => {
      const firstResponse = await harness.app.request("/api/v1/apps", {
        method: "POST",
        body: JSON.stringify({ applicationId: "status", name: "Status" }),
      });
      expect(firstResponse.status).toBe(201);

      const duplicateResponse = await harness.app.request("/api/v1/apps", {
        method: "POST",
        body: JSON.stringify({ applicationId: "status", name: "Status" }),
      });
      expect(duplicateResponse.status).toBe(409);
      await expect(readJson(duplicateResponse)).resolves.toMatchObject({
        code: "app_exists",
        message: 'an app with id "status" already exists',
      });
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
