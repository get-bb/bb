import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ThreadEvent } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createClaudeDeltaHarness } from "./delta-test-harness.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TRANSCRIPTS = resolve(__dirname, "./__fixtures__/transcripts");
const EXPECTED_PATH = resolve(TRANSCRIPTS, "expected.json");
const THREAD_ID = "bb-thread-transcript";

interface FixtureExpectation {
  items: Record<string, number>;
  tools: Record<string, number>;
  presented: Record<string, number>;
  planSnapshots: number;
  unhandled: number;
  turns: { completed: number; failed: number; interrupted: number };
}

const transcriptValueSchema = z.json();
const transcriptRecordSchema = z.record(z.string(), transcriptValueSchema);
const expectationsSchema = z.record(
  z.string(),
  z.object({
    items: z.record(z.string(), z.number()),
    tools: z.record(z.string(), z.number()),
    presented: z.record(z.string(), z.number()),
    planSnapshots: z.number(),
    unhandled: z.number(),
    turns: z.object({
      completed: z.number(),
      failed: z.number(),
      interrupted: z.number(),
    }),
  }),
);

type TranscriptValue = z.infer<typeof transcriptValueSchema>;
type TranscriptRecord = z.infer<typeof transcriptRecordSchema>;

function asRecord(value: TranscriptValue): TranscriptRecord | null {
  const parsed = transcriptRecordSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function asString(value: TranscriptValue): string | null {
  const parsed = z.string().safeParse(value);
  return parsed.success ? parsed.data : null;
}

function loadTranscript(name: string): TranscriptRecord[] {
  return readFileSync(resolve(TRANSCRIPTS, name), "utf8")
    .trim()
    .split("\n")
    .map((line) => {
      const parsed = transcriptRecordSchema.safeParse(JSON.parse(line));
      if (!parsed.success) {
        throw new Error(`${name}: non-object line`);
      }
      return parsed.data;
    });
}

function loadExpectations(): Record<string, FixtureExpectation> {
  return expectationsSchema.parse(
    JSON.parse(readFileSync(EXPECTED_PATH, "utf8")),
  );
}

function increment(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function sortedCounts(counts: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)),
  );
}

interface ToolUseBlock {
  id: string;
  name: string;
}

function toolUseBlocksOf(message: TranscriptRecord): ToolUseBlock[] {
  if (message.type !== "assistant") return [];
  const messageRecord = asRecord(message.message);
  if (messageRecord === null) return [];
  const content = messageRecord.content;
  if (!Array.isArray(content)) return [];
  const blocks: ToolUseBlock[] = [];
  for (const block of content) {
    const blockRecord = asRecord(block);
    if (blockRecord?.type !== "tool_use") continue;
    const id = asString(blockRecord.id);
    const name = asString(blockRecord.name);
    if (id !== null && name !== null) blocks.push({ id, name });
  }
  return blocks;
}

function toolResultIdsOf(message: TranscriptRecord): string[] {
  if (message.type !== "user") return [];
  const messageRecord = asRecord(message.message);
  if (messageRecord === null) return [];
  const content = messageRecord.content;
  if (!Array.isArray(content)) return [];
  const ids: string[] = [];
  for (const block of content) {
    const blockRecord = asRecord(block);
    if (blockRecord?.type !== "tool_result") continue;
    const id = asString(blockRecord.tool_use_id);
    if (id !== null) ids.push(id);
  }
  return ids;
}

interface SessionRun {
  events: ThreadEvent[];
  toolUses: ToolUseBlock[];
  toolResultIds: Set<string>;
  sidechainToolUses: Map<string, string[]>;
  itemId(providerItemId: string): string;
}

function runSession(messages: TranscriptRecord[]): SessionRun {
  const harness = createClaudeDeltaHarness();
  const events: ThreadEvent[] = [];
  const toolUses: ToolUseBlock[] = [];
  const toolResultIds = new Set<string>();
  const sidechainToolUses = new Map<string, string[]>();
  events.push(...harness.acceptInput("creq_23456789ab", THREAD_ID));
  for (const message of messages) {
    const parent = asString(message.parent_tool_use_id);
    for (const block of toolUseBlocksOf(message)) {
      toolUses.push(block);
      if (parent !== null) {
        const list = sidechainToolUses.get(parent) ?? [];
        list.push(block.id);
        sidechainToolUses.set(parent, list);
      }
    }
    for (const id of toolResultIdsOf(message)) toolResultIds.add(id);
    events.push(
      ...harness.translate(
        {
          jsonrpc: "2.0",
          method: "sdk/message",
          params: { threadId: THREAD_ID, message },
        },
        { threadId: THREAD_ID },
      ),
    );
  }
  events.push(...harness.settleSession(THREAD_ID));
  return {
    events,
    toolUses,
    toolResultIds,
    sidechainToolUses,
    itemId: (providerItemId) => harness.itemId(providerItemId, THREAD_ID),
  };
}

type StartedItem = Extract<ThreadEvent, { type: "item/started" }>["item"];

function startedItems(events: ThreadEvent[]): StartedItem[] {
  return events.flatMap((event) =>
    event.type === "item/started" ? [event.item] : [],
  );
}

