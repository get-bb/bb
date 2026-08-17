import { randomUUID } from "node:crypto";

import {
  archiveThread,
  createHostId,
  createPendingInteraction,
  getLatestThreadSequence,
  threads,
  unarchiveThread,
  updateThread,
} from "@bb/db";
import {
  encodeClientTurnRequestIdNumber,
  threadScope,
  turnScope,
  type Principal,
} from "@bb/domain";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { createBindingBackedRoomDistributionV1 } from "../../src/room-distribution/binding-backed-room-distribution.js";
import type {
  WorkTogetherRoomChildAttachmentPortV1,
  WorkTogetherRoomChildAttachmentV1,
} from "../../src/room-distribution/work-together-room-child-attachments.js";
import type {
  RoomDistributionContextV1,
  RoomJsonObject,
} from "../../src/room-distribution/room-distribution-port.js";
import { createWorkTogetherRoomResourceProvisioner } from "../../src/room-distribution/room-resource-provisioner.js";
import { createUserQuestionPayload } from "../helpers/pending-interactions.js";
import {
  seedEvent,
  seedHostSession,
  seedThread,
  seedTurnStarted,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const PRINCIPAL: Principal = Object.freeze({
  id: "user_room_live_list",
  kind: "human",
  displayName: "Room Live List",
});
const MEMBER_AUTHORITY = Object.freeze({
  read: async () =>
    Object.freeze({ role: "member" as const, isTaskAssignee: false }),
});

function context(bindingId: string): RoomDistributionContextV1 {
  return Object.freeze({
    bindingId,
    principal: PRINCIPAL,
    authorize: async () => ({ allowed: true as const }),
  });
}

function asObject(value: unknown): RoomJsonObject {
  expect(value).toEqual(expect.any(Object));
  return value as RoomJsonObject;
}

function assertPrimaryReady(event: unknown): RoomJsonObject {
  const ready = asObject(event);
  expect(Object.keys(ready)).toEqual(["type", "cursor", "subagents"]);
  expect(ready.type).toBe("ready");
  expect(ready.cursor).toMatch(/^s\.\d+$/u);
  expect(Array.isArray(ready.subagents)).toBe(true);
  return ready;
}

function assertSubagentReady(event: unknown): RoomJsonObject {
  const ready = asObject(event);
  expect(Object.keys(ready)).toEqual(["type", "cursor"]);
  expect(ready.type).toBe("ready");
  expect(ready.cursor).toMatch(/^s\.\d+$/u);
  return ready;
}

function assertSubagentsChanged(event: unknown): RoomJsonObject {
  const changed = asObject(event);
  expect(Object.keys(changed)).toEqual(["type", "subagents"]);
  expect(changed.type).toBe("subagents.changed");
  expect(Array.isArray(changed.subagents)).toBe(true);
  return changed;
}

function listFrames(emitted: unknown[]): RoomJsonObject[] {
  return emitted
    .map(asObject)
    .filter(
      (event) => event.type === "ready" || event.type === "subagents.changed",
    );
}

function seedAssistantTurn(
  deps: Parameters<typeof seedEvent>[0],
  args: {
    environmentId: string;
    text: string;
    threadId: string;
    turnId: string;
  },
): void {
  const startSequence =
    getLatestThreadSequence(deps.db, { threadId: args.threadId }) + 1;
  const clientRequestId = encodeClientTurnRequestIdNumber({ value: 1 });
  seedEvent(deps, {
    threadId: args.threadId,
    environmentId: args.environmentId,
    sequence: startSequence,
    type: "client/turn/requested",
    scope: threadScope(),
    data: {
      direction: "outbound",
      requestId: clientRequestId,
      input: [{ type: "text", text: args.text, mentions: [] }],
      target: { kind: "thread-start" },
      execution: {
        model: "gpt-5",
        reasoningLevel: "medium",
        permissionMode: "full",
        serviceTier: "default",
        source: "client/turn/requested",
      },
      initiator: "user",
      senderThreadId: null,
      request: { method: "turn/start", params: {} },
      source: "tell",
    },
  });
  seedEvent(deps, {
    threadId: args.threadId,
    environmentId: args.environmentId,
    providerThreadId: "provider-live-list",
    scope: turnScope(args.turnId),
    sequence: startSequence + 1,
    type: "turn/started",
    data: {},
  });
  seedEvent(deps, {
    threadId: args.threadId,
    environmentId: args.environmentId,
    providerThreadId: "provider-live-list",
    scope: turnScope(args.turnId),
    sequence: startSequence + 2,
    type: "item/completed",
    data: {
      item: {
        type: "agentMessage",
        id: `${args.turnId}-assistant`,
        text: args.text,
      },
    },
  });
  seedEvent(deps, {
    threadId: args.threadId,
    environmentId: args.environmentId,
    providerThreadId: "provider-live-list",
    scope: turnScope(args.turnId),
    sequence: startSequence + 3,
    type: "turn/completed",
    data: { status: "completed" },
  });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error("timed out waiting for live list condition");
}

async function flushMicrotasks(): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await Promise.resolve();
  }
}

