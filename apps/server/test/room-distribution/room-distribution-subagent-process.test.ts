import { randomUUID } from "node:crypto";

import {
  createHostId,
  environments,
  getLatestThreadSequence,
  getThreadCommandAdmission,
  updateThread,
} from "@bb/db";
import {
  encodeClientTurnRequestIdNumber,
  threadScope,
  turnScope,
  type PolicyAction,
  type PolicyResource,
  type Principal,
} from "@bb/domain";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";

import { isRegistryIssuedRoomDistributionAuthorization } from "../../src/auth/room-distribution-authorization.js";
import type { PrincipalPolicy } from "../../src/auth/principal-policy.js";
import {
  createBindingBackedRoomDistributionV1,
  type WorkTogetherRoomTaskProjectionPortV1,
} from "../../src/room-distribution/binding-backed-room-distribution.js";
import type {
  WorkTogetherRoomChildAttachmentPortV1,
  WorkTogetherRoomChildAttachmentV1,
} from "../../src/room-distribution/work-together-room-child-attachments.js";
import { createWorkTogetherRoomResourceProvisioner } from "../../src/room-distribution/room-resource-provisioner.js";
import { seedEvent, seedHostSession, seedThread } from "../helpers/seed.js";
import {
  startTestServer,
  type RunningTestServer,
  type TestAppHarness,
} from "../helpers/test-app.js";

const PRINCIPAL: Principal = Object.freeze({
  id: "user_RoomSubagentProcess",
  kind: "human",
  displayName: "Private Process Principal",
});
const SUBAGENT_KEYS = [
  "schemaVersion",
  "id",
  "parent",
  "label",
  "summary",
  "lifecycle",
  "attention",
  "capabilities",
] as const;
const BOOTSTRAP_KEYS = [
  "schemaVersion",
  "binding",
  "cell",
  "task",
  "repository",
  "environment",
  "primaryRun",
  "capabilities",
  "subagents",
  "collaboration",
  "timeline",
  "cursor",
] as const;
const RECEIPT_KEYS = [
  "schemaVersion",
  "outcome",
  "requestId",
  "commandKind",
  "admissionSequence",
  "result",
  "createdAt",
  "completedAt",
  "stream",
] as const;
const openServers: RunningTestServer[] = [];

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => server.close()));
});

function websocketUrl(baseUrl: string, path: string): string {
  const url = new URL(path, baseUrl);
  url.protocol = "ws:";
  return url.href;
}

