import {
  archiveThread,
  getThread,
  listEvents,
  listThreadsWithPendingInteractionState,
  unarchiveThread,
} from "@bb/db";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { turnScope } from "@bb/domain";
import { getLastThreadOutput } from "../../src/services/threads/thread-data.js";
import { stopThreadForCurrentState } from "../../src/services/threads/thread-lifecycle.js";
import { reportQueuedCommandSuccess } from "../helpers/commands.js";
import { waitForQueuedCommand } from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
  seedEvent,
} from "../helpers/seed.js";
import {
  dispatchArchivedThreadProviderArchiveCommand,
  dispatchThreadUnarchiveCommand,
  dispatchThreadRenameCommand,
} from "../../src/services/threads/thread-commands.js";
import { listQueuedCommands } from "../helpers/commands.js";
import { withTestHarness } from "../helpers/test-app.js";

for (const lifetime of [undefined, "disposable"] as const) {
  it(`stores and dispatches ${lifetime ?? "default persistent"} session lifetime`, async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const response = await harness.app.request("/api/v1/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          origin: "cli",
          projectId: project.id,
          providerId: "codex",
          model: "gpt-5",
          experimental_providerSessionLifetime: lifetime,
          input: [{ type: "text", text: "worker result" }],
          environment: { type: "reuse", environmentId: environment.id },
        }),
      });
      expect(response.status).toBe(201);
      const thread = z
        .looseObject({ id: z.string() })
        .parse(await readJson(response));
      expect(thread).toMatchObject({
        canEditMessages: lifetime !== "disposable",
        experimental_providerSessionLifetime: lifetime ?? "persistent",
      });
      const id = thread.id;
      expect(getThread(harness.db, id)).toMatchObject({
        providerSessionLifetime: lifetime ?? "persistent",
      });
      const start = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === id,
      );
      expect(start.command).toMatchObject({
        providerSessionLifetime: lifetime ?? "persistent",
      });
    });
  });
}

describe("unsupported disposable provider", () => {
  it("rejects before creating a BB thread or dispatching work", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const response = await harness.app.request("/api/v1/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          origin: "cli",
          projectId: project.id,
          providerId: "claude-code",
          model: "test-provider-default",
          experimental_providerSessionLifetime: "disposable",
          input: [{ type: "text", text: "temporary worker" }],
          environment: { type: "reuse", environmentId: environment.id },
        }),
      });
      expect(response.status).toBe(400);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "disposable_sessions_unsupported",
        retryable: false,
      });
      expect(
        listThreadsWithPendingInteractionState(harness.db, {
          projectId: project.id,
        }),
      ).toEqual([]);
    });
  });
});

it("keeps BB history while skipping native storage operations for disposable workers", async () => {
  await withTestHarness(async (harness) => {
    const { host } = seedHostSession(harness.deps);
    const { project } = seedProjectWithSource(harness.deps, {
      hostId: host.id,
    });
    const environment = seedEnvironment(harness.deps, {
      hostId: host.id,
      projectId: project.id,
    });
    const thread = seedThread(harness.deps, {
      projectId: project.id,
      environmentId: environment.id,
      providerSessionLifetime: "disposable",
    });
    seedThreadRuntimeState(harness.deps, {
      threadId: thread.id,
      environmentId: environment.id,
      providerThreadId: "ephemeral-uuid",
      inputText: "Retained worker input",
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environment.id,
      providerThreadId: "ephemeral-uuid",
      scope: turnScope("worker-turn"),
      sequence: 3,
      type: "item/completed",
      data: {
        item: {
          type: "agentMessage",
          id: "worker-result",
          text: "Retained assistant worker result",
        },
      },
    });
    expect(getLastThreadOutput(harness.db, thread.id)).toBe(
      "Retained assistant worker result",
    );
    const stopping = stopThreadForCurrentState(
      harness.deps,
      thread,
      environment,
    );
    const release = await waitForQueuedCommand(
      harness,
      ({ command }) =>
        command.type === "thread.stop" && command.threadId === thread.id,
    );
    expect(release.command).toMatchObject({ intent: "release" });
    await reportQueuedCommandSuccess(harness, release, {
      providerCheckpointId: null,
    });
    await stopping;
    expect(getLastThreadOutput(harness.db, thread.id)).toBe(
      "Retained assistant worker result",
    );
    const eventsBefore = listEvents(harness.db, { threadId: thread.id });
    archiveThread(harness.db, harness.hub, thread.id);
    expect(getThread(harness.db, thread.id)?.archivedAt).toEqual(
      expect.any(Number),
    );
    expect(
      dispatchArchivedThreadProviderArchiveCommand(harness.deps, {
        threadId: thread.id,
      }),
    ).toBe(false);
    unarchiveThread(harness.db, harness.hub, thread.id);
    expect(getThread(harness.db, thread.id)?.archivedAt).toBeNull();
    expect(
      dispatchThreadUnarchiveCommand(harness.deps, {
        thread,
        environment,
        providerThreadId: "ephemeral-uuid",
      }),
    ).toBe(false);
    dispatchThreadRenameCommand(harness.deps, {
      threadId: thread.id,
      providerId: thread.providerId,
      environment,
      title: "Retained worker",
    });
    expect(listQueuedCommands(harness, "thread.archive")).toEqual([]);
    expect(listQueuedCommands(harness, "thread.unarchive")).toEqual([]);
    expect(listQueuedCommands(harness, "thread.rename")).toEqual([]);
    expect(listEvents(harness.db, { threadId: thread.id })).toEqual(
      eventsBefore,
    );
    expect(getLastThreadOutput(harness.db, thread.id)).toBe(
      "Retained assistant worker result",
    );
    expect(getThread(harness.db, thread.id)).toMatchObject({
      providerSessionLifetime: "disposable",
      deletedAt: null,
    });
  });
});

it.each([
  { sourceLifetime: "disposable", targetLifetime: "persistent" },
  { sourceLifetime: "persistent", targetLifetime: "disposable" },
] as const)(
  "rejects a $sourceLifetime source fork into a $targetLifetime session",
  async ({ sourceLifetime, targetLifetime }) => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const source = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        providerSessionLifetime: sourceLifetime,
      });
      const response = await harness.app.request("/api/v1/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          origin: "cli",
          projectId: project.id,
          providerId: "codex",
          model: "gpt-5",
          sourceThreadId: source.id,
          originKind: "fork",
          experimental_providerSessionLifetime: targetLifetime,
          input: [{ type: "text", text: "fork" }],
          environment: { type: "reuse", environmentId: environment.id },
        }),
      });
      expect(response.status).toBe(400);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "invalid_request",
        message: "Disposable provider sessions cannot be forked",
      });
      expect(
        listThreadsWithPendingInteractionState(harness.db, {
          projectId: project.id,
        }),
      ).toHaveLength(1);
    });
  },
);
