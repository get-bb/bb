import { listEvents } from "@bb/db";
import {
  threadQueuedMessageSchema,
  threadSchema,
  turnRequestEventDataSchema,
} from "@bb/domain";
import { threadEnvironmentUnavailableApiErrorSchema } from "@bb/server-contract";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { readAttachment } from "../../src/services/projects/attachments.js";
import { registerHostRpcResponder } from "../helpers/host-rpc.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
  seedTurnStarted,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function registerRemoteImageResponder(
  harness: TestAppHarness,
  args: {
    hostId: string;
    mimeType?: string | null;
    paths: readonly string[];
    restoreCommandCaptureAfterResponse?: boolean;
    sessionId: string;
  },
): void {
  const mimeType = args.mimeType === undefined ? "image/png" : args.mimeType;
  registerHostRpcResponder(harness, {
    hostId: args.hostId,
    sessionId: args.sessionId,
    restoreCommandCaptureAfterResponse: args.restoreCommandCaptureAfterResponse,
    handle: ({ command }) => {
      if (
        command.type !== "host.read_file" ||
        !args.paths.includes(command.path)
      ) {
        throw new Error(`Unexpected host RPC ${command.type}`);
      }
      return {
        ok: true,
        result: {
          path: command.path,
          content: ONE_PIXEL_PNG.toString("base64"),
          contentEncoding: "base64",
          ...(mimeType ? { mimeType } : {}),
          sha256: createHash("sha256").update(ONE_PIXEL_PNG).digest("hex"),
          sizeBytes: ONE_PIXEL_PNG.byteLength,
        },
      };
    },
  });
}

function persistedImages(harness: TestAppHarness, threadId: string) {
  return listEvents(harness.db, { threadId })
    .filter((event) => event.type === "client/turn/requested")
    .flatMap((event) => {
      const request = turnRequestEventDataSchema.parse(JSON.parse(event.data));
      return request.input.filter((input) => input.type === "localImage");
    });
}

