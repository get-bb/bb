import type { ThreadListEntry } from "@bb/domain";
import type {
  ProjectThreadNode,
  SidebarSectionDefinition,
  ThreadComparator,
} from "@bb/client-core";
import { useAtomValue } from "jotai";
import { sidebarGroupThreadsByEnvironmentAtom } from "../preferences/atoms.js";
import { resolveSidebarNestPreviewBeforeKey } from "./sidebarNestPreviewPlacement.js";
import type { SectionThreadDndState } from "./useSectionThreadDnd.js";

interface UseNestDropPreviewArgs {
  compareThreads: ThreadComparator | undefined;
  draftThreadIds: ReadonlySet<string>;
  pinnedRootNodes: readonly ProjectThreadNode[];
  sectionDnd: SectionThreadDndState | null;
  sections: readonly SidebarSectionDefinition[];
  threads: readonly ThreadListEntry[];
}

export function useNestDropPreview({
  compareThreads,
  draftThreadIds,
  pinnedRootNodes,
  sectionDnd,
  sections,
  threads,
}: UseNestDropPreviewArgs): SectionThreadDndState | null {
  const groupThreadsByEnvironment = useAtomValue(
    sidebarGroupThreadsByEnvironmentAtom,
  );
  if (!sectionDnd) return null;
  const { activeThread, nestTarget } = sectionDnd;
  if (!activeThread || nestTarget?.state !== "valid") return sectionDnd;
  return {
    ...sectionDnd,
    nestPreviewBeforeKey: resolveSidebarNestPreviewBeforeKey({
      activeThread,
      compareThreads,
      draftThreadIds,
      groupThreadsByEnvironment,
      parentThreadId: nestTarget.threadId,
      pinnedRootNodes,
      sections,
      threads,
    }),
  };
}