function seedMessageTurn(
  harness: TestAppHarness,
  args: {
    environmentId: string;
    firstTurn: boolean;
    requestId: number;
    startSequence: number;
    text: string;
    threadId: string;
    turnId: string;
  },
): void {
  const clientRequestId = encodeClientTurnRequestIdNumber({
    value: args.requestId,
  });
  seedEvent(harness.deps, {
    threadId: args.threadId,
    environmentId: args.environmentId,
    sequence: args.startSequence,
    type: "client/turn/requested",
    scope: threadScope(),
    data: {
      direction: "outbound",
      requestId: clientRequestId,
      input: [{ type: "text", text: args.text, mentions: [] }],
      target: args.firstTurn ? { kind: "thread-start" } : { kind: "new-turn" },
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
  seedEvent(harness.deps, {
    threadId: args.threadId,
    environmentId: args.environmentId,
    providerThreadId: "provider-private-subagent-process",
    sequence: args.startSequence + 1,
    type: "turn/started",
    scope: turnScope(args.turnId),
    data: {},
  });
  seedEvent(harness.deps, {
    threadId: args.threadId,
    environmentId: args.environmentId,
    providerThreadId: "provider-private-subagent-process",
    sequence: args.startSequence + 2,
    type: "turn/input/accepted",
    scope: turnScope(args.turnId),
    data: { clientRequestId },
  });
  seedEvent(harness.deps, {
    threadId: args.threadId,
    environmentId: args.environmentId,
    providerThreadId: "provider-private-subagent-process",
    sequence: args.startSequence + 3,
    type: "item/completed",
    scope: turnScope(args.turnId),
    data: {
      item: {
        type: "agentMessage",
        id: `${args.turnId}-assistant-private`,
        text: `${args.text} — answered.`,
      },
    },
  });
  seedEvent(harness.deps, {
    threadId: args.threadId,
    environmentId: args.environmentId,
    providerThreadId: "provider-private-subagent-process",
    sequence: args.startSequence + 4,
    type: "turn/completed",
    scope: turnScope(args.turnId),
    data: { status: "completed" },
  });
}

async function provisionRoom(harness: TestAppHarness, seed: number) {
  const { host } = seedHostSession(harness.deps, { id: createHostId() });
  const launch = {
    bindingId: randomUUID(),
    workspaceId: randomUUID(),
    taskId: randomUUID(),
    cellId: randomUUID(),
    repositoryBindingId: randomUUID(),
    repositoryBindingVersion: 1,
    providerRepositoryId: String(seed),
    baseBranch: "main",
    generatedBranch: `rooms/subagent-process-${seed}`,
    candidateHostId: randomUUID(),
    environmentTemplate: "managed-worktree" as const,
  };
  const provisioned = await createWorkTogetherRoomResourceProvisioner(
    harness.deps,
    {
      resolve: () => ({
        bbHostId: host.id,
        projectName: `Subagent Process ${seed}`,
        providerId: "codex",
        sourcePath: `/srv/work-together/subagent-process-${seed}`,
      }),
    },
  ).provision({ principal: PRINCIPAL, launch });
  harness.db
    .update(environments)
    .set({ path: `/tmp/subagent-process-${seed}`, status: "ready" })
    .where(eq(environments.id, provisioned.environmentId))
    .run();
  return { launch, provisioned };
}

type CapturedSocket = {
  readonly frames: unknown[];
  readonly socket: WebSocket;
  error: Error | null;
};

function connectSocket(url: string): CapturedSocket {
  const captured: CapturedSocket = {
    frames: [],
    socket: new WebSocket(url),
    error: null,
  };
  captured.socket.on("message", (data) => {
    captured.frames.push(JSON.parse(data.toString("utf8")) as unknown);
  });
  captured.socket.on("error", (error) => {
    captured.error = error;
  });
  return captured;
}

async function waitForFrame<T>(
  captured: CapturedSocket,
  predicate: (frame: unknown) => frame is T,
  from = 0,
): Promise<T> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (captured.error !== null) throw captured.error;
    for (const frame of captured.frames.slice(from)) {
      if (predicate(frame)) return frame;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(
    `Timed out waiting for Room frame: ${JSON.stringify(captured.frames)}`,
  );
}

function isFrameType<TType extends string>(type: TType) {
  return (frame: unknown): frame is Record<string, unknown> & { type: TType } =>
    frame !== null &&
    typeof frame === "object" &&
    !Array.isArray(frame) &&
    (frame as { type?: unknown }).type === type;
}

describe("Room Subagent real process conformance", () => {
  it("carries the exact selected-stream contract through real HTTP and WebSocket boundaries", async () => {
    let denyCommands = false;
    let fixture!: {
      crossBindingId: string;
      crossChildId: string;
      crossSubagentId: string;
      directId: string;
      directSubagentId: string;
      environmentId: string;
      nestedId: string;
      nestedSubagentId: string;
      primaryThreadId: string;
      privateTurnIds: string[];
      projectId: string;
      roomBindingId: string;
    };

    const policy: PrincipalPolicy = {
      async resolve() {
        return Object.freeze({
          principal: PRINCIPAL,
          expiresAtMs: Date.now() + 30_000,
          clientRealtimeScope: "scoped" as const,
          async authorize(action: PolicyAction, resource: PolicyResource) {
            if (
              !isRegistryIssuedRoomDistributionAuthorization(
                action,
                resource,
              ) ||
              (denyCommands && action.name === "roomDistribution.commands")
            ) {
              return { allowed: false as const, reason: "forbidden" as const };
            }
            return { allowed: true as const };
          },
        });
      },
    };

    const server = await startTestServer({}, async (harness) => {
      const room = await provisionRoom(harness, 701);
      const crossRoom = await provisionRoom(harness, 702);
      const direct = seedThread(harness.deps, {
        projectId: room.provisioned.projectId,
        environmentId: room.provisioned.environmentId,
        parentThreadId: room.provisioned.primaryThreadId,
        title: "Research worker",
      });
      const nested = seedThread(harness.deps, {
        projectId: room.provisioned.projectId,
        environmentId: room.provisioned.environmentId,
        parentThreadId: direct.id,
        status: "active",
        title: "Verification worker",
      });
      const crossChild = seedThread(harness.deps, {
        projectId: crossRoom.provisioned.projectId,
        environmentId: crossRoom.provisioned.environmentId,
        parentThreadId: crossRoom.provisioned.primaryThreadId,
        title: "Other Room worker",
      });
      const privateTurnIds: string[] = [];
      const baseSequence =
        getLatestThreadSequence(harness.db, { threadId: nested.id }) + 1;
      for (let turn = 1; turn <= 22; turn += 1) {
        const turnId = `turn_private_subagent_process_${turn}`;
        privateTurnIds.push(turnId);
        seedMessageTurn(harness, {
          environmentId: room.provisioned.environmentId,
          firstTurn: turn === 1 && baseSequence === 1,
          requestId: 700 + turn,
          startSequence: baseSequence + (turn - 1) * 5,
          text: `Nested public message ${turn}`,
          threadId: nested.id,
          turnId,
        });
      }
      const primaryBaseSequence =
        getLatestThreadSequence(harness.db, {
          threadId: room.provisioned.primaryThreadId,
        }) + 1;
      seedMessageTurn(harness, {
        environmentId: room.provisioned.environmentId,
        firstTurn: primaryBaseSequence === 1,
        requestId: 799,
        startSequence: primaryBaseSequence,
        text: "Primary overlap probe",
        threadId: room.provisioned.primaryThreadId,
        // Deliberately reuse a private turn id across streams. Public row ids
        // must still be domain-separated by the selected public stream.
        turnId: privateTurnIds[0]!,
      });

      const directSubagentId = randomUUID();
      const nestedSubagentId = randomUUID();
      const crossSubagentId = randomUUID();
      const publicIds = new Map([
        [direct.id, directSubagentId],
        [nested.id, nestedSubagentId],
        [crossChild.id, crossSubagentId],
      ]);
      const attachmentsByBinding = new Map<
        string,
        WorkTogetherRoomChildAttachmentV1[]
      >([
        [room.launch.bindingId, []],
        [
          crossRoom.launch.bindingId,
          [
            Object.freeze({
              id: crossSubagentId,
              childThreadId: crossChild.id,
              parentThreadId: crossRoom.provisioned.primaryThreadId,
            }),
          ],
        ],
      ]);
      const childAttachments: WorkTogetherRoomChildAttachmentPortV1 = {
        attach: vi.fn(async (input) => {
          const publicId = publicIds.get(input.childThreadId);
          const entries = attachmentsByBinding.get(input.bindingId);
          if (publicId === undefined || entries === undefined) {
            throw new Error("unexpected child attachment");
          }
          const existing = entries.find(
            (entry) => entry.childThreadId === input.childThreadId,
          );
          if (existing !== undefined) return existing;
          const entry = Object.freeze({
            id: publicId,
            childThreadId: input.childThreadId,
            parentThreadId: input.parentThreadId,
          });
          entries.push(entry);
          return entry;
        }),
        list: vi.fn(async (input) =>
          Object.freeze([...(attachmentsByBinding.get(input.bindingId) ?? [])]),
        ),
      };
      const taskProjection: WorkTogetherRoomTaskProjectionPortV1 = {
        read: vi.fn(async ({ taskId }) => ({
          id: taskId,
          title: "Process-boundary Subagent task",
        })),
      };
      const distribution = createBindingBackedRoomDistributionV1(
        harness.deps,
        taskProjection,
        childAttachments,
        {
          read: async () =>
            Object.freeze({ role: "owner" as const, isTaskAssignee: false }),
        },
      );
      fixture = {
        crossBindingId: crossRoom.launch.bindingId,
        crossChildId: crossChild.id,
        crossSubagentId,
        directId: direct.id,
        directSubagentId,
        environmentId: room.provisioned.environmentId,
        nestedId: nested.id,
        nestedSubagentId,
        primaryThreadId: room.provisioned.primaryThreadId,
        privateTurnIds,
        projectId: room.provisioned.projectId,
        roomBindingId: room.launch.bindingId,
      };
      return {
        principalMode: "work-together",
        principalPolicy: policy,
        roomDistribution: distribution,
      };
    });
    openServers.push(server);
    const prefix = `/api/bb-rooms/v1/rooms/${fixture.roomBindingId}`;

    const bootstrapResponse = await fetch(
      `${server.baseUrl}${prefix}/bootstrap`,
    );
    expect(bootstrapResponse.status).toBe(200);
    const bootstrap = (await bootstrapResponse.json()) as Record<
      string,
      unknown
    >;
    expect(Object.keys(bootstrap)).toEqual([...BOOTSTRAP_KEYS]);
    expect(bootstrap.schemaVersion).toBe(2);
    expect(bootstrap).not.toHaveProperty("children");
    const subagents = bootstrap.subagents as Array<Record<string, unknown>>;
    expect(subagents).toHaveLength(2);
    expect(Object.keys(subagents[0]!)).toEqual([...SUBAGENT_KEYS]);
    expect(Object.keys(subagents[1]!)).toEqual([...SUBAGENT_KEYS]);
    expect(subagents).toEqual([
      {
        schemaVersion: 1,
        id: fixture.directSubagentId,
        parent: { kind: "primary", id: fixture.roomBindingId },
        label: "Research worker",
        summary: null,
        lifecycle: "created",
        attention: { kind: "none" },
        capabilities: ["message.send"],
      },
      {
        schemaVersion: 1,
        id: fixture.nestedSubagentId,
        parent: { kind: "subagent", id: fixture.directSubagentId },
        label: "Verification worker",
        summary: "Nested public message 22 — answered.",
        lifecycle: "running",
        attention: { kind: "none" },
        capabilities: ["message.send", "message.steer", "agent.interrupt"],
      },
    ]);

    const initialResponse = await fetch(
      `${server.baseUrl}${prefix}/events?subagent=${fixture.nestedSubagentId}`,
    );
    expect(initialResponse.status).toBe(200);
    const initial = (await initialResponse.json()) as Record<string, unknown>;
    expect(initial).toMatchObject({ schemaVersion: 1, changed: true });
    expect(initial.cursor).toMatch(/^s\.[0-9]+$/u);
    expect(initial.timeline).not.toBeNull();
    const latestTimeline = initial.timeline as {
      hasOlder: boolean;
      olderCursor: string | null;
      rows: Array<Record<string, unknown>>;
    };
    expect(latestTimeline.hasOlder).toBe(true);
    expect(latestTimeline.olderCursor).toMatch(/^p\.[1-9][0-9]*$/u);

    const equalResponse = await fetch(
      `${server.baseUrl}${prefix}/events?subagent=${fixture.nestedSubagentId}&cursor=${initial.cursor as string}`,
    );
    expect(equalResponse.status).toBe(200);
    const equal = await equalResponse.json();
    expect(equal).toEqual({
      schemaVersion: 1,
      cursor: initial.cursor,
      changed: false,
      timeline: null,
    });

    const olderResponse = await fetch(
      `${server.baseUrl}${prefix}/timeline?subagent=${fixture.nestedSubagentId}&before=${latestTimeline.olderCursor!}`,
    );
    expect(olderResponse.status).toBe(200);
    const older = (await olderResponse.json()) as Record<string, unknown>;
    expect(Object.keys(older)).toEqual(["schemaVersion", "timeline"]);
    const olderRows = (
      older.timeline as { rows: Array<Record<string, unknown>> }
    ).rows;
    expect(olderRows.length).toBeGreaterThan(0);
    expect(
      olderRows.some(
        (row) =>
          row.kind === "conversation" &&
          typeof row.text === "string" &&
          row.text.includes("Nested public message"),
      ),
    ).toBe(true);
    const primaryEventsResponse = await fetch(
      `${server.baseUrl}${prefix}/events`,
    );
    expect(primaryEventsResponse.status).toBe(200);
    const primaryEvents = (await primaryEventsResponse.json()) as {
      timeline: { rows: Array<{ id: string }> };
    };
    const primaryRowIds = new Set(
      primaryEvents.timeline.rows.map((row) => row.id),
    );
    expect(primaryRowIds.size).toBeGreaterThan(0);
    expect(
      [...latestTimeline.rows, ...olderRows].some(
        (row) => typeof row.id === "string" && primaryRowIds.has(row.id),
      ),
    ).toBe(false);

    const primarySocket = connectSocket(
      websocketUrl(server.baseUrl, `${prefix}/subscribe`),
    );
    const primaryReady = await waitForFrame(
      primarySocket,
      isFrameType("ready"),
    );
    expect(Object.keys(primaryReady)).toEqual(["type", "cursor", "subagents"]);
    expect(primaryReady.subagents).toEqual(subagents);

    const subagentSocket = connectSocket(
      websocketUrl(
        server.baseUrl,
        `${prefix}/subscribe?subagent=${fixture.nestedSubagentId}`,
      ),
    );
    const subagentReady = await waitForFrame(
      subagentSocket,
      isFrameType("ready"),
    );
    expect(Object.keys(subagentReady)).toEqual(["type", "cursor"]);

    const primaryFrameStart = primarySocket.frames.length;
    updateThread(server.db, server.hub, fixture.directId, {
      title: "Renamed research worker",
    });
    const listChanged = await waitForFrame(
      primarySocket,
      isFrameType("subagents.changed"),
      primaryFrameStart,
    );
    expect(Object.keys(listChanged)).toEqual(["type", "subagents"]);
    expect(listChanged).not.toHaveProperty("cursor");
    expect(listChanged.subagents).toEqual([
      expect.objectContaining({
        id: fixture.directSubagentId,
        label: "Renamed research worker",
      }),
      expect.objectContaining({ id: fixture.nestedSubagentId }),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(
      primarySocket.frames
        .slice(primaryFrameStart)
        .some((frame) => isFrameType("changed")(frame)),
    ).toBe(false);

    const command = {
      kind: "message.send",
      requestId: "creq_23456789sa",
      text: "Queue this only on the nested Subagent",
      stream: { kind: "subagent", id: fixture.nestedSubagentId },
    };
    const commandResponse = await fetch(`${server.baseUrl}${prefix}/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(command),
    });
    expect(commandResponse.status).toBe(202);
    const receipt = (await commandResponse.json()) as Record<string, unknown>;
    expect(Object.keys(receipt)).toEqual([...RECEIPT_KEYS]);
    expect(receipt).toMatchObject({
      schemaVersion: 2,
      outcome: "accepted",
      requestId: command.requestId,
      commandKind: "message.send",
      result: { disposition: "queued" },
      stream: command.stream,
    });
    expect(
      getThreadCommandAdmission(server.db, {
        threadId: fixture.nestedId,
        requestId: command.requestId,
      }),
    ).toMatchObject({ commandKind: "message.send" });
    for (const threadId of [fixture.primaryThreadId, fixture.directId]) {
      expect(
        getThreadCommandAdmission(server.db, {
          threadId,
          requestId: command.requestId,
        }),
      ).toBeNull();
    }

    const replayResponse = await fetch(`${server.baseUrl}${prefix}/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(command),
    });
    expect(replayResponse.status).toBe(200);
    const replay = (await replayResponse.json()) as Record<string, unknown>;
    expect(Object.keys(replay)).toEqual([...RECEIPT_KEYS]);
    expect(replay).toMatchObject({
      schemaVersion: 2,
      outcome: "already-accepted",
      requestId: command.requestId,
      stream: command.stream,
    });

    const invalidCommands = [
      {
        kind: "message.send",
        requestId: "creq_23456789sb",
        text: "Missing stream",
      },
      {
        kind: "message.send",
        requestId: "creq_23456789sc",
        text: "Malformed stream",
        stream: { kind: "subagent" },
      },
      {
        kind: "message.send",
        requestId: "creq_23456789sd",
        text: "Unknown stream",
        stream: { kind: "subagent", id: randomUUID() },
      },
      {
        kind: "message.send",
        requestId: "creq_23456789se",
        text: "Cross-Room stream",
        stream: { kind: "subagent", id: fixture.crossSubagentId },
      },
    ];
    const rejectedPublicResults: Array<{ body: string; status: number }> = [];
    for (const invalidCommand of invalidCommands) {
      const response = await fetch(`${server.baseUrl}${prefix}/commands`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(invalidCommand),
      });
      rejectedPublicResults.push({
        status: response.status,
        body: await response.text(),
      });
    }
    expect(
      new Set(rejectedPublicResults.map((result) => result.status)),
    ).toEqual(new Set([404]));
    expect(
      new Set(rejectedPublicResults.map((result) => result.body)).size,
    ).toBe(1);

    denyCommands = true;
    const deniedRequestId = "creq_23456789sf";
    const deniedResponse = await fetch(`${server.baseUrl}${prefix}/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...command,
        requestId: deniedRequestId,
        text: "Outer Principal policy denies this",
      }),
    });
    expect({
      status: deniedResponse.status,
      body: await deniedResponse.text(),
    }).toEqual(rejectedPublicResults[0]);
    denyCommands = false;

    for (const [requestId, threadIds] of [
      [
        "creq_23456789sb",
        [fixture.primaryThreadId, fixture.directId, fixture.nestedId],
      ],
      [
        "creq_23456789sc",
        [fixture.primaryThreadId, fixture.directId, fixture.nestedId],
      ],
      [
        "creq_23456789sd",
        [fixture.primaryThreadId, fixture.directId, fixture.nestedId],
      ],
      [
        "creq_23456789se",
        [
          fixture.primaryThreadId,
          fixture.directId,
          fixture.nestedId,
          fixture.crossChildId,
        ],
      ],
      [
        deniedRequestId,
        [fixture.primaryThreadId, fixture.directId, fixture.nestedId],
      ],
    ] as const) {
      for (const threadId of threadIds) {
        expect(
          getThreadCommandAdmission(server.db, { threadId, requestId }),
        ).toBeNull();
      }
    }

    const publicWire = JSON.stringify({
      bootstrap,
      initial,
      primaryEvents,
      equal,
      older,
      primaryFrames: primarySocket.frames,
      subagentFrames: subagentSocket.frames,
      receipt,
      replay,
      rejectedPublicResults,
    });
    for (const privateValue of [
      fixture.primaryThreadId,
      fixture.directId,
      fixture.nestedId,
      fixture.crossChildId,
      fixture.environmentId,
      fixture.projectId,
      PRINCIPAL.id,
      PRINCIPAL.displayName,
      ...fixture.privateTurnIds,
    ]) {
      expect(publicWire).not.toContain(privateValue);
    }
    expect(publicWire).not.toContain(fixture.crossBindingId);
    expect(publicWire).not.toContain("anchorId");
    expect(publicWire).not.toMatch(/:in-turn:|:byte-window:/u);

    primarySocket.socket.close();
    subagentSocket.socket.close();
  });
});
