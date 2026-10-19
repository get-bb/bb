import { describe, expect, it, vi } from "vitest";
import { groupHostDaemonEvents } from "@bb/host-daemon-contract";
import type { HostDaemonEventEnvelope } from "@bb/host-daemon-contract";
import { getEnvironment, getThread } from "@bb/db";
import {
  isServerPendingInteraction,
  turnScope,
  type RecordedPermissionMode,
} from "@bb/domain";
import {
  internalAuthHeaders,
  listQueuedThreadCommands,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { registerHostRpcResponder } from "../helpers/host-rpc.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedEvent,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
  seedTurnPermissionMode,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const TURN_ID = "turn-move";
const PROVIDER_THREAD_ID = "provider-move";

interface ResolvedFixturePath {
  gitCommonDir: string | null;
  realPath: string | null;
}

async function setupMove(
  harness: TestAppHarness,
  args: {
    permissionMode: RecordedPermissionMode;
    resolved: Record<string, ResolvedFixturePath> | null;
  },
) {
  const { host, session } = seedHostSession(harness.deps);
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: "/proj/app",
  });
  const currentEnvironment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    path: "/proj/app",
    environmentProviderId: "project-checkout",
  });
  const thread = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: currentEnvironment.id,
    providerId: "codex",
    status: "active",
  });
  seedThreadRuntimeState(harness.deps, {
    environmentId: currentEnvironment.id,
    providerThreadId: PROVIDER_THREAD_ID,
    threadId: thread.id,
  });
  seedEvent(harness.deps, {
    threadId: thread.id,
    environmentId: currentEnvironment.id,
    providerThreadId: PROVIDER_THREAD_ID,
    sequence: 3,
    type: "turn/started",
    scope: turnScope(TURN_ID),
    data: { providerThreadId: PROVIDER_THREAD_ID },
  });
  seedTurnPermissionMode(harness.deps, {
    environmentId: currentEnvironment.id,
    permissionMode: args.permissionMode,
    providerThreadId: PROVIDER_THREAD_ID,
    threadId: thread.id,
    turnId: TURN_ID,
  });
  const resolved = args.resolved;
  if (resolved !== null) {
    registerHostRpcResponder(harness, {
      hostId: host.id,
      sessionId: session.id,
      restoreCommandCaptureAfterResponse: true,
      handle: (request) => {
        if (request.command.type !== "host.resolve_directories") {
          throw new Error(`Unexpected RPC ${request.command.type}`);
        }
        return {
          ok: true,
          result: {
            entries: request.command.paths.map((path) => ({
              path,
              realPath: resolved[path]?.realPath ?? null,
              gitCommonDir: resolved[path]?.gitCommonDir ?? null,
            })),
          },
        };
      },
    });
  }
  return { currentEnvironment, session, thread };
}

function postMove(
  harness: TestAppHarness,
  args: { path: string; sessionId: string; threadId: string },
): Promise<Response> {
  return harness.app.request("/internal/session/tool-call", {
    method: "POST",
    headers: internalAuthHeaders(harness),
    body: JSON.stringify({
      sessionId: args.sessionId,
      threadId: args.threadId,
      providerThreadId: PROVIDER_THREAD_ID,
      turnId: TURN_ID,
      callId: "call-move",
      tool: "update_environment_directory",
      arguments: { path: args.path },
    }),
  });
}

async function completeTurn(
  harness: TestAppHarness,
  args: { sessionId: string; threadId: string },
): Promise<void> {
  const events: HostDaemonEventEnvelope[] = [
    {
      threadId: args.threadId,
      event: {
        type: "turn/completed",
        threadId: args.threadId,
        providerThreadId: PROVIDER_THREAD_ID,
        scope: turnScope(TURN_ID),
        status: "completed",
      },
    },
  ];
  const response = await harness.app.request("/internal/session/events", {
    method: "POST",
    headers: internalAuthHeaders(harness),
    body: JSON.stringify({
      sessionId: args.sessionId,
      eventGroups: groupHostDaemonEvents(events),
    }),
  });
  expect(response.status).toBe(200);
}

function resolveMove(
  harness: TestAppHarness,
  args: {
    decision: "allow_once" | "deny";
    interactionId: string;
    threadId: string;
  },
): Promise<Response> {
  return harness.app.request(
    `/api/v1/threads/${args.threadId}/interactions/${args.interactionId}/resolve`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        args.decision === "deny"
          ? { decision: "deny" }
          : { decision: "allow_once", grantedPermissions: null },
      ),
    },
  );
}

function pendingMoveApproval(harness: TestAppHarness, threadId: string) {
  const pending = harness.deps.pendingInteractions
    .listPendingThreadInteractions(threadId)
    .filter(isServerPendingInteraction);
  expect(pending).toHaveLength(1);
  return pending[0]!;
}

const OUTSIDE = "/tmp/outside";
const PROJECT_PATHS: Record<string, ResolvedFixturePath> = {
  "/proj/app": { realPath: "/proj/app", gitCommonDir: "/proj/app/.git" },
};

