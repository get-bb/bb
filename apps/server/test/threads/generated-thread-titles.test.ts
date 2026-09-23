import {
  createThread,
  getThread,
  listEvents,
  setAiServiceSelection,
} from "@bb/db";
import {
  type ResolvedThreadExecutionOptions,
  systemThreadProvisioningEventDataSchema,
  threadSchema,
  turnScope,
} from "@bb/domain";
import { groupHostDaemonEvents } from "@bb/host-daemon-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  internalAuthHeaders,
  listQueuedThreadCommands,
  reportQueuedCommandError,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
  waitForQueuedCommandAfter,
} from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import { skillInput, textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadIdentity,
  seedTurnStarted,
} from "../helpers/seed.js";
import {
  withTestHarness as withBaseHarness,
  type TestAppHarness,
} from "../helpers/test-app.js";
import { registerFakeAiService } from "../helpers/ai-services.js";
import { installFakeGitWorktreeProvider } from "../helpers/environment-provider.js";
import { runEnvironmentProvisioningSweep } from "../../src/services/system/periodic-sweeps.js";
import { createThreadFromRequest } from "../../src/services/threads/thread-create.js";
import { requestThreadStopForCurrentState } from "../../src/services/threads/thread-lifecycle.js";
import {
  advanceThreadProvisioning,
  requestThreadProvision,
} from "../../src/services/threads/thread-provisioning.js";
import { generateThreadMetadataWithOutcome } from "../../src/services/threads/title-generation.js";

interface MockThreadMetadata {
  title?: string;
}

const completeTitle = vi.fn<(prompt: string) => Promise<string>>();

function registerTitleService(harness: TestAppHarness): TestAppHarness {
  registerFakeAiService(harness.deps.aiServices, {
    id: "codex",
    pluginId: "provider-codex",
    builtin: true,
    complete: (prompt) => completeTitle(prompt),
  });
  return harness;
}

function withTestHarness<T>(
  run: (harness: TestAppHarness) => Promise<T>,
): Promise<T> {
  return withBaseHarness({}, (harness) => run(registerTitleService(harness)));
}

function sentPrompt(index = 0): string {
  return completeTitle.mock.calls[index]?.[0] ?? "";
}

function mockThreadMetadata(metadata: MockThreadMetadata): void {
  completeTitle.mockResolvedValue(metadata.title ?? "");
}

function deferredTitle(): {
  promise: Promise<string>;
  resolve: (metadata: MockThreadMetadata) => void;
} {
  let resolve: (metadata: MockThreadMetadata) => void = () => {
    throw new Error("Title generation was not started");
  };
  const promise = new Promise<string>((settle) => {
    resolve = (metadata) => settle(metadata.title ?? "");
  });
  return { promise, resolve };
}

function pendingThreadMetadata(): (metadata: MockThreadMetadata) => void {
  let current: ReturnType<typeof deferredTitle> | null = null;
  completeTitle.mockImplementation(() => {
    current = deferredTitle();
    return current.promise;
  });
  return (metadata) => {
    if (current === null) {
      throw new Error("Title generation was not started");
    }
    current.resolve(metadata);
  };
}

const THREAD_START_EXECUTION = {
  model: "gpt-5",
  serviceTier: "default",
  reasoningLevel: "medium",
  permissionMode: "accept-edits",
  source: "client/turn/requested",
} satisfies ResolvedThreadExecutionOptions;

interface CreateManagedWorktreeThreadArgs {
  hostId: string;
  projectId: string;
  text: string;
  title?: string;
}

async function createManagedWorktreeThread(
  harness: TestAppHarness,
  args: CreateManagedWorktreeThreadArgs,
) {
  const response = await harness.app.request("/api/v1/threads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      origin: "app",
      projectId: args.projectId,
      providerId: "codex",
      model: "gpt-5",
      ...(args.title === undefined ? {} : { title: args.title }),
      input: [{ type: "text", text: args.text }],
      environment: {
        type: "host",
        hostId: args.hostId,
        workspace: {
          type: "managed-worktree",
          baseBranch: { kind: "default" },
        },
      },
    }),
  });
  expect(response.status).toBe(201);
  return threadSchema.parse(await readJson(response));
}

