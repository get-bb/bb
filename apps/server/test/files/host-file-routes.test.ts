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
          return { ok: true, result: { outcome: "conflict", currentSha256: null } };
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

  it("rejects a non-primary host target when the multi-machine experiment is off", async () => {
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

      // Experiment off (default): writing files on a non-primary host is
      // rejected before any RPC is dispatched.
      const blocked = await harness.app.request(
        ...postJson("/api/v1/files/write", {
          hostId: secondary.id,
          path: "/home/me/notes/note.md",
          content: "hello",
        }),
      );
      expect(blocked.status).toBe(403);
      expect((await readJson(blocked)) as { code?: string }).toMatchObject({
        code: "multi_machine_disabled",
      });

      // The primary host stays writable with the experiment off.
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

      // Flipping the experiment on unblocks the non-primary host.
      setExperiments(harness.deps.db, {
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
