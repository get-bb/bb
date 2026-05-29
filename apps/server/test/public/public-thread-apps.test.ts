import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { JsonValue } from "@bb/domain";
import type { HostDaemonCommand } from "@bb/host-daemon-contract";
import {
  appDataListResponseSchema,
  appDataReadResponseSchema,
  appDetailSchema,
  appSummarySchema,
  type AppManifest,
} from "@bb/server-contract";
import { describe, expect, it, vi } from "vitest";
import {
  reportQueuedCommandError,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
  waitForQueuedCommandAfter,
  type QueuedCommand,
} from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import { createApp } from "../../src/server.js";
import type { TestAppHarness } from "../helpers/test-app.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { createTestAppHarness } from "../helpers/test-app.js";

interface ManagerThreadStorageFixture {
  hostId: string;
  threadId: string;
  storageRootPath: string;
}

interface ReadFileResultArgs {
  content: string;
  mimeType?: string;
  path: string;
}

interface PathEntryArgs {
  kind: "directory" | "file";
  path: string;
}

interface ManifestReadArgs {
  appId: string;
  afterCursor?: number;
  fixture: ManagerThreadStorageFixture;
  harness: TestAppHarness;
  manifest: JsonValue;
}

type WriteFileRelativeQueuedCommand = QueuedCommand<
  Extract<HostDaemonCommand, { type: "host.write_file_relative" }>
>;

const STATUS_MANIFEST: AppManifest = {
  manifestVersion: 1,
  id: "status",
  name: "Status",
  icon: "ListTodo",
  entry: "index.html",
  contributions: ["thread.app"],
  capabilities: ["data", "message"],
};

function seedManagerThreadStorage(
  harness: TestAppHarness,
): ManagerThreadStorageFixture {
  const { host } = seedHostSession(harness.deps, {
    id: "host-thread-apps",
  });
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: "/tmp/project-source",
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    path: "/tmp/project-source",
  });
  const thread = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    type: "manager",
  });
  return {
    hostId: host.id,
    threadId: thread.id,
    storageRootPath: `/tmp/bb-host-data/${host.id}/thread-storage/${thread.id}`,
  };
}

function appRoot(fixture: ManagerThreadStorageFixture, appId: string): string {
  return `${fixture.storageRootPath}/apps/${appId}`;
}

function appAssetsRoot(
  fixture: ManagerThreadStorageFixture,
  appId: string,
): string {
  return `${appRoot(fixture, appId)}/assets`;
}

function appDataRoot(
  fixture: ManagerThreadStorageFixture,
  appId: string,
): string {
  return `${appRoot(fixture, appId)}/data`;
}

