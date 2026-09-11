import { listEvents, listQueuedThreadMessages } from "@bb/db";
import { turnScope, type PromptInput } from "@bb/domain";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/errors.js";
import { runQueuedMessageDispatch } from "../../src/services/threads/queued-message-dispatch.js";
import { sendThreadMessage } from "../../src/services/threads/thread-send.js";
import {
  listQueuedThreadCommands,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { registerHostRpcResponder } from "../helpers/host-rpc.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedQueuedMessage,
  seedStoredEvent,
  seedThread,
  seedThreadIdentity,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const OWN_SESSION = "session-alpha";
const FOREIGN_SESSION = "session-beta";
const BATCH_AT = 1_787_775_164_121;

function seedThreads(harness: TestAppHarness) {
  const { host, session } = seedHostSession(harness.deps);
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: "/tmp/identity-ownership",
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    path: "/tmp/identity-ownership",
    status: "ready",
  });
  const first = seedThread(harness.deps, {
    environmentId: environment.id,
    projectId: project.id,
    status: "idle",
  });
  const second = seedThread(harness.deps, {
    environmentId: environment.id,
    projectId: project.id,
    status: "idle",
  });
  return { environment, first, host, second, session };
}

function seedStampedTurn(
  harness: TestAppHarness,
  args: {
    createdAt: number;
    environmentId: string;
    providerThreadId: string;
    sequence: number;
    threadId: string;
    turnId: string;
  },
): void {
  for (const [offset, type] of [
    [0, "turn/started"],
    [1, "turn/completed"],
  ] as const) {
    seedStoredEvent(harness.deps, {
      threadId: args.threadId,
      environmentId: args.environmentId,
      providerThreadId: args.providerThreadId,
      createdAt: args.createdAt,
      sequence: args.sequence + offset,
      type,
      scope: turnScope(args.turnId),
      data:
        type === "turn/completed"
          ? { providerThreadId: args.providerThreadId, status: "completed" }
          : { providerThreadId: args.providerThreadId },
    });
  }
}

function seedArchivedConcurrentStartPair(
  harness: TestAppHarness,
  args: { environmentId: string; earlyId: string; lateId: string },
): void {
  seedThreadIdentity(harness.deps, {
    threadId: args.earlyId,
    environmentId: args.environmentId,
    providerThreadId: "01a03fb4-1bb9-session-a",
    createdAt: BATCH_AT,
    sequence: 3,
  });
  seedThreadIdentity(harness.deps, {
    threadId: args.lateId,
    environmentId: args.environmentId,
    providerThreadId: "01a03fb4-1c1a-session-b",
    createdAt: BATCH_AT,
    sequence: 3,
  });
  for (const threadId of [args.earlyId, args.lateId]) {
    seedThreadIdentity(harness.deps, {
      threadId,
      environmentId: args.environmentId,
      providerThreadId: "01a03fb4-1bb9-session-a",
      createdAt: BATCH_AT,
      sequence: 6,
    });
  }
  seedStampedTurn(harness, {
    createdAt: BATCH_AT + 119,
    environmentId: args.environmentId,
    providerThreadId: "01a03fb4-1c1a-session-b",
    sequence: 7,
    threadId: args.earlyId,
    turnId: "turn-early",
  });
  seedStampedTurn(harness, {
    createdAt: BATCH_AT + 119,
    environmentId: args.environmentId,
    providerThreadId: "01a03fb4-1bb9-session-a",
    sequence: 7,
    threadId: args.lateId,
    turnId: "turn-late",
  });
}

const CLEAR_COMMAND_INPUT: PromptInput[] = [
  {
    type: "text",
    text: "/clear",
    mentions: [
      {
        start: 0,
        end: "/clear".length,
        resource: {
          kind: "command",
          trigger: "/",
          name: "clear",
          source: "command",
          origin: "builtin",
          label: "clear",
          argumentHint: null,
        },
      },
    ],
  },
];