async function withLiveListRoom(
  run: (args: {
    attach: ReturnType<typeof vi.fn>;
    attached: WorkTogetherRoomChildAttachmentV1[];
    bindingId: string;
    distribution: ReturnType<typeof createBindingBackedRoomDistributionV1>;
    environmentId: string;
    harness: TestAppHarness;
    ids: Map<string, string>;
    list: ReturnType<typeof vi.fn>;
    primaryThreadId: string;
    projectId: string;
  }) => Promise<void>,
): Promise<void> {
  await withTestHarness(async (harness) => {
    const { host } = seedHostSession(harness.deps, { id: createHostId() });
    const launch = {
      bindingId: randomUUID(),
      workspaceId: randomUUID(),
      taskId: randomUUID(),
      cellId: randomUUID(),
      repositoryBindingId: randomUUID(),
      repositoryBindingVersion: 1,
      providerRepositoryId: "401",
      baseBranch: "main",
      generatedBranch: "rooms/live-list",
      candidateHostId: randomUUID(),
      environmentTemplate: "managed-worktree" as const,
    };
    const provisioned = await createWorkTogetherRoomResourceProvisioner(
      harness.deps,
      {
        resolve: () => ({
          bbHostId: host.id,
          projectName: "Live List Repository",
          providerId: "codex",
          sourcePath: "/srv/work-together/live-list",
        }),
      },
    ).provision({ principal: PRINCIPAL, launch });
    const ids = new Map<string, string>();
    const attached: WorkTogetherRoomChildAttachmentV1[] = [];
    const attach = vi.fn(
      async (input: { childThreadId: string; parentThreadId: string }) => {
        let id = ids.get(input.childThreadId);
        if (id === undefined) {
          id = randomUUID();
          ids.set(input.childThreadId, id);
        }
        const existing = attached.find(
          (entry) => entry.childThreadId === input.childThreadId,
        );
        if (existing !== undefined) return existing;
        const entry = Object.freeze({
          id,
          childThreadId: input.childThreadId,
          parentThreadId: input.parentThreadId,
        });
        attached.push(entry);
        return entry;
      },
    );
    const list = vi.fn(async () => Object.freeze([...attached]));
    const childAttachments: WorkTogetherRoomChildAttachmentPortV1 =
      Object.freeze({ attach, list });
    const distribution = createBindingBackedRoomDistributionV1(
      harness.deps,
      { read: async () => ({ id: launch.taskId, title: "Task" }) },
      childAttachments,
      MEMBER_AUTHORITY,
    );
    await run({
      attach,
      attached,
      bindingId: launch.bindingId,
      distribution,
      environmentId: provisioned.environmentId,
      harness,
      ids,
      list,
      primaryThreadId: provisioned.primaryThreadId,
      projectId: provisioned.projectId,
    });
  });
}

