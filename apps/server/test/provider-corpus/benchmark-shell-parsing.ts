import { createHash } from "node:crypto";
import { loadavg } from "node:os";
import { threadCpuUsage } from "node:process";
import { events } from "@bb/db";
import { eq, sql } from "drizzle-orm";
import { buildThreadTimelineWithProfile } from "../../src/services/threads/timeline.js";
import { clearStoredEventDecodeCache } from "../../src/services/threads/stored-event-decode-cache.js";
import { clearTimelineSelectionMemo } from "../../src/services/threads/timeline-selection-memo.js";
import { createSyntheticThread } from "./synthetic-thread.js";

const WARMUPS = 5;
const SAMPLES = 30;
const payload = "synthetic payload words\n".repeat(4_000);
const cases = [
  { name: "normal", command: "rg value src && cat src/file.ts" },
  {
    name: "mixed-scripts",
    command: `cat > output.txt <<'EOF'\n${payload.slice(0, 8_000)}\nEOF\nrg value src`,
  },
  {
    name: "write-first",
    command: `cat > output.txt <<'EOF'\n${payload}EOF`,
  },
  {
    name: "write-last",
    command: `${"rg value src;".repeat(4_000)} cat src/file.ts > output.txt`,
  },
  { name: "read-only", command: "rg value src;".repeat(4_000) },
];

function summary(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {
    median: (sorted[middle - 1]! + sorted[middle]!) / 2,
    min: sorted[0],
    max: sorted.at(-1),
  };
}

const loadBefore = loadavg();
const results = cases.map(({ name, command }) => {
  const fixture = createSyntheticThread(1_500);
  const { db } = fixture;
  db.update(events)
    .set({ id: sql`'benchmark-event-' || ${events.sequence}` })
    .run();
  db.update(events)
    .set({
      data: sql`json_set(${events.data}, '$.item.command', ${command})`,
    })
    .where(
      name === "mixed-scripts"
        ? sql`${events.itemKind} = 'commandExecution' AND CAST(substr(${events.turnId}, 6) AS INTEGER) % 4 = 0`
        : eq(events.itemKind, "commandExecution"),
    )
    .run();
  const thread = { ...fixture.thread, status: "active" as const };
  const samples = [];
  const responseHashes = [];
  for (let sample = -WARMUPS; sample < SAMPLES; sample += 1) {
    const maxSeq = fixture.eventCount - 20 + ((sample + WARMUPS) % 21);
    clearStoredEventDecodeCache(db);
    clearTimelineSelectionMemo(db);
    const cpuStart = threadCpuUsage();
    const start = performance.now();
    const result = buildThreadTimelineWithProfile(db, thread, {
      completedTurnDisplay: "collapse",
      eventBudget: 1_500,
      includeDiagnosticOperations: false,
      includeNestedRows: true,
      maxInlineOutputChars: 32_000,
      maxSeq,
      page: { kind: "latest", segmentLimit: 20 },
    });
    const wallMs = performance.now() - start;
    const cpu = threadCpuUsage(cpuStart);
    if (sample < 0) continue;
    samples.push({
      maxSeq,
      wallMs,
      cpuMs: (cpu.user + cpu.system) / 1_000,
      profile: result.profile,
    });
    responseHashes.push(
      createHash("sha256")
        .update(
          JSON.stringify(result.response, (_key, value: unknown) =>
            typeof value === "string" && value.startsWith("timeline-v3:")
              ? `timeline-v3:${Buffer.from(value.slice(12), "base64url").toString("utf8")}`
              : value,
          ).replaceAll(thread.id, "benchmark-thread"),
        )
        .digest("hex"),
    );
  }
  fixture.close();
  return {
    name,
    commandChars: command.length,
    eventCount: fixture.eventCount,
    wallMs: summary(samples.map((sample) => sample.wallMs)),
    cpuMs: summary(samples.map((sample) => sample.cpuMs)),
    projectionMs: summary(
      samples.map((sample) =>
        sample.profile.stageTimings
          .filter((stage) => stage.stage === "thread-view-projection")
          .reduce((sum, stage) => sum + stage.durationMs, 0),
      ),
    ),
    responseHashes,
    samples,
  };
});
console.log(
  JSON.stringify({
    node: process.version,
    warmups: WARMUPS,
    sampleCount: SAMPLES,
    loadBefore,
    loadAfter: loadavg(),
    results,
  }),
);