async function sendUserMessage(
  harness: TestAppHarness,
  args: {
    environment: Parameters<typeof sendThreadMessage>[1]["environment"];
    input?: PromptInput[];
    thread: Parameters<typeof sendThreadMessage>[1]["thread"];
  },
): Promise<void> {
  await sendThreadMessage(harness.deps, {
    environment: args.environment,
    payload: {
      input: args.input ?? textInput("continue"),
      mode: "start",
      model: "gpt-5",
      permissionMode: "full",
      reasoningLevel: "medium",
      serviceTier: "default",
    },
    thread: args.thread,
    trigger: "user",
  });
}

async function expectProviderSessionUnavailable(
  promise: Promise<unknown>,
  details: Record<string, unknown>,
): Promise<void> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(ApiError);
  if (!(error instanceof ApiError)) {
    return;
  }
  expect(error.status).toBe(409);
  expect(error.body).toMatchObject({
    code: "provider_session_unavailable",
    details,
  });
  expect(error.body.message).toContain(
    "Clear context (/clear or bb thread clear) for a new session; history is kept.",
  );
}

describe("provider session ownership on dispatch", () => {
  it("resumes a thread into its own session when later events carry another thread's session", async () => {
    await withTestHarness(async (harness) => {
      const {
        environment,
        first: owner,
        second: contaminated,
      } = seedThreads(harness);
      seedThreadIdentity(harness.deps, {
        threadId: owner.id,
        environmentId: environment.id,
        providerThreadId: FOREIGN_SESSION,
        createdAt: BATCH_AT,
        sequence: 1,
      });
      seedThreadRuntimeState(harness.deps, {
        environmentId: environment.id,
        providerThreadId: OWN_SESSION,
        threadId: contaminated.id,
      });
      seedStampedTurn(harness, {
        createdAt: BATCH_AT + 600_000,
        environmentId: environment.id,
        providerThreadId: FOREIGN_SESSION,
        sequence: 3,
        threadId: contaminated.id,
        turnId: "turn-contaminated",
      });
      seedThreadIdentity(harness.deps, {
        threadId: contaminated.id,
        environmentId: environment.id,
        providerThreadId: FOREIGN_SESSION,
        createdAt: BATCH_AT + 900_000,
        sequence: 5,
      });

      await sendUserMessage(harness, { environment, thread: contaminated });

      const queued = await waitForQueuedCommand(
        harness,
        (candidate) =>
          candidate.command.type === "turn.submit" &&
          candidate.command.threadId === contaminated.id,
      );
      expect(queued.command).toMatchObject({
        type: "turn.submit",
        resumeContext: { providerThreadId: OWN_SESSION },
      });
      expect(
        listQueuedThreadCommands(harness, "thread.start", contaminated.id),
      ).toHaveLength(0);
    });
  });

  it("refuses to resume a thread whose only session another thread claimed first, and starts fresh after /clear", async () => {
    await withTestHarness(async (harness) => {
      const {
        environment,
        first: owner,
        host,
        second: contaminated,
        session,
      } = seedThreads(harness);
      seedThreadIdentity(harness.deps, {
        threadId: owner.id,
        environmentId: environment.id,
        providerThreadId: FOREIGN_SESSION,
        createdAt: BATCH_AT,
        sequence: 1,
      });
      seedThreadIdentity(harness.deps, {
        threadId: contaminated.id,
        environmentId: environment.id,
        providerThreadId: FOREIGN_SESSION,
        createdAt: BATCH_AT + 140,
        sequence: 1,
      });
      const responder = registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: ({ command }) => {
          switch (command.type) {
            case "thread.stop":
              return { ok: true, result: { providerCheckpointId: null } };
            case "thread.start":
              return {
                ok: true,
                result: { providerThreadId: "session-fresh" },
              };
            case "turn.submit":
              return { ok: true, result: { appliedAs: "new-turn" } };
            case "host.list_files":
              return { ok: true, result: { files: [], truncated: false } };
            case "host.read_file":
              return {
                ok: false,
                errorCode: "ENOENT",
                errorMessage: "Missing",
              };
            default:
              throw new Error(`Unexpected command: ${command.type}`);
          }
        },
      });
      const eventsBefore = listEvents(harness.db, {
        threadId: contaminated.id,
      });

      await expectProviderSessionUnavailable(
        sendUserMessage(harness, { environment, thread: contaminated }),
        {
          reason: "foreign",
          providerThreadId: FOREIGN_SESSION,
          claimantThreadIds: [owner.id],
        },
      );
      expect(listEvents(harness.db, { threadId: contaminated.id })).toEqual(
        eventsBefore,
      );
      expect(
        responder.requests.filter(
          ({ command }) =>
            "threadId" in command && command.threadId === contaminated.id,
        ),
      ).toEqual([]);

      await sendUserMessage(harness, {
        environment,
        input: CLEAR_COMMAND_INPUT,
        thread: contaminated,
      });
      await sendUserMessage(harness, { environment, thread: contaminated });
      const dispatchedFor = (threadId: string) =>
        responder.requests
          .map(({ command }) => command)
          .filter(
            (command) =>
              (command.type === "thread.start" ||
                command.type === "turn.submit") &&
              command.threadId === threadId,
          );
      await vi.waitFor(() => {
        expect(dispatchedFor(contaminated.id)).toHaveLength(1);
      });
      expect(dispatchedFor(contaminated.id)[0]).toMatchObject({
        type: "thread.start",
      });

      await sendUserMessage(harness, { environment, thread: owner });
      await vi.waitFor(() => {
        expect(dispatchedFor(owner.id)).toEqual([
          expect.objectContaining({
            type: "turn.submit",
            resumeContext: expect.objectContaining({
              providerThreadId: FOREIGN_SESSION,
            }),
          }),
        ]);
      });
      responder.unregister();
    });
  });

  it("refuses both threads of a same-millisecond claim without dispatching or rewriting history", async () => {
    await withTestHarness(async (harness) => {
      const { environment, first: early, second: late } = seedThreads(harness);
      seedArchivedConcurrentStartPair(harness, {
        environmentId: environment.id,
        earlyId: early.id,
        lateId: late.id,
      });
      const earlyEvents = listEvents(harness.db, { threadId: early.id });
      const lateEvents = listEvents(harness.db, { threadId: late.id });

      await expectProviderSessionUnavailable(
        sendUserMessage(harness, { environment, thread: early }),
        {
          reason: "ambiguous",
          providerThreadId: "01a03fb4-1bb9-session-a",
          claimantThreadIds: [late.id],
        },
      );
      await expectProviderSessionUnavailable(
        sendUserMessage(harness, { environment, thread: late }),
        {
          reason: "ambiguous",
          providerThreadId: "01a03fb4-1bb9-session-a",
          claimantThreadIds: [early.id],
        },
      );
      for (const type of ["thread.start", "turn.submit"] as const) {
        for (const threadId of [early.id, late.id]) {
          expect(listQueuedThreadCommands(harness, type, threadId)).toEqual([]);
        }
      }
      expect(listEvents(harness.db, { threadId: early.id })).toEqual(
        earlyEvents,
      );
      expect(listEvents(harness.db, { threadId: late.id })).toEqual(lateEvents);
    });
  });

  it("records the refusal on a queued message instead of starting a new session", async () => {
    await withTestHarness(async (harness) => {
      const { environment, first: early, second: late } = seedThreads(harness);
      seedArchivedConcurrentStartPair(harness, {
        environmentId: environment.id,
        earlyId: early.id,
        lateId: late.id,
      });
      const queued = seedQueuedMessage(harness.deps, {
        threadId: early.id,
        content: textInput("Queued follow-up"),
      });

      await runQueuedMessageDispatch(harness.deps, {
        kind: "thread-ready",
        threadId: early.id,
      });

      const [row] = listQueuedThreadMessages(harness.db, early.id);
      expect(row?.id).toBe(queued.id);
      expect(row?.failureReason).toBe(
        "Another thread claimed this thread's provider session in the same millisecond, so bb will not guess whose it is. Clear context (/clear or bb thread clear) for a new session; history is kept.",
      );
      for (const type of ["thread.start", "turn.submit"] as const) {
        expect(listQueuedThreadCommands(harness, type, early.id)).toEqual([]);
      }
    });
  });
});
