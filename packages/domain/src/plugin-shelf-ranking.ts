export const BB_OFFICIAL_COLLECTION_ID = "bb-official";

const TRENDING_MIN_RECENT_INSTALLS = 5;
const TRENDING_GRAVITY = 1.5;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface PluginShelfRankingSignals {
  id: string;
  recentInstalls: number | null;
  publishedAt?: string;
}

function publishedTime(publishedAt: string | undefined): number {
  const time = Date.parse(publishedAt ?? "");
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

export function rankPluginShelf<Entry>(
  entries: readonly Entry[],
  signals: (entry: Entry) => PluginShelfRankingSignals,
  now: number,
): Entry[] {
  const ranked = entries.map((entry) => {
    const { id, recentInstalls, publishedAt } = signals(entry);
    const recent = recentInstalls ?? 0;
    const published = publishedTime(publishedAt);
    const ageDays = Math.max(0, (now - published) / DAY_MS);
    return {
      entry,
      id,
      published,
      trending: recent >= TRENDING_MIN_RECENT_INSTALLS,
      score: recent / (ageDays + 2) ** TRENDING_GRAVITY,
    };
  });
  const newestFirst = (
    left: (typeof ranked)[number],
    right: (typeof ranked)[number],
  ) =>
    (right.published === left.published
      ? 0
      : right.published > left.published
        ? 1
        : -1) || left.id.localeCompare(right.id);
  return ranked
    .sort(
      (left, right) =>
        Number(right.trending) - Number(left.trending) ||
        (left.trending ? right.score - left.score : 0) ||
        newestFirst(left, right),
    )
    .map(({ entry }) => entry);
}
