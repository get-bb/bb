import { useMemo } from "react";
import { useAtomValue } from "jotai";
import { toast } from "sonner";
import {
  experimental_THREAD_ACTION_GROUPS,
  experimental_useSidebarThreads,
  type PluginThreadActionRegistration,
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

function choiceId(sectionId: string | null): string {
  return sectionId ?? THREADS_CHOICE_ID;
}

function useMoveDestinations(): readonly ThreadSectionMoveDestination[] | null {
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
      group: experimental_THREAD_ACTION_GROUPS.organize,
      order: 50,
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
};
