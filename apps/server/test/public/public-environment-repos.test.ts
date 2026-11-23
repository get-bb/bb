import { describe, expect, it } from "vitest";
import { createProjectSourceFolder, setEnvironmentColumns } from "@bb/db";
import { registerHostRpcResponder } from "../helpers/host-rpc.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedPrimaryHost,
  seedProjectWithSource,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

const GIT_ROOTS: Record<string, string> = {
  "/mono/packages/app": "/mono",
  "/work/api": "/work/api",
  "/work/also-mono": "/mono",
};
const FOUND: Record<string, string[]> = {
  "/data/stack": ["/data/stack/infra", "/data/stack/api"],
};

describe("environment repos", () => {
  it("lists the main repo, each extra folder's repo and repos found inside plain folders, once each", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-environment-repos",
      });
      seedPrimaryHost(harness.deps, host.id);
      const responder = registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: ({ command }) => {
          if (command.type !== "host.find_git_repos") {
            throw new Error(`Unexpected RPC ${command.type}`);
          }
          return {
            ok: true,
            result: {
              folders: command.folderPaths.map((folderPath) => ({
                path: folderPath,
                exists: folderPath !== "/work/gone",
                gitRoot: GIT_ROOTS[folderPath] ?? null,
                repos: FOUND[folderPath] ?? [],
                truncated: false,
              })),
            },
          };
        },
      });
      const { project, source } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/mono/packages/app",
      });
      for (const folderPath of ["/work/api", "/work/gone", "/work/also-mono"]) {
        createProjectSourceFolder(harness.db, harness.hub, {
          projectId: project.id,
          projectSourceId: source.id,
          path: folderPath,
        });
      }
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/mono/packages/app",
      });
      setEnvironmentColumns(harness.db, environment.id, {
        additionalPaths: ["/data/stack"],
      });
      const url = `/api/v1/environments/${environment.id}/repos`;

      const response = await harness.app.request(url);

      expect(response.status).toBe(200);
      expect(await readJson(response)).toEqual({
        repos: [
          {
            rootPath: "/mono",
            path: "/mono/packages/app",
            label: "",
            source: "main",
          },
          {
            rootPath: "/work/api",
            path: "/work/api",
            label: "../../../work/api",
            source: "folder",
          },
          {
            rootPath: "/data/stack/infra",
            path: "/data/stack/infra",
            label: "../../../data/stack/infra",
            source: "discovered",
          },
          {
            rootPath: "/data/stack/api",
            path: "/data/stack/api",
            label: "../../../data/stack/api",
            source: "discovered",
          },
        ],
        truncated: false,
      });

      await harness.app.request(url);
      expect(responder.requests).toHaveLength(1);
    });
  });
});
