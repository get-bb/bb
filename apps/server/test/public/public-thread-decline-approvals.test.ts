import { listQueuedThreadMessages } from "@bb/db";
import { ApiError } from "../../src/errors.js";
import type { PendingInteractionPayload } from "@bb/domain";
import { describe, expect, it, vi } from "vitest";
import {
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import {
  createCommandApprovalPayload,
  createUserQuestionPayload,
} from "../helpers/pending-interactions.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
  seedTurnStarted,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const PROVIDER_THREAD_ID = "provider-thread-decline";

function seedWaitingThread(harness: TestAppHarness, providerId = "codex") {
  const { host } = seedHostSession(harness.deps, { id: "host-decline" });
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    path: "/tmp/decline-project",
  });
  const thread = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    providerId,
    status: "active",
  });
  seedThreadRuntimeState(harness.deps, {
    environmentId: environment.id,
    providerThreadId: PROVIDER_THREAD_ID,
    threadId: thread.id,
  });
  const register = (requestId: string, payload: PendingInteractionPayload) => {
    seedTurnStarted(harness.deps, {
      threadId: thread.id,
      turnId: "turn-waiting",
      providerThreadId: PROVIDER_THREAD_ID,
    });
    const registered =
      harness.deps.pendingInteractions.registerPendingInteraction({
        interaction: {
          threadId: thread.id,
          turnId: "turn-waiting",
          providerId,
          providerThreadId: PROVIDER_THREAD_ID,
          providerRequestId: requestId,
          payload,
        },
      });
    if (registered.outcome === "rejected") {
      throw new Error(`Interaction registration failed: ${registered.reason}`);
    }
    return registered.interaction;
  };
  const send = (body: Record<string, unknown>) =>
    harness.app.request(`/api/v1/threads/${thread.id}/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        input: [{ type: "text", text: "Do not push. Open a draft PR." }],
        ...body,
      }),
    });
  const interactionStatus = async (id: string) =>
    (await readJson(
      await harness.app.request(
        `/api/v1/threads/${thread.id}/interactions/${id}`,
      ),
    )) as { status: string; resolution: unknown };
  return { thread, register, send, interactionStatus };
}

function commandApproval(itemId: string) {
  return createCommandApprovalPayload({
    itemId,
    reason: "Approve command",
    command: "git push --force",
    cwd: "/tmp/decline-project",
  });
}

describe("send with declinePendingApprovals", () => {
  it("denies every pending approval and delivers the message once they resolve", async () => {
    await withTestHarness(async (harness) => {
      const { thread, register, send, interactionStatus } =
        seedWaitingThread(harness);
      const first = register("request-1", commandApproval("item-1"));
      const second = register("request-2", commandApproval("item-2"));

      const response = await send({
        mode: "steer-if-active",
        declinePendingApprovals: true,
      });
      expect(
        response.status,
        JSON.stringify(await readJson(response.clone())),
      ).toBe(200);
      await expect(readJson(response)).resolves.toMatchObject({
        delivery: "queued",
        queuedMessage: { waitingOn: { kind: "interaction" } },
      });
      for (const interaction of [first, second]) {
        await expect(interactionStatus(interaction.id)).resolves.toMatchObject({
          status: "resolving",
          resolution: { decision: "deny" },
        });
      }

      for (const interaction of [first, second]) {
        const denyCommand = await waitForQueuedCommand(
          harness,
          ({ command }) =>
            command.type === "interactive.resolve" &&
            command.interactionId === interaction.id,
        );
        expect(
          (await reportQueuedCommandSuccess(harness, denyCommand, {})).status,
        ).toBe(200);
      }

      const redirect = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "turn.submit" &&
          JSON.stringify(command.input).includes("Open a draft PR"),
      );
      expect(redirect.command).toMatchObject({
        type: "turn.submit",
        threadId: thread.id,
      });
      await expect
        .poll(() => listQueuedThreadMessages(harness.db, thread.id).length)
        .toBe(0);
    });
  });

  it("leaves approvals pending without the flag", async () => {
    await withTestHarness(async (harness) => {
      const { register, send, interactionStatus } = seedWaitingThread(harness);
      const approval = register("request-1", commandApproval("item-1"));
      const response = await send({ mode: "steer-if-active" });
      expect(response.status).toBe(200);
      await expect(interactionStatus(approval.id)).resolves.toMatchObject({
        status: "pending",
      });
    });
  });

  it("refuses while a question is pending and declines nothing", async () => {
    await withTestHarness(async (harness) => {
      const { thread, register, send, interactionStatus } =
        seedWaitingThread(harness);
      const approval = register("request-1", commandApproval("item-1"));
      register("request-2", createUserQuestionPayload());
      const response = await send({
        mode: "steer-if-active",
        declinePendingApprovals: true,
      });
      expect(response.status).toBe(409);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "awaiting_user_interaction",
      });
      await expect(interactionStatus(approval.id)).resolves.toMatchObject({
        status: "pending",
      });
      expect(listQueuedThreadMessages(harness.db, thread.id)).toHaveLength(0);
    });
  });

  it("declines nothing when the send fails before it queues", async () => {
    await withTestHarness(async (harness) => {
      const { register, send, interactionStatus } = seedWaitingThread(
        harness,
        "pi",
      );
      const approval = register("request-1", commandApproval("item-1"));
      const response = await send({
        mode: "steer-if-active",
        declinePendingApprovals: true,
        model: "openai/codex-mini",
        permissionMode: "workspace-write",
      });
      expect(response.status).toBe(400);
      await expect(readJson(response)).resolves.toMatchObject({
        message: "Provider pi only supports full permission mode.",
      });
      await expect(interactionStatus(approval.id)).resolves.toMatchObject({
        status: "pending",
      });
    });
  });

  it("refuses an approval that offers no deny decision and declines nothing", async () => {
    await withTestHarness(async (harness) => {
      const { register, send, interactionStatus } = seedWaitingThread(harness);
      const first = register("request-1", commandApproval("item-1"));
      register(
        "request-2",
        createCommandApprovalPayload({
          itemId: "item-2",
          command: "make deploy",
          availableDecisions: ["allow_once"],
        }),
      );
      const response = await send({
        mode: "steer-if-active",
        declinePendingApprovals: true,
      });
      expect(response.status).toBe(409);
      await expect(interactionStatus(first.id)).resolves.toMatchObject({
        status: "pending",
      });
    });
  });

  it("still queues the message when one approval was answered in the meantime", async () => {
    await withTestHarness(async (harness) => {
      const { thread, register, send, interactionStatus } =
        seedWaitingThread(harness);
      const allowed = register("request-1", commandApproval("item-1"));
      const other = register("request-2", commandApproval("item-2"));
      const resolve =
        harness.deps.pendingInteractions.resolvePendingInteraction.bind(
          harness.deps.pendingInteractions,
        );
      vi.spyOn(
        harness.deps.pendingInteractions,
        "resolvePendingInteraction",
      ).mockImplementation((args) => {
        if (args.interactionId === allowed.id) {
          resolve({
            threadId: args.threadId,
            interactionId: allowed.id,
            resolution: { decision: "allow_once", grantedPermissions: null },
          });
          return resolve(args);
        }
        return resolve(args);
      });
      const response = await send({
        mode: "steer-if-active",
        declinePendingApprovals: true,
      });
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toMatchObject({
        delivery: "queued",
      });
      await expect(interactionStatus(allowed.id)).resolves.toMatchObject({
        resolution: { decision: "allow_once" },
      });
      await expect(interactionStatus(other.id)).resolves.toMatchObject({
        status: "resolving",
        resolution: { decision: "deny" },
      });
      expect(listQueuedThreadMessages(harness.db, thread.id)).toHaveLength(1);
    });
  });

  it("fails the send when declining fails for a reason other than a lost race", async () => {
    await withTestHarness(async (harness) => {
      const { register, send, interactionStatus } = seedWaitingThread(harness);
      const approval = register("request-1", commandApproval("item-1"));
      vi.spyOn(
        harness.deps.pendingInteractions,
        "resolvePendingInteraction",
      ).mockImplementation(() => {
        throw new ApiError(502, "host_unavailable", "Host is not connected");
      });
      const response = await send({
        mode: "steer-if-active",
        declinePendingApprovals: true,
      });
      expect(response.status).toBe(502);
      await expect(interactionStatus(approval.id)).resolves.toMatchObject({
        status: "pending",
      });
    });
  });

  it.each([
    ["compactFirst", { mode: "steer-if-active", compactFirst: true }],
    ["sendAt", { mode: "steer-if-active", sendAt: Date.now() + 60_000 }],
    ["mode start", { mode: "start" }],
    ["mode queue-if-active", { mode: "queue-if-active" }],
  ])("rejects declinePendingApprovals with %s", async (_, body) => {
    await withTestHarness(async (harness) => {
      const { register, send, interactionStatus } = seedWaitingThread(harness);
      const approval = register("request-1", commandApproval("item-1"));
      const response = await send({ ...body, declinePendingApprovals: true });
      expect(response.status).toBe(400);
      await expect(interactionStatus(approval.id)).resolves.toMatchObject({
        status: "pending",
      });
    });
  });
});
