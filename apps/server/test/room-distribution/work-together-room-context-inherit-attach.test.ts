import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

import {
  admitWorkTogetherRoomContext,
  createHostId,
  environments,
  getThread,
  getWorkTogetherRoomStreamContext,
  listEvents,
  threads,
} from "@bb/db";
import {
  encodeClientTurnRequestIdNumber,
  SYSTEM_ACTOR_STAMP,
  turnRequestEventDataSchema,
  type Principal,
  type PromptInput,
} from "@bb/domain";
import { describe, expect, it } from "vitest";

import { createBindingBackedRoomDistributionV1 } from "../../src/room-distribution/binding-backed-room-distribution.js";
import {
  createWorkTogetherRoomResourceProvisioner,
  type WorkTogetherRoomResourceTarget,
} from "../../src/room-distribution/room-resource-provisioner.js";
import type { RoomDistributionContextV1 } from "../../src/room-distribution/room-distribution-port.js";
import type { WorkTogetherRoomChildAttachmentPortV1 } from "../../src/room-distribution/work-together-room-child-attachments.js";
import { admitQueueIfActiveSendMessage } from "../../src/services/threads/admitted-send.js";
import { createThreadFromRequest } from "../../src/services/threads/thread-create.js";
import { waitForQueuedCommand } from "../helpers/commands.js";
import { seedHostSession, seedThread } from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const ALICE: Principal = Object.freeze({
  id: "user_alice_room_context_inherit",
  kind: "human",
  displayName: "Alice",
});
const NO_CHILDREN: WorkTogetherRoomChildAttachmentPortV1 = Object.freeze({
  attach: async () => {
    throw new Error("unexpected child attachment");
  },
  list: async () => Object.freeze([]),
});

function contextFor(bindingId: string): RoomDistributionContextV1 {
  return Object.freeze({
    bindingId,
    principal: ALICE,
    authorize: async () => ({ allowed: true as const }),
  });
}

function opaqueEnvelope(text: string) {
  const bytes = Buffer.from(text, "utf8");
  return {
    bytes,
    digest: createHash("sha256").update(bytes).digest("hex"),
    text,
  };
}

/** Timeline/chat view omits agent-only parts — same rule as thread-view. */
function visiblePromptText(input: readonly PromptInput[]): string {
  return input
    .filter(
      (item): item is Extract<PromptInput, { type: "text" }> =>
        item.type === "text" && item.visibility !== "agent-only",
    )
    .map((item) => item.text)
    .join("");
}

function target(
  harness: TestAppHarness,
  seed: number,
): WorkTogetherRoomResourceTarget {
  const { host } = seedHostSession(harness.deps, { id: createHostId() });
  return {
    bbHostId: host.id,
    dataDir: `/tmp/bb-host-data/${host.id}`,
    projectName: `Room Inherit ${seed}`,
    providerId: "codex",
    sourcePath: `/srv/work-together/inherit-${seed}`,
  };
}

async function provisionRoom(harness: TestAppHarness, seed: number) {
  const launch = {
    bindingId: randomUUID(),
    workspaceId: randomUUID(),
    taskId: randomUUID(),
    cellId: randomUUID(),
    workKind: "conversation" as const,
    candidateHostId: randomUUID(),
    environmentTemplate: "isolated-scratch" as const,
  };
  const resourceTarget = target(harness, seed);
  const provisioned = await createWorkTogetherRoomResourceProvisioner(
    harness.deps,
    {
      resolveHost: () => resourceTarget,
      resolve: () => resourceTarget,
    },
  ).provision({ principal: ALICE, launch });
  harness.db
    .update(environments)
    .set({ path: `/tmp/room-inherit-${seed}`, status: "ready" })
    .where(eq(environments.id, provisioned.environmentId))
    .run();
  harness.db
    .update(threads)
    .set({ status: "idle" })
    .where(eq(threads.id, provisioned.primaryThreadId))
    .run();
  return { launch, provisioned };
}

function agentOnlyTexts(input: readonly PromptInput[]): string[] {
  return input
    .filter(
      (item): item is Extract<PromptInput, { type: "text" }> =>
        item.type === "text" && item.visibility === "agent-only",
    )
    .map((item) => item.text);
}

function turnRequestInputForRequestId(
  harness: TestAppHarness,
  threadId: string,
  requestId: string,
): PromptInput[] {
  const event = listEvents(harness.db, { threadId }).find((row) => {
    if (row.type !== "client/turn/requested") return false;
    const data = turnRequestEventDataSchema.parse(JSON.parse(row.data));
    return data.requestId === requestId;
  });
  expect(event).toBeDefined();
  return turnRequestEventDataSchema.parse(JSON.parse(event!.data)).input;
}

