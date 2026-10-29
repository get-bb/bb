import {
  experimental_useRpcQuery,
  type ExperimentalBadge,
} from "@get-bb/plugin-sdk/app";
import { tasksRpcContract } from "../shared/contract.js";

export function useTasksBadge(): ExperimentalBadge | null {
  const { data } = experimental_useRpcQuery({
    contract: tasksRpcContract,
    method: "sidebarOpenTaskCount",
    input: null,
  });
  const count = data?.openTaskCount ?? null;
  if (count === null || count === 0) return null;
  return {
    count,
    label: count === 1 ? "1 open task" : `${count} open tasks`,
  };
}