describe("public thread prompt attachments", () => {
  it("persists a CLI absolute image from the execution host as a durable project attachment", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-cli-absolute-image",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/remote/project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/remote/project",
      });
      const absoluteImagePath = "/remote/references/reference.png";
      registerRemoteImageResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        paths: [absoluteImagePath],
        restoreCommandCaptureAfterResponse: true,
      });

      const response = await harness.app.request("/api/v1/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          origin: "cli",
          projectId: project.id,
          providerId: "codex",
          model: "gpt-5",
          input: [
            { type: "text", text: "Inspect this reference", mentions: [] },
            { type: "localImage", path: absoluteImagePath },
          ],
          environment: {
            type: "reuse",
            environmentId: environment.id,
          },
        }),
      });

      expect(response.status).toBe(201);
      const thread = threadSchema.parse(await readJson(response));
      const storedImage = persistedImages(harness, thread.id)[0];
      expect(storedImage).toBeDefined();
      if (storedImage?.type !== "localImage") {
        throw new Error("Expected persisted local image input");
      }
      expect(storedImage.path).toMatch(/^reference-\d+-[a-z0-9]{6}\.png$/u);
      await expect(
        readAttachment(harness.config.dataDir, project.id, storedImage.path),
      ).resolves.toMatchObject({ content: ONE_PIXEL_PNG });
    });
  });

  it("serves sniffed PNG bytes from a dotted non-image host path", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-cli-dotted-png",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/remote/project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/remote/project",
      });
      const absoluteImagePath = "/remote/references/backup.2024";
      registerRemoteImageResponder(harness, {
        hostId: host.id,
        mimeType: null,
        sessionId: session.id,
        paths: [absoluteImagePath],
        restoreCommandCaptureAfterResponse: true,
      });

      const response = await harness.app.request("/api/v1/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          origin: "cli",
          projectId: project.id,
          providerId: "codex",
          model: "gpt-5",
          input: [{ type: "localImage", path: absoluteImagePath }],
          environment: {
            type: "reuse",
            environmentId: environment.id,
          },
        }),
      });

      expect(response.status).toBe(201);
      const thread = threadSchema.parse(await readJson(response));
      const storedImage = persistedImages(harness, thread.id)[0];
      expect(storedImage?.path).toMatch(/^backup-\d+-[a-z0-9]{6}\.png$/u);

      const contentResponse = await harness.app.request(
        `/api/v1/projects/${project.id}/attachments/content?path=${encodeURIComponent(storedImage?.path ?? "missing")}`,
      );
      expect(contentResponse.status).toBe(200);
      expect(contentResponse.headers.get("content-type")).toBe("image/png");
      expect(Buffer.from(await contentResponse.arrayBuffer())).toEqual(
        ONE_PIXEL_PNG,
      );
    });
  });

  it("normalizes absolute images sent to an existing thread before event persistence", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-tell-absolute-image",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/remote/project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/remote/project",
      });
      const thread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
        status: "idle",
      });
      seedThreadRuntimeState(harness.deps, {
        environmentId: environment.id,
        providerThreadId: "provider-tell-image",
        threadId: thread.id,
      });
      const absoluteImagePath = "/remote/references/tell.png";
      registerRemoteImageResponder(harness, {
        hostId: host.id,
        paths: [absoluteImagePath],
        restoreCommandCaptureAfterResponse: true,
        sessionId: session.id,
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/send`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            input: [
              { type: "text", text: "Inspect this follow-up", mentions: [] },
              { type: "localImage", path: absoluteImagePath },
            ],
            mode: "auto",
          }),
        },
      );

      expect(response.status).toBe(200);
      const storedImage = persistedImages(harness, thread.id).at(-1);
      expect(storedImage?.path).toMatch(/^tell-\d+-[a-z0-9]{6}\.png$/u);
      await expect(
        readAttachment(
          harness.config.dataDir,
          project.id,
          storedImage?.path ?? "missing",
        ),
      ).resolves.toMatchObject({ content: ONE_PIXEL_PNG });
    });
  });

  it("normalizes absolute images when queued messages are created and updated", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-queue-absolute-image",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/remote/project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/remote/project",
      });
      const thread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
        status: "active",
      });
      const createdPath = "/remote/references/queued.png";
      const updatedPath = "/remote/references/updated.png";
      registerRemoteImageResponder(harness, {
        hostId: host.id,
        paths: [createdPath, updatedPath],
        sessionId: session.id,
      });

      const createResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/queued-messages`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            input: [{ type: "localImage", path: createdPath }],
            model: "gpt-5",
          }),
        },
      );
      expect(createResponse.status).toBe(201);
      const created = threadQueuedMessageSchema.parse(
        await readJson(createResponse),
      );
      expect(created.content[0]).toMatchObject({
        type: "localImage",
        path: expect.stringMatching(/^queued-\d+-[a-z0-9]{6}\.png$/u),
      });

      const updateResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/queued-messages/${created.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            expectedUpdatedAt: created.updatedAt,
            input: [{ type: "localImage", path: updatedPath }],
          }),
        },
      );
      expect(updateResponse.status).toBe(200);
      const updated = threadQueuedMessageSchema.parse(
        await readJson(updateResponse),
      );
      expect(updated.content[0]).toMatchObject({
        type: "localImage",
        path: expect.stringMatching(/^updated-\d+-[a-z0-9]{6}\.png$/u),
      });
    });
  });

  it("normalizes an absolute image in a fork prompt on the source execution host", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-fork-absolute-image",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/remote/project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/remote/project",
      });
      const sourceThread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
        status: "idle",
      });
      seedThreadRuntimeState(harness.deps, {
        environmentId: environment.id,
        providerThreadId: "provider-fork-image",
        threadId: sourceThread.id,
      });
      seedTurnStarted(harness.deps, {
        environmentId: environment.id,
        providerThreadId: "provider-fork-image",
        sequence: 3,
        threadId: sourceThread.id,
        turnId: "turn-fork-image",
      });
      const absoluteImagePath = "/remote/references/fork.png";
      registerRemoteImageResponder(harness, {
        hostId: host.id,
        paths: [absoluteImagePath],
        restoreCommandCaptureAfterResponse: true,
        sessionId: session.id,
      });

      const response = await harness.app.request("/api/v1/threads/fork", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceThreadId: sourceThread.id,
          workspace: "reuse",
          origin: "cli",
          agentContextSeed: [
            {
              type: "localImage",
              path: absoluteImagePath,
              visibility: "agent-only",
            },
          ],
          input: [
            { type: "text", text: "Inspect the fork image", mentions: [] },
            { type: "localImage", path: absoluteImagePath },
          ],
        }),
      });

      expect(response.status).toBe(201);
      const fork = threadSchema.parse(await readJson(response));
      const storedImages = persistedImages(harness, fork.id);
      expect(storedImages).toHaveLength(2);
      expect(storedImages[0]).toMatchObject({
        type: "localImage",
        visibility: "agent-only",
      });
      expect(storedImages[1]).not.toHaveProperty("visibility");
      expect(storedImages[0]?.path).toMatch(/^fork-\d+-[a-z0-9]{6}\.png$/u);
      expect(storedImages[1]?.path).toBe(storedImages[0]?.path);
      await expect(
        readAttachment(
          harness.config.dataDir,
          project.id,
          storedImages[0]?.path ?? "missing",
        ),
      ).resolves.toMatchObject({ content: ONE_PIXEL_PNG });
    });
  });

  it("returns a schema-valid lifecycle error when an absolute image has no execution host", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-image-without-thread-environment",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/remote/project",
      });
      const thread = seedThread(harness.deps, {
        environmentId: null,
        projectId: project.id,
        status: "active",
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/queued-messages`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            input: [
              {
                type: "localImage",
                path: "/remote/references/unavailable.png",
              },
            ],
            model: "gpt-5",
          }),
        },
      );

      expect(response.status).toBe(409);
      expect(
        threadEnvironmentUnavailableApiErrorSchema.parse(
          await readJson(response),
        ),
      ).toMatchObject({
        code: "thread_environment_unavailable",
        details: { environmentStatus: null, reason: "never_attached" },
      });
    });
  });

  it("preserves an oversized absolute image as a runtime path", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-cli-oversized-image",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/remote/project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/remote/project",
      });
      const absoluteImagePath = "/remote/references/large.png";
      registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        restoreCommandCaptureAfterResponse: true,
        handle: ({ command }) => {
          if (command.type !== "host.read_file") {
            throw new Error(`Unexpected host RPC ${command.type}`);
          }
          return {
            ok: false,
            errorCode: "file_too_large",
            errorMessage: "File exceeds the host image transport limit",
          };
        },
      });

      const response = await harness.app.request("/api/v1/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          origin: "cli",
          projectId: project.id,
          providerId: "codex",
          model: "gpt-5",
          input: [{ type: "localImage", path: absoluteImagePath }],
          environment: {
            type: "reuse",
            environmentId: environment.id,
          },
        }),
      });

      expect(response.status).toBe(201);
      const thread = threadSchema.parse(await readJson(response));
      expect(persistedImages(harness, thread.id)).toEqual([
        { type: "localImage", path: absoluteImagePath },
      ]);
    });
  });

  it("returns a public 404 when a host image path does not exist", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-cli-missing-image",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/remote/project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/remote/project",
      });
      const absoluteImagePath = "/remote/references/missing.png";
      registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: ({ command }) => {
          if (command.type !== "host.read_file") {
            throw new Error(`Unexpected host RPC ${command.type}`);
          }
          return {
            ok: false,
            errorCode: "ENOENT",
            errorMessage: `Path does not exist: ${absoluteImagePath}`,
          };
        },
      });

      const response = await harness.app.request("/api/v1/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          origin: "cli",
          projectId: project.id,
          providerId: "codex",
          model: "gpt-5",
          input: [{ type: "localImage", path: absoluteImagePath }],
          environment: {
            type: "reuse",
            environmentId: environment.id,
          },
        }),
      });

      expect(response.status).toBe(404);
      expect(await readJson(response)).toMatchObject({
        code: "ENOENT",
        message: `Path does not exist: ${absoluteImagePath}`,
      });
    });
  });
});
