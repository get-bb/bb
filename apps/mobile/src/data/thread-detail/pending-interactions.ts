import type { PendingInteraction } from "@bb/domain";

/** The interaction the banner acts on: the newest of the thread's pending list. */
export function getLatestPendingInteraction(
  interactions: readonly PendingInteraction[] | undefined,
): PendingInteraction | null {
  if (!interactions || interactions.length === 0) return null;
  const [first, ...rest] = interactions;
  return rest.reduce<PendingInteraction>(
    (latest, interaction) =>
      interaction.createdAt > latest.createdAt ? interaction : latest,
    first,
  );
}
