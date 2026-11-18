const generationsByThreadId = new Map<string, number>();

export function getThreadEventRewriteGeneration(threadId: string): number {
  return generationsByThreadId.get(threadId) ?? 0;
}

export function adoptThreadEventRewriteGeneration(
  threadId: string,
  generation: number,
): void {
  generationsByThreadId.set(threadId, generation);
}

export function bumpThreadEventRewriteGeneration(threadId: string): void {
  generationsByThreadId.set(
    threadId,
    getThreadEventRewriteGeneration(threadId) + 1,
  );
}
