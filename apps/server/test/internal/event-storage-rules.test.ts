import { eq } from "drizzle-orm";
import { events, PROVIDER_UNHANDLED_EVENT_MAX_BYTES } from "@bb/db";
import {
  threadScope,
  turnScope,
  type ThreadEvent,
  type ThreadEventFileChange,
} from "@bb/domain";
import {
  groupHostDaemonEvents,
  type HostDaemonEventEnvelope,
} from "@bb/host-daemon-contract";
import {
  listRecordedCells,
  recordedCellInputs,
  RECORDINGS_ROOT,
} from "@bb/provider-parity";
import { describe, expect, it } from "vitest";
import { internalAuthHeaders } from "../helpers/commands.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { createTestAppHarness } from "../helpers/test-app.js";
import type { TestAppHarness } from "../helpers/test-app.js";

interface StoredRow {
  sequence: number;
  type: string;
  itemId: string | null;
  data: string;
}

interface StorageRuleViolation {
  rule: "unhandled-cap" | "started-diff-duplicate";
  sequence: number;
  detail: string;
}

type ThreadEventInput = ThreadEvent extends infer Event
  ? Event extends ThreadEvent
    ? Omit<Event, "threadId" | "providerThreadId">
    : never
  : never;

const PROVIDER_THREAD_ID = "prov-1";

function storedRows(harness: TestAppHarness, threadId: string): StoredRow[] {
  return harness.db
    .select({
      sequence: events.sequence,
      type: events.type,
      itemId: events.itemId,
      data: events.data,
    })
    .from(events)
    .where(eq(events.threadId, threadId))
    .orderBy(events.sequence)
    .all();
}

function fileChanges(row: StoredRow): ThreadEventFileChange[] | null {
  const data = JSON.parse(row.data) as {
    item?: { type?: string; changes?: ThreadEventFileChange[] };
  };
  return data.item?.type === "fileChange" ? (data.item.changes ?? null) : null;
}

function storageRuleViolations(
  rows: readonly StoredRow[],
): StorageRuleViolation[] {
  const violations: StorageRuleViolation[] = [];
  const completedChanges = new Map<string, ThreadEventFileChange[]>();
  for (const row of rows) {
    if (row.type === "provider/unhandled") {
      const bytes = Buffer.byteLength(row.data);
      if (bytes > PROVIDER_UNHANDLED_EVENT_MAX_BYTES) {
        violations.push({
          rule: "unhandled-cap",
          sequence: row.sequence,
          detail: `${bytes} bytes`,
        });
      }
    }
    if (row.type === "item/completed" && row.itemId !== null) {
      const changes = fileChanges(row);
      if (changes !== null) completedChanges.set(row.itemId, changes);
    }
  }
  for (const row of rows) {
    if (row.type !== "item/started" || row.itemId === null) continue;
    const completed = completedChanges.get(row.itemId);
    const started = fileChanges(row);
    if (completed === undefined || started === null) continue;
    for (const [index, change] of started.entries()) {
      const settled = completed[index];
      if (
        change.diff !== undefined &&
        settled?.path === change.path &&
        settled.diff === change.diff
      ) {
        violations.push({
          rule: "started-diff-duplicate",
          sequence: row.sequence,
          detail: `${row.itemId} changes[${index}] (${change.diff.length} chars)`,
        });
      }
    }
  }
  return violations;
}

interface ReplayHost {
  environmentCount: number;
  harness: TestAppHarness;
  hostId: string;
  projectId: string;
  sessionId: string;
}

function seedReplayHost(harness: TestAppHarness): ReplayHost {
  const { host, session } = seedHostSession(harness.deps);
  const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
  return {
    environmentCount: 0,
    harness,
    hostId: host.id,
    projectId: project.id,
    sessionId: session.id,
  };
}

async function ingest(
  host: ReplayHost,
  providerId: string,
  inputs: readonly ThreadEventInput[],
): Promise<StoredRow[]> {
  const { harness } = host;
  host.environmentCount += 1;
  const environment = seedEnvironment(harness.deps, {
    hostId: host.hostId,
    projectId: host.projectId,
    path: `/tmp/event-storage-rules/${host.environmentCount}`,
  });
  const thread = seedThread(harness.deps, {
    projectId: host.projectId,
    environmentId: environment.id,
    providerId,
    status: "active",
  });
  const batch: HostDaemonEventEnvelope[] = inputs.map((input) => ({
    threadId: thread.id,
    event: {
      ...input,
      threadId: thread.id,
      providerThreadId: PROVIDER_THREAD_ID,
    } as ThreadEvent,
  }));
  const response = await harness.app.request("/internal/session/events", {
    method: "POST",
    headers: internalAuthHeaders(harness, { hostId: host.hostId }),
    body: JSON.stringify({
      sessionId: host.sessionId,
      eventGroups: groupHostDaemonEvents(batch),
    }),
  });
  expect(response.status).toBe(200);
  return storedRows(harness, thread.id);
}

