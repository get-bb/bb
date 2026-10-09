import { experimental_useRpcQuery } from "@get-bb/plugin-sdk/app";
import type { TasksRpcContract } from "../shared/contract.js";

export function TasksSidebarAccessory() {
  const query = experimental_useRpcQuery<
    TasksRpcContract,
    "sidebarOpenTaskCount"
  >({
    method: "sidebarOpenTaskCount",
    input: null,
    realtime: [{ channel: "tasks:changed" }, { channel: "projects:changed" }],
  });
  const count = query.data?.openTaskCount;
  return count === undefined || count === 0 ? null : (
    <span className="text-muted-foreground tabular-nums">{count}</span>
  );
}
