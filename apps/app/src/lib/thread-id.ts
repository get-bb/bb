export function hasThreadId(
  threadId: string | null | undefined,
): threadId is string {
  return threadId !== null && threadId !== undefined && threadId.length > 0;
}
