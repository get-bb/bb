import {
  events,
  getThread,
  nextStepDismissals,
  nextStepInstallState,
  nextSteps,
  threads,
  type DbConnection,
  type DbQueryConnection,
} from "@bb/db";
import {
  nextStepInputSchema,
  nextStepSchema,
  type NextStep,
  type NextStepInput,
  type NextStepResult,
} from "@bb/domain";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { ApiError } from "../../errors.js";
import type { WorkSessionDeps } from "../../types.js";
import { parseStoredEvent } from "./thread-data.js";
import { validateNextStepEvidence } from "./next-step-evidence.js";

const DAY2_IDLE_MS = 30 * 60 * 1000;

function installState(db: DbQueryConnection) {
  db.insert(nextStepInstallState)
    .values({ id: 1, lastUserMessageAt: 0 })
    .onConflictDoNothing()
    .run();
  return db
    .select()
    .from(nextStepInstallState)
    .where(eq(nextStepInstallState.id, 1))
    .get()!;
}

function calendarDate(at: number, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

export function nextStepDeliveryAt(now: number, timezone: string): number {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const localParts = (at: number) => {
    const parts = formatter.formatToParts(at);
    const value = (type: string) =>
      Number(parts.find((part) => part.type === type)?.value);
    return Date.UTC(
      value("year"),
      value("month") - 1,
      value("day"),
      value("hour"),
      value("minute"),
      value("second"),
    );
  };
  const day = new Date(localParts(now));
  day.setUTCHours(9, 0, 0, 0);
  do {
    day.setUTCDate(day.getUTCDate() + 1);
  } while (day.getUTCDay() === 0 || day.getUTCDay() === 6);
  const target = day.getTime();
  let delivery = target;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const difference = target - localParts(delivery);
    if (difference === 0) return delivery;
    delivery += difference;
  }
  throw new ApiError(
    400,
    "next_step_invalid_schedule",
    "Could not schedule the next weekday at 09:00 in this timezone",
  );
}

function normalizeNextStepSchedule(
  input: NextStepInput,
  now: number,
): NextStepInput {
  if (input.action.kind !== "automation") return input;
  const automation = input.action.automation;
  return {
    ...input,
    action: {
      kind: "automation",
      automation: {
        ...automation,
        schedule: {
          ...automation.schedule,
          runAt: nextStepDeliveryAt(now, automation.schedule.timezone),
        },
      },
    },
  };
}

function isInstallFirstDay(
  db: DbQueryConnection,
  now: number,
  timezone: string,
): boolean {
  const first = db
    .select({ createdAt: threads.createdAt })
    .from(threads)
    .orderBy(asc(threads.createdAt))
    .limit(1)
    .get();
  return (
    first !== undefined &&
    calendarDate(first.createdAt, timezone) === calendarDate(now, timezone)
  );
}

function readNextStep(
  db: DbQueryConnection,
  threadId: string,
): NextStep | null {
  const row = db
    .select({ suggestion: nextSteps.suggestion })
    .from(nextSteps)
    .where(eq(nextSteps.threadId, threadId))
    .get();
  return row ? nextStepSchema.parse(row.suggestion) : null;
}

function writeNextStep(db: DbQueryConnection, suggestion: NextStep): NextStep {
  db.update(nextSteps)
    .set({ status: suggestion.status, suggestion })
    .where(eq(nextSteps.threadId, suggestion.threadId))
    .run();
  return suggestion;
}

function requireNextStep(db: DbQueryConnection, threadId: string): NextStep {
  const suggestion = readNextStep(db, threadId);
  if (!suggestion)
    throw new ApiError(
      404,
      "next_step_not_found",
      "No Next step exists for this thread",
    );
  return suggestion;
}

function assertThreadCanPropose(
  db: DbQueryConnection,
  threadId: string,
  turnId: string,
): void {
  const thread = getThread(db, threadId);
  if (!thread || thread.deletedAt !== null || thread.archivedAt !== null)
    throw new ApiError(
      409,
      "next_step_thread_unavailable",
      "Next steps require an available thread",
    );
  const latestTurn = db
    .select({ turnId: events.turnId })
    .from(events)
    .where(
      and(
        eq(events.threadId, threadId),
        eq(events.type, "turn/started"),
        isNull(events.parentToolCallId),
      ),
    )
    .orderBy(desc(events.sequence))
    .limit(1)
    .get();
  if (latestTurn?.turnId !== turnId)
    throw new ApiError(
      400,
      "next_step_invalid_turn",
      "The suggestion must belong to the latest turn in this thread",
    );
}

