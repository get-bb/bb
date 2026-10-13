import type { HostDaemonOnlineRpcRequestMessage } from "@bb/host-daemon-contract";
import { describe, expect, it } from "vitest";
import { registerHostRpcResponder } from "../helpers/host-rpc.js";
import { readJson } from "../helpers/json.js";
import {
  seedHostSession,
  seedPrimaryHost,
  seedProjectWithSource,
  seedThread,
  seedThreadFixture,
} from "../helpers/seed.js";
import {
  withTestHarness,
  type TestAppHarness as TestHarness,
} from "../helpers/test-app.js";

type HostCommand = HostDaemonOnlineRpcRequestMessage["command"];

interface HostFile {
  bytes: Buffer;
  mimeType: string;
}

const REVISION = "0".repeat(64);

function serveFiles(
  harness: TestHarness,
  args: {
    hostId: string;
    sessionId: string;
    files: Map<string, HostFile>;
  },
): HostCommand[] {
  const commands: HostCommand[] = [];
  registerHostRpcResponder(harness, {
    hostId: args.hostId,
    sessionId: args.sessionId,
    handle: ({ command }) => {
      commands.push(command);
      if (command.type !== "host.read_file_chunk") {
        throw new Error(`Unexpected command ${command.type}`);
      }
      const file = args.files.get(command.path);
      if (!file) {
        return {
          ok: false,
          errorCode: "ENOENT",
          errorMessage: `Path does not exist: ${command.path}`,
        };
      }
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
          revision: REVISION,
        },
      };
    },
  });
  return commands;
}

