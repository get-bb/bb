import type { HostDaemonOnlineRpcRequestMessage } from "@bb/host-daemon-contract";
import { describe, expect, it } from "vitest";
import { setExperiments } from "@bb/db";
import { defaultExperiments } from "@bb/domain";
import { registerHostRpcResponder } from "../helpers/host-rpc.js";
import { readJson } from "../helpers/json.js";
import { seedHostSession, seedPrimaryHost } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

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
  it("creates opaque path-shaped preview leases and serves sandboxed HTML", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      seedPrimaryHost(harness.deps, host.id);
      const commands: unknown[] = [];
      registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: (request) => {
          commands.push(request.command);
          return {
            ok: true,
            result: {
              path: "/notes/report.html",
              content: "<!doctype html><h1>Report</h1>",
              contentEncoding: "utf8",
              mimeType: "text/html",
              sha256: "c".repeat(64),
              sizeBytes: 31,
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

      const content = await harness.app.request(`${lease.baseUrl}/report.html`);
      expect(content.status).toBe(200);
      expect(content.headers.get("content-security-policy")).toBe(
        "sandbox allow-scripts",
      );
      expect(content.headers.get("x-content-type-options")).toBe("nosniff");
      await expect(content.text()).resolves.toContain("<h1>Report</h1>");
      expect(commands).toEqual([
        {
          type: "host.read_file",
          path: "/notes/report.html",
          rootPath: "/notes",
        },
      ]);
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
          return { ok: true, result: { ok: true } };
        },
      });

      for (const [route, payload] of [
        [
          "/api/v1/files/paths",
          { path: "/notes", includeFiles: true, includeDirectories: true },
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

  it("gates a non-primary host target with the Multi-machine experiment", async () => {
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

      const blocked = await harness.app.request(
        ...postJson("/api/v1/files/write", {
          hostId: secondary.id,
          path: "/home/me/notes/note.md",
          content: "hello",
        }),
      );
      expect(blocked.status).toBe(400);
      await expect(readJson(blocked)).resolves.toMatchObject({
        code: "unsupported_host",
        message: "Non-primary machines require the Multi-machine experiment",
      });

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

      setExperiments(harness.db, {
        ...defaultExperiments,
        multiMachine: true,
      });
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
