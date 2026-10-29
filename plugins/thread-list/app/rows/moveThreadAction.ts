import { useMemo } from "react";
import { useAtomValue } from "jotai";
import { toast } from "sonner";
import {
  experimental_THREAD_ACTION_GROUPS,
  experimental_useSidebarThreads,
  type PluginBrowserBbSdk,
  type PluginThreadActionRegistration,
  type PluginThreadActionTarget,
} from "@get-bb/plugin-sdk/app";
import {
  buildSidebarEntitySectionId,
  normalizeSidebarSectionOrder,
} from "../model/sidebar-section-order.js";
import {
  sidebarManualSectionOrderAtom,
  sidebarOrganizationModeAtom,
} from "../preferences/atoms.js";
import { usePreferencesSync } from "../preferences/PreferencesSync.js";

export interface ThreadSectionMoveDestination {
  label: string;
  sectionId: string | null;
}

const THREADS_CHOICE_ID = "threads";
const ANCESTORS_BATCH_SIZE = 200;

async function selectedRoots(
  sdk: PluginBrowserBbSdk,
  threads: readonly PluginThreadActionTarget[],
): Promise<PluginThreadActionTarget[]> {
  const threadIds = threads.map((thread) => thread.id);
  const selected = new Set(threadIds);
  const ancestorIds = new Map<string, readonly string[]>();
  for (let index = 0; index < threadIds.length; index += ANCESTORS_BATCH_SIZE) {
    const { threads: rows } = await sdk.threads.experimental_listAncestors({
      threadIds: threadIds.slice(index, index + ANCESTORS_BATCH_SIZE),
    });
    for (const row of rows) ancestorIds.set(row.threadId, row.ancestorIds);
  }
  return threads.filter(
    (thread) =>
      !(ancestorIds.get(thread.id) ?? []).some((id) => selected.has(id)),
  );
}

function choiceId(sectionId: string | null): string {
  return sectionId ?? THREADS_CHOICE_ID;
}

export function useMoveDestinations():
  | readonly ThreadSectionMoveDestination[]
  | null {
  usePreferencesSync();
  const mode = useAtomValue(sidebarOrganizationModeAtom);
  const storedOrder = useAtomValue(sidebarManualSectionOrderAtom);
  const { sections } = experimental_useSidebarThreads();
  const destinations =
    mode === "chronological"
      ? normalizeSidebarSectionOrder({
          storedOrder,
          entitySectionIds: sections.map((section) =>
            buildSidebarEntitySectionId("section", section.id),
          ),
          legacyEntityAnchor: "sections",
          hasPinnedSection: true,
        }).flatMap<ThreadSectionMoveDestination>((id) => {
          if (id === "threads") return [{ label: "Threads", sectionId: null }];
          const section = sections.find(
            (candidate) =>
              buildSidebarEntitySectionId("section", candidate.id) === id,
          );
          return section
            ? [{ label: section.name, sectionId: section.id }]
            : [];
        })
      : null;
  const key = JSON.stringify(destinations);
  return useMemo(
    () => JSON.parse(key) as readonly ThreadSectionMoveDestination[] | null,
    [key],
  );
}

export const moveThreadAction: PluginThreadActionRegistration<
  readonly ThreadSectionMoveDestination[] | null
> = {
  id: "move",
  title: "Move to section",
  icon: "SectionMove",
  group: experimental_THREAD_ACTION_GROUPS.organize,
  order: 50,
  useData: useMoveDestinations,
  item: ({ thread, data: destinations, sdk }) => {
    if (
      destinations === null ||
      thread.parentThreadId !== null ||
      thread.archivedAt !== null
    ) {
      return null;
    }
    const isCurrent = (sectionId: string | null) =>
      thread.pinnedAt === null && thread.sectionId === sectionId;
    if (destinations.every((destination) => isCurrent(destination.sectionId))) {
      return null;
    }
    return {
      label: "Move to section",
      icon: "SectionMove",
      choices: {
        items: destinations.map((destination) => ({
          id: choiceId(destination.sectionId),
          label: destination.label,
          selected: isCurrent(destination.sectionId),
          disabled: isCurrent(destination.sectionId),
        })),
      },
      run: ({ value }) => {
        const destination = destinations.find(
          (candidate) => choiceId(candidate.sectionId) === value,
        );
        if (destination === undefined) return;
        const threadId = thread.id;
        const { sectionId } = destination;
        if (thread.pinnedAt !== null) {
          if (thread.sectionId === sectionId) {
            void sdk.threads.unpin({ threadId }).catch(() => {
              toast.error("Failed to unpin thread.");
            });
            return;
          }
          void Promise.all([
            sdk.threads.unpin({ threadId }),
            sdk.threads.update({ threadId, sectionId }),
          ]).catch(() => {
            toast.error("Failed to unpin and move thread.");
          });
          return;
        }
        if (thread.sectionId === sectionId) return;
        void sdk.threads.update({ threadId, sectionId }).catch(() => {
          toast.error("Failed to move thread.");
        });
      },
    };
  },
  experimental_bulkItem: ({ threads, data: destinations, sdk }) => {
    if (destinations === null || destinations.length === 0) return null;
    const isCurrent = (sectionId: string | null) =>
      threads.every(
        (thread) =>
          thread.pinnedAt === null &&
          thread.parentThreadId === null &&
          thread.sectionId === sectionId,
      );
    return {
      label: "Move to section",
      icon: "SectionMove",
      choices: {
        items: destinations.map((destination) => ({
          id: choiceId(destination.sectionId),
          label: destination.label,
          selected: isCurrent(destination.sectionId),
          disabled: isCurrent(destination.sectionId),
        })),
      },
      run: async ({ value }) => {
        const destination = destinations.find(
          (candidate) => choiceId(candidate.sectionId) === value,
        );
        if (destination === undefined) return;
        const { sectionId } = destination;
        const roots = await selectedRoots(sdk, threads).catch(() => null);
        if (roots === null) {
          toast.error("Failed to move threads.");
          return;
        }
        const results = await Promise.allSettled(
          roots.map(async (thread) => {
            if (thread.pinnedAt !== null) {
              await sdk.threads.unpin({ threadId: thread.id });
            }
            if (
              thread.sectionId !== sectionId ||
              thread.parentThreadId !== null
            ) {
              await sdk.threads.update({
                threadId: thread.id,
                sectionId,
                ...(thread.parentThreadId === null
                  ? {}
                  : { parentThreadId: null }),
              });
            }
          }),
        );
        if (results.some((result) => result.status === "rejected")) {
          toast.error("Failed to move threads.");
        }
      },
    };
  },
};
