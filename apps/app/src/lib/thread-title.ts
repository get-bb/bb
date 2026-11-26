import { experimental_threadDisplayTitle } from "@get-bb/plugin-sdk";
import type { Thread } from "@bb/domain";

export function getThreadDisplayTitle(
  thread: Pick<Thread, "id" | "title" | "titleFallback">,
): string {
  return experimental_threadDisplayTitle(thread);
}
