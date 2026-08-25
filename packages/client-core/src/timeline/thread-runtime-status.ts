import { assertNever } from "@bb/core-ui";
import type { ThreadRuntimeDisplayStatus } from "@bb/domain";

export function isRunningThreadRuntimeDisplayStatus(
  status: ThreadRuntimeDisplayStatus,
): boolean {
  switch (status) {
    case "active":
    case "host-reconnecting":
    case "provisioning":
    case "starting":
    case "stopping":
      return true;
    case "error":
    // A held thread has never started: nothing is dispatching until the hold
    // releases, so it sorts and filters exactly like idle.
    case "held":
    case "idle":
    case "waiting-for-host":
      return false;
    default:
      return assertNever(status);
  }
}