function assertNotSuppressed(
  db: DbQueryConnection,
  input: NextStepInput,
): void {
  const dismissal = db
    .select()
    .from(nextStepDismissals)
    .where(eq(nextStepDismissals.kind, input.action.kind))
    .get();
  if (
    dismissal &&
    input.evidence.every((entry) => dismissal.sources.includes(entry.source))
  ) {
    throw new ApiError(
      409,
      "next_step_suppressed",
      "This kind of suggestion is suppressed until a different evidence source is available",
    );
  }
}

export function getNextStep(
  db: DbConnection,
  threadId: string,
  now = Date.now(),
): NextStep | null {
  return db.transaction((tx) => promoteNextStep(tx, threadId, now), {
    behavior: "immediate",
  });
}

export async function proposeNextStep(
  deps: WorkSessionDeps,
  args: {
    threadId: string;
    turnId: string;
    input: NextStepInput;
    now?: number;
  },
): Promise<NextStep> {
  const now = args.now ?? Date.now();
  const input = normalizeNextStepSchedule(
    nextStepInputSchema.parse(args.input),
    now,
  );
  if (readNextStep(deps.db, args.threadId))
    throw new ApiError(
      409,
      "next_step_already_proposed",
      "This thread already has a Next step",
    );
  assertThreadCanPropose(deps.db, args.threadId, args.turnId);
  assertNotSuppressed(deps.db, input);
  if (input.action.kind === "automation") {
    const { timezone } = input.action.automation.schedule;
    if (!isInstallFirstDay(deps.db, now, timezone))
      throw new ApiError(
        409,
        "next_step_first_day_only",
        "The day-two offer is available only on the install's first day",
      );
    if (installState(deps.db).day2ShownAt !== null)
      throw new ApiError(
        409,
        "next_step_day2_already_shown",
        "The day-two offer has already been shown",
      );
  }
  await validateNextStepEvidence(deps, args.threadId, input.evidence);
  return deps.db.transaction(
    (tx) => {
      assertNotSuppressed(tx, input);
      assertThreadCanPropose(tx, args.threadId, args.turnId);
      if (installState(tx).lastUserMessageAt > now)
        throw new ApiError(
          409,
          "next_step_new_message",
          "A new message arrived while verifying the suggestion",
        );
      const completion = tx
        .select()
        .from(events)
        .where(
          and(
            eq(events.threadId, args.threadId),
            eq(events.turnId, args.turnId),
            eq(events.type, "turn/completed"),
          ),
        )
        .orderBy(desc(events.sequence))
        .limit(1)
        .get();
      const completedEvent = completion ? parseStoredEvent(completion) : null;
      if (
        completedEvent?.type === "turn/completed" &&
        completedEvent.status !== "completed"
      )
        throw new ApiError(
          409,
          "next_step_failed_turn",
          "Only a successful turn can offer a Next step",
        );
      const suggestion: NextStep = {
        ...input,
        id: `nst_${randomUUID()}`,
        analyticsId: randomUUID(),
        threadId: args.threadId,
        turnId: args.turnId,
        status: "pending",
        createdAt: now,
        shownAt: null,
        result: null,
      };
      const inserted = tx
        .insert(nextSteps)
        .values({
          threadId: args.threadId,
          turnId: args.turnId,
          kind: input.action.kind,
          status: suggestion.status,
          suggestion,
          completedAt: completion?.createdAt ?? null,
        })
        .onConflictDoNothing()
        .returning({ threadId: nextSteps.threadId })
        .get();
      if (!inserted)
        throw new ApiError(
          409,
          "next_step_already_proposed",
          "This thread already has a Next step",
        );
      if (completion) {
        const state = installState(tx);
        if (state.lastSuccessfulTurnId === null)
          tx.update(nextStepInstallState)
            .set({
              lastSuccessfulThreadId: args.threadId,
              lastSuccessfulTurnId: args.turnId,
            })
            .where(eq(nextStepInstallState.id, 1))
            .run();
      }
      return suggestion;
    },
    { behavior: "immediate" },
  );
}

