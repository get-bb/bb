import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
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
import { appRuntimeBrowserBundle } from "@bb/sdk/app-runtime";
import { describe, expect, it } from "vitest";
import { appRuntimeScriptAsset } from "../../src/services/threads/app-client-script.js";
import {
  copyApplicationScaffoldTemplate,
  resolveApplicationScaffoldTemplatePathForModuleDir,
} from "../../src/services/threads/app-scaffold-template-copy.js";
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

interface WriteMinimalScaffoldTemplateArgs {
  templatePath: string;
}

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

async function writeMinimalScaffoldTemplate(
  args: WriteMinimalScaffoldTemplateArgs,
): Promise<void> {
  const { templatePath } = args;
  await mkdir(path.join(templatePath, "public"), { recursive: true });
  await writeFile(
    path.join(templatePath, "manifest.json"),
    JSON.stringify(VALID_MANIFEST),
    "utf8",
  );
  await writeFile(
    path.join(templatePath, "README.md"),
    "# BB_APP_NAME_PLACEHOLDER\n",
    "utf8",
  );
  await writeFile(
    path.join(templatePath, "public", "index.html"),
    "<!doctype html>",
    "utf8",
  );
}

function appRequestPath(resolvedUrl: URL): string {
  return `${resolvedUrl.pathname}${resolvedUrl.search}${resolvedUrl.hash}`;
}

