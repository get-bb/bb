import { useEffect } from "react";
import { useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import type { Host } from "@bb/domain";
import { createJsonLocalStorage } from "@/lib/browser-storage";

const acknowledgedIssuesAtom = atomWithStorage<string[]>(
  "bb.sidebar.machineAttentionAcknowledged",
  [],
  createJsonLocalStorage<string[]>(
    (value): value is string[] =>
      Array.isArray(value) && value.every((entry) => typeof entry === "string"),
  ),
  { getOnInit: true },
);

function machineIssue(
  host: Host,
): { key: string; label: string; offline: boolean } | null {
  if (host.type === "ephemeral") return null;
  if (
    host.lifecycle.phase === "removing" &&
    host.lifecycle.teardown?.status === "failed"
  ) {
    return {
      key: JSON.stringify([
        host.id,
        "cleanup-failed",
        host.lifecycle.teardown.attempt,
        host.lifecycle.message,
      ]),
      label: `${host.name} cleanup failed`,
      offline: false,
    };
  }
  if (host.lifecycle.phase !== "active" || host.status === "connected") {
    return null;
  }
  return {
    key: JSON.stringify([host.id, "offline", host.lastSeenAt]),
    label: `${host.name} is offline`,
    offline: true,
  };
}

export function useMachineAttention(hosts: Host[], isLoading: boolean) {
  const [acknowledged, setAcknowledged] = useAtom(acknowledgedIssuesAtom);
  const issues = hosts.flatMap((host) => {
    const issue = machineIssue(host);
    return issue === null ? [] : [issue];
  });

  useEffect(() => {
    if (isLoading || hosts.length === 0) return;
    const remaining = acknowledged.filter((key) =>
      issues.some((issue) => issue.key === key),
    );
    if (remaining.length !== acknowledged.length) {
      setAcknowledged(remaining);
    }
  }, [acknowledged, hosts.length, isLoading, issues, setAcknowledged]);

  return {
    label:
      issues.every((issue) => acknowledged.includes(issue.key))
        ? null
        : issues.length === 1
          ? issues[0]!.label
          : issues.every((issue) => issue.offline)
            ? "Machines offline"
            : `${issues.length} machines need attention`,
    acknowledge: () => setAcknowledged(issues.map((issue) => issue.key)),
  };
}
