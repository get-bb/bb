import type { ThreadOpenSplit } from "@bb/server-contract";
import { getThreadLocationPath } from "@/lib/route-paths";
import { applyThreadOpenToLayout } from "@/views/thread-detail/splitThreadNavigation";
import { splitLayoutAtom } from "./atoms";
import { findPaneByThread, type SplitLayout } from "./index";

interface SplitLayoutStore {
  get(atom: typeof splitLayoutAtom): SplitLayout | null;
  set(atom: typeof splitLayoutAtom, value: SplitLayout): void;
}

export interface OpenThreadSplit {
  zone: ThreadOpenSplit;
  store: SplitLayoutStore;
  isCompact: boolean;
}

export interface OpenThreadArgs {
  navigate: (
    route: string,
    options?: { replace?: boolean; state?: Record<string, unknown> },
  ) => void | Promise<void>;
  projectId: string;
  threadId: string;
  split?: OpenThreadSplit;
  messageSeq?: number;
  state?: Record<string, unknown>;
}

export function openThread({
  navigate,
  projectId,
  threadId,
  split,
  messageSeq,
  state,
}: OpenThreadArgs): void {
  const route = getThreadLocationPath({
    projectId,
    threadId,
    ...(messageSeq === undefined ? {} : { messageSeq }),
  });
  const go = (options?: { replace?: boolean }) => {
    const merged = { ...options, ...(state === undefined ? {} : { state }) };
    if (Object.keys(merged).length === 0) {
      void navigate(route);
      return;
    }
    void navigate(route, merged);
  };
  const layout = split?.store.get(splitLayoutAtom) ?? null;
  if (split === undefined || layout === null) {
    go();
    return;
  }
  const alreadyOpen =
    findPaneByThread(layout.root, projectId, threadId) !== null;
  if (split.isCompact) {
    go(alreadyOpen ? { replace: true } : undefined);
    return;
  }
  const next = applyThreadOpenToLayout(
    layout,
    { projectId, threadId },
    split.zone,
  );
  if (next !== layout) {
    split.store.set(splitLayoutAtom, next);
  }
  go(alreadyOpen ? { replace: true } : undefined);
}
