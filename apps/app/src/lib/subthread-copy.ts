export const SUBTHREAD_NOUN = "subthread";

export function subthreadNoun(count: number): string {
  return count === 1 ? SUBTHREAD_NOUN : `${SUBTHREAD_NOUN}s`;
}

export function formatSubthreadCount(count: number): string {
  return `${count} ${subthreadNoun(count)}`;
}
