import type { ExperimentalBadge } from "@get-bb/plugin-sdk/app";
import { useTaskRead } from "./data.js";
export function useTasksBadge(): ExperimentalBadge | null {
  const { data } = useTaskRead(
    "sidebarOpenTaskCount",
    null,
    (value) => value.openTaskCount,
  );
  return data
    ? { count: data, label: data === 1 ? "1 open task" : `${data} open tasks` }
    : null;
}
