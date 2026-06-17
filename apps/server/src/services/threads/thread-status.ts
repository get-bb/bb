import type { ThreadStatus } from "@bb/domain";

export type PreStartThreadStatus = Extract<
  ThreadStatus,
  "starting"
>;

export function isPreStartThreadStatus(
  status: ThreadStatus,
): status is PreStartThreadStatus {
  return status === "starting";
}
