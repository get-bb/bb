import type { Host, ThreadListEntry } from "@bb/domain";

// Group key for threads whose environment has no host (plain chats). Host ids
// are prefixed (e.g. "host_…"), so the sentinel cannot collide with one.
export const NO_MACHINE_GROUP_KEY = "no-machine";

interface MachineThreadGroup {
  /** Host id, or {@link NO_MACHINE_GROUP_KEY}. */
  key: string;
  label: string;
  threads: ThreadListEntry[];
}

/**
 * Buckets threads by the host their environment runs on, for the sidebar's
 * "By machine" view. Groups follow server host order; hosts the server no
 * longer lists keep a stable id-ordered section; machineless threads land in
 * a trailing "No machine" group. Machines without threads get no group.
 */
export function buildMachineThreadGroups(
  threads: readonly ThreadListEntry[],
  hosts: readonly Host[],
): MachineThreadGroup[] {
  const threadsByKey = new Map<string, ThreadListEntry[]>();
  for (const thread of threads) {
    const key = thread.environmentHostId ?? NO_MACHINE_GROUP_KEY;
    const existing = threadsByKey.get(key);
    if (existing) {
      existing.push(thread);
    } else {
      threadsByKey.set(key, [thread]);
    }
  }

  const groups: MachineThreadGroup[] = [];
  for (const host of hosts) {
    const hostThreads = threadsByKey.get(host.id);
    if (!hostThreads) {
      continue;
    }
    threadsByKey.delete(host.id);
    groups.push({ key: host.id, label: host.name, threads: hostThreads });
  }

  const noMachineThreads = threadsByKey.get(NO_MACHINE_GROUP_KEY);
  threadsByKey.delete(NO_MACHINE_GROUP_KEY);

  const unknownHostIds = Array.from(threadsByKey.keys()).sort((left, right) =>
    left.localeCompare(right),
  );
  for (const hostId of unknownHostIds) {
    groups.push({
      key: hostId,
      label: "Unknown machine",
      threads: threadsByKey.get(hostId) ?? [],
    });
  }

  if (noMachineThreads) {
    groups.push({
      key: NO_MACHINE_GROUP_KEY,
      label: "No machine",
      threads: noMachineThreads,
    });
  }

  return groups;
}
