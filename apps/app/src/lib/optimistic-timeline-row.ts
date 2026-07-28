/**
 * Client-only timeline rows: the user message a send renders immediately,
 * before the server's own row for it exists.
 *
 * An optimistic row lives in the timeline query cache and is dropped from it
 * by the refetch that brings the server's row. Because its id is minted
 * locally it can never match a server row id, so any consumer that merges
 * cached snapshots has to treat it as non-durable — a retained copy would sit
 * alongside the server row instead of being replaced by it.
 */
export const OPTIMISTIC_TIMELINE_ROW_ID_PREFIX = "optimistic-user-";

export function isOptimisticTimelineRowId(id: string): boolean {
  return id.startsWith(OPTIMISTIC_TIMELINE_ROW_ID_PREFIX);
}
