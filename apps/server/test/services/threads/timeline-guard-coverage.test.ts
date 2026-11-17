import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { events } from "@bb/db";
import {
  threadEventTypeValues,
  threadScope,
  turnScope,
  validateThreadEventScope,
  type ThreadEventType,
} from "@bb/domain";
import { THREAD_TIMELINE_EXCLUDED_EVENT_TYPES } from "@bb/thread-view";
import { withTestHarness } from "../../helpers/test-app.js";
import {
  createRng,
  createThreadLog,
  EXTENSION_STATE_EVENT_LOG,
  INTERLEAVED_EVENT_LOG,
  MIXED_EVENT_LOG,
} from "./timeline-guard-harness.js";

type ScopeKind = "thread" | "turn";

const LEGACY_REPLACED = (replacement: string) =>
  `Legacy; read back as ${replacement}, which the generator produces.`;
const LEGACY_UNWRITTEN =
  "Legacy; nothing writes it now, so only old threads have it.";
const NOT_GENERATED_YET =
  "Not generated yet, so the equivalence tests do not check where it is placed.";

const NOT_GENERATED: Readonly<Record<string, string>> = {
  "thread/goal/updated (thread scope)": LEGACY_REPLACED(
    "thread/extensionState/updated",
  ),
  "thread/goal/cleared (thread scope)": LEGACY_REPLACED(
    "thread/extensionState/updated",
  ),
  "system/permissionGrant/lifecycle (turn scope)": LEGACY_REPLACED(
    "system/interaction/lifecycle",
  ),
  "system/userQuestion/lifecycle (turn scope)": LEGACY_REPLACED(
    "system/interaction/lifecycle",
  ),
  "client/turn/start (thread scope)": LEGACY_UNWRITTEN,
  "system/manager/user_message (thread scope)": LEGACY_UNWRITTEN,
  "system/manager/user_message (turn scope)": LEGACY_UNWRITTEN,
  "system/provider-turn-watchdog (thread scope)": LEGACY_UNWRITTEN,
  "provider.env-resolved (thread scope)":
    "Shown only with diagnostic events on; the equivalence tests run with them off.",
  "thread/name/updated (thread scope)": NOT_GENERATED_YET,
  "thread/context/cleared (turn scope)": NOT_GENERATED_YET,
  "item/fileChange/outputDelta (turn scope)": NOT_GENERATED_YET,
  "item/reasoning/summaryTextDelta (turn scope)": NOT_GENERATED_YET,
  "item/reasoning/textDelta (turn scope)": NOT_GENERATED_YET,
  "item/plan/delta (turn scope)": NOT_GENERATED_YET,
  "item/mcpToolCall/progress (turn scope)": NOT_GENERATED_YET,
  "item/toolCall/progress (turn scope)": NOT_GENERATED_YET,
  "item/delegation/progress (thread scope)": NOT_GENERATED_YET,
  "turn/plan/updated (turn scope)": NOT_GENERATED_YET,
  "provider/error (thread scope)": NOT_GENERATED_YET,
  "provider/error (turn scope)": NOT_GENERATED_YET,
  "provider/rateLimits/updated (thread scope)": NOT_GENERATED_YET,
  "client/thread/start (thread scope)": NOT_GENERATED_YET,
  "system/error (thread scope)": NOT_GENERATED_YET,
  "system/error (turn scope)": NOT_GENERATED_YET,
  "system/thread/interrupted (thread scope)": NOT_GENERATED_YET,
  "system/operation (turn scope)": NOT_GENERATED_YET,
  "system/thread-provisioning (thread scope)": NOT_GENERATED_YET,
};

const SEEDS = [1, 2, 3, 4];
const STEPS_PER_SEED = 1_000;

function eventKind(type: string, scope: ScopeKind): string {
  return `${type} (${scope} scope)`;
}

function displayableEventKinds(): string[] {
  const excluded = new Set<ThreadEventType>(
    THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
  );
  return threadEventTypeValues
    .filter((type) => !excluded.has(type))
    .flatMap((type) =>
      (
        [
          ["thread", threadScope()],
          ["turn", turnScope("turn")],
        ] as const
      ).flatMap(([kind, scope]) =>
        validateThreadEventScope({ type, scope }).valid
          ? [eventKind(type, kind)]
          : [],
      ),
    );
}

describe("timeline equivalence generator coverage", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("produces every event kind a full build can display", async () => {
    const generated = new Set<string>();
    for (const shape of [
      MIXED_EVENT_LOG,
      INTERLEAVED_EVENT_LOG,
      EXTENSION_STATE_EVENT_LOG,
    ]) {
      for (const seed of SEEDS) {
        await withTestHarness(async (harness) => {
          const log = createThreadLog({
            harness,
            providerId: "codex",
            rng: createRng(seed),
            shape,
          });
          log.bulk(STEPS_PER_SEED);
          log.finishOpenWork();
          const rows = harness.db
            .selectDistinct({ scope: events.scopeKind, type: events.type })
            .from(events)
            .where(eq(events.threadId, log.threadId))
            .all();
          for (const row of rows) {
            generated.add(eventKind(row.type, row.scope));
          }
        });
      }
    }
    const displayable = displayableEventKinds();
    expect(
      displayable.filter(
        (kind) => !generated.has(kind) && !(kind in NOT_GENERATED),
      ),
      "event kinds the full build can display but the generator in timeline-guard-harness.ts never produces; generate them or list them in NOT_GENERATED with a reason",
    ).toEqual([]);
    expect(
      Object.keys(NOT_GENERATED).filter(
        (kind) => generated.has(kind) || !displayable.includes(kind),
      ),
      "NOT_GENERATED entries the generator now produces or that no longer exist",
    ).toEqual([]);
  });
});