export function completeNextStepTurn(
  db: DbConnection,
  args: {
    threadId: string;
    turnId: string;
    successful: boolean;
    completedAt: number;
  },
): void {
  db.transaction(
    (tx) => {
      installState(tx);
      if (args.successful) {
        tx.update(nextStepInstallState)
          .set({
            lastSuccessfulThreadId: args.threadId,
            lastSuccessfulTurnId: args.turnId,
          })
          .where(eq(nextStepInstallState.id, 1))
          .run();
      }
      const suggestion = readNextStep(tx, args.threadId);
      if (suggestion?.turnId !== args.turnId || suggestion.status !== "pending")
        return;
      if (!args.successful) {
        writeNextStep(tx, { ...suggestion, status: "expired" });
        return;
      }
      tx.update(nextSteps)
        .set({ completedAt: args.completedAt })
        .where(eq(nextSteps.threadId, args.threadId))
        .run();
    },
    { behavior: "immediate" },
  );
}

export function expireNextStep(db: DbConnection, threadId: string): void {
  db.transaction(
    (tx) => {
      const suggestion = readNextStep(tx, threadId);
      if (
        suggestion &&
        (suggestion.status === "pending" || suggestion.status === "proposed")
      ) {
        writeNextStep(tx, { ...suggestion, status: "expired" });
      }
    },
    { behavior: "immediate" },
  );
}

export function noteNextStepUserMessage(
  db: DbConnection,
  args: { threadId: string; now?: number },
): void {
  db.transaction(
    (tx) => {
      installState(tx);
      tx.update(nextStepInstallState)
        .set({ lastUserMessageAt: args.now ?? Date.now() })
        .where(eq(nextStepInstallState.id, 1))
        .run();
      const suggestion = readNextStep(tx, args.threadId);
      if (
        suggestion &&
        (suggestion.status === "pending" || suggestion.status === "proposed")
      )
        writeNextStep(tx, { ...suggestion, status: "expired" });
    },
    { behavior: "immediate" },
  );
}

function promoteNextStep(
  db: DbQueryConnection,
  threadId: string,
  now: number,
): NextStep | null {
  const suggestion = readNextStep(db, threadId);
  if (
    !suggestion ||
    (suggestion.status !== "pending" && suggestion.status !== "proposed")
  )
    return suggestion;
  try {
    assertThreadCanPropose(db, threadId, suggestion.turnId);
  } catch {
    return writeNextStep(db, { ...suggestion, status: "expired" });
  }
  if (suggestion.status === "proposed") return suggestion;
  const row = db
    .select({ completedAt: nextSteps.completedAt })
    .from(nextSteps)
    .where(eq(nextSteps.threadId, threadId))
    .get();
  if (row?.completedAt === null || row?.completedAt === undefined)
    return suggestion;
  if (suggestion.action.kind === "automation") {
    const state = installState(db);
    if (
      state.day2ShownAt !== null ||
      state.lastUserMessageAt > row.completedAt ||
      state.lastSuccessfulThreadId !== suggestion.threadId ||
      state.lastSuccessfulTurnId !== suggestion.turnId
    )
      return writeNextStep(db, { ...suggestion, status: "expired" });
    if (now < row.completedAt + DAY2_IDLE_MS) return suggestion;
    const { timezone } = suggestion.action.automation.schedule;
    if (!isInstallFirstDay(db, now, timezone))
      return writeNextStep(db, { ...suggestion, status: "expired" });
  }
  try {
    assertNotSuppressed(db, suggestion);
  } catch {
    return writeNextStep(db, { ...suggestion, status: "expired" });
  }
  if (suggestion.action.kind === "automation")
    db.update(nextStepInstallState)
      .set({ day2ShownAt: now })
      .where(
        and(
          eq(nextStepInstallState.id, 1),
          isNull(nextStepInstallState.day2ShownAt),
        ),
      )
      .run();
  return writeNextStep(db, { ...suggestion, status: "proposed" });
}

export function showNextStep(
  db: DbConnection,
  args: { threadId: string; now?: number },
): { suggestion: NextStep | null; newlyShown: boolean } {
  const now = args.now ?? Date.now();
  return db.transaction(
    (tx) => {
      const suggestion = promoteNextStep(tx, args.threadId, now);
      if (suggestion?.status !== "proposed" || suggestion.shownAt !== null)
        return { suggestion, newlyShown: false };
      return {
        suggestion: writeNextStep(tx, { ...suggestion, shownAt: now }),
        newlyShown: true,
      };
    },
    { behavior: "immediate" },
  );
}

