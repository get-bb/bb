import { useEffect, useMemo, useRef, useState } from "react";
import { useSdk } from "@get-bb/plugin-sdk/app";
import type { SidebarThread } from "../model/sidebar-thread.js";
import {
  isSidebarSortKeyCandidate,
  readSidebarSortKey,
  type SidebarSortKeys,
} from "../model/section-sort-keys.js";

const METADATA_LIST_BATCH_SIZE = 200;
const SORT_KEY_REFRESH_INTERVAL_MS = 60_000;
const EMPTY_SORT_KEYS: SidebarSortKeys = new Map();

function threadIdsByOriginPlugin(
  threads: readonly SidebarThread[],
): Map<string, string[]> {
  const byPluginId = new Map<string, string[]>();
  for (const thread of threads) {
    if (!isSidebarSortKeyCandidate(thread) || thread.originPluginId === null) {
      continue;
    }
    const threadIds = byPluginId.get(thread.originPluginId);
    if (threadIds) {
      threadIds.push(thread.id);
    } else {
      byPluginId.set(thread.originPluginId, [thread.id]);
    }
  }
  for (const threadIds of byPluginId.values()) {
    threadIds.sort();
  }
  return byPluginId;
}

function haveSameSortKeys(
  left: SidebarSortKeys,
  right: SidebarSortKeys,
): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const [threadId, key] of left) {
    if (right.get(threadId) !== key) {
      return false;
    }
  }
  return true;
}

export function useSidebarSortKeys(
  threads: readonly SidebarThread[],
): SidebarSortKeys {
  const sdk = useSdk();
  const requests = useMemo(
    () =>
      [...threadIdsByOriginPlugin(threads)].sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    [threads],
  );
  const requestKey = JSON.stringify(requests);
  const requestsRef = useRef(requests);
  requestsRef.current = requests;
  const [sortKeys, setSortKeys] = useState<SidebarSortKeys>(EMPTY_SORT_KEYS);

  useEffect(() => {
    const requests = requestsRef.current;
    if (requests.length === 0) {
      return;
    }
    let cancelled = false;
    const load = async () => {
      const keys = new Map<string, number>();
      for (const [pluginId, threadIds] of requests) {
        for (
          let start = 0;
          start < threadIds.length;
          start += METADATA_LIST_BATCH_SIZE
        ) {
          const { threads: rows } =
            await sdk.threads.experimental_listPluginMetadata({
              pluginId,
              threadIds: threadIds.slice(
                start,
                start + METADATA_LIST_BATCH_SIZE,
              ),
            });
          for (const { threadId, metadata } of rows) {
            const key = readSidebarSortKey(metadata);
            if (key !== null) {
              keys.set(threadId, key);
            }
          }
        }
      }
      return keys;
    };
    const refresh = () => {
      load().then(
        (keys) => {
          if (!cancelled) {
            setSortKeys((current) =>
              haveSameSortKeys(current, keys) ? current : keys,
            );
          }
        },
        () => {},
      );
    };
    refresh();
    const interval = setInterval(refresh, SORT_KEY_REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [requestKey, sdk]);

  return requests.length === 0 ? EMPTY_SORT_KEYS : sortKeys;
}