function provisioningEntries(harness: TestAppHarness, threadId: string) {
  return listEvents(harness.db, { threadId })
    .filter((event) => event.type === "system/thread-provisioning")
    .flatMap(
      (event) =>
        systemThreadProvisioningEventDataSchema.parse(JSON.parse(event.data))
          .entries,
    );
}

describe("generated thread titles", () => {
  beforeEach(() => {
    completeTitle.mockReset();
  });

  it("resolves a managed-worktree request to the worktree provider once the title is generated", async () => {
    mockThreadMetadata({ title: "Improve Branch Names" });
    await withTestHarness(async (harness) => {
      const provider = installFakeGitWorktreeProvider();
      const { host } = seedHostSession(harness.deps, {
        id: "host-generated-branch",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/generated-branch-project",
      });

      const thread = await createManagedWorktreeThread(harness, {
        hostId: host.id,
        projectId: project.id,
        text: "Improve the generated branch naming path",
      });
      expect(thread.title).toBeNull();

      const context = await provider.waitForProvision();
      expect(context.thread.id).toBe(thread.id);
      expect(context.thread.title).toBe("Improve Branch Names");
      expect(context.host?.id).toBe(host.id);
      expect(context.inputs).toEqual({ branch: { kind: "default" } });
      expect(getThread(harness.db, thread.id)?.title).toBe(
        "Improve Branch Names",
      );
      expect(completeTitle).toHaveBeenCalledTimes(1);
    });
  });

  it("opens the workspace-setup block before metadata inference completes", async () => {
    const resolveMetadata = pendingThreadMetadata();

    await withTestHarness(async (harness) => {
      const provider = installFakeGitWorktreeProvider();
      const { host } = seedHostSession(harness.deps, {
        id: "host-managed-early-provisioning-row",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/managed-early-provisioning-row-project",
      });

      const thread = await createManagedWorktreeThread(harness, {
        hostId: host.id,
        projectId: project.id,
        text: "Show provisioning before generated branch metadata finishes",
      });

      await vi.waitFor(() => {
        expect(completeTitle).toHaveBeenCalledTimes(1);
        expect(provisioningEntries(harness, thread.id)[0]?.key).toBe(
          "workspace-started",
        );
      });
      expect(getThread(harness.db, thread.id)?.environmentId).toBeNull();
      expect(provider.contexts).toHaveLength(0);

      resolveMetadata({ title: "Early Visible Provisioning" });

      const context = await provider.waitForProvision();
      expect(context.thread.title).toBe("Early Visible Provisioning");
    });
  });

  it("does not fail a stopped thread when metadata inference settles", async () => {
    const resolveMetadata = pendingThreadMetadata();

    await withTestHarness(async (harness) => {
      const provider = installFakeGitWorktreeProvider();
      const { host } = seedHostSession(harness.deps, {
        id: "host-stop-during-metadata",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/stop-during-metadata-project",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        status: "starting",
        title: null,
        titleFallback: "Stop during metadata inference",
      });
      const input = textInput("Stop during metadata inference before setup");
      requestThreadProvision(harness.deps, {
        environmentIntent: {
          type: "provider",
          environmentProviderId: "git-worktree",
          machine: { type: "existing", hostId: host.id },
          inputs: { branch: { kind: "default" } },
          selectionResolved: true,
        },
        execution: THREAD_START_EXECUTION,
        fork: null,
        input,
        startedOnBehalfOf: null,
        thread,
        titleProvided: false,
      });
      const advance = advanceThreadProvisioning(harness.deps, {
        threadId: thread.id,
      });

      await vi.waitFor(() => {
        expect(completeTitle).toHaveBeenCalledTimes(1);
      });

      const startingThread = getThread(harness.db, thread.id);
      if (!startingThread) {
        throw new Error("Expected the starting thread");
      }
      expect(startingThread.environmentId).toBeNull();
      requestThreadStopForCurrentState(harness.deps, startingThread, null);
      expect(getThread(harness.db, thread.id)).toMatchObject({
        status: "idle",
      });

      resolveMetadata({ title: "Stopped Metadata Race" });
      await advance;

      expect(getThread(harness.db, thread.id)).toMatchObject({
        status: "idle",
      });
      const events = listEvents(harness.db, { threadId: thread.id });
      expect(events.map((event) => event.type)).not.toContain("system/error");
      expect(provider.contexts).toHaveLength(0);
      expect(getThread(harness.db, thread.id)?.environmentId).toBeNull();
    });
  });

  it("does not fail a thread waiting on metadata during provisioning sweeps", async () => {
    const resolveMetadata = pendingThreadMetadata();

    await withTestHarness(async (harness) => {
      const provider = installFakeGitWorktreeProvider();
      const { host } = seedHostSession(harness.deps, {
        id: "host-managed-prepared-sweep",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/managed-prepared-sweep-project",
      });

      const thread = await createManagedWorktreeThread(harness, {
        hostId: host.id,
        projectId: project.id,
        text: "Keep prepared provisioning safe during sweeps",
      });

      await vi.waitFor(() => {
        expect(completeTitle).toHaveBeenCalledTimes(1);
        expect(provisioningEntries(harness, thread.id)).not.toHaveLength(0);
      });

      await runEnvironmentProvisioningSweep(harness.deps);

      expect(getThread(harness.db, thread.id)?.status).toBe("starting");
      expect(
        listEvents(harness.db, { threadId: thread.id }).map(
          (event) => event.type,
        ),
      ).not.toContain("system/error");

      resolveMetadata({ title: "Prepared Sweep Safe" });

      const context = await provider.waitForProvision();
      expect(context.thread.title).toBe("Prepared Sweep Safe");
    });
  });

  it("falls through to the next Automatic service for provider-path titles", async () => {
    completeTitle.mockRejectedValueOnce(new Error("Codex is overloaded"));
    await withTestHarness(async (harness) => {
      const cloud = registerFakeAiService(harness.deps.aiServices, {
        id: "bb",
        pluginId: "bb-ai",
        builtin: true,
        complete: async () => "Recovered Managed Metadata",
      });
      const provider = installFakeGitWorktreeProvider();
      const { host } = seedHostSession(harness.deps, {
        id: "host-managed-metadata-retry",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/managed-metadata-retry-project",
      });

      const thread = await createManagedWorktreeThread(harness, {
        hostId: host.id,
        projectId: project.id,
        text: "Recover managed metadata after a failed first service",
      });

      const context = await provider.waitForProvision();
      expect(context.thread.title).toBe("Recovered Managed Metadata");
      expect(getThread(harness.db, thread.id)?.title).toBe(
        "Recovered Managed Metadata",
      );
      expect(completeTitle).toHaveBeenCalledTimes(1);
      expect(cloud.completeCalls).toHaveLength(1);
    });
  });

  it("queues a daemon rename after a generated title thread starts", async () => {
    mockThreadMetadata({ title: "Generated Rename Title" });
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-generated-title-rename",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/generated-title-rename-project",
      });
      seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/generated-title-rename-workspace",
        status: "ready",
      });
      installFakeGitWorktreeProvider(() => ({
        action: "ready",
        environment: {
          type: "host",
          hostId: host.id,
          path: "/tmp/generated-title-rename-workspace",
        },
      }));

      const thread = await createManagedWorktreeThread(harness, {
        hostId: host.id,
        projectId: project.id,
        text: "Generate a title then sync it after startup",
      });
      const start = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === thread.id,
      );
      await reportQueuedCommandSuccess(
        harness,
        start,
        { providerThreadId: "provider-generated-title-rename" },
        { hostId: host.id },
      );

      const rename = await waitForQueuedCommandAfter(
        harness,
        start.row.cursor,
        ({ command }) =>
          command.type === "thread.rename" && command.threadId === thread.id,
      );
      expect(rename.command).toMatchObject({
        type: "thread.rename",
        threadId: thread.id,
        title: "Generated Rename Title",
      });
    });
  });

  it("generates titles for submitted fork threads", async () => {
    mockThreadMetadata({ title: "Generated Fork Title" });

    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-generated-fork-title",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/generated-fork-title-project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/generated-fork-title-project",
        status: "ready",
      });
      const sourceThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
      });
      seedThreadIdentity(harness.deps, {
        threadId: sourceThread.id,
        providerThreadId: "provider-generated-fork-title-source",
      });
      seedTurnStarted(harness.deps, {
        threadId: sourceThread.id,
        turnId: "turn-generated-fork-title-source",
        providerThreadId: "provider-generated-fork-title-source",
      });

      const input = textInput("Continue this fork and generate a useful title");
      const fork = await createThreadFromRequest(harness.deps, {
        environment: { type: "reuse", environmentId: environment.id },
        input,
        model: "gpt-5",
        origin: "app",
        originKind: "fork",
        projectId: project.id,
        providerId: "codex",
        sourceThreadId: sourceThread.id,
        startedOnBehalfOf: null,
      });

      expect(getThread(harness.db, fork.id)?.titleFallback).toBe(
        "Continue this fork and generate a useful title",
      );

      const start = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === fork.id,
      );
      if (start.command.type !== "thread.start") {
        throw new Error("Expected a thread.start command");
      }
      expect(start.command.input).toEqual(input);
      expect(start.command.fork).toEqual({
        sourceProviderThreadId: "provider-generated-fork-title-source",
      });

      await reportQueuedCommandSuccess(
        harness,
        start,
        { providerThreadId: "provider-generated-fork-title" },
        { hostId: host.id },
      );

      await vi.waitFor(() => {
        expect(getThread(harness.db, fork.id)?.title).toBe(
          "Generated Fork Title",
        );
      });
    });
  });
  it("does not queue a daemon rename for user-supplied titles", async () => {
    mockThreadMetadata({ title: "Generated Title" });
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-user-title-no-rename",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/user-title-no-rename-project",
      });
      seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/user-title-no-rename-workspace",
        status: "ready",
      });
      installFakeGitWorktreeProvider(() => ({
        action: "ready",
        environment: {
          type: "host",
          hostId: host.id,
          path: "/tmp/user-title-no-rename-workspace",
        },
      }));

      const thread = await createManagedWorktreeThread(harness, {
        hostId: host.id,
        projectId: project.id,
        text: "Use the user supplied title without daemon rename",
        title: "User Picked Title",
      });
      const start = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === thread.id,
      );
      await reportQueuedCommandSuccess(
        harness,
        start,
        { providerThreadId: "provider-user-title-no-rename" },
        { hostId: host.id },
      );

      await expect(
        waitForQueuedCommandAfter(
          harness,
          start.row.cursor,
          ({ command }) =>
            command.type === "thread.rename" && command.threadId === thread.id,
          100,
        ),
      ).rejects.toThrow("Timed out waiting for queued command");
      expect(completeTitle).not.toHaveBeenCalled();
    });
  });

  it("renames an idle non-managed thread when its title lands late", async () => {
    const resolveMetadata = pendingThreadMetadata();

    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-idle-late-title-rename",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/idle-late-title-rename-project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/idle-late-title-rename-workspace",
        status: "ready",
      });
      const thread = createThread(harness.db, harness.hub, {
        projectId: project.id,
        environmentId: environment.id,
        providerId: "codex",
        status: "starting",
        title: null,
        titleFallback: "Idle late title rename",
      });

      requestThreadProvision(harness.deps, {
        environmentIntent: {
          type: "reuse",
          environmentId: environment.id,
        },
        execution: THREAD_START_EXECUTION,
        fork: null,
        input: textInput("Generate a title for this non-managed reuse thread"),
        startedOnBehalfOf: null,
        thread,
        titleProvided: false,
      });
      await advanceThreadProvisioning(harness.deps, {
        threadId: thread.id,
      });

      const start = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === thread.id,
      );
      await reportQueuedCommandSuccess(
        harness,
        start,
        { providerThreadId: "provider-idle-late-title" },
        { hostId: host.id },
      );
      expect(getThread(harness.db, thread.id)?.status).toBe("active");
      expect(getThread(harness.db, thread.id)?.title).toBeNull();

      const eventsResponse = await harness.app.request(
        "/internal/session/events",
        {
          method: "POST",
          headers: internalAuthHeaders(harness),
          body: JSON.stringify({
            sessionId: session.id,
            eventGroups: groupHostDaemonEvents([
              {
                threadId: thread.id,
                event: {
                  type: "turn/started",
                  threadId: thread.id,
                  providerThreadId: "provider-idle-late-title",
                  scope: turnScope("turn-idle-late-title"),
                },
              },
              {
                threadId: thread.id,
                event: {
                  type: "turn/completed",
                  threadId: thread.id,
                  providerThreadId: "provider-idle-late-title",
                  scope: turnScope("turn-idle-late-title"),
                  status: "completed",
                },
              },
            ]),
          }),
        },
      );
      expect(eventsResponse.status).toBe(200);
      expect(getThread(harness.db, thread.id)?.status).toBe("idle");

      await vi.waitFor(() => {
        expect(completeTitle).toHaveBeenCalledTimes(1);
      });

      resolveMetadata({ title: "Late Idle Title" });

      const rename = await waitForQueuedCommandAfter(
        harness,
        start.row.cursor,
        ({ command }) =>
          command.type === "thread.rename" && command.threadId === thread.id,
      );
      expect(rename.command).toMatchObject({
        type: "thread.rename",
        threadId: thread.id,
        title: "Late Idle Title",
      });
      expect(getThread(harness.db, thread.id)?.title).toBe("Late Idle Title");
    });
  });

  it("does not rename a non-managed thread that errored before its title landed", async () => {
    const resolveMetadata = pendingThreadMetadata();

    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-errored-late-title-no-rename",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/errored-late-title-no-rename-project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/errored-late-title-no-rename-workspace",
        status: "ready",
      });
      const thread = createThread(harness.db, harness.hub, {
        projectId: project.id,
        environmentId: environment.id,
        providerId: "codex",
        status: "starting",
        title: null,
        titleFallback: "Errored late title no rename",
      });

      requestThreadProvision(harness.deps, {
        environmentIntent: {
          type: "reuse",
          environmentId: environment.id,
        },
        execution: THREAD_START_EXECUTION,
        fork: null,
        input: textInput("Generate a title for this non-managed reuse thread"),
        startedOnBehalfOf: null,
        thread,
        titleProvided: false,
      });
      await advanceThreadProvisioning(harness.deps, {
        threadId: thread.id,
      });

      const start = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === thread.id,
      );
      await reportQueuedCommandError(
        harness,
        start,
        {
          errorCode: "thread_start_failed",
          errorMessage: "Thread start failed",
        },
        { hostId: host.id },
      );
      expect(getThread(harness.db, thread.id)?.status).toBe("error");

      resolveMetadata({ title: "Errored Late Title" });

      await expect(
        waitForQueuedCommandAfter(
          harness,
          start.row.cursor,
          ({ command }) =>
            command.type === "thread.rename" && command.threadId === thread.id,
          100,
        ),
      ).rejects.toThrow("Timed out waiting for queued command");
      expect(
        listQueuedThreadCommands(harness, "thread.rename", thread.id),
      ).toEqual([]);
    });
  });
  it("skips generation when thread titles are turned off", async () => {
    await withTestHarness(async (harness) => {
      setAiServiceSelection(harness.db, "thread-title", { mode: "off" });
      await expect(
        generateThreadMetadataWithOutcome(harness.deps, {
          input: textInput("Improve the generated title fallback path"),
          threadId: "thr_inference_unavailable",
        }),
      ).resolves.toMatchObject({
        metadata: null,
        reason: "inference-unavailable",
      });
      expect(completeTitle).not.toHaveBeenCalled();
    });
  });

  it("reports no service when nothing can generate titles", async () => {
    await withBaseHarness({}, async (harness) => {
      await expect(
        generateThreadMetadataWithOutcome(harness.deps, {
          input: textInput("Improve the generated title fallback path"),
          threadId: "thr_no_service",
        }),
      ).resolves.toMatchObject({
        metadata: null,
        reason: "inference-unavailable",
      });
    });
  });

  it("cleans and clamps a chatty title reply", async () => {
    completeTitle.mockResolvedValue(
      '<think>short and clear</think>\nTitle: "Make the generated branch names easier to read in the sidebar"',
    );
    await withTestHarness(async (harness) => {
      const outcome = await generateThreadMetadataWithOutcome(harness.deps, {
        input: textInput("Make generated branch names easier to read"),
        threadId: "thr_chatty_title",
      });
      expect(outcome.metadata?.title).toBe(
        "Make the generated branch names easier to read",
      );
    });
  });

  it("titles a skill invocation from the task, not the command token", async () => {
    mockThreadMetadata({ title: "Drop stale release branches" });
    await withTestHarness(async (harness) => {
      await expect(
        generateThreadMetadataWithOutcome(harness.deps, {
          input: skillInput(
            "sync-repo",
            " and drop the stale release branches",
          ),
          threadId: "thr_skill_metadata",
        }),
      ).resolves.toMatchObject({
        metadata: { title: "Drop stale release branches" },
      });
      const prompt = sentPrompt();
      expect(prompt).toContain("and drop the stale release branches");
      expect(prompt).toContain(
        "The prompt invokes these commands or skills: /sync-repo.",
      );
      expect(prompt).not.toContain("/sync-repo and drop");
    });
  });

  it.each(["调", "𠮷"])(
    "clamps the task after stripping commands without splitting %s",
    async (character) => {
      mockThreadMetadata({ title: "Investigate the reported issue" });
      await withTestHarness(async (harness) => {
        const input = skillInput("review", ` ${character.repeat(60)}`);
        const original = structuredClone(input);
        await generateThreadMetadataWithOutcome(harness.deps, {
          input,
          threadId: "thr_unicode_skill_metadata",
        });
        const prompt = sentPrompt();
        expect(prompt).toContain(
          "The prompt invokes these commands or skills: /review.",
        );
        expect(prompt).toContain(`Task:\n${character.repeat(38)}...`);
        expect(prompt).not.toContain(character.repeat(39));
        expect(input).toEqual(original);
      });
    },
  );

  it("titles a bare skill invocation from what the skill does", async () => {
    mockThreadMetadata({ title: "Generate the weekly report" });
    await withTestHarness(async (harness) => {
      await expect(
        generateThreadMetadataWithOutcome(harness.deps, {
          input: skillInput("weekly-report"),
          threadId: "thr_bare_skill_metadata",
        }),
      ).resolves.toMatchObject({
        metadata: { title: "Generate the weekly report" },
      });
      expect(sentPrompt()).toContain(
        "The prompt invokes these commands or skills: /weekly-report.",
      );
      expect(sentPrompt()).toContain("Task:\n/weekly-report");
    });
  });

  it("reports a failed title generation without retrying the same service", async () => {
    completeTitle.mockRejectedValue(new Error("metadata failed"));
    await withTestHarness(async (harness) => {
      await expect(
        generateThreadMetadataWithOutcome(harness.deps, {
          input: textInput("Improve failed metadata generation behavior"),
          threadId: "thr_failed_metadata",
        }),
      ).resolves.toMatchObject({
        metadata: null,
        reason: "failed",
      });
      expect(completeTitle).toHaveBeenCalledTimes(1);
      expect(sentPrompt()).not.toContain(
        "The prompt invokes these commands or skills",
      );
    });
  });
});
