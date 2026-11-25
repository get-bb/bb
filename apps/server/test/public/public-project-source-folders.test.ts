import { describe, expect, it } from "vitest";
import {
  createProjectSource,
  deleteProjectSource,
  listProjectFolderPathsForHost,
} from "@bb/db";
import { registerHostRpcResponder } from "../helpers/host-rpc.js";
import { readJson } from "../helpers/json.js";
import {
  seedHostSession,
  seedPrimaryHost,
  seedProjectWithSource,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

function seedFolderProject(
  harness: TestAppHarness,
  files: Record<string, string> = {},
) {
  const { host, session } = seedHostSession(harness.deps, {
    id: "host-project-folders",
  });
  seedPrimaryHost(harness.deps, host.id);
  const existingPaths = new Set([
    "/work/api",
    "/work/api-v2",
    "/work/docs",
    "/work",
  ]);
  const responder = registerHostRpcResponder(harness, {
    hostId: host.id,
    sessionId: session.id,
    handle: ({ command }) => {
      if (command.type === "host.read_file") {
        const content = files[command.path];
        if (content === undefined) {
          return {
            ok: false,
            errorCode: "ENOENT",
            errorMessage: `${command.path} not found`,
          };
        }
        return {
          ok: true,
          result: {
            path: command.path,
            content,
            contentEncoding: "utf8",
            sizeBytes: content.length,
            sha256: "0".repeat(64),
          },
        };
      }
      if (command.type !== "host.paths_exist") {
        throw new Error(`Unexpected RPC ${command.type}`);
      }
      return {
        ok: true,
        result: {
          existence: Object.fromEntries(
            command.paths.map((path) => [path, existingPaths.has(path)]),
          ),
        },
      };
    },
  });
  const { project, source } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: "/work/app",
  });
  const foldersUrl = `/api/v1/projects/${project.id}/sources/${source.id}/folders`;
  const addFolder = (path: string) =>
    harness.app.request(foldersUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path }),
    });
  const importWorkspace = (path: string) =>
    harness.app.request(`${foldersUrl}/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path }),
    });
  return {
    addFolder,
    foldersUrl,
    host,
    importWorkspace,
    project,
    responder,
    source,
  };
}

describe("project source folders", () => {
  it("imports a .code-workspace file's folders and says why each other folder was skipped", async () => {
    await withTestHarness(async (harness) => {
      const { addFolder, foldersUrl, importWorkspace } = seedFolderProject(
        harness,
        {
          "/work/app/app.code-workspace": `{
  // relative folders resolve against the file's directory
  "folders": [
    { "path": "." },
    { "path": "packages/ui" },
    { "path": "../api" },
    { "path": "/work/docs" },
    { "uri": "file:///work/api-v2" },
    { "path": "../gone" },
    { "path": "/work/docs/" },
    { "path": ".." },
    { "path": 7 },
    { "uri": "vscode-remote://ssh-remote+box/srv/app" },
  ],
}`,
          "/work/app/broken.code-workspace": "{ folders: ",
        },
      );
      expect((await addFolder("/work/api")).status).toBe(201);

      const response = await importWorkspace("/work/app/app.code-workspace");
      expect(response.status).toBe(200);
      expect(await readJson(response)).toEqual({
        added: [
          expect.objectContaining({ path: "/work/docs" }),
          expect.objectContaining({ path: "/work/api-v2" }),
        ],
        skipped: [
          expect.objectContaining({ path: "/work/app", reason: "main_folder" }),
          expect.objectContaining({
            path: "/work/app/packages/ui",
            reason: "inside_main_folder",
          }),
          expect.objectContaining({ path: "/work/api", reason: "duplicate" }),
          expect.objectContaining({ path: "/work/gone", reason: "not_found" }),
          expect.objectContaining({ path: "/work/docs", reason: "duplicate" }),
          expect.objectContaining({
            path: "/work",
            reason: "invalid",
            message: expect.stringContaining("contains the main folder"),
          }),
          expect.objectContaining({ path: "folders[8]", reason: "invalid" }),
          expect.objectContaining({
            path: "vscode-remote://ssh-remote+box/srv/app",
            reason: "unsupported_uri",
          }),
        ],
      });
      expect(
        (await readJson(await harness.app.request(foldersUrl))) as unknown[],
      ).toEqual([
        expect.objectContaining({ path: "/work/api" }),
        expect.objectContaining({ path: "/work/docs" }),
        expect.objectContaining({ path: "/work/api-v2" }),
      ]);

      const broken = await importWorkspace("/work/app/broken.code-workspace");
      expect(broken.status).toBe(400);
      expect(JSON.stringify(await readJson(broken))).toContain(
        "is not a VS Code workspace file",
      );
      expect((await importWorkspace("relative.code-workspace")).status).toBe(
        400,
      );
      const missing = await importWorkspace("/work/app/none.code-workspace");
      expect(missing.status).toBe(404);
      expect(await readJson(missing)).toMatchObject({ code: "ENOENT" });
    });
  });

  it("adds, lists and removes folders in order", async () => {
    await withTestHarness(async (harness) => {
      const { addFolder, foldersUrl, host, project } =
        seedFolderProject(harness);

      const added = await addFolder("/work/api/");
      expect(added.status).toBe(201);
      const api = await readJson(added);
      expect(api).toMatchObject({ path: "/work/api" });
      expect((await addFolder("/work/docs")).status).toBe(201);

      const listed = await readJson(await harness.app.request(foldersUrl));
      expect(listed).toEqual([
        expect.objectContaining({ path: "/work/api" }),
        expect.objectContaining({ path: "/work/docs" }),
      ]);
      expect(
        listProjectFolderPathsForHost(harness.db, {
          projectId: project.id,
          hostId: host.id,
        }),
      ).toEqual(["/work/api", "/work/docs"]);

      const removed = await harness.app.request(
        `${foldersUrl}/${(api as { id: string }).id}`,
        { method: "DELETE" },
      );
      expect(removed.status).toBe(200);
      expect(await readJson(await harness.app.request(foldersUrl))).toEqual([
        expect.objectContaining({ path: "/work/docs" }),
      ]);
      expect(
        (
          await harness.app.request(
            `${foldersUrl}/${(api as { id: string }).id}`,
            { method: "DELETE" },
          )
        ).status,
      ).toBe(404);
    });
  });

  it("refuses folders that overlap the checkout, repeat, or do not exist on the machine", async () => {
    await withTestHarness(async (harness) => {
      const { addFolder, responder } = seedFolderProject(harness);
      expect((await addFolder("/work/api")).status).toBe(201);
      const requestsBefore = responder.requests.length;

      for (const [path, status, message] of [
        ["relative/path", 400, "absolute"],
        ["/work/app", 400, "is the main folder"],
        ["/work/app/packages/ui", 400, "is inside the main folder"],
        ["/work", 400, "contains the main folder"],
        ["/work/api", 409, "already listed"],
      ] as const) {
        const response = await addFolder(path);
        expect(response.status).toBe(status);
        expect(JSON.stringify(await readJson(response))).toContain(message);
      }
      expect(responder.requests.length).toBe(requestsBefore);

      const missing = await addFolder("/work/gone");
      expect(missing.status).toBe(400);
      expect(await readJson(missing)).toMatchObject({
        code: "path_not_found",
      });
    });
  });

  it("changes a folder's path in place and applies the add rules to the new path", async () => {
    await withTestHarness(async (harness) => {
      const { addFolder, foldersUrl, host, project } =
        seedFolderProject(harness);
      const api = (await readJson(await addFolder("/work/api"))) as {
        id: string;
      };
      expect((await addFolder("/work/docs")).status).toBe(201);
      const updateFolder = (folderId: string, path: string) =>
        harness.app.request(`${foldersUrl}/${folderId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path }),
        });

      for (const [path, status, message] of [
        ["/work/app/packages/ui", 400, "is inside the main folder"],
        ["/work/docs", 409, "already listed"],
        ["/work/gone", 400, "does not exist on this machine"],
      ] as const) {
        const response = await updateFolder(api.id, path);
        expect(response.status).toBe(status);
        expect(JSON.stringify(await readJson(response))).toContain(message);
      }
      expect((await updateFolder("psf_missing", "/work")).status).toBe(404);

      const updated = await updateFolder(api.id, "/work/api/");
      expect(updated.status).toBe(200);
      expect(await readJson(updated)).toMatchObject({
        id: api.id,
        path: "/work/api",
      });
      expect(
        await readJson(await updateFolder(api.id, "/work/api-v2")),
      ).toMatchObject({ id: api.id, path: "/work/api-v2" });
      expect(
        listProjectFolderPathsForHost(harness.db, {
          projectId: project.id,
          hostId: host.id,
        }),
      ).toEqual(["/work/api-v2", "/work/docs"]);
    });
  });

  it("removes a checkout's folders with the checkout and keeps other machines' folders apart", async () => {
    await withTestHarness(async (harness) => {
      const { addFolder, host, project, source } = seedFolderProject(harness);
      expect((await addFolder("/work/api")).status).toBe(201);
      const other = seedHostSession(harness.deps, {
        id: "host-project-folders-other",
      }).host;
      createProjectSource(harness.db, harness.hub, {
        projectId: project.id,
        type: "local_path",
        hostId: other.id,
        path: "/other/app",
      });
      expect(
        listProjectFolderPathsForHost(harness.db, {
          projectId: project.id,
          hostId: other.id,
        }),
      ).toEqual([]);

      deleteProjectSource(harness.db, harness.hub, source.id);

      expect(
        listProjectFolderPathsForHost(harness.db, {
          projectId: project.id,
          hostId: host.id,
        }),
      ).toEqual([]);
    });
  });
});
