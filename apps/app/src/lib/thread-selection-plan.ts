import type { Thread } from "@bb/domain";
import {
  THREAD_CASCADE_LIST_MAX_IDS,
  type ThreadCascadeAction,
  type ThreadCascadeListResponse,
} from "@bb/server-contract";
import { sdk } from "@/lib/sdk";

export interface ThreadSelectionPlan {
  roots: Thread[];
  cascadeThreadIdsByRootId: ReadonlyMap<string, readonly string[]>;
  childThreadCount: number;
}

export function summarizeThreadSelection(
  threads: readonly Thread[],
  cascades: ThreadCascadeListResponse["threads"],
): ThreadSelectionPlan {
  const selected = new Set(threads.map((thread) => thread.id));
  const covered = new Set(cascades.flatMap((row) => row.cascadeThreadIds));
  const roots = threads.filter((thread) => !covered.has(thread.id));
  const rootIds = new Set(roots.map((thread) => thread.id));
  const cascadeThreadIdsByRootId = new Map(
    cascades.flatMap((row) =>
      rootIds.has(row.threadId) ? [[row.threadId, row.cascadeThreadIds]] : [],
    ),
  );
  const others = new Set(
    [...cascadeThreadIdsByRootId.values()]
      .flat()
      .filter((id) => !selected.has(id)),
  );
  return { roots, cascadeThreadIdsByRootId, childThreadCount: others.size };
}

export async function planThreadSelection({
  threads,
  action,
  signal,
}: {
  threads: readonly Thread[];
  action: ThreadCascadeAction;
  signal: AbortSignal;
}): Promise<ThreadSelectionPlan> {
  const threadIds = threads.map((thread) => thread.id);
  const chunks: string[][] = [];
  for (
    let index = 0;
    index < threadIds.length;
    index += THREAD_CASCADE_LIST_MAX_IDS
  ) {
    chunks.push(threadIds.slice(index, index + THREAD_CASCADE_LIST_MAX_IDS));
  }
  const responses = await Promise.all(
    chunks.map((chunk) =>
      sdk.threads.experimental_listCascade({
        threadIds: chunk,
        action,
        signal,
      }),
    ),
  );
  return summarizeThreadSelection(
    threads,
    responses.flatMap((response) => response.threads),
  );
}
