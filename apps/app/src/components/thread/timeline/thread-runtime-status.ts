import { assertNever } from "@bb/core-ui";
import type { ThreadRuntimeDisplayStatus } from "@bb/domain";

export function isRunningThreadRuntimeDisplayStatus(
  status: ThreadRuntimeDisplayStatus,
): boolean {
  switch (status) {
    case "active":
    case "host-reconnecting":
    case "starting":
    case "stopping":
      return true;
    case "error":
    case "idle":
    case "waiting-for-host":
      return false;
    default:
      return assertNever(status);
  }
}
