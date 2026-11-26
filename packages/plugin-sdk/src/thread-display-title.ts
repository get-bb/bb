import type { ExperimentalThreadDisplayTitleInput } from "./app-contract.js";

export function experimental_threadDisplayTitle(
  thread: ExperimentalThreadDisplayTitleInput,
): string {
  if (thread.title !== null && thread.title.trim().length > 0) {
    return thread.title;
  }
  if (thread.titleFallback !== null && thread.titleFallback.trim().length > 0) {
    return thread.titleFallback;
  }
  return `Thread ${thread.id.slice(0, 8)}`;
}