function sha256Text(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function readFileResult(args: ReadFileResultArgs) {
  return {
    path: args.path,
    content: args.content,
    contentEncoding: "utf8" as const,
    ...(args.mimeType ? { mimeType: args.mimeType } : {}),
    sizeBytes: Buffer.byteLength(args.content),
  };
}

function pathEntry(args: PathEntryArgs) {
  return {
    kind: args.kind,
    path: args.path,
    name: args.path.split("/").at(-1) ?? args.path,
    score: 1,
    positions: [],
  };
}

function requireWriteFileRelativeCommand(
  queued: QueuedCommand,
): WriteFileRelativeQueuedCommand {
  if (queued.command.type === "host.write_file_relative") {
    return {
      command: queued.command,
      row: queued.row,
    };
  }
  throw new Error("Expected host.write_file_relative command");
}

async function reportManifestRead(
  args: ManifestReadArgs,
): Promise<QueuedCommand> {
  const queued = args.afterCursor
    ? await waitForQueuedCommandAfter(
        args.harness,
        args.afterCursor,
        ({ command }) =>
          command.type === "host.read_file_relative" &&
          command.rootPath === appRoot(args.fixture, args.appId) &&
          command.path === "manifest.json",
      )
    : await waitForQueuedCommand(
        args.harness,
        ({ command }) =>
          command.type === "host.read_file_relative" &&
          command.rootPath === appRoot(args.fixture, args.appId) &&
          command.path === "manifest.json",
      );
  const content = `${JSON.stringify(args.manifest, null, 2)}\n`;
  await reportQueuedCommandSuccess(
    args.harness,
    queued,
    readFileResult({
      path: "manifest.json",
      content,
      mimeType: "application/json",
    }),
  );
  return queued;
}

describe("public thread app routes", () => {
  it("lists app summaries from daemon-owned manifests", async () => {
    const harness = await createTestAppHarness();
    try {
      const fixture = seedManagerThreadStorage(harness);
      const request = harness.app.request(
        `/api/v1/threads/${fixture.threadId}/apps`,
      );
      const listCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "host.list_paths" &&
          command.path === `${fixture.storageRootPath}/apps`,
      );
      await reportQueuedCommandSuccess(harness, listCommand, {
        paths: [
          pathEntry({ kind: "directory", path: "demo" }),
          pathEntry({ kind: "directory", path: "status" }),
        ],
        truncated: false,
      });
      await reportManifestRead({
        harness,
        fixture,
        appId: "demo",
        afterCursor: listCommand.row.cursor,
        manifest: {
          ...STATUS_MANIFEST,
          id: "demo",
          name: "Demo",
          icon: "GridView",
        },
      });
      await reportManifestRead({
        harness,
        fixture,
        appId: "status",
        afterCursor: listCommand.row.cursor,
        manifest: STATUS_MANIFEST,
      });

      const response = await request;
      expect(response.status).toBe(200);
      const apps = appSummarySchema.array().parse(await readJson(response));
      expect(apps.map((app) => app.id)).toEqual(["demo", "status"]);
      expect(apps[0]?.icon).toEqual({ kind: "builtin", name: "GridView" });
      expect(apps[1]?.icon).toEqual({ kind: "builtin", name: "ListTodo" });
    } finally {
      await harness.cleanup();
    }
  });

  it("skips invalid app manifests when listing app summaries", async () => {
    const harness = await createTestAppHarness();
    const warn = vi.spyOn(harness.deps.logger, "warn");
    try {
      const fixture = seedManagerThreadStorage(harness);
      const request = harness.app.request(
        `/api/v1/threads/${fixture.threadId}/apps`,
      );
      const listCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "host.list_paths" &&
          command.path === `${fixture.storageRootPath}/apps`,
      );
      await reportQueuedCommandSuccess(harness, listCommand, {
        paths: [
          pathEntry({ kind: "directory", path: "broken" }),
          pathEntry({ kind: "directory", path: "status" }),
        ],
        truncated: false,
      });
      await reportManifestRead({
        harness,
        fixture,
        appId: "broken",
        afterCursor: listCommand.row.cursor,
        manifest: {
          ...STATUS_MANIFEST,
          id: "broken",
          name: "Broken",
          icon: "NotAnIcon",
        },
      });
      await reportManifestRead({
        harness,
        fixture,
        appId: "status",
        afterCursor: listCommand.row.cursor,
        manifest: STATUS_MANIFEST,
      });

      const response = await request;
      expect(response.status).toBe(200);
      const apps = appSummarySchema.array().parse(await readJson(response));
      expect(apps.map((app) => app.id)).toEqual(["status"]);
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({
          appId: "broken",
          manifestPath: `${appRoot(fixture, "broken")}/manifest.json`,
          issueSummary: expect.stringContaining("icon"),
          issues: expect.any(Array),
        }),
        "Skipping invalid thread app manifest",
      );
    } finally {
      warn.mockRestore();
      await harness.cleanup();
    }
  });

  it("returns a provisioned-app error when app detail is missing manifest.json", async () => {
    const harness = await createTestAppHarness();
    try {
      const fixture = seedManagerThreadStorage(harness);
      const request = harness.app.request(
        `/api/v1/threads/${fixture.threadId}/apps/status`,
      );
      const manifestCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "host.read_file_relative" &&
          command.rootPath === appRoot(fixture, "status") &&
          command.path === "manifest.json",
      );
      await reportQueuedCommandError(harness, manifestCommand, {
        errorCode: "ENOENT",
        errorMessage: "Path does not exist: manifest.json",
      });

      const response = await request;
      expect(response.status).toBe(404);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "app_not_provisioned",
        message: expect.stringContaining("missing manifest.json"),
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("returns an invalid-manifest error when app detail manifest validation fails", async () => {
    const harness = await createTestAppHarness();
    try {
      const fixture = seedManagerThreadStorage(harness);
      const request = harness.app.request(
        `/api/v1/threads/${fixture.threadId}/apps/broken`,
      );
      await reportManifestRead({
        harness,
        fixture,
        appId: "broken",
        manifest: {
          ...STATUS_MANIFEST,
          id: "broken",
          name: "Broken",
          icon: "NotAnIcon",
        },
      });

      const response = await request;
      expect(response.status).toBe(422);
      const body = await readJson(response);
      expect(body).toMatchObject({
        code: "invalid_manifest",
        message: expect.stringContaining("failed validation"),
      });
      expect(JSON.stringify(body)).not.toContain("NotAnIcon");
    } finally {
      await harness.cleanup();
    }
  });

  it("returns an invalid-manifest error before serving app assets", async () => {
    const harness = await createTestAppHarness();
    try {
      const fixture = seedManagerThreadStorage(harness);
      const request = harness.app.request(
        `/api/v1/threads/${fixture.threadId}/apps/broken/index.html`,
      );
      await reportManifestRead({
        harness,
        fixture,
        appId: "broken",
        manifest: {
          ...STATUS_MANIFEST,
          id: "broken",
          name: "Broken",
          icon: "NotAnIcon",
        },
      });

      const response = await request;
      expect(response.status).toBe(422);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "invalid_manifest",
        message: expect.stringContaining("failed validation"),
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("serves HTML app entries with capability-scoped window.bb injection", async () => {
    const harness = await createTestAppHarness();
    try {
      const fixture = seedManagerThreadStorage(harness);
      const html =
        "<!doctype html><html><head></head><body>Status</body></html>";
      const request = harness.app.request(
        `/api/v1/threads/${fixture.threadId}/apps/status/`,
      );
      const manifestCommand = await reportManifestRead({
        harness,
        fixture,
        appId: "status",
        manifest: STATUS_MANIFEST,
      });
      const metadataCommand = await waitForQueuedCommandAfter(
        harness,
        manifestCommand.row.cursor,
        ({ command }) =>
          command.type === "host.file_metadata" &&
          command.path === `${appAssetsRoot(fixture, "status")}/index.html`,
      );
      await reportQueuedCommandSuccess(harness, metadataCommand, {
        path: `${appAssetsRoot(fixture, "status")}/index.html`,
        modifiedAtMs: 1234,
        sizeBytes: Buffer.byteLength(html),
      });
      const entryCommand = await waitForQueuedCommandAfter(
        harness,
        metadataCommand.row.cursor,
        ({ command }) =>
          command.type === "host.read_file_relative" &&
          command.rootPath === appAssetsRoot(fixture, "status") &&
          command.path === "index.html",
      );
      await reportQueuedCommandSuccess(
        harness,
        entryCommand,
        readFileResult({
          path: "index.html",
          content: html,
          mimeType: "text/html",
        }),
      );

      const response = await request;
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe(
        "text/html; charset=utf-8",
      );
      const body = await response.text();
      expect(body).toContain("data-bb-app-client");
      expect(body).toContain("window.bb");
      expect(body).toContain('"capabilities":["data","message"]');
      expect(body).toContain("<body>Status</body>");
    } finally {
      await harness.cleanup();
    }
  });

  it("serves flat app asset URLs from the internal assets directory", async () => {
    const harness = await createTestAppHarness();
    try {
      const fixture = seedManagerThreadStorage(harness);
      const request = harness.app.request(
        `/api/v1/threads/${fixture.threadId}/apps/status/index-Cd7sCqsN.js`,
      );
      const manifestCommand = await reportManifestRead({
        harness,
        fixture,
        appId: "status",
        manifest: STATUS_MANIFEST,
      });
      const assetCommand = await waitForQueuedCommandAfter(
        harness,
        manifestCommand.row.cursor,
        ({ command }) =>
          command.type === "host.read_file_relative" &&
          command.rootPath === appAssetsRoot(fixture, "status") &&
          command.path === "index-Cd7sCqsN.js",
      );
      expect(assetCommand.command).toMatchObject({ dotfiles: "deny" });
      await reportQueuedCommandSuccess(
        harness,
        assetCommand,
        readFileResult({
          path: "index-Cd7sCqsN.js",
          content: "console.log('status');",
          mimeType: "application/javascript",
        }),
      );

      const response = await request;
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe(
        "application/javascript",
      );
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      await expect(response.text()).resolves.toBe("console.log('status');");
    } finally {
      await harness.cleanup();
    }
  });

  it("serves nested flat app asset URLs without collapsing path segments", async () => {
    const harness = await createTestAppHarness();
    try {
      const fixture = seedManagerThreadStorage(harness);
      const request = harness.app.request(
        `/api/v1/threads/${fixture.threadId}/apps/status/chunks/index-Cd7sCqsN.js`,
      );
      const manifestCommand = await reportManifestRead({
        harness,
        fixture,
        appId: "status",
        manifest: STATUS_MANIFEST,
      });
      const assetCommand = await waitForQueuedCommandAfter(
        harness,
        manifestCommand.row.cursor,
        ({ command }) =>
          command.type === "host.read_file_relative" &&
          command.rootPath === appAssetsRoot(fixture, "status") &&
          command.path === "chunks/index-Cd7sCqsN.js",
      );
      await reportQueuedCommandSuccess(
        harness,
        assetCommand,
        readFileResult({
          path: "chunks/index-Cd7sCqsN.js",
          content: "export const status = true;",
          mimeType: "application/javascript",
        }),
      );

      const response = await request;
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe(
        "application/javascript",
      );
      await expect(response.text()).resolves.toBe(
        "export const status = true;",
      );
    } finally {
      await harness.cleanup();
    }
  });

  it("returns JSON 404 for missing flat app assets instead of the outer SPA shell", async () => {
    const staticDir = await mkdtemp(path.join(tmpdir(), "bb-apps-static-"));
    await writeFile(
      path.join(staticDir, "index.html"),
      '<!doctype html><html lang="en" class="bb-app-shell-root"><head><title>bb</title></head><body>shell</body></html>',
      "utf8",
    );
    const harness = await createTestAppHarness();
    const serverApp = createApp(harness.deps, { staticDir });
    try {
      const fixture = seedManagerThreadStorage(harness);
      const request = serverApp.app.request(
        `/api/v1/threads/${fixture.threadId}/apps/status/missing.js`,
      );
      const manifestCommand = await reportManifestRead({
        harness,
        fixture,
        appId: "status",
        manifest: STATUS_MANIFEST,
      });
      const assetCommand = await waitForQueuedCommandAfter(
        harness,
        manifestCommand.row.cursor,
        ({ command }) =>
          command.type === "host.read_file_relative" &&
          command.rootPath === appAssetsRoot(fixture, "status") &&
          command.path === "missing.js",
      );
      await reportQueuedCommandError(harness, assetCommand, {
        errorCode: "ENOENT",
        errorMessage: "Path does not exist: missing.js",
      });

      const response = await request;
      const body = await response.text();
      expect(response.status).toBe(404);
      expect(response.headers.get("content-type")).toBe("application/json");
      expect(body).not.toContain("bb-app-shell-root");
      expect(JSON.parse(body)).toMatchObject({
        code: "ENOENT",
        message: "Path does not exist: missing.js",
      });
    } finally {
      await serverApp.closeWebSockets();
      await harness.cleanup();
      await rm(staticDir, { recursive: true, force: true });
    }
  });

  it("proxies app data list, read, write, and delete through generic daemon file commands", async () => {
    const harness = await createTestAppHarness();
    try {
      const fixture = seedManagerThreadStorage(harness);
      const stateJson = `${JSON.stringify({ workers: [] }, null, 2)}\n`;

      const listRequest = harness.app.request(
        `/api/v1/threads/${fixture.threadId}/apps/status/data`,
      );
      const listManifest = await reportManifestRead({
        harness,
        fixture,
        appId: "status",
        manifest: STATUS_MANIFEST,
      });
      const listCommand = await waitForQueuedCommandAfter(
        harness,
        listManifest.row.cursor,
        ({ command }) =>
          command.type === "host.list_paths" &&
          command.path === appDataRoot(fixture, "status"),
      );
      await reportQueuedCommandSuccess(harness, listCommand, {
        paths: [pathEntry({ kind: "file", path: "state.json" })],
        truncated: false,
      });
      const listRead = await waitForQueuedCommandAfter(
        harness,
        listCommand.row.cursor,
        ({ command }) =>
          command.type === "host.read_file_relative" &&
          command.rootPath === appDataRoot(fixture, "status") &&
          command.path === "state.json",
      );
      await reportQueuedCommandSuccess(
        harness,
        listRead,
        readFileResult({
          path: "state.json",
          content: stateJson,
          mimeType: "application/json",
        }),
      );
      const listMetadata = await waitForQueuedCommandAfter(
        harness,
        listCommand.row.cursor,
        ({ command }) =>
          command.type === "host.file_metadata" &&
          command.path === `${appDataRoot(fixture, "status")}/state.json`,
      );
      await reportQueuedCommandSuccess(harness, listMetadata, {
        path: `${appDataRoot(fixture, "status")}/state.json`,
        modifiedAtMs: 1234,
        sizeBytes: Buffer.byteLength(stateJson),
      });
      const listResponse = await listRequest;
      expect(listResponse.status).toBe(200);
      expect(
        appDataListResponseSchema.parse(await readJson(listResponse)),
      ).toEqual({
        entries: [
          {
            path: "state.json",
            value: { workers: [] },
            version: sha256Text(stateJson),
            sizeBytes: Buffer.byteLength(stateJson),
            modifiedAtMs: 1234,
          },
        ],
      });

      const readRequest = harness.app.request(
        `/api/v1/threads/${fixture.threadId}/apps/status/data/state.json`,
      );
      const readManifest = await reportManifestRead({
        harness,
        fixture,
        appId: "status",
        afterCursor: listMetadata.row.cursor,
        manifest: STATUS_MANIFEST,
      });
      const readCommand = await waitForQueuedCommandAfter(
        harness,
        readManifest.row.cursor,
        ({ command }) =>
          command.type === "host.read_file_relative" &&
          command.rootPath === appDataRoot(fixture, "status") &&
          command.path === "state.json",
      );
      await reportQueuedCommandSuccess(
        harness,
        readCommand,
        readFileResult({
          path: "state.json",
          content: stateJson,
          mimeType: "application/json",
        }),
      );
      const readMetadata = await waitForQueuedCommandAfter(
        harness,
        readManifest.row.cursor,
        ({ command }) =>
          command.type === "host.file_metadata" &&
          command.path === `${appDataRoot(fixture, "status")}/state.json`,
      );
      await reportQueuedCommandSuccess(harness, readMetadata, {
        path: `${appDataRoot(fixture, "status")}/state.json`,
        modifiedAtMs: 2345,
        sizeBytes: Buffer.byteLength(stateJson),
      });
      const readResponse = await readRequest;
      expect(readResponse.status).toBe(200);
      expect(
        appDataReadResponseSchema.parse(await readJson(readResponse)),
      ).toEqual({
        path: "state.json",
        value: { workers: [] },
        version: sha256Text(stateJson),
        sizeBytes: Buffer.byteLength(stateJson),
        modifiedAtMs: 2345,
      });

      const nextValue = { workers: [{ id: "worker-1" }] };
      const nextJson = `${JSON.stringify(nextValue, null, 2)}\n`;
      const writeRequest = harness.app.request(
        `/api/v1/threads/${fixture.threadId}/apps/status/data/state.json`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ value: nextValue }),
        },
      );
      const writeManifest = await reportManifestRead({
        harness,
        fixture,
        appId: "status",
        afterCursor: readMetadata.row.cursor,
        manifest: STATUS_MANIFEST,
      });
      const writeCommand = await waitForQueuedCommandAfter(
        harness,
        writeManifest.row.cursor,
        ({ command }) =>
          command.type === "host.write_file_relative" &&
          command.rootPath === appDataRoot(fixture, "status") &&
          command.path === "state.json",
      );
      expect(writeCommand.command).toMatchObject({
        dotfiles: "deny",
        content: nextJson,
        contentEncoding: "utf8",
      });
      await reportQueuedCommandSuccess(harness, writeCommand, {
        path: "state.json",
        hash: sha256Text(nextJson),
        modifiedAtMs: 3456,
        sizeBytes: Buffer.byteLength(nextJson),
      });
      const writeResponse = await writeRequest;
      expect(writeResponse.status).toBe(200);
      expect(
        appDataReadResponseSchema.parse(await readJson(writeResponse)),
      ).toEqual({
        path: "state.json",
        value: nextValue,
        version: sha256Text(nextJson),
        sizeBytes: Buffer.byteLength(nextJson),
        modifiedAtMs: 3456,
      });

      const deleteRequest = harness.app.request(
        `/api/v1/threads/${fixture.threadId}/apps/status/data/state.json`,
        { method: "DELETE" },
      );
      const deleteManifest = await reportManifestRead({
        harness,
        fixture,
        appId: "status",
        afterCursor: writeCommand.row.cursor,
        manifest: STATUS_MANIFEST,
      });
      const deleteCommand = await waitForQueuedCommandAfter(
        harness,
        deleteManifest.row.cursor,
        ({ command }) =>
          command.type === "host.delete_file_relative" &&
          command.rootPath === appDataRoot(fixture, "status") &&
          command.path === "state.json",
      );
      await reportQueuedCommandSuccess(harness, deleteCommand, {
        path: "state.json",
        deleted: true,
        previousHash: sha256Text(nextJson),
      });
      const deleteResponse = await deleteRequest;
      expect(deleteResponse.status).toBe(200);
      await expect(readJson(deleteResponse)).resolves.toEqual({ ok: true });
    } finally {
      await harness.cleanup();
    }
  });

  it("lists app data subtree prefixes when the prefix is a directory", async () => {
    const harness = await createTestAppHarness();
    try {
      const fixture = seedManagerThreadStorage(harness);
      const oneJson = `${JSON.stringify({ title: "One" }, null, 2)}\n`;
      const twoJson = `${JSON.stringify({ title: "Two" }, null, 2)}\n`;

      const request = harness.app.request(
        `/api/v1/threads/${fixture.threadId}/apps/status/data?prefix=tasks`,
      );
      const manifestCommand = await reportManifestRead({
        harness,
        fixture,
        appId: "status",
        manifest: STATUS_MANIFEST,
      });
      const prefixRead = await waitForQueuedCommandAfter(
        harness,
        manifestCommand.row.cursor,
        ({ command }) =>
          command.type === "host.read_file_relative" &&
          command.rootPath === appDataRoot(fixture, "status") &&
          command.path === "tasks",
      );
      await reportQueuedCommandError(harness, prefixRead, {
        errorCode: "invalid_path",
        errorMessage: "Path is a directory, not a file",
      });
      const listCommand = await waitForQueuedCommandAfter(
        harness,
        prefixRead.row.cursor,
        ({ command }) =>
          command.type === "host.list_paths" &&
          command.path === `${appDataRoot(fixture, "status")}/tasks`,
      );
      await reportQueuedCommandSuccess(harness, listCommand, {
        paths: [
          pathEntry({ kind: "file", path: "one.json" }),
          pathEntry({ kind: "file", path: "nested/two.json" }),
        ],
        truncated: false,
      });

      const oneRead = await waitForQueuedCommandAfter(
        harness,
        listCommand.row.cursor,
        ({ command }) =>
          command.type === "host.read_file_relative" &&
          command.rootPath === appDataRoot(fixture, "status") &&
          command.path === "tasks/one.json",
      );
      await reportQueuedCommandSuccess(
        harness,
        oneRead,
        readFileResult({
          path: "tasks/one.json",
          content: oneJson,
          mimeType: "application/json",
        }),
      );
      const twoRead = await waitForQueuedCommandAfter(
        harness,
        listCommand.row.cursor,
        ({ command }) =>
          command.type === "host.read_file_relative" &&
          command.rootPath === appDataRoot(fixture, "status") &&
          command.path === "tasks/nested/two.json",
      );
      await reportQueuedCommandSuccess(
        harness,
        twoRead,
        readFileResult({
          path: "tasks/nested/two.json",
          content: twoJson,
          mimeType: "application/json",
        }),
      );
      const oneMetadata = await waitForQueuedCommandAfter(
        harness,
        oneRead.row.cursor,
        ({ command }) =>
          command.type === "host.file_metadata" &&
          command.path === `${appDataRoot(fixture, "status")}/tasks/one.json`,
      );
      await reportQueuedCommandSuccess(harness, oneMetadata, {
        path: `${appDataRoot(fixture, "status")}/tasks/one.json`,
        modifiedAtMs: 1111,
        sizeBytes: Buffer.byteLength(oneJson),
      });
      const twoMetadata = await waitForQueuedCommandAfter(
        harness,
        twoRead.row.cursor,
        ({ command }) =>
          command.type === "host.file_metadata" &&
          command.path ===
            `${appDataRoot(fixture, "status")}/tasks/nested/two.json`,
      );
      await reportQueuedCommandSuccess(harness, twoMetadata, {
        path: `${appDataRoot(fixture, "status")}/tasks/nested/two.json`,
        modifiedAtMs: 2222,
        sizeBytes: Buffer.byteLength(twoJson),
      });

      const response = await request;
      expect(response.status).toBe(200);
      expect(appDataListResponseSchema.parse(await readJson(response))).toEqual(
        {
          entries: [
            {
              path: "tasks/nested/two.json",
              value: { title: "Two" },
              version: sha256Text(twoJson),
              sizeBytes: Buffer.byteLength(twoJson),
              modifiedAtMs: 2222,
            },
            {
              path: "tasks/one.json",
              value: { title: "One" },
              version: sha256Text(oneJson),
              sizeBytes: Buffer.byteLength(oneJson),
              modifiedAtMs: 1111,
            },
          ],
        },
      );
    } finally {
      await harness.cleanup();
    }
  });

  it("serves top-level logo icons and 404s built-in icons", async () => {
    const harness = await createTestAppHarness();
    try {
      const fixture = seedManagerThreadStorage(harness);
      const logoManifest: AppManifest = {
        manifestVersion: 1,
        id: "demo",
        name: "Demo",
        entry: "index.html",
        contributions: ["thread.app"],
        capabilities: ["data", "message"],
      };
      const logoSvg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
      const request = harness.app.request(
        `/api/v1/threads/${fixture.threadId}/apps/demo/icon`,
      );
      const manifestCommand = await reportManifestRead({
        harness,
        fixture,
        appId: "demo",
        manifest: logoManifest,
      });
      const logoListCommand = await waitForQueuedCommandAfter(
        harness,
        manifestCommand.row.cursor,
        ({ command }) =>
          command.type === "host.list_paths" &&
          command.path === appRoot(fixture, "demo"),
      );
      await reportQueuedCommandSuccess(harness, logoListCommand, {
        paths: [pathEntry({ kind: "file", path: "logo.svg" })],
        truncated: false,
      });
      const metadataCommand = await waitForQueuedCommandAfter(
        harness,
        logoListCommand.row.cursor,
        ({ command }) =>
          command.type === "host.file_metadata" &&
          command.path === `${appRoot(fixture, "demo")}/logo.svg`,
      );
      await reportQueuedCommandSuccess(harness, metadataCommand, {
        path: `${appRoot(fixture, "demo")}/logo.svg`,
        modifiedAtMs: 4567,
        sizeBytes: Buffer.byteLength(logoSvg),
      });
      const readCommand = await waitForQueuedCommandAfter(
        harness,
        metadataCommand.row.cursor,
        ({ command }) =>
          command.type === "host.read_file_relative" &&
          command.rootPath === appRoot(fixture, "demo") &&
          command.path === "logo.svg",
      );
      await reportQueuedCommandSuccess(
        harness,
        readCommand,
        readFileResult({
          path: "logo.svg",
          content: logoSvg,
          mimeType: "image/svg+xml",
        }),
      );
      const response = await request;
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/svg+xml");
      await expect(response.text()).resolves.toBe(logoSvg);

      const builtInRequest = harness.app.request(
        `/api/v1/threads/${fixture.threadId}/apps/status/icon`,
      );
      await reportManifestRead({
        harness,
        fixture,
        appId: "status",
        afterCursor: readCommand.row.cursor,
        manifest: STATUS_MANIFEST,
      });
      const builtInResponse = await builtInRequest;
      expect(builtInResponse.status).toBe(404);
    } finally {
      await harness.cleanup();
    }
  });

  it("does not serve logo symlinks omitted by the daemon path listing", async () => {
    const harness = await createTestAppHarness();
    try {
      const fixture = seedManagerThreadStorage(harness);
      const logoManifest: AppManifest = {
        manifestVersion: 1,
        id: "demo",
        name: "Demo",
        entry: "index.html",
        contributions: ["thread.app"],
        capabilities: ["data", "message"],
      };
      const request = harness.app.request(
        `/api/v1/threads/${fixture.threadId}/apps/demo/icon`,
      );
      const manifestCommand = await reportManifestRead({
        harness,
        fixture,
        appId: "demo",
        manifest: logoManifest,
      });
      const logoListCommand = await waitForQueuedCommandAfter(
        harness,
        manifestCommand.row.cursor,
        ({ command }) =>
          command.type === "host.list_paths" &&
          command.path === appRoot(fixture, "demo"),
      );
      await reportQueuedCommandSuccess(harness, logoListCommand, {
        paths: [pathEntry({ kind: "file", path: "manifest.json" })],
        truncated: false,
      });

      const response = await request;
      expect(response.status).toBe(404);
    } finally {
      await harness.cleanup();
    }
  });

  it("scaffolds status-template apps through the server lifecycle route", async () => {
    const harness = await createTestAppHarness();
    try {
      const fixture = seedManagerThreadStorage(harness);
      const request = harness.app.request(
        `/api/v1/threads/${fixture.threadId}/apps`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: "demo",
            name: "Demo",
            template: "status",
          }),
        },
      );
      const existingCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "host.read_file_relative" &&
          command.rootPath === appRoot(fixture, "demo") &&
          command.path === "manifest.json",
      );
      await reportQueuedCommandError(harness, existingCommand, {
        errorCode: "ENOENT",
        errorMessage: "Path does not exist: manifest.json",
      });

      const manifestWrite = await waitForQueuedCommandAfter(
        harness,
        existingCommand.row.cursor,
        ({ command }) =>
          command.type === "host.write_file_relative" &&
          command.rootPath === appRoot(fixture, "demo") &&
          command.path === "manifest.json",
      );
      expect(manifestWrite.command).toMatchObject({
        dotfiles: "deny",
        contentEncoding: "utf8",
      });
      const manifestWriteCommand =
        requireWriteFileRelativeCommand(manifestWrite);
      await reportQueuedCommandSuccess(harness, manifestWrite, {
        path: "manifest.json",
        hash: sha256Text(manifestWriteCommand.command.content),
        modifiedAtMs: 1000,
        sizeBytes: Buffer.byteLength(manifestWriteCommand.command.content),
      });

      const htmlWrite = await waitForQueuedCommandAfter(
        harness,
        manifestWrite.row.cursor,
        ({ command }) =>
          command.type === "host.write_file_relative" &&
          command.rootPath === appRoot(fixture, "demo") &&
          command.path === "assets/index.html",
      );
      const htmlWriteCommand = requireWriteFileRelativeCommand(htmlWrite);
      await reportQueuedCommandSuccess(harness, htmlWrite, {
        path: "assets/index.html",
        hash: sha256Text(htmlWriteCommand.command.content),
        modifiedAtMs: 1001,
        sizeBytes: Buffer.byteLength(htmlWriteCommand.command.content),
      });

      const stateWrite = await waitForQueuedCommandAfter(
        harness,
        htmlWrite.row.cursor,
        ({ command }) =>
          command.type === "host.write_file_relative" &&
          command.rootPath === appRoot(fixture, "demo") &&
          command.path === "data/state.json",
      );
      const stateWriteCommand = requireWriteFileRelativeCommand(stateWrite);
      await reportQueuedCommandSuccess(harness, stateWrite, {
        path: "data/state.json",
        hash: sha256Text(stateWriteCommand.command.content),
        modifiedAtMs: 1002,
        sizeBytes: Buffer.byteLength(stateWriteCommand.command.content),
      });

      await reportManifestRead({
        harness,
        fixture,
        appId: "demo",
        afterCursor: stateWrite.row.cursor,
        manifest: {
          manifestVersion: 1,
          id: "demo",
          name: "Demo",
          icon: "ListTodo",
          entry: "index.html",
          contributions: ["thread.app"],
          capabilities: ["data", "message"],
        },
      });

      const response = await request;
      expect(response.status).toBe(201);
      expect(appDetailSchema.parse(await readJson(response))).toMatchObject({
        id: "demo",
        name: "Demo",
        entry: { kind: "html", path: "index.html" },
        icon: { kind: "builtin", name: "ListTodo" },
        capabilities: ["data", "message"],
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("scaffolds blank-template apps with the bb-styled index.html", async () => {
    const harness = await createTestAppHarness();
    try {
      const fixture = seedManagerThreadStorage(harness);
      const request = harness.app.request(
        `/api/v1/threads/${fixture.threadId}/apps`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: "blank-demo",
            name: "Blank Demo",
            template: "blank",
          }),
        },
      );
      const existingCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "host.read_file_relative" &&
          command.rootPath === appRoot(fixture, "blank-demo") &&
          command.path === "manifest.json",
      );
      await reportQueuedCommandError(harness, existingCommand, {
        errorCode: "ENOENT",
        errorMessage: "Path does not exist: manifest.json",
      });

      const manifestWrite = await waitForQueuedCommandAfter(
        harness,
        existingCommand.row.cursor,
        ({ command }) =>
          command.type === "host.write_file_relative" &&
          command.rootPath === appRoot(fixture, "blank-demo") &&
          command.path === "manifest.json",
      );
      const manifestWriteCommand =
        requireWriteFileRelativeCommand(manifestWrite);
      await reportQueuedCommandSuccess(harness, manifestWrite, {
        path: "manifest.json",
        hash: sha256Text(manifestWriteCommand.command.content),
        modifiedAtMs: 1000,
        sizeBytes: Buffer.byteLength(manifestWriteCommand.command.content),
      });

      const htmlWrite = await waitForQueuedCommandAfter(
        harness,
        manifestWrite.row.cursor,
        ({ command }) =>
          command.type === "host.write_file_relative" &&
          command.rootPath === appRoot(fixture, "blank-demo") &&
          command.path === "assets/index.html",
      );
      const htmlWriteCommand = requireWriteFileRelativeCommand(htmlWrite);
      const html = htmlWriteCommand.command.content;
      // bb design tokens come through verbatim from `bb guide styling`.
      expect(html).toContain('--font-sans: "Inter"');
      expect(html).toContain("oklch(0.9551 0 0)");
      expect(html).toContain("@media (prefers-color-scheme: dark)");
      // Placeholder copy keeps the blank scaffold aligned with app guidance.
      expect(html).toContain(
        "No web server or build step needed.",
      );
      // Task-list row vocabulary is present so the scaffold looks bb-native.
      expect(html).toContain('class="row"');
      expect(html).toContain('class="pill"');
      // App name is interpolated into the visible title.
      expect(html).toContain("<title>Blank Demo</title>");
      await reportQueuedCommandSuccess(harness, htmlWrite, {
        path: "assets/index.html",
        hash: sha256Text(html),
        modifiedAtMs: 1001,
        sizeBytes: Buffer.byteLength(html),
      });

      const stateWrite = await waitForQueuedCommandAfter(
        harness,
        htmlWrite.row.cursor,
        ({ command }) =>
          command.type === "host.write_file_relative" &&
          command.rootPath === appRoot(fixture, "blank-demo") &&
          command.path === "data/state.json",
      );
      const stateWriteCommand = requireWriteFileRelativeCommand(stateWrite);
      await reportQueuedCommandSuccess(harness, stateWrite, {
        path: "data/state.json",
        hash: sha256Text(stateWriteCommand.command.content),
        modifiedAtMs: 1002,
        sizeBytes: Buffer.byteLength(stateWriteCommand.command.content),
      });

      const manifestRead = await reportManifestRead({
        harness,
        fixture,
        appId: "blank-demo",
        afterCursor: stateWrite.row.cursor,
        manifest: {
          manifestVersion: 1,
          id: "blank-demo",
          name: "Blank Demo",
          entry: "index.html",
          contributions: ["thread.app"],
          capabilities: ["data", "message"],
        },
      });

      // No icon in manifest -> server probes the app root for a logo file.
      const logoListCommand = await waitForQueuedCommandAfter(
        harness,
        manifestRead.row.cursor,
        ({ command }) =>
          command.type === "host.list_paths" &&
          command.path === appRoot(fixture, "blank-demo"),
      );
      await reportQueuedCommandSuccess(harness, logoListCommand, {
        paths: [],
        truncated: false,
      });

      const response = await request;
      expect(response.status).toBe(201);
      expect(appDetailSchema.parse(await readJson(response))).toMatchObject({
        id: "blank-demo",
        name: "Blank Demo",
        entry: { kind: "html", path: "index.html" },
        icon: { kind: "builtin", name: "GridView" },
        capabilities: ["data", "message"],
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("HTML-escapes the app name in the blank scaffold to block XSS", async () => {
    const harness = await createTestAppHarness();
    try {
      const fixture = seedManagerThreadStorage(harness);
      const maliciousName = `<script>alert(1)</script> & "q" 'a'`;
      const request = harness.app.request(
        `/api/v1/threads/${fixture.threadId}/apps`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: "xss-demo",
            name: maliciousName,
            template: "blank",
          }),
        },
      );
      const existingCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "host.read_file_relative" &&
          command.rootPath === appRoot(fixture, "xss-demo") &&
          command.path === "manifest.json",
      );
      await reportQueuedCommandError(harness, existingCommand, {
        errorCode: "ENOENT",
        errorMessage: "Path does not exist: manifest.json",
      });

      const manifestWrite = await waitForQueuedCommandAfter(
        harness,
        existingCommand.row.cursor,
        ({ command }) =>
          command.type === "host.write_file_relative" &&
          command.rootPath === appRoot(fixture, "xss-demo") &&
          command.path === "manifest.json",
      );
      const manifestWriteCommand =
        requireWriteFileRelativeCommand(manifestWrite);
      await reportQueuedCommandSuccess(harness, manifestWrite, {
        path: "manifest.json",
        hash: sha256Text(manifestWriteCommand.command.content),
        modifiedAtMs: 2000,
        sizeBytes: Buffer.byteLength(manifestWriteCommand.command.content),
      });

      const htmlWrite = await waitForQueuedCommandAfter(
        harness,
        manifestWrite.row.cursor,
        ({ command }) =>
          command.type === "host.write_file_relative" &&
          command.rootPath === appRoot(fixture, "xss-demo") &&
          command.path === "assets/index.html",
      );
      const htmlWriteCommand = requireWriteFileRelativeCommand(htmlWrite);
      const html = htmlWriteCommand.command.content;

      // Raw special characters from the name must never reach the rendered
      // HTML where they would be interpreted as markup.
      expect(html).not.toContain("<script>alert(1)</script>");
      expect(html).not.toContain('name & "q"');
      expect(html).not.toContain("'a'");
      // Each special char in the name is replaced with its entity form.
      expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
      expect(html).toContain("&amp;");
      expect(html).toContain("&quot;q&quot;");
      expect(html).toContain("&#39;a&#39;");
      // The escaped name shows up in both the <title> and the visible header.
      const escapedName =
        "&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;q&quot; &#39;a&#39;";
      expect(html).toContain(`<title>${escapedName}</title>`);
      expect(html).toContain(
        `<span class="title">${escapedName}</span>`,
      );

      await reportQueuedCommandSuccess(harness, htmlWrite, {
        path: "assets/index.html",
        hash: sha256Text(html),
        modifiedAtMs: 2001,
        sizeBytes: Buffer.byteLength(html),
      });

      const stateWrite = await waitForQueuedCommandAfter(
        harness,
        htmlWrite.row.cursor,
        ({ command }) =>
          command.type === "host.write_file_relative" &&
          command.rootPath === appRoot(fixture, "xss-demo") &&
          command.path === "data/state.json",
      );
      const stateWriteCommand = requireWriteFileRelativeCommand(stateWrite);
      await reportQueuedCommandSuccess(harness, stateWrite, {
        path: "data/state.json",
        hash: sha256Text(stateWriteCommand.command.content),
        modifiedAtMs: 2002,
        sizeBytes: Buffer.byteLength(stateWriteCommand.command.content),
      });

      const manifestRead = await reportManifestRead({
        harness,
        fixture,
        appId: "xss-demo",
        afterCursor: stateWrite.row.cursor,
        manifest: {
          manifestVersion: 1,
          id: "xss-demo",
          name: maliciousName,
          entry: "index.html",
          contributions: ["thread.app"],
          capabilities: ["data", "message"],
        },
      });

      const logoListCommand = await waitForQueuedCommandAfter(
        harness,
        manifestRead.row.cursor,
        ({ command }) =>
          command.type === "host.list_paths" &&
          command.path === appRoot(fixture, "xss-demo"),
      );
      await reportQueuedCommandSuccess(harness, logoListCommand, {
        paths: [],
        truncated: false,
      });

      const response = await request;
      expect(response.status).toBe(201);
    } finally {
      await harness.cleanup();
    }
  });
});