describe("update_environment_directory approval", () => {
  it.each(["allow_once", "deny"] as const)(
    "waits for approval before moving outside the project in Accept edits (%s)",
    async (decision) => {
      await withTestHarness(async (harness) => {
        const { currentEnvironment, session, thread } = await setupMove(
          harness,
          {
            permissionMode: "accept-edits",
            resolved: {
              ...PROJECT_PATHS,
              [OUTSIDE]: { realPath: OUTSIDE, gitCommonDir: null },
            },
          },
        );

        const response = await postMove(harness, {
          path: OUTSIDE,
          sessionId: session.id,
          threadId: thread.id,
        });
        expect(response.status).toBe(200);
        await expect(readJson(response)).resolves.toMatchObject({
          success: true,
          contentItems: [
            {
              type: "inputText",
              text: expect.stringContaining("needs the user's approval"),
            },
          ],
        });
        expect(getThread(harness.db, thread.id)?.environmentId).toBe(
          currentEnvironment.id,
        );
        const approval = pendingMoveApproval(harness, thread.id);
        expect(approval.request).toMatchObject({
          kind: "environment_directory_move",
          path: OUTSIDE,
          requestTurnId: TURN_ID,
        });

        const sameTurn = await resolveMove(harness, {
          decision,
          interactionId: approval.id,
          threadId: thread.id,
        });
        expect(sameTurn.status).toBe(409);

        await completeTurn(harness, {
          sessionId: session.id,
          threadId: thread.id,
        });
        const resolved = await resolveMove(harness, {
          decision,
          interactionId: approval.id,
          threadId: thread.id,
        });
        expect(resolved.status).toBe(200);

        if (decision === "allow_once") {
          const attach = await waitForQueuedCommand(
            harness,
            ({ command }) =>
              command.type === "environment.attach" && command.path === OUTSIDE,
          );
          await reportQueuedCommandSuccess(harness, attach, {
            path: OUTSIDE,
            isGitRepo: false,
            isWorktree: false,
            branchName: null,
            defaultBranch: null,
            transcript: [],
          });
        }

        await vi.waitFor(() =>
          expect(
            listQueuedThreadCommands(harness, "turn.submit", thread.id),
          ).toHaveLength(1),
        );
        const [submit] = listQueuedThreadCommands(
          harness,
          "turn.submit",
          thread.id,
        );
        const environment = getEnvironment(
          harness.db,
          getThread(harness.db, thread.id)?.environmentId ?? "",
        );
        if (decision === "allow_once") {
          expect(environment?.path).toBe(OUTSIDE);
          expect(JSON.stringify(submit)).toContain(
            "Environment directory updated to /tmp/outside",
          );
        } else {
          expect(environment?.id).toBe(currentEnvironment.id);
          expect(JSON.stringify(submit)).toContain(
            "denied moving this thread to /tmp/outside",
          );
        }
      });
    },
  );

  it.each([
    {
      name: "a worktree of the project's repo in Accept edits",
      permissionMode: "accept-edits" as const,
      path: "/proj/app-feature",
      resolved: {
        ...PROJECT_PATHS,
        "/proj/app-feature": {
          realPath: "/proj/app-feature",
          gitCommonDir: "/proj/app/.git",
        },
      },
    },
    {
      name: "any directory in Auto",
      permissionMode: "auto" as const,
      path: OUTSIDE,
      resolved: null,
    },
  ])(
    "moves without asking: $name",
    async ({ path, permissionMode, resolved }) => {
      await withTestHarness(async (harness) => {
        const { session, thread } = await setupMove(harness, {
          permissionMode,
          resolved,
        });

        const responsePromise = postMove(harness, {
          path,
          sessionId: session.id,
          threadId: thread.id,
        });
        const attach = await waitForQueuedCommand(
          harness,
          ({ command }) =>
            command.type === "environment.attach" && command.path === path,
        );
        await reportQueuedCommandSuccess(harness, attach, {
          path,
          isGitRepo: true,
          isWorktree: true,
          branchName: "feature",
          defaultBranch: "main",
          transcript: [],
        });
        const response = await responsePromise;
        await expect(readJson(response)).resolves.toMatchObject({
          success: true,
        });
        expect(
          getEnvironment(
            harness.db,
            getThread(harness.db, thread.id)?.environmentId ?? "",
          )?.path,
        ).toBe(path);
        expect(
          harness.deps.pendingInteractions
            .listPendingThreadInteractions(thread.id)
            .filter(isServerPendingInteraction),
        ).toHaveLength(0);
      });
    },
  );

  it("asks when a path inside the project is a symlink to somewhere else", async () => {
    await withTestHarness(async (harness) => {
      const { currentEnvironment, session, thread } = await setupMove(harness, {
        permissionMode: "accept-edits",
        resolved: {
          ...PROJECT_PATHS,
          "/proj/app/home": { realPath: "/home/user", gitCommonDir: null },
        },
      });

      const response = await postMove(harness, {
        path: "/proj/app/home",
        sessionId: session.id,
        threadId: thread.id,
      });
      expect(response.status).toBe(200);
      expect(getThread(harness.db, thread.id)?.environmentId).toBe(
        currentEnvironment.id,
      );
      expect(pendingMoveApproval(harness, thread.id).request.path).toBe(
        "/home/user",
      );
    });
  });
});