function settledItemIds(events: ThreadEvent[]): Set<string> {
  const ids = new Set<string>();
  for (const event of events) {
    if (
      event.type === "item/completed" ||
      event.type === "item/backgroundTask/completed" ||
      event.type === "item/delegation/completed"
    ) {
      ids.add(event.item.id);
    }
  }
  return ids;
}

function projection(run: SessionRun): FixtureExpectation {
  const items: Record<string, number> = {};
  const tools: Record<string, number> = {};
  const presented: Record<string, number> = {};
  for (const item of startedItems(run.events)) {
    increment(items, item.type);
    if (item.type === "toolCall") {
      increment(tools, item.server ? `${item.server}:${item.tool}` : item.tool);
    }
    if ("presentation" in item && item.presentation !== undefined) {
      increment(presented, item.type);
    }
  }
  const turns = { completed: 0, failed: 0, interrupted: 0 };
  let unhandled = 0;
  let planSnapshots = 0;
  for (const event of run.events) {
    if (event.type === "provider/unhandled") unhandled += 1;
    if (event.type === "turn/completed") turns[event.status] += 1;
    if (event.type === "item/completed" && event.item.type === "planSteps") {
      planSnapshots += 1;
    }
  }
  return {
    items: sortedCounts(items),
    tools: sortedCounts(tools),
    presented: sortedCounts(presented),
    planSnapshots,
    unhandled,
    turns,
  };
}

const fixtureNames = readdirSync(TRANSCRIPTS)
  .filter((name) => name.endsWith(".ndjson"))
  .sort();
const runs = new Map(
  fixtureNames.map((name) => [name, runSession(loadTranscript(name))]),
);

describe("claude transcript fixtures", () => {
  it("covers every converted session", () => {
    expect(fixtureNames.length).toBeGreaterThan(0);
  });

  describe.each(fixtureNames)("%s", (name) => {
    const run = runs.get(name)!;

    it("opens one item per tool_use and settles it with its tool_result", () => {
      const started = new Map(
        startedItems(run.events).map((item) => [item.id, item]),
      );
      const settled = settledItemIds(run.events);
      for (const toolUse of run.toolUses) {
        const itemId = run.itemId(toolUse.id);
        expect(itemId, `${toolUse.name} ${toolUse.id} minted no item`).not.toBe(
          "",
        );
        expect(
          started.has(itemId),
          `${toolUse.name} ${toolUse.id} never started`,
        ).toBe(true);
        if (run.toolResultIds.has(toolUse.id)) {
          expect(
            settled.has(itemId),
            `${toolUse.name} ${toolUse.id} has a result but never settled`,
          ).toBe(true);
        }
      }
    });

    it("nests sidechain items under their spawning call", () => {
      const started = new Map(
        startedItems(run.events).map((item) => [item.id, item]),
      );
      for (const [parentToolUseId, childToolUseIds] of run.sidechainToolUses) {
        const parentItemId = run.itemId(parentToolUseId);
        expect(parentItemId).not.toBe("");
        for (const childToolUseId of childToolUseIds) {
          const child = started.get(run.itemId(childToolUseId));
          expect(child?.parentToolCallId, childToolUseId).toBe(parentItemId);
        }
      }
    });

    it("attaches a presentation to every started item", () => {
      const missing = startedItems(run.events).filter(
        (item) =>
          item.type !== "agentMessage" &&
          item.type !== "reasoning" &&
          !("presentation" in item && item.presentation !== undefined),
      );
      expect(missing.map((item) => `${item.type}:${item.id}`)).toEqual([]);
    });

    it("settles every turn it opens and leaves no item open", () => {
      const openTurns = new Set<string>();
      for (const event of run.events) {
        if (event.scope.kind !== "turn") continue;
        if (event.type === "turn/started") openTurns.add(event.scope.turnId);
        if (event.type === "turn/completed") {
          expect(openTurns.has(event.scope.turnId)).toBe(true);
          openTurns.delete(event.scope.turnId);
        }
      }
      expect([...openTurns]).toEqual([]);
      const settled = settledItemIds(run.events);
      const openItems = startedItems(run.events).filter(
        (item) =>
          !settled.has(item.id) &&
          item.type !== "agentMessage" &&
          item.type !== "reasoning",
      );
      expect(openItems.map((item) => `${item.type}:${item.id}`)).toEqual([]);
    });
  });

  it("matches the pinned projection (UPDATE_TRANSCRIPT_EXPECTATIONS=1 to rewrite)", () => {
    const actual = Object.fromEntries(
      fixtureNames.map((name) => [name, projection(runs.get(name)!)]),
    );
    if (process.env.UPDATE_TRANSCRIPT_EXPECTATIONS === "1") {
      writeFileSync(EXPECTED_PATH, `${JSON.stringify(actual, null, 2)}\n`);
    }
    const expected = loadExpectations();
    expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
    for (const name of fixtureNames) {
      expect(
        actual[name]!.unhandled,
        `${name}: provider/unhandled rose`,
      ).toBeLessThanOrEqual(expected[name]!.unhandled);
      expect(actual[name], name).toEqual(expected[name]);
    }
  });
});
