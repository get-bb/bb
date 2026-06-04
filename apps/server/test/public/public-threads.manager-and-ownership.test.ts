import {
  provisionHostMock,
  resumeHostMock,
} from "./public-thread-test-harness.js";

import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  events,
  archiveThread,
  getLatestThreadSequence,
  getQueuedThreadMessage,
  getThread,
  hostDaemonCommands,
  markThreadDeleted,
  promptHistoryEntries,
  threads,
  upsertThreadDynamicContextFileState,
} from "@bb/db";
import {
  systemOperationEventDataSchema,
  threadScope,
  threadSchema,
  turnRequestEventDataSchema,
} from "@bb/domain";
import { renderTemplate } from "@bb/templates";
import { buildManagerToolReminderText } from "../../src/services/threads/manager-tool-reminder.js";
import { MANAGER_PREFERENCES_FILE_KEY } from "../../src/services/threads/manager-dynamic-file-delivery.js";
import {
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
  waitForQueuedCommandAfter,
} from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import { waitForThreadEnvironment } from "./public-thread-assertions.js";
import {
  seedQueuedMessage,
  seedEnvironment,
  seedEvent,
  seedHost,
  seedHostSession,
  seedProjectWithSource,
  seedThreadRuntimeState,
  seedThread,
} from "../helpers/seed.js";
import {
  createTestAppHarness,
  type TestAppHarness,
  withTestHarness,
} from "../helpers/test-app.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";

interface HostDataDirArgs {
  hostId: string;
}

interface RespondToManagerPreferencesReadArgs {
  content: string;
  harness: TestAppHarness;
}

function hostDataDir(args: HostDataDirArgs): string {
  return `/tmp/bb-host-data/${args.hostId}`;
}

function managerToolReminderInput() {
  return {
    type: "text",
    text: buildManagerToolReminderText("codex"),
  };
}

async function respondToNextManagerPreferencesRead(
  args: RespondToManagerPreferencesReadArgs,
): Promise<void> {
  const queued = await waitForQueuedCommand(
    args.harness,
    ({ command, row }) =>
      row.state === "pending" &&
      command.type === "host.read_file" &&
      command.path.endsWith("/PREFERENCES.md"),
  );
  if (queued.command.type !== "host.read_file") {
    throw new Error(`Expected host.read_file, got ${queued.command.type}`);
  }
  const response = await reportQueuedCommandSuccess(args.harness, queued, {
    path: queued.command.path,
    content: args.content,
    contentEncoding: "utf8",
    mimeType: "text/markdown",
    sizeBytes: Buffer.byteLength(args.content),
  });
  expect(response.status).toBe(200);
}

