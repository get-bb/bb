export const CHILD_THREAD_NOUN = "child thread";

export function childThreadNoun(count: number): string {
  return count === 1 ? CHILD_THREAD_NOUN : `${CHILD_THREAD_NOUN}s`;
}

export function formatChildThreadCount(count: number): string {
  return `${count} ${childThreadNoun(count)}`;
}
