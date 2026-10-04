import { useEffect } from "react";
import { useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import type { Host } from "@bb/domain";
import { createJsonLocalStorage } from "@/lib/browser-storage";
import { hostNeedsUpdate } from "@/lib/host-update-status";

const acknowledgedIssuesAtom = atomWithStorage<string[]>(
  "bb.sidebar.machineAttentionAcknowledged",
  [],
  createJsonLocalStorage<string[]>(
    (value): value is string[] =>
      Array.isArray(value) && value.every((entry) => typeof entry === "string"),
  ),
  { getOnInit: true },
);

function machineIssue(host: Host): { key: string; label: string } | null {
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
    };
  }
  if (host.lifecycle.phase !== "active" || host.status === "connected") {
    return null;
  }
  return {
    key: JSON.stringify([
      host.id,
      "offline",
      host.lastSeenAt,
      host.lastRejectedProtocolVersion,
    ]),
    label: hostNeedsUpdate(host)
      ? `${host.name} needs an update and is offline`
      : `${host.name} is offline`,
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

  const unseen = issues.filter((issue) => !acknowledged.includes(issue.key));
  return {
    label:
      unseen.length === 0
        ? null
        : unseen.length === 1
          ? unseen[0]!.label
          : `${unseen.length} machines need attention`,
    acknowledge: () => setAcknowledged(issues.map((issue) => issue.key)),
  };
}
