import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { z } from "zod";
import { createJsonLocalStorage } from "@/lib/browser-storage";

export const MESSAGE_ACTION_USAGE_STORAGE_KEY = "bb.messageActionUsage.v1";
const MESSAGE_ACTION_PROMOTION_SCORE = 1.5;
const PROMOTED_MESSAGE_ACTION_SLOTS = 2;

const USAGE_HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_TRACKED_ACTIONS = 64;

const usageEntrySchema = z.object({
  score: z.number().nonnegative().finite(),
  usedAt: z.number().int().nonnegative(),
});
const messageActionUsageSchema = z.record(z.string().min(1), usageEntrySchema);

type MessageActionUsageEntry = z.infer<typeof usageEntrySchema>;
export type MessageActionUsage = Readonly<
  Record<string, MessageActionUsageEntry>
>;

function isMessageActionUsage(value: unknown): value is MessageActionUsage {
  return messageActionUsageSchema.safeParse(value).success;
}

export function messageActionScore(
  usage: MessageActionUsage,
  usageKey: string,
  now: number,
): number {
  const entry = usage[usageKey];
  if (entry === undefined) return 0;
  const elapsed = Math.max(0, now - entry.usedAt);
  return entry.score * 0.5 ** (elapsed / USAGE_HALF_LIFE_MS);
}

export function recordMessageActionUsage(
  usage: MessageActionUsage,
  usageKey: string,
  now: number,
): MessageActionUsage {
  const next: Record<string, MessageActionUsageEntry> = {
    ...usage,
    [usageKey]: {
      score: messageActionScore(usage, usageKey, now) + 1,
      usedAt: now,
    },
  };
  const entries = Object.entries(next);
  if (entries.length <= MAX_TRACKED_ACTIONS) return next;
  return Object.fromEntries(
    entries
      .sort(
        ([left], [right]) =>
          messageActionScore(next, right, now) -
          messageActionScore(next, left, now),
      )
      .slice(0, MAX_TRACKED_ACTIONS),
  );
}

interface RankableMessageAction {
  usageKey: string;
  promotable: boolean;
}

export function rankInlineMessageActions<T extends RankableMessageAction>({
  actions,
  usage,
  now,
}: {
  actions: readonly T[];
  usage: MessageActionUsage;
  now: number;
}): T[] {
  const defaultInlineCount = actions.filter(
    (action) => !action.promotable,
  ).length;
  const slotCount = defaultInlineCount + PROMOTED_MESSAGE_ACTION_SLOTS;
  return actions
    .map((action, index) => ({
      action,
      index,
      score: messageActionScore(usage, action.usageKey, now),
    }))
    .filter(
      ({ action, score }) =>
        !action.promotable || score >= MESSAGE_ACTION_PROMOTION_SCORE,
    )
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, slotCount)
    .map(({ action }) => action);
}

export const messageActionUsageAtom = atomWithStorage<MessageActionUsage>(
  MESSAGE_ACTION_USAGE_STORAGE_KEY,
  {},
  createJsonLocalStorage(isMessageActionUsage),
  { getOnInit: true },
);

export const recordMessageActionUseAtom = atom(
  null,
  (get, set, usageKey: string) => {
    set(
      messageActionUsageAtom,
      recordMessageActionUsage(
        get(messageActionUsageAtom),
        usageKey,
        Date.now(),
      ),
    );
  },
);