export function linkNextStepResult(
  db: DbConnection,
  args: { threadId: string; result: NextStepResult },
): void {
  db.transaction(
    (tx) => {
      const suggestion = requireNextStep(tx, args.threadId);
      if (
        suggestion.status !== "accepting" ||
        suggestion.action.kind !== args.result.kind
      )
        throw new ApiError(
          409,
          "next_step_not_accepting",
          "This Next step is not being accepted",
        );
      writeNextStep(tx, { ...suggestion, result: args.result });
    },
    { behavior: "immediate" },
  );
}

export async function acceptNextStep(
  db: DbConnection,
  args: {
    threadId: string;
    execute: (
      suggestion: NextStep,
      acceptedAt: number,
    ) => Promise<NextStepResult>;
  },
): Promise<{ suggestion: NextStep; newlyAccepted: boolean }> {
  const acceptedAt = Date.now();
  const claimed = db.transaction(
    (tx) => {
      promoteNextStep(tx, args.threadId, acceptedAt);
      const suggestion = requireNextStep(tx, args.threadId);
      if (suggestion.status === "accepted")
        return { suggestion, execute: false };
      if (suggestion.status !== "proposed")
        throw new ApiError(
          409,
          "next_step_not_available",
          "This Next step is no longer available",
        );
      return {
        suggestion: writeNextStep(tx, {
          ...suggestion,
          ...normalizeNextStepSchedule(suggestion, acceptedAt),
          status: "accepting",
        }),
        execute: true,
      };
    },
    { behavior: "immediate" },
  );
  if (!claimed.execute)
    return { suggestion: claimed.suggestion, newlyAccepted: false };
  try {
    const result = await args.execute(claimed.suggestion, acceptedAt);
    if (result.kind !== claimed.suggestion.action.kind)
      throw new Error("Next step execution returned the wrong result kind");
    const suggestion = writeNextStep(db, {
      ...claimed.suggestion,
      status: "accepted",
      result,
    });
    return { suggestion, newlyAccepted: true };
  } catch (error) {
    const linked = requireNextStep(db, args.threadId);
    if (linked.result !== null)
      return {
        suggestion: writeNextStep(db, { ...linked, status: "accepted" }),
        newlyAccepted: true,
      };
    writeNextStep(db, { ...claimed.suggestion, status: "expired" });
    throw error;
  }
}

export function dismissNextStep(
  db: DbConnection,
  threadId: string,
): { suggestion: NextStep; newlyDismissed: boolean } {
  return db.transaction(
    (tx) => {
      const suggestion = requireNextStep(tx, threadId);
      if (suggestion.status === "dismissed")
        return { suggestion, newlyDismissed: false };
      if (suggestion.status !== "proposed")
        throw new ApiError(
          409,
          "next_step_not_available",
          "This Next step is no longer available",
        );
      const sources = [
        ...new Set(suggestion.evidence.map((entry) => entry.source)),
      ];
      tx.insert(nextStepDismissals)
        .values({ kind: suggestion.action.kind, sources })
        .onConflictDoUpdate({
          target: nextStepDismissals.kind,
          set: { sources },
        })
        .run();
      return {
        suggestion: writeNextStep(tx, { ...suggestion, status: "dismissed" }),
        newlyDismissed: true,
      };
    },
    { behavior: "immediate" },
  );
}

export async function undoNextStep(
  db: DbConnection,
  args: { threadId: string; undo: (automationId: string) => Promise<void> },
): Promise<NextStep> {
  const claimed = db.transaction(
    (tx) => {
      const suggestion = requireNextStep(tx, args.threadId);
      if (suggestion.status === "undone") return suggestion;
      if (
        suggestion.status !== "accepted" ||
        suggestion.result?.kind !== "automation"
      )
        throw new ApiError(
          409,
          "next_step_not_undoable",
          "Only an automation Next step has a result reminder to cancel",
        );
      return writeNextStep(tx, { ...suggestion, status: "undoing" });
    },
    { behavior: "immediate" },
  );
  if (claimed.status === "undone") return claimed;
  if (claimed.result?.kind !== "automation")
    throw new Error("Missing scheduled Next step result");
  try {
    await args.undo(claimed.result.automationId);
    return writeNextStep(db, { ...claimed, status: "undone" });
  } catch (error) {
    writeNextStep(db, { ...claimed, status: "accepted" });
    throw error;
  }
}
