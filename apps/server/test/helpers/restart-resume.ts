import { setExperiments } from "@bb/db";
import {
  queuedMessageWaitingOnSchema,
  threadScope,
  turnScope,
} from "@bb/domain";
import {
  seedEnvironment,
  seedProjectWithSource,
  seedStoredEvent,
  seedThread,
  seedThreadRuntimeState,
  seedTurnStarted,
} from "./seed.js";
import type { TestAppHarness } from "./test-app.js";

export const ACTIVE_TURN_ID = "turn-1";

export function enableRestartContinuation(harness: TestAppHarness): void {
  setExperiments(harness.db, { continueThreadsAfterRestarts: true });
}

export function seedThreadOnHost(
  harness: TestAppHarness,
  hostId: string,
  status: "idle" | "active",
) {
  const { project } = seedProjectWithSource(harness.deps, { hostId });
  const environment = seedEnvironment(harness.deps, {
    hostId,
    projectId: project.id,
    path: `/tmp/restart-resume-${project.id}`,
  });
  const thread = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    status,
  });
  seedThreadRuntimeState(harness.deps, {
    threadId: thread.id,
    environmentId: environment.id,
    providerThreadId: `provider-${thread.id}`,
  });
  if (status === "active") {
    seedTurnStarted(harness.deps, {
      environmentId: environment.id,
      providerThreadId: `provider-${thread.id}`,
      sequence: 3,
      threadId: thread.id,
      turnId: ACTIVE_TURN_ID,
    });
  }
  return { environment, thread };
}

export function seedCommand(
  harness: TestAppHarness,
  args: { command: string; environmentId: string; threadId: string },
) {
  seedStoredEvent(harness.deps, {
    threadId: args.threadId,
    environmentId: args.environmentId,
    scope: turnScope(ACTIVE_TURN_ID),
    providerThreadId: `provider-${args.threadId}`,
    itemId: "command-open",
    itemKind: "commandExecution",
    sequence: 10,
    type: "item/started",
    data: {
      item: {
        id: "command-open",
        type: "commandExecution",
        command: args.command,
        cwd: "/tmp/project",
        status: "inProgress",
        approvalStatus: null,
      },
    },
  });
}

export function seedBackgroundJob(
  harness: TestAppHarness,
  args: {
    description: string;
    environmentId: string;
    taskType: "local_agent" | "local_bash";
    threadId: string;
  },
) {
  const item = {
    id: "task:job",
    type: "backgroundTask",
    taskType: args.taskType,
    description: args.description,
    status: "pending",
    taskStatus: "running",
    skipTranscript: false,
    foreground: false,
  };
  const base = {
    threadId: args.threadId,
    environmentId: args.environmentId,
    providerThreadId: `provider-${args.threadId}`,
    itemId: item.id,
    itemKind: "backgroundTask" as const,
    data: { providerThreadId: `provider-${args.threadId}`, item },
  };
  seedStoredEvent(harness.deps, {
    ...base,
    scope: turnScope("turn-job"),
    sequence: 20,
    type: "item/started",
  });
  seedStoredEvent(harness.deps, {
    ...base,
    scope: threadScope(),
    sequence: 21,
    type: "item/backgroundTask/progress",
  });
}

export function finishBackgroundJob(
  harness: TestAppHarness,
  args: { environmentId: string; threadId: string },
) {
  seedStoredEvent(harness.deps, {
    threadId: args.threadId,
    environmentId: args.environmentId,
    providerThreadId: `provider-${args.threadId}`,
    itemId: "task:job",
    itemKind: "backgroundTask",
    scope: threadScope(),
    sequence: 22,
    type: "item/backgroundTask/completed",
    data: {
      providerThreadId: `provider-${args.threadId}`,
      item: {
        id: "task:job",
        type: "backgroundTask",
        taskType: "local_agent",
        description: "done",
        status: "completed",
        taskStatus: "completed",
        skipTranscript: false,
        foreground: false,
      },
    },
  });
}

export function sendText(
  harness: TestAppHarness,
  threadId: string,
  text: string,
) {
  return harness.app.request(`/api/v1/threads/${threadId}/send`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      input: [{ type: "text", text, mentions: [] }],
      mode: "steer-if-active",
      model: "gpt-5",
      permissionMode: "full",
      reasoningLevel: "medium",
      serviceTier: "default",
    }),
  });
}

export function waitingOnKind(row: { waitingOn: string | null }): string | null {
  return row.waitingOn === null
    ? null
    : queuedMessageWaitingOnSchema.parse(JSON.parse(row.waitingOn)).kind;
}