async function createRoomChild(
  harness: TestAppHarness,
  args: {
    parentThreadId: string;
    projectId: string;
    prompt?: string;
  },
) {
  return createThreadFromRequest(harness.deps, {
    environment: { type: "project-default" },
    input:
      args.prompt === undefined
        ? []
        : [{ type: "text", text: args.prompt, mentions: [] }],
    origin: "sdk",
    parentThreadId: args.parentThreadId,
    projectId: args.projectId,
    providerId: "codex",
    startedOnBehalfOf: null,
  });
}

function distribution(harness: TestAppHarness) {
  return createBindingBackedRoomDistributionV1(
    harness.deps,
    { read: async () => ({ title: "Inherit task" }) },
    NO_CHILDREN,
    { read: async () => ({ role: "owner", isTaskAssignee: false }) },
  );
}

describe("GW-04 Room context inherit + non-chat attach", () => {
  it("records the applied pair on child create and attaches exact bytes on first turn", async () => {
    await withTestHarness(async (harness) => {
      const room = await provisionRoom(harness, 901);
      const envelope = opaqueEnvelope("inherited-room-context-v4");
      const apply = await createBindingBackedRoomDistributionV1(
        harness.deps,
        { read: async () => ({ title: "Inherit task" }) },
        NO_CHILDREN,
        { read: async () => ({ role: "owner", isTaskAssignee: false }) },
      ).execute(contextFor(room.launch.bindingId), {
        kind: "context.apply",
        requestId: "creq_23456789ca",
        stream: { kind: "primary" },
        contextVersion: 4,
        digest: envelope.digest,
        bytesBase64: envelope.bytes.toString("base64"),
      });
      expect(apply.status).toBe(202);

      const child = await createRoomChild(harness, {
        parentThreadId: room.provisioned.primaryThreadId,
        projectId: room.provisioned.projectId,
      });
      expect(getWorkTogetherRoomStreamContext(harness.db, child.id)).toEqual({
        bindingId: room.launch.bindingId,
        version: 4,
        digest: envelope.digest,
      });

      harness.db
        .update(threads)
        .set({ status: "idle" })
        .where(eq(threads.id, child.id))
        .run();
      const childThread = getThread(harness.db, child.id)!;
      const requestId = encodeClientTurnRequestIdNumber({ value: 901 });
      await admitQueueIfActiveSendMessage(harness.deps, {
        actor: SYSTEM_ACTOR_STAMP,
        payload: {
          input: [{ type: "text", text: "child first turn", mentions: [] }],
          mode: "queue-if-active",
        },
        requestId,
        thread: childThread,
      });

      const eventDataInput = turnRequestInputForRequestId(
        harness,
        child.id,
        requestId,
      );
      expect(agentOnlyTexts(eventDataInput)).toEqual([envelope.text]);
      expect(visiblePromptText(eventDataInput)).toBe("child first turn");

      const started = await waitForQueuedCommand(
        harness,
        (candidate) =>
          (candidate.command.type === "thread.start" ||
            candidate.command.type === "turn.submit") &&
          "threadId" in candidate.command &&
          candidate.command.threadId === child.id &&
          "requestId" in candidate.command &&
          candidate.command.requestId === requestId,
      );
      const commandInput =
        "input" in started.command ? started.command.input : [];
      expect(agentOnlyTexts(commandInput)).toEqual([envelope.text]);
      expect(
        commandInput.some(
          (item) =>
            item.type === "text" &&
            item.visibility !== "agent-only" &&
            item.text === "child first turn",
        ),
      ).toBe(true);
    });
  });

  it("attaches current applied bytes on Primary message.send after apply", async () => {
    await withTestHarness(async (harness) => {
      const room = await provisionRoom(harness, 902);
      const envelope = opaqueEnvelope("primary-applied-context");
      await distribution(harness).execute(contextFor(room.launch.bindingId), {
        kind: "context.apply",
        requestId: "creq_23456789cb",
        stream: { kind: "primary" },
        contextVersion: 2,
        digest: envelope.digest,
        bytesBase64: envelope.bytes.toString("base64"),
      });

      const primary = getThread(harness.db, room.provisioned.primaryThreadId)!;
      const requestId = encodeClientTurnRequestIdNumber({ value: 902 });
      await admitQueueIfActiveSendMessage(harness.deps, {
        actor: SYSTEM_ACTOR_STAMP,
        payload: {
          input: [{ type: "text", text: "opening turn", mentions: [] }],
          mode: "queue-if-active",
        },
        requestId,
        thread: primary,
      });

      const eventDataInput = turnRequestInputForRequestId(
        harness,
        room.provisioned.primaryThreadId,
        requestId,
      );
      expect(agentOnlyTexts(eventDataInput)).toEqual([envelope.text]);
      expect(visiblePromptText(eventDataInput)).toBe("opening turn");
      expect(eventDataInput[0]).toMatchObject({
        visibility: "agent-only",
        text: envelope.text,
      });
      expect(
        eventDataInput.some(
          (item) =>
            item.type === "text" &&
            item.text === envelope.text &&
            item.visibility !== "agent-only",
        ),
      ).toBe(false);
    });
  });

  it("keeps the child frozen pair when Primary later refreshes", async () => {
    await withTestHarness(async (harness) => {
      const room = await provisionRoom(harness, 903);
      const first = opaqueEnvelope("child-frozen-v1");
      const roomDist = distribution(harness);
      await roomDist.execute(contextFor(room.launch.bindingId), {
        kind: "context.apply",
        requestId: "creq_23456789cc",
        stream: { kind: "primary" },
        contextVersion: 1,
        digest: first.digest,
        bytesBase64: first.bytes.toString("base64"),
      });
      const child = await createRoomChild(harness, {
        parentThreadId: room.provisioned.primaryThreadId,
        projectId: room.provisioned.projectId,
      });
      const second = opaqueEnvelope("primary-refresh-v2");
      await roomDist.execute(contextFor(room.launch.bindingId), {
        kind: "context.apply",
        requestId: "creq_23456789cd",
        stream: { kind: "primary" },
        contextVersion: 2,
        digest: second.digest,
        bytesBase64: second.bytes.toString("base64"),
      });
      expect(getWorkTogetherRoomStreamContext(harness.db, child.id)).toEqual({
        bindingId: room.launch.bindingId,
        version: 1,
        digest: first.digest,
      });

      harness.db
        .update(threads)
        .set({ status: "idle" })
        .where(eq(threads.id, child.id))
        .run();
      const requestId = encodeClientTurnRequestIdNumber({ value: 903 });
      await admitQueueIfActiveSendMessage(harness.deps, {
        actor: SYSTEM_ACTOR_STAMP,
        payload: {
          input: [{ type: "text", text: "after refresh", mentions: [] }],
          mode: "queue-if-active",
        },
        requestId,
        thread: getThread(harness.db, child.id)!,
      });
      expect(
        agentOnlyTexts(turnRequestInputForRequestId(harness, child.id, requestId)),
      ).toEqual([first.text]);
    });
  });

  it("nested grandchild inherits Room current at its create, not the parent child's frozen pair", async () => {
    await withTestHarness(async (harness) => {
      const room = await provisionRoom(harness, 905);
      const v1 = opaqueEnvelope("nested-room-v1");
      const roomDist = distribution(harness);
      await roomDist.execute(contextFor(room.launch.bindingId), {
        kind: "context.apply",
        requestId: "creq_23456789cf",
        stream: { kind: "primary" },
        contextVersion: 1,
        digest: v1.digest,
        bytesBase64: v1.bytes.toString("base64"),
      });
      const child = await createRoomChild(harness, {
        parentThreadId: room.provisioned.primaryThreadId,
        projectId: room.provisioned.projectId,
      });
      expect(getWorkTogetherRoomStreamContext(harness.db, child.id)).toEqual({
        bindingId: room.launch.bindingId,
        version: 1,
        digest: v1.digest,
      });

      const v2 = opaqueEnvelope("nested-room-v2");
      await roomDist.execute(contextFor(room.launch.bindingId), {
        kind: "context.apply",
        requestId: "creq_23456789cg",
        stream: { kind: "primary" },
        contextVersion: 2,
        digest: v2.digest,
        bytesBase64: v2.bytes.toString("base64"),
      });
      const grandchild = await createRoomChild(harness, {
        parentThreadId: child.id,
        projectId: room.provisioned.projectId,
      });
      expect(getWorkTogetherRoomStreamContext(harness.db, child.id)).toEqual({
        bindingId: room.launch.bindingId,
        version: 1,
        digest: v1.digest,
      });
      expect(getWorkTogetherRoomStreamContext(harness.db, grandchild.id)).toEqual(
        {
          bindingId: room.launch.bindingId,
          version: 2,
          digest: v2.digest,
        },
      );
    });
  });

  it("keeps in-flight Primary turn bytes when a later apply refreshes Room current", async () => {
    await withTestHarness(async (harness) => {
      const room = await provisionRoom(harness, 906);
      const v1 = opaqueEnvelope("inflight-primary-v1");
      const roomDist = distribution(harness);
      await roomDist.execute(contextFor(room.launch.bindingId), {
        kind: "context.apply",
        requestId: "creq_23456789ch",
        stream: { kind: "primary" },
        contextVersion: 1,
        digest: v1.digest,
        bytesBase64: v1.bytes.toString("base64"),
      });

      const primary = getThread(harness.db, room.provisioned.primaryThreadId)!;
      const inflightRequestId = encodeClientTurnRequestIdNumber({ value: 906 });
      await admitQueueIfActiveSendMessage(harness.deps, {
        actor: SYSTEM_ACTOR_STAMP,
        payload: {
          input: [{ type: "text", text: "in flight", mentions: [] }],
          mode: "queue-if-active",
        },
        requestId: inflightRequestId,
        thread: primary,
      });
      expect(
        agentOnlyTexts(
          turnRequestInputForRequestId(
            harness,
            room.provisioned.primaryThreadId,
            inflightRequestId,
          ),
        ),
      ).toEqual([v1.text]);

      const v2 = opaqueEnvelope("inflight-primary-v2");
      await roomDist.execute(contextFor(room.launch.bindingId), {
        kind: "context.apply",
        requestId: "creq_23456789ci",
        stream: { kind: "primary" },
        contextVersion: 2,
        digest: v2.digest,
        bytesBase64: v2.bytes.toString("base64"),
      });
      expect(
        agentOnlyTexts(
          turnRequestInputForRequestId(
            harness,
            room.provisioned.primaryThreadId,
            inflightRequestId,
          ),
        ),
      ).toEqual([v1.text]);

      harness.db
        .update(threads)
        .set({ status: "idle" })
        .where(eq(threads.id, room.provisioned.primaryThreadId))
        .run();
      const futureRequestId = encodeClientTurnRequestIdNumber({ value: 916 });
      await admitQueueIfActiveSendMessage(harness.deps, {
        actor: SYSTEM_ACTOR_STAMP,
        payload: {
          input: [{ type: "text", text: "after apply", mentions: [] }],
          mode: "queue-if-active",
        },
        requestId: futureRequestId,
        thread: getThread(harness.db, room.provisioned.primaryThreadId)!,
      });
      expect(
        agentOnlyTexts(
          turnRequestInputForRequestId(
            harness,
            room.provisioned.primaryThreadId,
            futureRequestId,
          ),
        ),
      ).toEqual([v2.text]);
    });
  });

  it("lets a GW-03 Room child create and send with no applied context", async () => {
    await withTestHarness(async (harness) => {
      const room = await provisionRoom(harness, 907);
      const child = await createRoomChild(harness, {
        parentThreadId: room.provisioned.primaryThreadId,
        projectId: room.provisioned.projectId,
      });
      expect(getWorkTogetherRoomStreamContext(harness.db, child.id)).toBeNull();

      harness.db
        .update(threads)
        .set({ status: "idle" })
        .where(eq(threads.id, child.id))
        .run();
      const requestId = encodeClientTurnRequestIdNumber({ value: 907 });
      await admitQueueIfActiveSendMessage(harness.deps, {
        actor: SYSTEM_ACTOR_STAMP,
        payload: {
          input: [{ type: "text", text: "gw03 child", mentions: [] }],
          mode: "queue-if-active",
        },
        requestId,
        thread: getThread(harness.db, child.id)!,
      });
      const input = turnRequestInputForRequestId(harness, child.id, requestId);
      expect(agentOnlyTexts(input)).toEqual([]);
      expect(visiblePromptText(input)).toBe("gw03 child");
    });
  });

  it("refuses a Room child send when apply exists but inherit was skipped", async () => {
    await withTestHarness(async (harness) => {
      const room = await provisionRoom(harness, 904);
      const envelope = opaqueEnvelope("must-inherit");
      admitWorkTogetherRoomContext(harness.db, {
        bindingId: room.launch.bindingId,
        requestId: "creq_23456789ce",
        contextVersion: 1,
        digest: envelope.digest,
        bytes: envelope.bytes,
        nowMs: Date.now(),
      });
      // Bypass createThreadFromRequest so inherit never runs.
      const orphan = seedThread(harness.deps, {
        projectId: room.provisioned.projectId,
        environmentId: room.provisioned.environmentId,
        parentThreadId: room.provisioned.primaryThreadId,
        title: "Missing inherit",
      });
      expect(getWorkTogetherRoomStreamContext(harness.db, orphan.id)).toBeNull();
      harness.db
        .update(threads)
        .set({ status: "idle" })
        .where(eq(threads.id, orphan.id))
        .run();

      await expect(
        admitQueueIfActiveSendMessage(harness.deps, {
          actor: SYSTEM_ACTOR_STAMP,
          payload: {
            input: [{ type: "text", text: "nope", mentions: [] }],
            mode: "queue-if-active",
          },
          requestId: encodeClientTurnRequestIdNumber({ value: 904 }),
          thread: getThread(harness.db, orphan.id)!,
        }),
      ).rejects.toMatchObject({
        status: 409,
        body: { code: "invalid_request" },
      });
    });
  });
});