describe("public thread manager and ownership routes", () => {
  beforeEach(() => {
    provisionHostMock.mockReset();
    resumeHostMock.mockReset();
  });

  it("summarizes non-deleted assigned child threads for a manager", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const managerThread = seedThread(harness.deps, {
        projectId: project.id,
        type: "manager",
      });
      seedThread(harness.deps, {
        projectId: project.id,
        parentThreadId: managerThread.id,
      });
      const archivedChild = seedThread(harness.deps, {
        projectId: project.id,
        parentThreadId: managerThread.id,
      });
      const deletedChild = seedThread(harness.deps, {
        projectId: project.id,
        parentThreadId: managerThread.id,
      });
      seedThread(harness.deps, {
        projectId: project.id,
      });
      archiveThread(harness.db, harness.deps.hub, archivedChild.id);
      markThreadDeleted(harness.db, harness.deps.hub, {
        threadId: deletedChild.id,
      });

      const response = await harness.app.request(
        `/api/v1/threads/${managerThread.id}/assigned-child-summary`,
      );

      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({
        nonDeletedAssignedChildCount: 2,
      });
    });
  });

  it("returns zero assigned child threads when a manager only has deleted children", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const managerThread = seedThread(harness.deps, {
        projectId: project.id,
        type: "manager",
      });
      const deletedChild = seedThread(harness.deps, {
        projectId: project.id,
        parentThreadId: managerThread.id,
      });
      markThreadDeleted(harness.db, harness.deps.hub, {
        threadId: deletedChild.id,
      });

      const response = await harness.app.request(
        `/api/v1/threads/${managerThread.id}/assigned-child-summary`,
      );

      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({
        nonDeletedAssignedChildCount: 0,
      });
    });
  });

  it("summarizes assigned child threads for archived manager threads", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const managerThread = seedThread(harness.deps, {
        projectId: project.id,
        type: "manager",
      });
      seedThread(harness.deps, {
        projectId: project.id,
        parentThreadId: managerThread.id,
      });
      archiveThread(harness.db, harness.deps.hub, managerThread.id);

      const response = await harness.app.request(
        `/api/v1/threads/${managerThread.id}/assigned-child-summary`,
      );

      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({
        nonDeletedAssignedChildCount: 1,
      });
    });
  });

  it("rejects assigned child summaries for non-manager threads", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        type: "standard",
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/assigned-child-summary`,
      );

      expect(response.status).toBe(400);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "invalid_request",
      });
    });
  });

  it("queues thread.rename, returns thread events, sends queued messages, and creates manager threads", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/thread-data-project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/thread-data-project",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
        title: "Old title",
        titleFallback: "Old title",
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        sequence: 1,
        type: "system/manager/user_message",
        scope: threadScope(),
        data: { text: "Hello from the manager" },
      });

      const patchResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            title: "New title",
          }),
        },
      );
      expect(patchResponse.status).toBe(200);
      const renameCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.rename" && command.threadId === thread.id,
      );
      expect(renameCommand.command).toMatchObject({
        title: "New title",
      });

      const eventsResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/events`,
      );
      expect(eventsResponse.status).toBe(200);
      await expect(readJson(eventsResponse)).resolves.toEqual([
        expect.objectContaining({
          type: "system/manager/user_message",
        }),
      ]);

      const queuedMessage = seedQueuedMessage(harness.deps, {
        threadId: thread.id,
        content: [{ type: "text", text: "Queued message content" }],
        model: "gpt-5",
        serviceTier: "default",
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-queuedMessage",
        sequence: 2,
        type: "thread/identity",
        scope: threadScope(),
        data: {},
      });
      const queuedMessageSendResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/queued-messages/${queuedMessage.id}/send`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ mode: "auto" }),
        },
      );
      expect(queuedMessageSendResponse.status).toBe(200);
      const queuedMessageCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "turn.submit" && command.threadId === thread.id,
      );
      expect(queuedMessageCommand.command).toMatchObject({
        environmentId: environment.id,
        options: {
          model: "gpt-5",
          serviceTier: "default",
        },
      });
      expect(getQueuedThreadMessage(harness.db, queuedMessage.id)).toBeNull();

      const managerResponse = await harness.app.request(
        `/api/v1/projects/${project.id}/managers`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            origin: "app",
            name: "Project manager",
            providerId: "codex",
            model: "gpt-5",
            reasoningLevel: "medium",
            environment: {
              type: "host",
              hostId: host.id,
            },
          }),
        },
      );
      expect(managerResponse.status).toBe(201);
      const managerThread = threadSchema.parse(await readJson(managerResponse));
      expect(managerThread.type).toBe("manager");
      if (!managerThread.environmentId) {
        throw new Error("Expected manager thread environment");
      }

      const managerStartCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" &&
          command.threadId === managerThread.id,
      );
      if (managerStartCommand.command.type !== "thread.start") {
        throw new Error("Expected thread.start command");
      }
      expect(managerStartCommand.command.options).toMatchObject({
        model: "gpt-5",
        serviceTier: "default",
        reasoningLevel: "medium",
        permissionMode: "full",
        permissionEscalation: null,
      });
      expect(managerStartCommand.command.dynamicTools).toEqual([
        expect.objectContaining({ name: "message_user" }),
      ]);
      expect(managerStartCommand.command.disallowedTools).toEqual([
        "ExitPlanMode",
        "NotebookEdit",
        "Task",
      ]);
      expect(managerStartCommand.command.instructions).toContain(
        "You are a manager in a project inside bb",
      );
      expect(managerStartCommand.command.instructions).not.toContain(
        "PREFERENCES.md contents",
      );
      expect(managerStartCommand.command.instructions).toContain(project.name);
      expect(managerStartCommand.command.instructions).toContain(
        "Project root: `/tmp/thread-data-project`",
      );
      expect(managerStartCommand.command.instructions).toContain(
        `Thread storage: \`/tmp/bb-host-data/${host.id}/thread-storage/${managerThread.id}\``,
      );
    });
  });

  it("prepends changed manager preferences before the next tell", async () => {
    const harness = await createTestAppHarness();
    const hostId = "host-manager-preferences-change-detection";
    const dataDir = hostDataDir({ hostId });
    await rm(dataDir, { recursive: true, force: true });
    try {
      const { host } = seedHostSession(harness.deps, { id: hostId });
      const { project, source } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: source.path,
      });
      const response = await harness.app.request(
        `/api/v1/projects/${project.id}/managers`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            origin: "cli",
            providerId: "codex",
            model: "gpt-5",
            environment: {
              type: "host",
              hostId: host.id,
            },
          }),
        },
      );
      expect(response.status).toBe(201);
      const thread = threadSchema.parse(await readJson(response));
      await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === thread.id,
      );

      const latestSequence = getLatestThreadSequence(harness.db, {
        threadId: thread.id,
      });
      seedThreadRuntimeState(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-manager-preferences-change-detection",
        inputText: "Initial manager task",
        sequenceStart: latestSequence + 1,
      });
      harness.db
        .update(threads)
        .set({ status: "idle", updatedAt: Date.now() })
        .where(eq(threads.id, thread.id))
        .run();
      // Creation never reads PREFERENCES.md, so seed the change-detection
      // baseline as if an earlier tell already delivered different contents.
      upsertThreadDynamicContextFileState(harness.db, {
        threadId: thread.id,
        fileKey: MANAGER_PREFERENCES_FILE_KEY,
        contentHash: "alpha-prefs-hash",
        contentStatus: "present",
        shownAt: Date.now() - 1,
      });
      const storagePath = path.join(dataDir, "thread-storage", thread.id);
      await mkdir(storagePath, { recursive: true });
      await writeFile(
        path.join(storagePath, "PREFERENCES.md"),
        "beta prefs\n",
        "utf8",
      );

      const sendResponsePromise = harness.app.request(
        `/api/v1/threads/${thread.id}/send`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            input: [{ type: "text", text: "ack prefs test" }],
            mode: "start",
          }),
        },
      );
      await respondToNextManagerPreferencesRead({
        harness,
        content: "beta prefs\n",
      });
      const sendResponse = await sendResponsePromise;
      expect(sendResponse.status).toBe(200);

      const turnSubmit = await waitForQueuedCommand(
        harness,
        ({ command, row }) =>
          row.state === "pending" &&
          command.type === "turn.submit" &&
          command.threadId === thread.id,
      );
      if (turnSubmit.command.type !== "turn.submit") {
        throw new Error(`Expected turn.submit, got ${turnSubmit.command.type}`);
      }
      expect(turnSubmit.command.input[0]).toEqual({
        type: "text",
        text: expect.stringContaining(
          "PREFERENCES.md has been updated. New contents:",
        ),
        visibility: "agent-only",
      });
      expect(turnSubmit.command.input[0]).toEqual({
        type: "text",
        text: expect.stringContaining("beta prefs"),
        visibility: "agent-only",
      });
      expect(turnSubmit.command.input[1]).toEqual({
        type: "text",
        text: "ack prefs test",
      });
      expect(turnSubmit.command.input[1]).not.toHaveProperty("visibility");
      expect(turnSubmit.command.input.at(-1)).toEqual(
        managerToolReminderInput(),
      );
    } finally {
      await harness.cleanup();
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("replaces the welcome template with a quick-start preamble + user input when input is provided", async () => {
    const harness = await createTestAppHarness();
    const hostId = "host-manager-quick-start";
    const dataDir = hostDataDir({ hostId });
    await rm(dataDir, { recursive: true, force: true });
    try {
      const { host } = seedHostSession(harness.deps, { id: hostId });
      const { project, source } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: source.path,
      });

      const response = await harness.app.request(
        `/api/v1/projects/${project.id}/managers`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            origin: "app",
            providerId: "codex",
            model: "gpt-5",
            environment: { type: "host", hostId: host.id },
            input: [{ type: "text", text: "Investigate the timeline flicker." }],
          }),
        },
      );

      expect(response.status).toBe(201);
      const thread = threadSchema.parse(await readJson(response));
      const startCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === thread.id,
      );
      if (startCommand.command.type !== "thread.start") {
        throw new Error(`Expected thread.start, got ${startCommand.command.type}`);
      }
      // The preferences-snapshot system message isn't prepended when no
      // PREFERENCES.md exists, so the quick-start preamble lands at index
      // 0, the user's input at index 1.
      expect(startCommand.command.input[0]).toEqual({
        type: "text",
        text: renderTemplate("systemMessageManagerQuickStart", {}),
        visibility: "agent-only",
      });
      expect(startCommand.command.input[1]).toEqual({
        type: "text",
        text: "Investigate the timeline flicker.",
      });
      // The welcome template is NOT sent when the caller supplied input —
      // the quick-start preamble replaces it.
      expect(
        startCommand.command.input.some(
          (entry) =>
            entry.type === "text" &&
            entry.text === renderTemplate("systemMessageManagerWelcome", {}),
        ),
      ).toBe(false);

      // Sanity-check prompt-history coverage: manager hire is `initiator:
      // "system"`, which `resolveAcceptedPromptHistoryScope` rejects, so
      // nothing about this hire should land in the recall table. In
      // particular, the agent-only quick-start preamble must never appear
      // in prompt history.
      const promptHistoryRows = harness.db
        .select({
          input: promptHistoryEntries.input,
          threadId: promptHistoryEntries.threadId,
        })
        .from(promptHistoryEntries)
        .where(eq(promptHistoryEntries.threadId, thread.id))
        .all();
      expect(promptHistoryRows).toEqual([]);
    } finally {
      await harness.cleanup();
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("falls back to the welcome template when no input is provided", async () => {
    const harness = await createTestAppHarness();
    const hostId = "host-manager-welcome-fallback";
    const dataDir = hostDataDir({ hostId });
    await rm(dataDir, { recursive: true, force: true });
    try {
      const { host } = seedHostSession(harness.deps, { id: hostId });
      const { project, source } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: source.path,
      });

      const response = await harness.app.request(
        `/api/v1/projects/${project.id}/managers`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            origin: "app",
            providerId: "codex",
            model: "gpt-5",
            environment: { type: "host", hostId: host.id },
          }),
        },
      );

      expect(response.status).toBe(201);
      const thread = threadSchema.parse(await readJson(response));
      const startCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === thread.id,
      );
      if (startCommand.command.type !== "thread.start") {
        throw new Error(`Expected thread.start, got ${startCommand.command.type}`);
      }
      expect(startCommand.command.input[0]).toEqual({
        type: "text",
        text: renderTemplate("systemMessageManagerWelcome", {}),
      });
      expect(startCommand.command.input[0]).not.toHaveProperty("visibility");
      // No user-input message follows the welcome.
      expect(startCommand.command.input).toHaveLength(1);
    } finally {
      await harness.cleanup();
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("falls back to the welcome template when input only contains whitespace text", async () => {
    const harness = await createTestAppHarness();
    const hostId = "host-manager-whitespace-only";
    const dataDir = hostDataDir({ hostId });
    await rm(dataDir, { recursive: true, force: true });
    try {
      const { host } = seedHostSession(harness.deps, { id: hostId });
      const { project, source } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: source.path,
      });

      const response = await harness.app.request(
        `/api/v1/projects/${project.id}/managers`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            origin: "app",
            providerId: "codex",
            model: "gpt-5",
            environment: { type: "host", hostId: host.id },
            // Two text-only parts, both whitespace — the route should treat
            // this as no input and route to the welcome fallback so the
            // timeline doesn't show an empty user message preceded by an
            // invisible quick-start preamble.
            input: [
              { type: "text", text: "   \n\t  " },
              { type: "text", text: "" },
            ],
          }),
        },
      );

      expect(response.status).toBe(201);
      const thread = threadSchema.parse(await readJson(response));
      const startCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === thread.id,
      );
      if (startCommand.command.type !== "thread.start") {
        throw new Error(`Expected thread.start, got ${startCommand.command.type}`);
      }
      expect(startCommand.command.input[0]).toEqual({
        type: "text",
        text: renderTemplate("systemMessageManagerWelcome", {}),
      });
      expect(startCommand.command.input[0]).not.toHaveProperty("visibility");
      // No quick-start preamble, no user-input echo of the whitespace.
      expect(startCommand.command.input).toHaveLength(1);
      expect(
        startCommand.command.input.some(
          (entry) =>
            entry.type === "text" &&
            entry.text ===
              renderTemplate("systemMessageManagerQuickStart", {}),
        ),
      ).toBe(false);
    } finally {
      await harness.cleanup();
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("does not read PREFERENCES.md or seed thread storage during manager creation", async () => {
    const harness = await createTestAppHarness();
    const hostId = "host-manager-preferences-missing";
    const dataDir = hostDataDir({ hostId });
    await rm(dataDir, { recursive: true, force: true });
    try {
      const { host } = seedHostSession(harness.deps, { id: hostId });
      const { project, source } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: source.path,
      });

      // The creation response must resolve without any daemon round-trip:
      // nothing seeds a fresh manager's storage, so a creation-time
      // PREFERENCES.md read could only ever ENOENT.
      const response = await harness.app.request(
        `/api/v1/projects/${project.id}/managers`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            origin: "cli",
            providerId: "codex",
            model: "gpt-5",
            environment: {
              type: "host",
              hostId: host.id,
            },
          }),
        },
      );

      expect(response.status).toBe(201);
      const thread = threadSchema.parse(await readJson(response));
      await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === thread.id,
      );
      const preferencesReads = harness.db
        .select({ id: hostDaemonCommands.id })
        .from(hostDaemonCommands)
        .where(eq(hostDaemonCommands.type, "host.read_file"))
        .all();
      expect(preferencesReads).toEqual([]);
      const storagePath = path.join(dataDir, "thread-storage", thread.id);
      await expect(
        stat(path.join(storagePath, "PREFERENCES.md")),
      ).rejects.toThrow();
      await expect(
        stat(path.join(storagePath, "apps", "status", "manifest.json")),
      ).rejects.toThrow();
    } finally {
      await harness.cleanup();
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  for (const providerId of ["claude-code", "pi"]) {
    it(`does not queue thread.rename for ${providerId} threads`, async () => {
      await withTestHarness(async (harness) => {
        const { host } = seedHostSession(harness.deps);
        const { project } = seedProjectWithSource(harness.deps, {
          hostId: host.id,
          path: `/tmp/${providerId}-thread-data-project`,
        });
        const environment = seedEnvironment(harness.deps, {
          hostId: host.id,
          projectId: project.id,
          path: `/tmp/${providerId}-thread-data-project`,
        });
        const thread = seedThread(harness.deps, {
          projectId: project.id,
          environmentId: environment.id,
          providerId,
          status: "idle",
          title: "Old title",
          titleFallback: "Old title",
        });

        const patchResponse = await harness.app.request(
          `/api/v1/threads/${thread.id}`,
          {
            method: "PATCH",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({
              title: "New title",
            }),
          },
        );
        expect(patchResponse.status).toBe(200);

        const queuedRenames = harness.db
          .select({ id: hostDaemonCommands.id })
          .from(hostDaemonCommands)
          .where(
            and(
              eq(hostDaemonCommands.hostId, host.id),
              eq(hostDaemonCommands.type, "thread.rename"),
            ),
          )
          .all();
        expect(queuedRenames).toEqual([]);
      });
    });
  }

  it("appends an ownership change event and queues a manager assignment message", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/thread-ownership-project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/thread-ownership-project/worktree",
      });
      const managerThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        type: "manager",
        title: "Manager thread",
      });
      seedThreadRuntimeState(harness.deps, {
        threadId: managerThread.id,
        environmentId: environment.id,
        providerThreadId: "provider-manager-assigned",
        inputText: "Initial manager task",
        model: "gpt-5.4",
      });
      upsertThreadDynamicContextFileState(harness.db, {
        threadId: managerThread.id,
        fileKey: MANAGER_PREFERENCES_FILE_KEY,
        contentHash: "previous-ownership-assignment-preferences-hash",
        contentStatus: "present",
        shownAt: Date.now() - 1,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        parentThreadId: null,
      });

      const responsePromise = harness.app.request(
        `/api/v1/threads/${thread.id}`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            parentThreadId: managerThread.id,
          }),
        },
      );

      const managerPreferencesPath = `/tmp/bb-host-data/${host.id}/thread-storage/${managerThread.id}/PREFERENCES.md`;
      const preferencesReadCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "host.read_file" &&
          command.path === managerPreferencesPath,
      );
      if (preferencesReadCommand.command.type !== "host.read_file") {
        throw new Error(
          `Expected host.read_file, got ${preferencesReadCommand.command.type}`,
        );
      }
      const preferencesContent = "ownership assignment updated prefs\n";
      const readResponse = await reportQueuedCommandSuccess(
        harness,
        preferencesReadCommand,
        {
          path: managerPreferencesPath,
          content: preferencesContent,
          contentEncoding: "utf8",
          mimeType: "text/markdown",
          sizeBytes: Buffer.byteLength(preferencesContent),
        },
      );
      expect(readResponse.status).toBe(200);

      const response = await responsePromise;
      expect(response.status).toBe(200);
      expect(getThread(harness.db, thread.id)?.parentThreadId).toBe(
        managerThread.id,
      );

      const storedEvent = harness.db
        .select({ type: events.type, data: events.data })
        .from(events)
        .where(eq(events.threadId, thread.id))
        .orderBy(events.sequence)
        .all()
        .at(-1);

      expect(storedEvent?.type).toBe("system/operation");
      const parsedData = systemOperationEventDataSchema.parse(
        storedEvent ? JSON.parse(storedEvent.data) : null,
      );
      expect(parsedData).toMatchObject({
        operation: "ownership_change",
        status: "completed",
        message: "Thread assigned to manager",
        metadata: {
          action: "assign",
          previousParentThreadId: null,
          previousParentThreadTitle: null,
          nextParentThreadId: managerThread.id,
          nextParentThreadTitle: "Manager thread",
        },
      });

      const queuedCommand = await waitForQueuedCommandAfter(
        harness,
        preferencesReadCommand.row.cursor,
        ({ command }) =>
          command.type === "turn.submit" &&
          command.threadId === managerThread.id,
      );
      expect(queuedCommand.command).toMatchObject({
        environmentId: environment.id,
        input: [
          {
            type: "text",
            text: expect.stringContaining(
              "PREFERENCES.md has been updated. New contents:",
            ),
            visibility: "agent-only",
          },
          {
            type: "text",
            text: renderTemplate("systemMessageThreadOwnershipAssigned", {
              threadLabel: `${thread.id}: Test Thread`,
            }),
          },
          managerToolReminderInput(),
        ],
        options: {
          model: "gpt-5.4",
          serviceTier: "default",
          reasoningLevel: "medium",
          permissionMode: "full",
          permissionEscalation: null,
        },
        resumeContext: {
          providerId: managerThread.providerId,
          providerThreadId: "provider-manager-assigned",
          projectId: project.id,
          workspaceContext: {
            workspacePath: environment.path,
            workspaceProvisionType: "unmanaged",
          },
        },
      });
      if (queuedCommand.command.type !== "turn.submit") {
        throw new Error(
          `Expected turn.submit, got ${queuedCommand.command.type}`,
        );
      }
      expect(queuedCommand.command.input[0]).toEqual({
        type: "text",
        text: expect.stringContaining("ownership assignment updated prefs"),
        visibility: "agent-only",
      });
      expect(queuedCommand.command.input[1]).not.toHaveProperty("visibility");
      const managerTurnRequest = harness.db
        .select({ data: events.data, type: events.type })
        .from(events)
        .where(eq(events.threadId, managerThread.id))
        .orderBy(events.sequence)
        .all()
        .filter((event) => event.type === "client/turn/requested")
        .at(-1);
      if (!managerTurnRequest) {
        throw new Error("Expected persisted manager turn request");
      }
      const managerTurnData = turnRequestEventDataSchema.parse(
        JSON.parse(managerTurnRequest.data),
      );
      expect(managerTurnData.input[0]).toEqual(queuedCommand.command.input[0]);
      expect(managerTurnData.input[1]).toEqual(queuedCommand.command.input[1]);
    });
  });

  it("defaults manager-created child threads to managed worktrees and keeps explicit reuse opt-in", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-manager-child-defaults",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/manager-child-defaults",
      });
      const managerEnvironment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/manager-child-defaults",
      });
      const managerThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: managerEnvironment.id,
        type: "manager",
        title: "Manager thread",
      });

      const createManagedChildResponse = await harness.app.request(
        "/api/v1/threads",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            origin: "app",
            projectId: project.id,
            parentThreadId: managerThread.id,
            providerId: "codex",
            model: "gpt-5",
            input: [{ type: "text", text: "Implement the feature" }],
            environment: {
              type: "host",
              hostId: host.id,
              workspace: { type: "unmanaged", path: null },
            },
          }),
        },
      );

      expect(createManagedChildResponse.status).toBe(201);
      const managedChild = threadSchema.parse(
        await readJson(createManagedChildResponse),
      );
      expect(managedChild.parentThreadId).toBe(managerThread.id);
      expect(managedChild.status).toBe("provisioning");
      expect(managedChild.environmentId).toBeNull();
      const managedChildEnvironment = await waitForThreadEnvironment(
        harness,
        managedChild.id,
      );

      const provisionCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "environment.provision" &&
          command.environmentId === managedChildEnvironment.id,
      );
      expect(provisionCommand.command).toMatchObject({
        workspaceProvisionType: "managed-worktree",
      });

      const reuseEnvironment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/manager-child-defaults/reuse",
        workspaceProvisionType: "managed-worktree",
      });
      const createReuseChildResponse = await harness.app.request(
        "/api/v1/threads",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            origin: "app",
            projectId: project.id,
            parentThreadId: managerThread.id,
            providerId: "codex",
            model: "gpt-5",
            input: [{ type: "text", text: "Review in place" }],
            environment: {
              type: "reuse",
              environmentId: reuseEnvironment.id,
            },
          }),
        },
      );

      expect(createReuseChildResponse.status).toBe(201);
      const reuseChild = threadSchema.parse(
        await readJson(createReuseChildResponse),
      );
      expect(reuseChild.environmentId).toBe(reuseEnvironment.id);
      const reuseThreadStart = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === reuseChild.id,
      );
      if (reuseThreadStart.command.type !== "thread.start") {
        throw new Error("Expected thread.start command");
      }
      expect(reuseThreadStart.command.environmentId).toBe(reuseEnvironment.id);
    });
  });

  it("rejects invalid parentThreadId values when creating managed child threads", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-invalid-parent-create",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/invalid-parent-create-project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/invalid-parent-create-project/worktree",
      });
      const { project: otherProject } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/invalid-parent-create-other-project",
      });
      const crossProjectManager = seedThread(harness.deps, {
        projectId: otherProject.id,
        type: "manager",
      });
      const standardParent = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        type: "standard",
      });
      const deletedManager = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        type: "manager",
      });
      markThreadDeleted(harness.db, harness.hub, {
        threadId: deletedManager.id,
      });

      const initialThreadCount = harness.db.select().from(threads).all().length;
      const invalidParentCases = [
        { parentThreadId: crossProjectManager.id, reason: "wrong_project" },
        { parentThreadId: standardParent.id, reason: "not_a_manager" },
        { parentThreadId: deletedManager.id, reason: "deleted" },
      ];

      for (const invalidParent of invalidParentCases) {
        const response = await harness.app.request("/api/v1/threads", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            origin: "app",
            projectId: project.id,
            parentThreadId: invalidParent.parentThreadId,
            providerId: "codex",
            model: "gpt-5",
            input: [{ type: "text", text: "Invalid parent" }],
            environment: {
              type: "host",
              hostId: host.id,
              workspace: { type: "unmanaged", path: null },
            },
          }),
        });

        expect(response.status).toBe(400);
        await expect(readJson(response)).resolves.toMatchObject({
          code: "parent_thread_invalid",
          details: {
            reason: invalidParent.reason,
            subject: "parent",
          },
        });
      }

      expect(harness.db.select().from(threads).all()).toHaveLength(
        initialThreadCount,
      );
    });
  });

  it("rejects invalid parentThreadId values when assigning ownership", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-invalid-parent-update",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/invalid-parent-update-project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/invalid-parent-update-project/worktree",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        parentThreadId: null,
      });
      const { project: otherProject } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/invalid-parent-update-other-project",
      });
      const crossProjectManager = seedThread(harness.deps, {
        projectId: otherProject.id,
        type: "manager",
      });
      const standardParent = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        type: "standard",
      });
      const deletedManager = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        type: "manager",
      });
      markThreadDeleted(harness.db, harness.hub, {
        threadId: deletedManager.id,
      });

      const invalidParentCases = [
        { parentThreadId: crossProjectManager.id, reason: "wrong_project" },
        { parentThreadId: standardParent.id, reason: "not_a_manager" },
        { parentThreadId: deletedManager.id, reason: "deleted" },
      ];

      for (const invalidParent of invalidParentCases) {
        const response = await harness.app.request(
          `/api/v1/threads/${thread.id}`,
          {
            method: "PATCH",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({
              parentThreadId: invalidParent.parentThreadId,
            }),
          },
        );

        expect(response.status).toBe(400);
        await expect(readJson(response)).resolves.toMatchObject({
          code: "parent_thread_invalid",
          details: {
            reason: invalidParent.reason,
            subject: "parent",
          },
        });
        expect(getThread(harness.db, thread.id)?.parentThreadId).toBeNull();
      }

      expect(
        harness.db
          .select({ id: hostDaemonCommands.id })
          .from(hostDaemonCommands)
          .all(),
      ).toEqual([]);
    });
  });

  it("queues a manager unassignment message when ownership is cleared", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/thread-unassignment-project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/thread-unassignment-project/worktree",
      });
      const managerThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        type: "manager",
        title: "Manager thread",
      });
      seedThreadRuntimeState(harness.deps, {
        threadId: managerThread.id,
        environmentId: environment.id,
        providerThreadId: "provider-manager-unassigned",
        inputText: "Initial manager task",
        model: "gpt-5.4",
      });
      upsertThreadDynamicContextFileState(harness.db, {
        threadId: managerThread.id,
        fileKey: MANAGER_PREFERENCES_FILE_KEY,
        contentHash: "previous-ownership-removal-preferences-hash",
        contentStatus: "present",
        shownAt: Date.now() - 1,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        parentThreadId: managerThread.id,
      });

      const responsePromise = harness.app.request(
        `/api/v1/threads/${thread.id}`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            parentThreadId: null,
          }),
        },
      );

      const managerPreferencesPath = `/tmp/bb-host-data/${host.id}/thread-storage/${managerThread.id}/PREFERENCES.md`;
      const preferencesReadCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "host.read_file" &&
          command.path === managerPreferencesPath,
      );
      if (preferencesReadCommand.command.type !== "host.read_file") {
        throw new Error(
          `Expected host.read_file, got ${preferencesReadCommand.command.type}`,
        );
      }
      const preferencesContent = "ownership removal updated prefs\n";
      const readResponse = await reportQueuedCommandSuccess(
        harness,
        preferencesReadCommand,
        {
          path: managerPreferencesPath,
          content: preferencesContent,
          contentEncoding: "utf8",
          mimeType: "text/markdown",
          sizeBytes: Buffer.byteLength(preferencesContent),
        },
      );
      expect(readResponse.status).toBe(200);

      const response = await responsePromise;
      expect(response.status).toBe(200);
      expect(getThread(harness.db, thread.id)?.parentThreadId).toBeNull();

      const queuedCommand = await waitForQueuedCommandAfter(
        harness,
        preferencesReadCommand.row.cursor,
        ({ command }) =>
          command.type === "turn.submit" &&
          command.threadId === managerThread.id,
      );
      expect(queuedCommand.command).toMatchObject({
        environmentId: environment.id,
        input: [
          {
            type: "text",
            text: expect.stringContaining(
              "PREFERENCES.md has been updated. New contents:",
            ),
            visibility: "agent-only",
          },
          {
            type: "text",
            text: renderTemplate("systemMessageThreadOwnershipRemoved", {
              threadLabel: `${thread.id}: Test Thread`,
            }),
          },
          managerToolReminderInput(),
        ],
        options: {
          model: "gpt-5.4",
          serviceTier: "default",
          reasoningLevel: "medium",
          permissionMode: "full",
          permissionEscalation: null,
        },
        resumeContext: {
          providerId: managerThread.providerId,
          providerThreadId: "provider-manager-unassigned",
          projectId: project.id,
          workspaceContext: {
            workspacePath: environment.path,
            workspaceProvisionType: "unmanaged",
          },
        },
      });
      if (queuedCommand.command.type !== "turn.submit") {
        throw new Error(
          `Expected turn.submit, got ${queuedCommand.command.type}`,
        );
      }
      expect(queuedCommand.command.input[0]).toEqual({
        type: "text",
        text: expect.stringContaining("ownership removal updated prefs"),
        visibility: "agent-only",
      });
      expect(queuedCommand.command.input[1]).not.toHaveProperty("visibility");
      const managerTurnRequest = harness.db
        .select({ data: events.data, type: events.type })
        .from(events)
        .where(eq(events.threadId, managerThread.id))
        .orderBy(events.sequence)
        .all()
        .filter((event) => event.type === "client/turn/requested")
        .at(-1);
      if (!managerTurnRequest) {
        throw new Error("Expected persisted manager turn request");
      }
      const managerTurnData = turnRequestEventDataSchema.parse(
        JSON.parse(managerTurnRequest.data),
      );
      expect(managerTurnData.input[0]).toEqual(queuedCommand.command.input[0]);
      expect(managerTurnData.input[1]).toEqual(queuedCommand.command.input[1]);
    });
  });

  it("keeps ownership updates successful when manager notification queuing fails", async () => {
    await withTestHarness(async (harness) => {
      const loggerError = vi.fn();
      harness.deps.logger.error = loggerError;

      const host = seedHost(harness.deps, {
        id: "host-manager-notify-offline",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/thread-ownership-offline-project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/thread-ownership-offline-project/worktree",
      });
      const managerThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        type: "manager",
        title: "Offline manager",
      });
      seedThreadRuntimeState(harness.deps, {
        threadId: managerThread.id,
        environmentId: environment.id,
        providerThreadId: "provider-manager-offline",
        inputText: "Initial manager task",
        model: "gpt-5.4",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        parentThreadId: null,
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            parentThreadId: managerThread.id,
          }),
        },
      );

      expect(response.status).toBe(200);
      expect(getThread(harness.db, thread.id)?.parentThreadId).toBe(
        managerThread.id,
      );
      expect(
        harness.db
          .select({ id: hostDaemonCommands.id })
          .from(hostDaemonCommands)
          .all(),
      ).toEqual([]);
      expect(loggerError).toHaveBeenCalledWith(
        expect.objectContaining({
          err: expect.any(Error),
          managedThreadId: thread.id,
          managerThreadId: managerThread.id,
          reason: "assigned",
        }),
        "Failed to queue manager ownership system message",
      );
    });
  });
});
