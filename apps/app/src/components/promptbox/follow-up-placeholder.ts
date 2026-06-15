import type { ThreadRuntimeDisplayStatus } from "@bb/domain";
import { assertNever } from "@bb/core-ui";

/**
 * Placeholder copy for the follow-up prompt-box, derived from the thread's
 * runtime display status. Lives in its own module so stories can share the
 * same derivation as production
 * (ThreadDetailPromptArea) — keeping placeholder text from drifting across
 * surfaces.
 */
export function getFollowUpPromptPlaceholder(
  displayStatus: ThreadRuntimeDisplayStatus,
): string {
  switch (displayStatus) {
    case "starting":
      return "Starting thread...";
    case "stopping":
      return "Stopping thread...";
    case "waiting-for-host":
      return "Host disconnected";
    case "host-reconnecting":
      return "Waiting for host to reconnect...";
    case "error":
      return "Retry by sending a follow-up message";
    case "idle":
    case "active":
      return "Ask for a follow-up. @ to mention files, folders, or threads";
    default:
      return assertNever(displayStatus);
  }
}
