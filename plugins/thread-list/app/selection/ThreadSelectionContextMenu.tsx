import {
  useMemo,
  useRef,
  type ComponentPropsWithRef,
  type MouseEvent,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { useSdk } from "@get-bb/plugin-sdk/app";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuLabel,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  ActionMenuItem,
  ActionMenuSeparator,
} from "@/components/ui/action-menu-items";
import { Icon } from "@/components/ui/icon";
import type { SidebarThread } from "../model/sidebar-thread.js";
import { useSidebarData } from "../model/use-sidebar-data.js";
import { useMoveDestinations } from "../rows/moveThreadAction.js";
import { useThreadSelectionStore } from "./threadSelection.js";

const SURFACE = "context";

function stopMenuClickPropagation(event: MouseEvent) {
  event.stopPropagation();
}

function describeThreads(count: number): string {
  return count === 1 ? "1 thread" : `${count} threads`;
}

async function settleAll(
  requests: readonly Promise<unknown>[],
  failureMessage: string,
): Promise<void> {
  const results = await Promise.allSettled(requests);
  if (results.some((result) => result.status === "rejected")) {
    toast.error(failureMessage);
  }
}

function ThreadSelectionMenuItems({
  threadIds,
}: {
  threadIds: readonly string[];
}) {
  const sdk = useSdk();
  const store = useThreadSelectionStore();
  const { projects } = useSidebarData();
  const destinations = useMoveDestinations();
  const { threads, roots } = useMemo(() => {
    const byId = new Map<string, SidebarThread>();
    for (const project of projects) {
      for (const thread of project.threads) byId.set(thread.id, thread);
    }
    const threads = threadIds.flatMap((threadId) => {
      const thread = byId.get(threadId);
      return thread === undefined ? [] : [thread];
    });
    const selected = new Set(threadIds);
    const roots = threads.filter((thread) => {
      let parentId = thread.parentThreadId;
      while (parentId !== null) {
        if (selected.has(parentId)) return false;
        parentId = byId.get(parentId)?.parentThreadId ?? null;
      }
      return true;
    });
    return { threads, roots };
  }, [projects, threadIds]);
  const count = describeThreads(threads.length);
  const anyUnread = threads.some((thread) => thread.isUnread);
  const allPinned = threads.every((thread) => thread.pinnedAt !== null);
  const active = threads.filter((thread) => thread.archivedAt === null);

  const markRead = () =>
    void settleAll(
      threads.map((thread) =>
        anyUnread
          ? sdk.threads.markRead({ threadId: thread.id })
          : sdk.threads.markUnread({ threadId: thread.id }),
      ),
      anyUnread
        ? "Failed to mark threads read."
        : "Failed to mark threads unread.",
    );
  const togglePinned = () => {
    if (allPinned) {
      void settleAll(
        threads.map((thread) => sdk.threads.unpin({ threadId: thread.id })),
        "Failed to unpin threads.",
      );
      return;
    }
    const unpinned = threads.filter((thread) => thread.pinnedAt === null);
    void [...unpinned]
      .reverse()
      .reduce<Promise<unknown>>(
        (previous, thread) =>
          previous.then(() => sdk.threads.pin({ threadId: thread.id })),
        Promise.resolve(),
      )
      .catch(() => toast.error("Failed to pin threads."));
  };
  const moveToSection = (sectionId: string | null) =>
    void settleAll(
      roots.map(async (thread) => {
        if (thread.pinnedAt !== null) {
          await sdk.threads.unpin({ threadId: thread.id });
        }
        if (thread.sectionId !== sectionId || thread.parentThreadId !== null) {
          await sdk.threads.update({
            threadId: thread.id,
            sectionId,
            ...(thread.parentThreadId === null ? {} : { parentThreadId: null }),
          });
        }
      }),
      "Failed to move threads.",
    );
  const archive = async () => {
    const results = await Promise.allSettled(
      active.map((thread) => sdk.threads.archive({ threadId: thread.id })),
    );
    const archivedThreadIds = results.flatMap((result) =>
      result.status === "fulfilled" ? result.value.archivedThreadIds : [],
    );
    store.clear();
    if (results.some((result) => result.status === "rejected")) {
      toast.error("Failed to archive some threads.");
    }
    if (archivedThreadIds.length === 0) return;
    toast.success(`Archived ${describeThreads(archivedThreadIds.length)}`, {
      action: {
        label: "Undo",
        onClick: () =>
          void settleAll(
            archivedThreadIds.map((threadId) =>
              sdk.threads.unarchive({ threadId }),
            ),
            "Failed to unarchive threads.",
          ),
      },
    });
  };

  return (
    <>
      <ContextMenuLabel className="text-muted-foreground">
        {count} selected
      </ContextMenuLabel>
      <ActionMenuSeparator surface={SURFACE} />
      <ActionMenuItem
        surface={SURFACE}
        icon={anyUnread ? "MailOpen" : "Mail"}
        onSelect={markRead}
      >
        {anyUnread ? "Mark read" : "Mark unread"}
      </ActionMenuItem>
      <ActionMenuItem
        surface={SURFACE}
        icon={allPinned ? "PinOff" : "Pin"}
        onSelect={togglePinned}
      >
        {allPinned ? "Unpin" : "Pin"}
      </ActionMenuItem>
      {destinations !== null && destinations.length > 0 ? (
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Icon name="SectionMove" aria-hidden="true" />
            Move to section
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {destinations.map((destination) => (
              <ActionMenuItem
                key={destination.sectionId ?? "threads"}
                surface={SURFACE}
                icon="SectionMove"
                onSelect={() => moveToSection(destination.sectionId)}
              >
                {destination.label}
              </ActionMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
      ) : null}
      <ActionMenuSeparator surface={SURFACE} />
      <ActionMenuItem surface={SURFACE} icon="X" onSelect={() => store.clear()}>
        Clear selection
      </ActionMenuItem>
      {active.length > 0 ? (
        <ActionMenuItem
          surface={SURFACE}
          icon="Archive"
          onSelect={() => void archive()}
        >
          Archive {describeThreads(active.length)}
        </ActionMenuItem>
      ) : null}
    </>
  );
}

export function ThreadSelectionContextMenu({
  threadIds,
  children,
  disabled,
  onOpenChange,
  ...triggerProps
}: ComponentPropsWithRef<"div"> & {
  threadIds: readonly string[] | null;
  children: ReactNode;
  disabled: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const store = useThreadSelectionStore();
  const dismissedWithEscape = useRef(false);
  return (
    <ContextMenu modal={false} onOpenChange={onOpenChange}>
      <ContextMenuTrigger {...triggerProps} asChild disabled={disabled}>
        {children}
      </ContextMenuTrigger>
      {threadIds === null ? null : (
        <ContextMenuContent
          aria-label={`Actions for ${describeThreads(threadIds.length)}`}
          onClick={stopMenuClickPropagation}
          onEscapeKeyDown={() => {
            dismissedWithEscape.current = true;
            store.clear();
          }}
          onCloseAutoFocus={(event) => {
            if (!dismissedWithEscape.current) return;
            dismissedWithEscape.current = false;
            event.preventDefault();
            store.restoreActiveThreadFocus();
          }}
        >
          <ThreadSelectionMenuItems threadIds={threadIds} />
        </ContextMenuContent>
      )}
    </ContextMenu>
  );
}
