import type { HostDaemonOnlineRpcRequestMessage } from "@bb/host-daemon-contract";
import { describe, expect, it } from "vitest";
import { registerHostRpcResponder } from "../helpers/host-rpc.js";
import { readJson } from "../helpers/json.js";
import { seedHostSession, seedPrimaryHost } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";
import { DEFAULT_PATH_LIST_EXCLUDE_NAMES } from "../../src/routes/path-list-policy.js";

const DEFAULT_EXCLUDE_NAMES = [...DEFAULT_PATH_LIST_EXCLUDE_NAMES];

const WRITTEN_RESULT = {
  outcome: "written",
  sha256: "a".repeat(64),
  sizeBytes: 5,
} as const;

const READ_RESULT = {
  path: "/home/me/notes/note.md",
  content: "# Hi",
  contentEncoding: "utf8",
  mimeType: "text/markdown",
  modifiedAtMs: 1234,
  sha256: "b".repeat(64),
  sizeBytes: 4,
} as const;

function postJson(path: string, body: unknown): [string, RequestInit] {
  return [
    path,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  ];
}

describe("host file routes", () => {
  it("rejects hostile-origin and text/plain privileged mutations before host RPC", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      seedPrimaryHost(harness.deps, host.id);
      const commands: HostDaemonOnlineRpcRequestMessage["command"][] = [];
      registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: (request) => {
          commands.push(request.command);
          return { ok: true, result: { ok: true } };
        },
      });

      const mutations = [
        ["/api/v1/files/write", { path: "/notes/a.md", content: "attacker" }],
        ["/api/v1/files/mkdir", { path: "/notes/private" }],
        [
          "/api/v1/files/move",
          {
            sourcePath: "/notes/a.md",
            destinationPath: "/notes/b.md",
          },
        ],
        ["/api/v1/files/remove", { path: "/notes/b.md" }],
      ] as const;

      for (const [route, payload] of mutations) {
        const hostile = await harness.app.request(route, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://evil.example",
          },
          body: JSON.stringify(payload),
        });
        expect(hostile.status, route).toBe(403);

        const simpleRequest = await harness.app.request(route, {
          method: "POST",
          headers: { "content-type": "text/plain" },
          body: JSON.stringify(payload),
        });
        expect(simpleRequest.status, route).toBe(415);
      }

      expect(commands).toEqual([]);
    });
  });

  it("streams preview files, revalidating media while keeping sandboxed HTML uncached", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      seedPrimaryHost(harness.deps, host.id);
      const revision = "d".repeat(64);
      const files = new Map([
        [
          "/notes/chart.png",
          {
            bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
            mimeType: "image/png",
          },
        ],
        [
          "/notes/report.html",
          {
            bytes: Buffer.from("<!doctype html><h1>Report</h1>"),
            mimeType: "text/html",
          },
        ],
        [
          "/notes/archive.zip",
          {
            bytes: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 1, 2, 3]),
            mimeType: "application/zip",
          },
        ],
      ]);
      const rootPaths: string[] = [];
      registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: ({ command }) => {
          if (command.type !== "host.read_file_chunk")
            throw new Error("Unexpected command");
          rootPaths.push(command.rootPath);
          const file = files.get(command.path);
          if (!file) throw new Error(`Unexpected path ${command.path}`);
          return {
            ok: true,
            result: {
              path: command.path,
              content: file.bytes
                .subarray(command.offset, command.offset + command.length)
                .toString("base64"),
              offset: command.offset,
              mimeType: file.mimeType,
              modifiedAtMs: 1234,
              sizeBytes: file.bytes.length,
              revision,
            },
          };
        },
      });

      const leaseResponse = await harness.app.request(
        ...postJson("/api/v1/files/previews", { rootPath: "/notes" }),
      );
      expect(leaseResponse.status).toBe(200);
      const lease = await readJson(leaseResponse);
      expect(lease).toMatchObject({
        baseUrl: expect.stringMatching(/^\/api\/v1\/file-previews\//),
      });
      if (
        typeof lease !== "object" ||
        lease === null ||
        !("baseUrl" in lease) ||
        typeof lease.baseUrl !== "string"
      ) {
        throw new Error("Preview response missing baseUrl");
      }

      const image = await harness.app.request(`${lease.baseUrl}/chart.png`, {
        headers: { "if-none-match": `W/"file-${revision}"` },
      });
      expect(image.status).toBe(304);
      expect(image.headers.get("cache-control")).toBe("private, no-cache");

      const content = await harness.app.request(
        `${lease.baseUrl}/report.html`,
        { headers: { "if-none-match": `W/"file-${revision}"` } },
      );
      expect(content.status).toBe(200);
      expect(content.headers.get("cache-control")).toBe("no-store");
      expect(content.headers.get("content-security-policy")).toBe(
        "sandbox allow-scripts",
      );
      expect(content.headers.get("x-content-type-options")).toBe("nosniff");
      await expect(content.text()).resolves.toContain("<h1>Report</h1>");

      const archive = await harness.app.request(
        `${lease.baseUrl}/archive.zip`,
        { headers: { Range: "bytes=0-3" } },
      );
      expect(archive.status).toBe(206);
      expect(archive.headers.get("content-range")).toBe("bytes 0-3/8");
      expect(Buffer.from(await archive.arrayBuffer())).toEqual(
        Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      );
      expect(new Set(rootPaths)).toEqual(new Set(["/notes"]));
    });
  });

  it("routes recursive path listings and confined mutations to the selected daemon", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      seedPrimaryHost(harness.deps, host.id);
      const commands: HostDaemonOnlineRpcRequestMessage["command"][] = [];
      registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: (request) => {
          commands.push(request.command);
          if (request.command.type === "host.list_paths") {
            return { ok: true, result: { paths: [], truncated: false } };
          }
          if (request.command.type === "host.list_files") {
            return { ok: true, result: { files: [], truncated: false } };
          }
          return { ok: true, result: { ok: true } };
        },
      });

      for (const [route, payload] of [
        [
          "/api/v1/files/paths",
          { path: "/notes", includeFiles: true, includeDirectories: true },
        ],
        [
          "/api/v1/files/paths",
          {
            path: "/notes",
            includeFiles: true,
            includeDirectories: true,
            includeHidden: false,
          },
        ],
        [
          "/api/v1/files/list",
          { path: "/notes", includeHidden: false, excludeNames: [".obsidian"] },
        ],
        [
          "/api/v1/files/mkdir",
          { path: "/notes/projects", rootPath: "/notes" },
        ],
        [
          "/api/v1/files/move",
          {
            sourcePath: "/notes/a.md",
            destinationPath: "/notes/b.md",
            rootPath: "/notes",
          },
        ],
        ["/api/v1/files/remove", { path: "/notes/b.md", rootPath: "/notes" }],
      ] as const) {
        const response = await harness.app.request(...postJson(route, payload));
        expect(
          response.status,
          `${route}: ${await response.clone().text()}`,
        ).toBe(200);
      }

      expect(commands).toEqual([
        {
          type: "host.list_paths",
          path: "/notes",
          limit: 1000,
          includeFiles: true,
          includeDirectories: true,
          includeHidden: true,
          respectGitIgnore: false,
          excludeNames: DEFAULT_EXCLUDE_NAMES,
        },
        {
          type: "host.list_paths",
          path: "/notes",
          limit: 1000,
          includeFiles: true,
          includeDirectories: true,
          includeHidden: false,
          respectGitIgnore: false,
          excludeNames: DEFAULT_EXCLUDE_NAMES,
        },
        {
          type: "host.list_files",
          path: "/notes",
          limit: 1000,
          includeHidden: false,
          respectGitIgnore: false,
          excludeNames: [".obsidian"],
        },
        {
          type: "host.mkdir",
          path: "/notes/projects",
          rootPath: "/notes",
          recursive: false,
        },
        {
          type: "host.move_path",
          sourcePath: "/notes/a.md",
          destinationPath: "/notes/b.md",
          rootPath: "/notes",
        },
        {
          type: "host.remove_path",
          path: "/notes/b.md",
          rootPath: "/notes",
          recursive: false,
        },
      ]);
    });
  });

  it("fills write defaults and resolves the primary host at the boundary", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      seedPrimaryHost(harness.deps, host.id);
      const requests: HostDaemonOnlineRpcRequestMessage[] = [];
      registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: (request) => {
          requests.push(request);
          if (request.command.type !== "host.write_file") {
            throw new Error(`Unexpected RPC command ${request.command.type}`);
          }
          return { ok: true, result: WRITTEN_RESULT };
        },
      });

      const response = await harness.app.request(
        ...postJson("/api/v1/files/write", {
          path: "/home/me/notes/note.md",
          content: "hello",
        }),
      );

      expect(response.status).toBe(200);
      expect(await readJson(response)).toEqual(WRITTEN_RESULT);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.command).toEqual({
        type: "host.write_file",
        path: "/home/me/notes/note.md",
        content: "hello",
        contentEncoding: "utf8",
        createParents: false,
      });
    });
  });

  it("passes the create-only null guard through to the daemon", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      const commands: unknown[] = [];
      registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: (request) => {
          commands.push(request.command);
          return {
            ok: true,
            result: { outcome: "conflict", currentSha256: null },
          };
        },
      });

      const response = await harness.app.request(
        ...postJson("/api/v1/files/write", {
          hostId: host.id,
          path: "/home/me/notes/new.md",
          content: "hello",
          expectedSha256: null,
          createParents: true,
        }),
      );

      expect(response.status).toBe(200);
      expect(await readJson(response)).toEqual({
        outcome: "conflict",
        currentSha256: null,
      });
      expect(commands[0]).toMatchObject({
        expectedSha256: null,
        createParents: true,
      });
    });
  });

  it("serves reads and remaps daemon ENOENT to 404", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: (request) => {
          if (request.command.type !== "host.read_file") {
            throw new Error(`Unexpected RPC command ${request.command.type}`);
          }
          if (request.command.path === "/home/me/notes/note.md") {
            return { ok: true, result: READ_RESULT };
          }
          return {
            ok: false,
            errorCode: "ENOENT",
            errorMessage: "Path does not exist",
          };
        },
      });

      const okResponse = await harness.app.request(
        ...postJson("/api/v1/files/read", {
          hostId: host.id,
          path: "/home/me/notes/note.md",
          rootPath: "/home/me/notes",
        }),
      );
      expect(okResponse.status).toBe(200);
      expect(await readJson(okResponse)).toEqual(READ_RESULT);

      const missingResponse = await harness.app.request(
        ...postJson("/api/v1/files/read", {
          hostId: host.id,
          path: "/home/me/notes/missing.md",
        }),
      );
      expect(missingResponse.status).toBe(404);
    });
  });

  it("allows a non-primary host target", async () => {
    await withTestHarness(async (harness) => {
      const { host: primary, session: primarySession } = seedHostSession(
        harness.deps,
        { id: "host-file-primary" },
      );
      seedPrimaryHost(harness.deps, primary.id);
      const { host: secondary, session: secondarySession } = seedHostSession(
        harness.deps,
        { id: "host-file-secondary" },
      );

      registerHostRpcResponder(harness, {
        hostId: primary.id,
        sessionId: primarySession.id,
        handle: () => ({ ok: true, result: WRITTEN_RESULT }),
      });
      const primaryOk = await harness.app.request(
        ...postJson("/api/v1/files/write", {
          hostId: primary.id,
          path: "/home/me/notes/note.md",
          content: "hello",
        }),
      );
      expect(primaryOk.status).toBe(200);

      registerHostRpcResponder(harness, {
        hostId: secondary.id,
        sessionId: secondarySession.id,
        handle: () => ({ ok: true, result: WRITTEN_RESULT }),
      });
      const secondaryOk = await harness.app.request(
        ...postJson("/api/v1/files/write", {
          hostId: secondary.id,
          path: "/home/me/notes/note.md",
          content: "hello",
        }),
      );
      expect(secondaryOk.status).toBe(200);
    });
  });
});