describe("public global app routes", () => {
  it("resolves the app scaffold template beside the module in source and dist layouts", async () => {
    const sourceModuleDir = path.resolve(process.cwd(), "src/services/threads");
    expect(
      resolveApplicationScaffoldTemplatePathForModuleDir({
        moduleDir: sourceModuleDir,
      }),
    ).toBe(path.join(sourceModuleDir, "app-scaffold-template"));

    const tempDistDir = await mkdtemp(
      path.join(tmpdir(), "bb-app-scaffold-dist-"),
    );
    try {
      expect(() =>
        resolveApplicationScaffoldTemplatePathForModuleDir({
          moduleDir: tempDistDir,
        }),
      ).toThrow(/Missing app scaffold template/u);

      await writeMinimalScaffoldTemplate({
        templatePath: path.join(tempDistDir, "app-scaffold-template"),
      });
      expect(
        resolveApplicationScaffoldTemplatePathForModuleDir({
          moduleDir: tempDistDir,
        }),
      ).toBe(path.join(tempDistDir, "app-scaffold-template"));
    } finally {
      await rm(tempDistDir, { recursive: true, force: true });
    }
  });

  it("copies the scaffold template excluding source dev artifacts at every depth", async () => {
    // Shared by the runtime scaffold copy and the dist build copy, so dev
    // artifacts left behind by template regeneration never reach created
    // apps or the packaged server.
    const tempDir = await mkdtemp(path.join(tmpdir(), "bb-app-scaffold-copy-"));
    try {
      const templatePath = path.join(tempDir, "app-scaffold-template");
      const targetPath = path.join(tempDir, "copy-target");
      const copiedFiles = [
        "manifest.json",
        "README.md",
        "public/index.html",
        "public/screenshots/hero.png",
        "skills/add-todos/SKILL.md",
        "source/package.json",
        "source/src/App.tsx",
      ];
      const excludedDevArtifacts = [
        "source/node_modules/react/index.js",
        "source/playwright-report/index.html",
        "source/screenshots/after-full-light.png",
        "source/test-results/results.json",
        "source/src/screenshots/nested.png",
      ];
      for (const relativePath of [...copiedFiles, ...excludedDevArtifacts]) {
        const filePath = path.join(templatePath, relativePath);
        await mkdir(path.dirname(filePath), { recursive: true });
        await writeFile(filePath, relativePath, "utf8");
      }

      await copyApplicationScaffoldTemplate({ targetPath, templatePath });

      for (const relativePath of copiedFiles) {
        await expect(
          readFile(path.join(targetPath, relativePath), "utf8"),
        ).resolves.toBe(relativePath);
      }
      for (const relativePath of excludedDevArtifacts) {
        expect(existsSync(path.join(targetPath, relativePath))).toBe(false);
      }
      expect(existsSync(path.join(targetPath, "source", "node_modules"))).toBe(
        false,
      );
      expect(
        existsSync(path.join(targetPath, "source", "src", "screenshots")),
      ).toBe(false);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

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

  it("injects a runtime bootstrap containing exactly the fields the runtime consumes", async () => {
    await withTestHarness(async (harness) => {
      const applicationId = "bootstrap-app";
      await writeApplication(harness.config.dataDir, {
        manifestVersion: 1,
        id: applicationId,
        name: "Bootstrap App",
        entry: "index.html",
        capabilities: ["data", "message"],
      });

      const entryResponse = await harness.app.request(
        `/api/v1/apps/${applicationId}/`,
      );
      expect(entryResponse.status).toBe(200);
      const html = await entryResponse.text();
      const bootstrapMatch =
        /window\.__BB_APP_RUNTIME_BOOTSTRAP__ = (\{.*\});/u.exec(html);
      if (!bootstrapMatch?.[1]) {
        throw new Error("Injected app runtime bootstrap not found");
      }
      // The bootstrap is the server->runtime contract: it must carry exactly
      // what the injected SDK reads. Decorative fields (capabilities,
      // dataUrl, messageUrl, appId) were accepted-but-ignored and must not
      // come back.
      expect(JSON.parse(bootstrapMatch[1])).toEqual({
        applicationId,
        appSessionToken: null,
        targetThreadId: null,
        wsUrl: expect.stringMatching(/^wss?:\/\/.+\/ws$/u),
      });
    });
  });

  it("references the runtime as a shared immutable script instead of inlining it", async () => {
    await withTestHarness(async (harness) => {
      const applicationId = "runtime-asset";
      await writeApplication(harness.config.dataDir, {
        manifestVersion: 1,
        id: applicationId,
        name: "Runtime Asset App",
        entry: "index.html",
        capabilities: ["data"],
      });

      const entryResponse = await harness.app.request(
        `/api/v1/apps/${applicationId}/`,
      );
      expect(entryResponse.status).toBe(200);
      const html = await entryResponse.text();
      expect(html).toContain(
        `<script src="${appRuntimeScriptAsset.url}"></script>`,
      );
      expect(html).toContain("window.__BB_APP_RUNTIME_BOOTSTRAP__ = ");
      expect(html).not.toContain(appRuntimeBrowserBundle.contents);

      const runtimeResponse = await harness.app.request(
        appRuntimeScriptAsset.url,
      );
      expect(runtimeResponse.status).toBe(200);
      expect(runtimeResponse.headers.get("cache-control")).toBe(
        "public, max-age=31536000, immutable",
      );
      expect(runtimeResponse.headers.get("content-type")).toBe(
        "text/javascript; charset=utf-8",
      );
      await expect(runtimeResponse.text()).resolves.toBe(
        appRuntimeBrowserBundle.contents,
      );

      const staleHashResponse = await harness.app.request(
        `/api/v1/app-runtime/${"0".repeat(64)}.js`,
      );
      expect(staleHashResponse.status).toBe(404);
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
      const appRootPath = resolveApplicationPath(
        harness.config.dataDir,
        created.applicationId,
      );
      const publicPath = resolveApplicationPublicPath(
        harness.config.dataDir,
        created.applicationId,
      );
      const publicEntries = await readdir(publicPath);
      const publicIndexHtml = await readFile(
        path.join(publicPath, "index.html"),
        "utf8",
      );
      const readmeText = await readFile(
        path.join(appRootPath, "README.md"),
        "utf8",
      );
      const skillText = await readFile(
        path.join(appRootPath, "skills", "add-todos", "SKILL.md"),
        "utf8",
      );
      const sourcePackageText = await readFile(
        path.join(appRootPath, "source", "package.json"),
        "utf8",
      );
      const sdkDeclarationText = await readFile(
        path.join(appRootPath, "source", "src", "bb-sdk.d.ts"),
        "utf8",
      );

      expect(publicEntries).toContain("index.html");
      expect(
        publicEntries.some((entry) =>
          /^index-[A-Za-z0-9_-]+\.js$/u.test(entry),
        ),
      ).toBe(true);
      expect(
        publicEntries.some((entry) =>
          /^index-[A-Za-z0-9_-]+\.css$/u.test(entry),
        ),
      ).toBe(true);
      expect(publicIndexHtml).toContain('src="./index-');
      expect(publicIndexHtml).toContain('href="./index-');
      expect(publicIndexHtml).not.toContain("Created App");
      expect(publicIndexHtml).not.toContain("/assets/");
      expect(readmeText).toMatch(/^# Created App\n/u);
      expect(skillText).toContain("todos/<id>");
      expect(skillText).toContain("bb app data write");
      // Scaffolds no longer seed app data; the app folder stays pure code and
      // the data dir is created lazily on first write outside the app folder.
      await expect(
        readdir(path.join(appRootPath, "data")),
      ).rejects.toMatchObject({ code: "ENOENT" });
      await expect(
        readdir(
          resolveApplicationDataPath(
            harness.config.dataDir,
            created.applicationId,
          ),
        ),
      ).rejects.toMatchObject({ code: "ENOENT" });
      expect(sdkDeclarationText).toContain("GENERATED - do not edit");
      await expect(
        readdir(path.join(appRootPath, "source", "screenshots")),
      ).rejects.toThrow();
      expect(JSON.parse(sourcePackageText)).toMatchObject({
        scripts: { build: expect.stringContaining("vite build") },
        dependencies: {
          react: expect.any(String),
          "react-dom": expect.any(String),
        },
        devDependencies: {
          "@vitejs/plugin-react": expect.any(String),
          vite: expect.any(String),
          typescript: expect.any(String),
        },
      });
      const appRootEntries = await readdir(
        resolveAppsRootPath(harness.config.dataDir),
      );
      expect(appRootEntries.some((entry) => entry.startsWith(".tmp-"))).toBe(
        false,
      );

      const dataWriteResponse = await harness.app.request(
        `/api/v1/apps/${created.applicationId}/data/state.json`,
        {
          method: "PUT",
          body: JSON.stringify({ value: { tasks: [] } }),
        },
      );
      expect(dataWriteResponse.status).toBe(200);

      const deleteResponse = await harness.app.request(
        `/api/v1/apps/${created.applicationId}`,
        { method: "DELETE" },
      );
      expect(deleteResponse.status).toBe(200);
      const deletedGetResponse = await harness.app.request(
        `/api/v1/apps/${created.applicationId}`,
      );
      expect(deletedGetResponse.status).toBe(404);
      // Explicit app deletion removes the detached data dir too.
      await expect(
        readdir(
          resolveApplicationDataPath(
            harness.config.dataDir,
            created.applicationId,
          ),
        ),
      ).rejects.toMatchObject({ code: "ENOENT" });
    });
  });

  it("stamps app names containing $ replacement patterns into the README literally", async () => {
    await withTestHarness(async (harness) => {
      const createResponse = await harness.app.request("/api/v1/apps", {
        method: "POST",
        body: JSON.stringify({
          applicationId: "dollar-app",
          name: "Win $& $$ Fast",
        }),
      });
      expect(createResponse.status).toBe(201);

      const readmeText = await readFile(
        path.join(
          resolveApplicationPath(harness.config.dataDir, "dollar-app"),
          "README.md",
        ),
        "utf8",
      );
      expect(readmeText).toMatch(/^# Win \$& \$\$ Fast\n/u);
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
