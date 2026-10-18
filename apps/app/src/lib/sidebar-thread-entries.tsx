import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { ThreadListEntry } from "@bb/domain";
import type { SidebarBootstrapResponse } from "@bb/server-contract";
import { useArchivedThreads } from "@/hooks/queries/thread-queries";

const EMPTY_ENTRIES: ReadonlyMap<string, ThreadListEntry> = new Map();
const SidebarThreadEntriesContext = createContext<ReadonlyMap<
  string,
  ThreadListEntry
> | null>(null);

const threadEntryMapByPayload = new WeakMap<
  SidebarBootstrapResponse,
  ReadonlyMap<string, ThreadListEntry>
>();

export function threadEntryMapFor(
  data: SidebarBootstrapResponse | undefined,
): ReadonlyMap<string, ThreadListEntry> {
  if (data === undefined) return EMPTY_ENTRIES;
  const cached = threadEntryMapByPayload.get(data);
  if (cached !== undefined) return cached;
  const entries = new Map<string, ThreadListEntry>();
  for (const project of [...data.projects, data.personalProject]) {
    for (const thread of project.threads) entries.set(thread.id, thread);
  }
  threadEntryMapByPayload.set(data, entries);
  return entries;
}

const archivedEntryMaps = new WeakMap<
  NonNullable<ReturnType<typeof useArchivedThreads>["data"]>,
  WeakMap<
    ReadonlyMap<string, ThreadListEntry>,
    ReadonlyMap<string, ThreadListEntry>
  >
>();

export function SidebarThreadEntriesProvider({
  navigation,
  children,
}: {
  navigation: SidebarBootstrapResponse | undefined;
  children: ReactNode;
}) {
  const archived = useArchivedThreads({}, { enabled: false });
  const entries = useMemo(() => {
    const active = threadEntryMapFor(navigation);
    if (archived.data === undefined) return active;
    let maps = archivedEntryMaps.get(archived.data);
    if (maps === undefined) {
      maps = new WeakMap();
      archivedEntryMaps.set(archived.data, maps);
    }
    const cached = maps.get(active);
    if (cached !== undefined) return cached;
    const merged = new Map([
      ...archived.data.pages
        .flat()
        .map((thread) => [thread.id, thread] as const),
      ...active,
    ]);
    maps.set(active, merged);
    return merged;
  }, [navigation, archived.data]);
  return (
    <SidebarThreadEntriesContext value={entries}>
      {children}
    </SidebarThreadEntriesContext>
  );
}

export function useSidebarThreadEntries(): ReadonlyMap<
  string,
  ThreadListEntry
> {
  const entries = useContext(SidebarThreadEntriesContext);
  if (entries === null) {
    throw new Error("SidebarThreadEntriesProvider is required");
  }
  return entries;
}