describe("file content routes", () => {
  it.each([
    ["svg", "image/svg+xml"],
    ["xhtml", "application/xhtml+xml"],
  ])("sends a sandbox policy for %s documents", async (extension, mimeType) => {
    await withTestHarness(async (harness) => {
      const { host, session, thread } = seedThreadFixture(harness);
      const bytes = Buffer.from("<script>alert(document.domain)</script>");
      serveFiles(harness, {
        hostId: host.id,
        sessionId: session.id,
        files: new Map([[`/tmp/probe.${extension}`, { bytes, mimeType }]]),
      });
      const url = `/api/v1/threads/${thread.id}/host-files/tmp/probe.${extension}`;
      for (const headers of [
        new Headers(),
        new Headers({ range: "bytes=0-15" }),
      ]) {
        const response = await harness.app.request(url, { headers });
        expect(response.status).toBe(headers.has("range") ? 206 : 200);
        expect(response.headers.get("content-type")).toBe(mimeType);
        expect(response.headers.get("content-security-policy")).toBe(
          "sandbox allow-scripts",
        );
        await response.arrayBuffer();
      }
    });
  });

  it("streams thread storage with ranges and sandboxed HTML", async () => {
    await withTestHarness(async (harness) => {
      const { host, session, thread } = seedThreadFixture(harness);
      const storageRoot = `/tmp/bb-host-data/${host.id}/thread-storage/${thread.id}`;
      const commands = serveFiles(harness, {
        hostId: host.id,
        sessionId: session.id,
        files: new Map([
          [
            `${storageRoot}/clip.mp4`,
            { bytes: Buffer.from([0, 1, 2, 3, 4, 5]), mimeType: "video/mp4" },
          ],
          [
            `${storageRoot}/reports/preview v2.html`,
            {
              bytes: Buffer.from("<!doctype html><h1>Preview</h1>"),
              mimeType: "text/html",
            },
          ],
        ]),
      });
      const baseUrl = `/api/v1/threads/${thread.id}/thread-storage/files`;

      const clip = await harness.app.request(`${baseUrl}/clip.mp4`, {
        headers: { Range: "bytes=0-1" },
      });
      expect(clip.status).toBe(206);
      expect(clip.headers.get("content-range")).toBe("bytes 0-1/6");
      expect(Buffer.from(await clip.arrayBuffer())).toEqual(
        Buffer.from([0, 1]),
      );

      const html = await harness.app.request(
        `${baseUrl}/reports/preview%20v2.html`,
      );
      expect(html.status).toBe(200);
      expect(html.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(html.headers.get("content-security-policy")).toBe(
        "sandbox allow-scripts",
      );
      expect(html.headers.get("cache-control")).toBe("no-store");
      await expect(html.text()).resolves.toContain("<h1>Preview</h1>");

      expect(
        new Set(
          commands.map((command) =>
            command.type === "host.read_file_chunk" ? command.rootPath : null,
          ),
        ),
      ).toEqual(new Set([storageRoot]));
    });
  });

  it("reports file changes before streaming as retryable conflicts", async () => {
    await withTestHarness(async (harness) => {
      const { host, session, thread } = seedThreadFixture(harness);
      registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: ({ command }) => {
          if (command.type !== "host.read_file_chunk") {
            throw new Error("Unexpected command");
          }
          if (command.length !== 0) {
            return {
              ok: false,
              errorCode: "file_changed",
              errorMessage: "File changed",
            };
          }
          return {
            ok: true,
            result: {
              path: command.path,
              content: "",
              offset: 0,
              sizeBytes: 30 * 1024 * 1024,
              mimeType: "video/mp4",
              modifiedAtMs: 1234,
              revision: REVISION,
            },
          };
        },
      });
      const baseUrl = `/api/v1/threads/${thread.id}/thread-storage/files`;

      const response = await harness.app.request(`${baseUrl}/clip.mp4`);

      expect(response.status).toBe(409);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "file_changed",
        retryable: true,
      });
    });
  });

  it("serves HTML larger than the preview render limit as sandboxed bytes", async () => {
    await withTestHarness(async (harness) => {
      const { host, session, thread } = seedThreadFixture(harness);
      const storageRoot = `/tmp/bb-host-data/${host.id}/thread-storage/${thread.id}`;
      const html = Buffer.alloc(6 * 1024 * 1024, "a");
      serveFiles(harness, {
        hostId: host.id,
        sessionId: session.id,
        files: new Map([
          [`${storageRoot}/large.html`, { bytes: html, mimeType: "text/html" }],
        ]),
      });
      const baseUrl = `/api/v1/threads/${thread.id}/thread-storage/files`;

      const response = await harness.app.request(`${baseUrl}/large.html`);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-security-policy")).toBe(
        "sandbox allow-scripts",
      );
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect((await response.arrayBuffer()).byteLength).toBe(html.length);
    });
  });

  it("reads thread host files from the filesystem root without a ready environment", async () => {
    await withTestHarness(async (harness) => {
      const { host, session, thread } = seedThreadFixture(harness, {
        environment: { status: "provisioning" },
      });
      const commands = serveFiles(harness, {
        hostId: host.id,
        sessionId: session.id,
        files: new Map([
          [
            "/Users/me/notes/plan.md",
            { bytes: Buffer.from("# Plan\n"), mimeType: "text/markdown" },
          ],
        ]),
      });
      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/host-files/Users/me/notes/plan.md`,
      );

      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toBe("# Plan\n");
      expect(commands[0]).toMatchObject({
        type: "host.read_file_chunk",
        path: "/Users/me/notes/plan.md",
        rootPath: "/",
      });
    });
  });

  it("refuses thread host files for a thread without an environment", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: null,
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/host-files/tmp/x.bin`,
      );

      expect(response.status).toBe(409);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "thread_environment_unavailable",
        details: { reason: "never_attached" },
      });
    });
  });

  it.each([
    { errorCode: "invalid_path", expectedStatus: 400 },
    { errorCode: "ENOENT", expectedStatus: 404 },
  ])(
    "maps daemon $errorCode failures on file reads to $expectedStatus",
    async ({ errorCode, expectedStatus }) => {
      await withTestHarness(async (harness) => {
        const { host, session, thread } = seedThreadFixture(harness);
        registerHostRpcResponder(harness, {
          hostId: host.id,
          sessionId: session.id,
          handle: () => ({
            ok: false,
            errorCode,
            errorMessage: "Read failed",
          }),
        });
        const response = await harness.app.request(
          `/api/v1/threads/${thread.id}/host-files/tmp/x.bin`,
        );

        expect(response.status).toBe(expectedStatus);
        await expect(readJson(response)).resolves.toMatchObject({
          code: errorCode,
        });
      });
    },
  );

  it("reads working-tree files by chunk and git revisions in one read", async () => {
    await withTestHarness(async (harness) => {
      const { host, session, environment } = seedThreadFixture(harness, {
        environment: { path: "/tmp/lease-env" },
      });
      const commands: HostCommand[] = [];
      registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: ({ command }) => {
          commands.push(command);
          if (command.type === "host.read_file") {
            return {
              ok: true,
              result: {
                path: command.path,
                content: Buffer.from([0, 1, 2, 255]).toString("base64"),
                contentEncoding: "base64",
                mimeType: "application/octet-stream",
                sizeBytes: 4,
                sha256: "a".repeat(64),
              },
            };
          }
          if (command.type !== "host.read_file_chunk") {
            throw new Error(`Unexpected command ${command.type}`);
          }
          const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 1, 2, 3]);
          return {
            ok: true,
            result: {
              path: command.path,
              content: bytes
                .subarray(command.offset, command.offset + command.length)
                .toString("base64"),
              offset: command.offset,
              mimeType: "application/zip",
              modifiedAtMs: 1234,
              sizeBytes: bytes.length,
              revision: REVISION,
            },
          };
        },
      });

      const zip = await harness.app.request(
        `/api/v1/environments/${environment.id}/files/dist/app.zip`,
        {
          headers: { Range: "bytes=0-3" },
        },
      );
      expect(zip.status).toBe(206);
      expect(zip.headers.get("content-range")).toBe("bytes 0-3/8");
      expect(commands.at(-1)).toMatchObject({
        type: "host.read_file_chunk",
        path: "/tmp/lease-env/dist/app.zip",
        rootPath: "/tmp/lease-env",
      });

      const head = `/api/v1/environments/${environment.id}/revisions/HEAD/files`;
      const logo = await harness.app.request(`${head}/logo.bin`);
      expect(logo.status).toBe(200);
      expect(Buffer.from(await logo.arrayBuffer())).toEqual(
        Buffer.from([0, 1, 2, 255]),
      );
      expect(commands.at(-1)).toEqual({
        type: "host.read_file",
        path: "/tmp/lease-env/logo.bin",
        rootPath: "/tmp/lease-env",
        ref: "HEAD",
      });

      const revalidated = await harness.app.request(`${head}/logo.bin`, {
        headers: { "if-none-match": `"${"a".repeat(64)}"` },
      });
      expect(revalidated.status).toBe(304);

      const optionRef = await harness.app.request(
        `/api/v1/environments/${environment.id}/revisions/--output=x/files/logo.bin`,
      );
      expect(optionRef.status).toBe(400);
      await expect(readJson(optionRef)).resolves.toMatchObject({
        code: "invalid_ref",
      });
    });
  });

  it("reads project files from the primary host source or a named host", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      seedPrimaryHost(harness.deps, host.id);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/primary/project",
      });
      const commands = serveFiles(harness, {
        hostId: host.id,
        sessionId: session.id,
        files: new Map([
          [
            "/primary/project/qa/report.zip",
            { bytes: Buffer.from([1, 2, 3]), mimeType: "application/zip" },
          ],
        ]),
      });

      const primary = await harness.app.request(
        `/api/v1/projects/${project.id}/files/qa/report.zip`,
      );
      expect(Buffer.from(await primary.arrayBuffer())).toEqual(
        Buffer.from([1, 2, 3]),
      );
      const named = await harness.app.request(
        `/api/v1/projects/${project.id}/hosts/${host.id}/files/qa/report.zip`,
      );
      expect(Buffer.from(await named.arrayBuffer())).toEqual(
        Buffer.from([1, 2, 3]),
      );
      expect(
        commands.map((command) =>
          command.type === "host.read_file_chunk" ? command.rootPath : null,
        ),
      ).toEqual(Array(commands.length).fill("/primary/project"));
    });
  });

  it("maps Windows drive paths to the drive root and rejects backslash traversal", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      const commands = serveFiles(harness, {
        hostId: host.id,
        sessionId: session.id,
        files: new Map([
          [
            "C:\\Users\\me\\chart.png",
            { bytes: Buffer.from([7, 8]), mimeType: "image/png" },
          ],
        ]),
      });

      const chart = await harness.app.request(
        `/api/v1/hosts/${host.id}/files/C%3A/Users/me/chart.png`,
      );
      expect(chart.status).toBe(200);
      expect(commands[0]).toMatchObject({
        path: "C:\\Users\\me\\chart.png",
        rootPath: "C:\\",
      });

      const commandCount = commands.length;
      const traversal = await harness.app.request(
        `/api/v1/hosts/${host.id}/files/tmp/..%5Cetc/passwd`,
      );
      expect(traversal.status).toBe(400);
      expect(commands).toHaveLength(commandCount);
    });
  });
});
