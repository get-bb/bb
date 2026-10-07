import type {
  PluginSidebarThreadActions,
  PluginThreadAction,
  PluginThreadActionGroup,
  PluginThreadActionItem,
  PluginThreadActionSurface,
  PluginThreadActionTarget,
} from "@get-bb/plugin-sdk";
import { copyToClipboardWithToast } from "@/lib/clipboard";
import { getThreadRoutePath } from "@/lib/route-paths";

export interface CoreThreadActionSectionMove {
  destinations: readonly { label: string; sectionId: string | null }[];
  moveThread(
    thread: Pick<PluginThreadActionTarget, "id" | "pinnedAt" | "sectionId">,
    sectionId: string | null,
  ): void;
}

export interface CoreThreadActionContext {
  isCompactViewport: boolean;
  canSplit: boolean;
  sidebarActions: PluginSidebarThreadActions;
  requestRename(threadId: string): void;
  unarchive(threadId: string): void;
  sectionMove: CoreThreadActionSectionMove | null;
}

interface CoreThreadActionDefinition {
  id: string;
  resolve(
    target: PluginThreadActionTarget,
    surface: PluginThreadActionSurface,
    context: CoreThreadActionContext,
  ): PluginThreadAction | null;
}

export const THREAD_ACTION_GROUP_ORDER: readonly PluginThreadActionGroup[] = [
  "open",
  "organize",
  "lifecycle",
];

const THREADS_DESTINATION_CHOICE_ID = "threads";

function afterMenuCloses(run: () => void): void {
  window.setTimeout(run, 0);
}

export function getThreadUrl(target: PluginThreadActionTarget): string {
  return new URL(
    getThreadRoutePath({ projectId: target.projectId, threadId: target.id }),
    window.location.origin,
  ).toString();
}

const CORE_THREAD_ACTIONS: readonly CoreThreadActionDefinition[] = [
  {
    id: "split",
    resolve(target, _surface, context) {
      if (!context.canSplit) return null;
      return {
        label: "Open in split",
        icon: "Columns2",
        group: "open",
        run: () => {
          context.sidebarActions.open(target.id, { split: true });
        },
      };
    },
  },
  {
    id: "newThreadInEnvironment",
    resolve(target, _surface, context) {
      const environment = target.environment;
      if (
        !context.isCompactViewport ||
        environment === null ||
        environment.path === null
      ) {
        return null;
      }
      return {
        label: "New thread in environment",
        icon: "MessageSquarePlus",
        group: "open",
        run: () => {
          context.sidebarActions.openNewThread({
            projectId: target.projectId,
            environmentId: environment.id,
            experimental_placement: {
              sectionId: target.sectionId,
              pinned: target.pinnedAt !== null,
            },
            focusPrompt: true,
          });
        },
      };
    },
  },
  {
    id: "copyLink",
    resolve(target) {
      return {
        label: "Copy thread link",
        icon: "Copy",
        group: "organize",
        run: () => {
          void copyToClipboardWithToast(getThreadUrl(target), {
            successMessage: "Thread link copied",
            errorMessage: "Failed to copy thread link",
          });
        },
      };
    },
  },
  {
    id: "read",
    resolve(target, _surface, context) {
      return {
        label: target.isUnread ? "Mark read" : "Mark unread",
        icon: target.isUnread ? "MailOpen" : "Mail",
        group: "organize",
        run: () => {
          void context.sidebarActions.setRead(target.id, target.isUnread);
        },
      };
    },
  },
  {
    id: "pin",
    resolve(target, _surface, context) {
      const isPinned = target.pinnedAt !== null;
      return {
        label: isPinned ? "Unpin" : "Pin",
        icon: isPinned ? "PinOff" : "Pin",
        group: "organize",
        run: () => {
          void context.sidebarActions
            .setPinned(target.id, !isPinned)
            .catch(() => undefined);
        },
      };
    },
  },
  {
    id: "move",
    resolve(target, _surface, context) {
      const sectionMove = context.sectionMove;
      if (
        sectionMove === null ||
        target.parentThreadId !== null ||
        target.archivedAt !== null
      ) {
        return null;
      }
      const isCurrent = (sectionId: string | null) =>
        target.pinnedAt === null && target.sectionId === sectionId;
      if (
        !sectionMove.destinations.some(
          (destination) => !isCurrent(destination.sectionId),
        )
      ) {
        return null;
      }
      return {
        label: "Move to section",
        icon: "SectionMove",
        group: "organize",
        choices: {
          heading: "Move to section",
          items: sectionMove.destinations.map((destination) => ({
            id: destination.sectionId ?? THREADS_DESTINATION_CHOICE_ID,
            label: destination.label,
            selected: isCurrent(destination.sectionId),
            disabled: isCurrent(destination.sectionId),
          })),
          select: (choiceId) => {
            const destination = sectionMove.destinations.find(
              (candidate) =>
                (candidate.sectionId ?? THREADS_DESTINATION_CHOICE_ID) ===
                choiceId,
            );
            if (destination === undefined) return;
            sectionMove.moveThread(target, destination.sectionId);
          },
        },
      };
    },
  },
  {
    id: "rename",
    resolve(target, _surface, context) {
      return {
        label: "Rename",
        icon: "Edit",
        group: "organize",
        run: () => {
          afterMenuCloses(() => context.requestRename(target.id));
        },
      };
    },
  },
  {
    id: "archive",
    resolve(target, _surface, context) {
      const isArchived = target.archivedAt !== null;
      return {
        label: isArchived ? "Unarchive" : "Archive",
        icon: isArchived ? "ArchiveRestore" : "Archive",
        group: "lifecycle",
        run: () => {
          if (isArchived) {
            context.unarchive(target.id);
            return;
          }
          afterMenuCloses(() => context.sidebarActions.archive(target.id));
        },
      };
    },
  },
  {
    id: "delete",
    resolve(target, _surface, context) {
      return {
        label: "Delete",
        icon: "Trash2",
        group: "lifecycle",
        variant: "destructive",
        run: () => {
          afterMenuCloses(() =>
            context.sidebarActions.requestDelete(target.id),
          );
        },
      };
    },
  },
];

export function coreThreadActionKey(id: string): string {
  return `core:${id}`;
}

export function resolveCoreThreadActions(
  target: PluginThreadActionTarget,
  surface: PluginThreadActionSurface,
  context: CoreThreadActionContext,
): PluginThreadActionItem[] {
  return CORE_THREAD_ACTIONS.flatMap((definition) => {
    const action = definition.resolve(target, surface, context);
    return action === null
      ? []
      : [{ key: coreThreadActionKey(definition.id), pluginId: null, action }];
  });
}

export function orderThreadActionItems(
  items: readonly PluginThreadActionItem[],
): PluginThreadActionItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const byGroup =
        THREAD_ACTION_GROUP_ORDER.indexOf(left.item.action.group) -
        THREAD_ACTION_GROUP_ORDER.indexOf(right.item.action.group);
      return byGroup !== 0 ? byGroup : left.index - right.index;
    })
    .map(({ item }) => item);
}