describe("binding-backed Room Subagent live list", () => {
  it("emits exact Primary and Subagent ready keys", async () => {
    await withLiveListRoom(async (room) => {
      const child = seedThread(room.harness.deps, {
        environmentId: room.environmentId,
        parentThreadId: room.primaryThreadId,
        projectId: room.projectId,
        title: "Direct worker",
      });
      const primaryEvents: unknown[] = [];
      const primary = await room.distribution.subscribe(
        context(room.bindingId),
        { subagentId: null, cursor: null },
        (event) => primaryEvents.push(event),
      );
      const ready = assertPrimaryReady(primaryEvents[0]);
      expect(ready.subagents).toEqual([
        expect.objectContaining({
          id: room.ids.get(child.id),
          label: "Direct worker",
          parent: { kind: "primary", id: room.bindingId },
        }),
      ]);
      expect(JSON.stringify(primaryEvents)).not.toContain(child.id);
      expect(JSON.stringify(primaryEvents)).not.toContain(room.primaryThreadId);

      const subagentEvents: unknown[] = [];
      const subagent = await room.distribution.subscribe(
        context(room.bindingId),
        { subagentId: room.ids.get(child.id)!, cursor: null },
        (event) => subagentEvents.push(event),
      );
      assertSubagentReady(subagentEvents[0]);
      expect(
        subagentEvents.every(
          (event) => asObject(event).type !== "subagents.changed",
        ),
      ).toBe(true);
      primary.close();
      subagent.close();
    });
  });

  it("replaces the Primary list on direct creation without advancing the cursor", async () => {
    await withLiveListRoom(async (room) => {
      const emitted: unknown[] = [];
      const subscription = await room.distribution.subscribe(
        context(room.bindingId),
        { subagentId: null, cursor: null },
        (event) => emitted.push(event),
      );
      const ready = assertPrimaryReady(emitted[0]);
      expect(ready.subagents).toEqual([]);
      const readyCursor = ready.cursor;
      emitted.length = 0;

      const child = seedThread(room.harness.deps, {
        environmentId: room.environmentId,
        parentThreadId: room.primaryThreadId,
        projectId: room.projectId,
        title: "Created worker",
      });
      await waitFor(() =>
        emitted.some((event) => asObject(event).type === "subagents.changed"),
      );
      const changed = assertSubagentsChanged(emitted[0]);
      expect(changed.subagents).toEqual([
        expect.objectContaining({
          id: room.ids.get(child.id),
          label: "Created worker",
        }),
      ]);
      expect(emitted.some((event) => asObject(event).type === "changed")).toBe(
        false,
      );
      expect(readyCursor).toBe(
        `s.${getLatestThreadSequence(room.harness.db, {
          threadId: room.primaryThreadId,
        })}`,
      );
      subscription.close();
    });
  });

  it("discovers nested creation from a known parent children-changed hint", async () => {
    await withLiveListRoom(async (room) => {
      const direct = seedThread(room.harness.deps, {
        environmentId: room.environmentId,
        parentThreadId: room.primaryThreadId,
        projectId: room.projectId,
        title: "Direct worker",
      });
      const emitted: unknown[] = [];
      const subscription = await room.distribution.subscribe(
        context(room.bindingId),
        { subagentId: null, cursor: null },
        (event) => emitted.push(event),
      );
      assertPrimaryReady(emitted[0]);
      emitted.length = 0;
      const attachCalls = room.attach.mock.calls.length;

      const nested = seedThread(room.harness.deps, {
        environmentId: room.environmentId,
        parentThreadId: direct.id,
        projectId: room.projectId,
        title: "Nested worker",
      });
      await waitFor(() =>
        emitted.some((event) => asObject(event).type === "subagents.changed"),
      );
      const changed = assertSubagentsChanged(emitted[0]);
      expect(changed.subagents).toEqual([
        expect.objectContaining({
          id: room.ids.get(direct.id),
          label: "Direct worker",
        }),
        expect.objectContaining({
          id: room.ids.get(nested.id),
          label: "Nested worker",
          parent: { kind: "subagent", id: room.ids.get(direct.id) },
        }),
      ]);
      expect(room.attach.mock.calls.length).toBeGreaterThan(attachCalls);
      subscription.close();
    });
  });

  it("retains a nested parent hint while that parent is still attaching", async () => {
    await withLiveListRoom(async (room) => {
      const emitted: unknown[] = [];
      const subscription = await room.distribution.subscribe(
        context(room.bindingId),
        { subagentId: null, cursor: null },
        (event) => emitted.push(event),
      );
      assertPrimaryReady(emitted[0]);
      emitted.length = 0;

      const originalAttach = room.attach.getMockImplementation() as
        | ((input: {
            childThreadId: string;
            parentThreadId: string;
          }) => Promise<WorkTogetherRoomChildAttachmentV1>)
        | undefined;
      if (originalAttach === undefined)
        throw new Error("missing attach fixture");
      let releaseDirectAttach: (() => void) | undefined;
      const directAttachHold = new Promise<void>((resolve) => {
        releaseDirectAttach = resolve;
      });
      let signalDirectAttach: (() => void) | undefined;
      const directAttachStarted = new Promise<void>((resolve) => {
        signalDirectAttach = resolve;
      });
      let held = false;
      room.attach.mockImplementation(async (input) => {
        if (!held) {
          held = true;
          signalDirectAttach?.();
          await directAttachHold;
        }
        return originalAttach(input);
      });

      const direct = seedThread(room.harness.deps, {
        environmentId: room.environmentId,
        parentThreadId: room.primaryThreadId,
        projectId: room.projectId,
        title: "Attaching parent",
      });
      await directAttachStarted;
      const nested = seedThread(room.harness.deps, {
        environmentId: room.environmentId,
        parentThreadId: direct.id,
        projectId: room.projectId,
        title: "Created during attach",
      });
      releaseDirectAttach?.();

      await waitFor(() =>
        emitted.some((event) => {
          const frame = asObject(event);
          if (frame.type !== "subagents.changed") return false;
          return (frame.subagents as RoomJsonObject[]).some(
            (subagent) => subagent.id === room.ids.get(nested.id),
          );
        }),
      );
      expect(listFrames(emitted).at(-1)?.subagents).toEqual([
        expect.objectContaining({
          id: room.ids.get(direct.id),
          label: "Attaching parent",
        }),
        expect.objectContaining({
          id: room.ids.get(nested.id),
          label: "Created during attach",
          parent: { kind: "subagent", id: room.ids.get(direct.id) },
        }),
      ]);
      subscription.close();
    });
  });

  it("emits replacement frames for public list changes and suppresses signature no-ops", async () => {
    await withLiveListRoom(async (room) => {
      const child = seedThread(room.harness.deps, {
        environmentId: room.environmentId,
        parentThreadId: room.primaryThreadId,
        projectId: room.projectId,
        status: "idle",
        title: "Worker",
      });
      const emitted: unknown[] = [];
      const subscription = await room.distribution.subscribe(
        context(room.bindingId),
        { subagentId: null, cursor: null },
        (event) => emitted.push(event),
      );
      assertPrimaryReady(emitted[0]);
      emitted.length = 0;

      updateThread(room.harness.db, room.harness.hub, child.id, {
        title: "Renamed worker",
      });
      await waitFor(() =>
        emitted.some((event) => asObject(event).type === "subagents.changed"),
      );
      expect(assertSubagentsChanged(emitted.at(-1)).subagents).toEqual([
        expect.objectContaining({ label: "Renamed worker" }),
      ]);
      emitted.length = 0;
      room.harness.hub.notifyThread(child.id, ["title-changed"]);
      await flushMicrotasks();
      expect(
        emitted.filter((event) => asObject(event).type === "subagents.changed"),
      ).toEqual([]);

      seedAssistantTurn(room.harness.deps, {
        environmentId: room.environmentId,
        text: "Public summary",
        threadId: child.id,
        turnId: "turn_live_summary",
      });
      room.harness.hub.notifyThread(child.id, ["events-appended"], {
        eventTypes: ["item/completed", "turn/completed"],
      });
      await waitFor(() =>
        emitted.some((event) => asObject(event).type === "subagents.changed"),
      );
      expect(assertSubagentsChanged(emitted.at(-1)).subagents).toEqual([
        expect.objectContaining({
          lifecycle: "completed",
          summary: "Public summary",
        }),
      ]);
      emitted.length = 0;
      room.harness.hub.notifyThread(child.id, ["events-appended"], {
        eventTypes: ["item/agentMessage/delta"],
      });
      await flushMicrotasks();
      expect(emitted).toEqual([]);

      archiveThread(room.harness.db, room.harness.hub, child.id);
      await waitFor(() =>
        emitted.some((event) => asObject(event).type === "subagents.changed"),
      );
      expect(assertSubagentsChanged(emitted.at(-1)).subagents).toEqual([
        expect.objectContaining({ lifecycle: "archived" }),
      ]);
      emitted.length = 0;
      room.harness.db
        .update(threads)
        .set({ status: "active" })
        .where(eq(threads.id, child.id))
        .run();
      unarchiveThread(room.harness.db, room.harness.hub, child.id);
      await waitFor(() =>
        emitted.some((event) => asObject(event).type === "subagents.changed"),
      );
      expect(assertSubagentsChanged(emitted.at(-1)).subagents).toEqual([
        expect.objectContaining({
          capabilities: ["message.send", "message.steer"],
          lifecycle: "running",
        }),
      ]);
      emitted.length = 0;

      seedTurnStarted(room.harness.deps, {
        environmentId: room.environmentId,
        threadId: child.id,
        turnId: "turn_live_question",
      });
      const pending =
        room.harness.deps.pendingInteractions.registerPendingInteraction({
          interaction: {
            payload: createUserQuestionPayload(),
            providerId: "codex",
            providerRequestId: "request-live-question",
            providerThreadId: "provider-live-question",
            threadId: child.id,
            turnId: "turn_live_question",
          },
        });
      expect(pending.outcome).toBe("created");
      await waitFor(() =>
        emitted.some((event) => asObject(event).type === "subagents.changed"),
      );
      expect(assertSubagentsChanged(emitted.at(-1)).subagents).toEqual([
        expect.objectContaining({
          attention: { kind: "question" },
          capabilities: ["message.send", "message.steer", "interaction.answer"],
        }),
      ]);
      subscription.close();
    });
  });

  it("installs the observer before the snapshot and emits ready before any change", async () => {
    await withLiveListRoom(async (room) => {
      const child = seedThread(room.harness.deps, {
        environmentId: room.environmentId,
        parentThreadId: room.primaryThreadId,
        projectId: room.projectId,
        title: "Before",
      });
      const order: string[] = [];
      const originalOnChanged = room.harness.hub.onChangedMessage.bind(
        room.harness.hub,
      );
      vi.spyOn(room.harness.hub, "onChangedMessage").mockImplementation(
        (listener) => {
          order.push("observer");
          return originalOnChanged(listener);
        },
      );
      let releaseSnapshot: (() => void) | undefined;
      const snapshotHold = new Promise<void>((resolve) => {
        releaseSnapshot = resolve;
      });
      let listCalls = 0;
      room.list.mockImplementation(async () => {
        listCalls += 1;
        order.push(`list-${listCalls}`);
        if (listCalls === 1) await snapshotHold;
        return Object.freeze([...room.attached]);
      });

      const emitted: unknown[] = [];
      const subscribePromise = room.distribution.subscribe(
        context(room.bindingId),
        { subagentId: null, cursor: null },
        (event) => emitted.push(event),
      );
      await flushMicrotasks();
      expect(order[0]).toBe("observer");
      expect(order).toContain("list-1");
      expect(emitted).toEqual([]);

      updateThread(room.harness.db, room.harness.hub, child.id, {
        title: "After snapshot",
      });
      releaseSnapshot?.();
      const subscription = await subscribePromise;
      expect(order.slice(0, 3)).toEqual(["observer", "list-1", "list-2"]);
      const ready = assertPrimaryReady(emitted[0]);
      const frames = listFrames(emitted);
      expect(frames[0]?.type).toBe("ready");
      expect(
        frames.some((event) => event.type === "subagents.changed")
          ? frames.findIndex((event) => event.type === "subagents.changed")
          : 1,
      ).toBeGreaterThan(0);
      const latest = frames.at(-1);
      expect(latest).toEqual(
        expect.objectContaining({
          subagents: [expect.objectContaining({ label: "After snapshot" })],
        }),
      );
      expect(ready.cursor).toMatch(/^s\.\d+$/u);
      subscription.close();
    });
  });

  it("repairs a missed change on reconnect ready and ignores unrelated hints", async () => {
    await withLiveListRoom(async (room) => {
      const child = seedThread(room.harness.deps, {
        environmentId: room.environmentId,
        parentThreadId: room.primaryThreadId,
        projectId: room.projectId,
        title: "Original",
      });
      const firstEvents: unknown[] = [];
      const first = await room.distribution.subscribe(
        context(room.bindingId),
        { subagentId: null, cursor: null },
        (event) => firstEvents.push(event),
      );
      assertPrimaryReady(firstEvents[0]);
      first.close();

      updateThread(room.harness.db, room.harness.hub, child.id, {
        title: "Reconnect repair",
      });
      const reconnectEvents: unknown[] = [];
      const reconnect = await room.distribution.subscribe(
        context(room.bindingId),
        { subagentId: null, cursor: null },
        (event) => reconnectEvents.push(event),
      );
      expect(assertPrimaryReady(reconnectEvents[0]).subagents).toEqual([
        expect.objectContaining({ label: "Reconnect repair" }),
      ]);
      expect(
        reconnectEvents.some(
          (event) => asObject(event).type === "subagents.changed",
        ),
      ).toBe(false);

      const attachCalls = room.attach.mock.calls.length;
      const listCalls = room.list.mock.calls.length;
      room.harness.hub.notifyThread("thr_unrelated_hint", ["title-changed"]);
      room.harness.hub.notifyThread("thr_unrelated_hint", ["children-changed"]);
      await flushMicrotasks();
      expect(room.attach.mock.calls.length).toBe(attachCalls);
      expect(room.list.mock.calls.length).toBe(listCalls);

      const created = seedThread(room.harness.deps, {
        environmentId: room.environmentId,
        parentThreadId: room.primaryThreadId,
        projectId: room.projectId,
        title: "Second worker",
      });
      await waitFor(() =>
        reconnectEvents.some(
          (event) => asObject(event).type === "subagents.changed",
        ),
      );
      expect(listFrames(reconnectEvents).at(-1)?.subagents).toEqual([
        expect.objectContaining({ label: "Reconnect repair" }),
        expect.objectContaining({
          id: room.ids.get(created.id),
          label: "Second worker",
        }),
      ]);
      reconnectEvents.length = 0;
      updateThread(room.harness.db, room.harness.hub, created.id, {
        title: "Observed second",
      });
      await waitFor(() =>
        reconnectEvents.some(
          (event) => asObject(event).type === "subagents.changed",
        ),
      );
      expect(assertSubagentsChanged(reconnectEvents.at(-1)).subagents).toEqual([
        expect.objectContaining({ label: "Reconnect repair" }),
        expect.objectContaining({ label: "Observed second" }),
      ]);
      reconnect.close();
    });
  });

  it("batches pending-interaction projection reads and contains post-ready errors", async () => {
    await withLiveListRoom(async (room) => {
      const first = seedThread(room.harness.deps, {
        environmentId: room.environmentId,
        parentThreadId: room.primaryThreadId,
        projectId: room.projectId,
        status: "active",
        title: "First",
      });
      const second = seedThread(room.harness.deps, {
        environmentId: room.environmentId,
        parentThreadId: room.primaryThreadId,
        projectId: room.projectId,
        status: "active",
        title: "Second",
      });
      seedTurnStarted(room.harness.deps, {
        environmentId: room.environmentId,
        threadId: first.id,
        turnId: "turn_batch_q1",
      });
      seedTurnStarted(room.harness.deps, {
        environmentId: room.environmentId,
        threadId: second.id,
        turnId: "turn_batch_q2",
      });
      expect(
        room.harness.deps.pendingInteractions.registerPendingInteraction({
          interaction: {
            payload: createUserQuestionPayload(),
            providerId: "codex",
            providerRequestId: "request-batch-q1",
            providerThreadId: "provider-batch-q1",
            threadId: first.id,
            turnId: "turn_batch_q1",
          },
        }).outcome,
      ).toBe("created");
      expect(
        room.harness.deps.pendingInteractions.registerPendingInteraction({
          interaction: {
            payload: createUserQuestionPayload(),
            providerId: "codex",
            providerRequestId: "request-batch-q2",
            providerThreadId: "provider-batch-q2",
            threadId: second.id,
            turnId: "turn_batch_q2",
          },
        }).outcome,
      ).toBe("created");
      createPendingInteraction(room.harness.db, {
        payload: "{not-json",
        providerId: "codex",
        providerRequestId: "request-batch-corrupt",
        providerThreadId: "provider-batch-corrupt",
        threadId: second.id,
        turnId: "turn_batch_corrupt",
      });

      const batched = vi.spyOn(
        room.harness.deps.pendingInteractions,
        "listPendingThreadInteractionsByThreadIds",
      );
      const single = vi.spyOn(
        room.harness.deps.pendingInteractions,
        "listPendingThreadInteractions",
      );
      const emitted: unknown[] = [];
      const subscription = await room.distribution.subscribe(
        context(room.bindingId),
        { subagentId: null, cursor: null },
        (event) => emitted.push(event),
      );
      expect(batched.mock.calls.length).toBeGreaterThan(0);
      expect(single).not.toHaveBeenCalled();
      expect(assertPrimaryReady(emitted[0]).subagents).toEqual([
        expect.objectContaining({
          attention: { kind: "question" },
          id: room.ids.get(first.id),
        }),
        expect.objectContaining({
          attention: { kind: "question" },
          id: room.ids.get(second.id),
        }),
      ]);

      const warn = vi.spyOn(room.harness.deps.logger, "warn");
      let listCalls = 0;
      room.list.mockImplementation(async () => {
        listCalls += 1;
        if (listCalls > 0) throw new Error("live list projection failed");
        return Object.freeze([...room.attached]);
      });
      room.harness.hub.notifyThread(first.id, ["title-changed"]);
      await waitFor(() => warn.mock.calls.length > 0);
      expect(warn).toHaveBeenCalled();
      expect(JSON.stringify(warn.mock.calls)).not.toContain(first.id);
      expect(JSON.stringify(warn.mock.calls)).not.toContain(
        room.primaryThreadId,
      );
      subscription.close();
    });
  });
});