function withoutThreadIdentity(event: ThreadEvent): ThreadEventInput {
  const {
    threadId: _threadId,
    providerThreadId: _providerThreadId,
    ...rest
  } = event as ThreadEvent & { providerThreadId?: string };
  return rest as ThreadEventInput;
}

function bigDiff(chars: number): string {
  return `@@ -1 +1 @@\n-${"a".repeat(chars / 2)}\n+${"b".repeat(chars / 2)}\n`;
}

const turnStarted: ThreadEventInput = {
  type: "turn/started",
  scope: turnScope("turn-1"),
};

function fileChangeItem(
  status: "pending" | "completed" | "interrupted",
  changes: ThreadEventFileChange[],
) {
  return {
    type: "fileChange" as const,
    id: "item-edit",
    status,
    approvalStatus: null,
    changes,
  };
}

const editedFile = (diff: string): ThreadEventFileChange => ({
  path: "src/notes.txt",
  kind: "update",
  diff,
});

interface PastCase {
  name: string;
  providerId: string;
  inputs: ThreadEventInput[];
  expectStartedDiff?: string;
}

const LARGE_DIFF = bigDiff(256 * 1024);

const PAST_CASES: PastCase[] = [
  {
    name: "#7522 pi system message snapshot stored whole as provider/unhandled",
    providerId: "pi",
    inputs: [
      turnStarted,
      ...(["sdk/message_start", "sdk/message_end"] as const).map(
        (rawType): ThreadEventInput => ({
          type: "provider/unhandled",
          providerId: "pi",
          rawType,
          rawEvent: {
            jsonrpc: "2.0",
            method: "sdk/message",
            params: {
              message: {
                type: rawType.slice(4),
                message: {
                  role: "system",
                  content: "",
                  sections: { skills: "s".repeat(120 * 1024) },
                  toolsAdded: [{ name: "read", description: "d".repeat(4096) }],
                },
              },
            },
          },
          scope: turnScope("turn-1"),
        }),
      ),
    ],
  },
  {
    name: "#6025 rejected extension payload kept whole in its fallback diagnostic",
    providerId: "pi",
    inputs: [
      turnStarted,
      {
        type: "thread/extensionState/updated",
        kind: "provider-nobody/goal",
        payload: { objective: "x".repeat(200 * 1024) },
        scope: threadScope(),
      },
    ],
  },
  ...["claude-code", "codex", "pi"].map((providerId): PastCase => ({
    name: `#7523 ${providerId} file change diff stored in item/started and item/completed`,
    providerId,
    inputs: [
      turnStarted,
      {
        type: "item/started",
        item: fileChangeItem("pending", [editedFile(LARGE_DIFF)]),
        scope: turnScope("turn-1"),
      },
      {
        type: "item/completed",
        item: fileChangeItem("completed", [editedFile(LARGE_DIFF)]),
        scope: turnScope("turn-1"),
      },
    ],
  })),
  {
    name: "a file change awaiting approval keeps its started diff",
    providerId: "codex",
    inputs: [
      turnStarted,
      {
        type: "item/started",
        item: fileChangeItem("pending", [editedFile(LARGE_DIFF)]),
        scope: turnScope("turn-1"),
      },
    ],
    expectStartedDiff: LARGE_DIFF,
  },
  {
    name: "a denied file change keeps its started diff when the completion carries none",
    providerId: "claude-code",
    inputs: [
      turnStarted,
      {
        type: "item/started",
        item: fileChangeItem("pending", [editedFile(LARGE_DIFF)]),
        scope: turnScope("turn-1"),
      },
      {
        type: "item/completed",
        item: fileChangeItem("interrupted", []),
        scope: turnScope("turn-1"),
      },
    ],
    expectStartedDiff: LARGE_DIFF,
  },
];

describe("event storage rules", () => {
  it("hold for every provider recording replayed through ingest", async () => {
    const harness = await createTestAppHarness();
    try {
      const host = seedReplayHost(harness);
      const cells = listRecordedCells(RECORDINGS_ROOT);
      expect(cells.length).toBeGreaterThan(0);
      const violations: string[] = [];
      for (const cell of cells) {
        const { events: recorded } = recordedCellInputs(cell);
        const rows = await ingest(
          host,
          cell.provider,
          recorded.map(withoutThreadIdentity),
        );
        for (const violation of storageRuleViolations(rows)) {
          violations.push(
            `${cell.provider}/${cell.cell} seq ${violation.sequence} ${violation.rule}: ${violation.detail}`,
          );
        }
      }
      expect(violations).toEqual([]);
    } finally {
      await harness.cleanup();
    }
  }, 120_000);

  it.each(PAST_CASES)("hold for $name", async (pastCase) => {
    const harness = await createTestAppHarness();
    try {
      const rows = await ingest(
        seedReplayHost(harness),
        pastCase.providerId,
        pastCase.inputs,
      );
      expect(storageRuleViolations(rows)).toEqual([]);
      if (pastCase.expectStartedDiff !== undefined) {
        const started = rows.find((row) => row.type === "item/started");
        expect(started && fileChanges(started)?.[0]?.diff).toBe(
          pastCase.expectStartedDiff,
        );
      }
    } finally {
      await harness.cleanup();
    }
  });
});
