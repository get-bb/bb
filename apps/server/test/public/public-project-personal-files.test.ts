import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { registerHostRpcResponder } from "../helpers/host-rpc.js";
import {
  seedEnvironment,
  seedHostSession,
  seedPrimaryHost,
  seedProjectWithSource,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

const routes = [
  {
    path: "files",
    query: "",
    body: {
      files: [{ name: "hello.txt", path: "hello.txt" }],
      truncated: false,
    },
  },
  {
    path: "paths",
    query: "includeFiles=true&includeDirectories=true",
    body: {
      paths: [
        {
          path: "hello.txt",
          name: "hello.txt",
          kind: "file",
          positions: [],
          score: 1,
        },
      ],
      truncated: false,
    },
  },
  { path: "files/content", query: "path=hello.txt", body: "hi\n" },
];

describe("Personal project file access", () => {
  it.each(routes)(
    "routes $path to the selected Personal environment",
    async (route) => {
      await withTestHarness(async (harness) => {
        const { host, session } = seedHostSession(harness.deps);
        seedPrimaryHost(harness.deps, host.id);
        const environment = seedEnvironment(harness.deps, {
          projectId: PERSONAL_PROJECT_ID,
          hostId: host.id,
          path: "/personal/workspace",
        });
        const responder = registerHostRpcResponder(harness, {
          hostId: host.id,
          sessionId: session.id,
          handle(request) {
            switch (request.command.type) {
              case "host.list_files":
                expect(request.command.path).toBe(environment.path);
                return {
                  ok: true,
                  result: {
                    files: [{ name: "hello.txt", path: "hello.txt" }],
                    truncated: false,
                  },
                };
              case "host.list_paths":
                expect(request.command.path).toBe(environment.path);
                return {
                  ok: true,
                  result: {
                    paths: [
                      {
                        path: "hello.txt",
                        name: "hello.txt",
                        kind: "file",
                        positions: [],
                        score: 1,
                      },
                    ],
                    truncated: false,
                  },
                };
              case "host.read_file":
                expect(request.command.path).toBe(
                  "/personal/workspace/hello.txt",
                );
                expect(request.command.rootPath).toBe(environment.path);
                return {
                  ok: true,
                  result: {
                    path: request.command.path,
                    content: "hi\n",
                    contentEncoding: "utf8",
                    mimeType: "text/plain",
                    sizeBytes: 3,
                    sha256: "1".repeat(64),
                  },
                };
              default:
                throw new Error(`Unexpected RPC ${request.command.type}`);
            }
          },
        });
        const response = await harness.app.request(
          `/api/v1/projects/${PERSONAL_PROJECT_ID}/${route.path}?environmentId=${environment.id}&${route.query}`,
        );
        expect(response.status).toBe(200);
        expect(
          typeof route.body === "string"
            ? await response.text()
            : await response.json(),
        ).toEqual(route.body);
        expect(responder.requests).toHaveLength(1);
      });
    },
  );

  it.each(routes)("preserves workspace validation for $path", async (route) => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      seedPrimaryHost(harness.deps, host.id);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const foreign = seedEnvironment(harness.deps, {
        projectId: project.id,
        hostId: host.id,
      });
      const unready = seedEnvironment(harness.deps, {
        projectId: PERSONAL_PROJECT_ID,
        hostId: host.id,
        status: "creating",
        path: null,
      });
      const responder = registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle(request) {
          throw new Error(`Unexpected RPC ${request.command.type}`);
        },
      });
      for (const [selector, status, code] of [
        [`environmentId=${foreign.id}`, 404, "environment_not_found"],
        [`environmentId=${unready.id}`, 409, "environment_not_ready"],
        ["environmentId=env_missing", 404, "environment_not_found"],
        ["", 409, "invalid_request"],
      ] as const) {
        const response = await harness.app.request(
          `/api/v1/projects/${PERSONAL_PROJECT_ID}/${route.path}?${route.query}&${selector}`,
        );
        expect(response.status, selector).toBe(status);
        expect(await response.json()).toMatchObject({ code });
      }
      expect(responder.requests).toHaveLength(0);
    });
  });
});
