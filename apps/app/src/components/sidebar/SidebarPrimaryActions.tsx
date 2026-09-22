import type { PointerEventHandler } from "react";
import { cn } from "@bb/shared-ui/lib/utils";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import {
  AppCommandShortcutHint,
  AppCommandShortcutPill,
} from "@/components/commands/AppCommandShortcutHint";
import {
  useAppCommandRunner,
  useAppCommandShortcut,
} from "@/components/commands/AppCommandProvider";
import { PROJECT_LIST_ACTION_BUTTON_CLASS } from "./sidebarRowClasses";
import { usePaneContentSplitIndicator } from "./paneContentSplitIndicator";
import { SplitPaneMiniMap } from "./SplitPaneMiniMap";

interface ProjectListNewThreadActionProps {
  splitEnabled?: boolean;
  newThreadSplit?: {
    onPointerDown?: PointerEventHandler<HTMLElement>;
    openInSplit(): void;
  };
  onNewChat?: () => void;
}

interface ProjectListSearchThreadsActionProps {
  onSearchThreads?: () => void;
}

export function ProjectListNewThreadAction({
  splitEnabled = false,
  newThreadSplit,
  onNewChat,
}: ProjectListNewThreadActionProps) {
  const isNewChatDisabled = !onNewChat;
  const newThreadShortcut = useAppCommandShortcut("thread.new");
  const newThreadSplitIndicator = usePaneContentSplitIndicator(
    { kind: "new-thread" },
    splitEnabled,
  );

  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className={cn(PROJECT_LIST_ACTION_BUTTON_CLASS, "w-full")}
      onPointerDown={newThreadSplit?.onPointerDown}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey) {
          newThreadSplit?.openInSplit();
          return;
        }
        onNewChat?.();
      }}
      disabled={isNewChatDisabled}
      aria-label={
        newThreadShortcut
          ? `New thread (${newThreadShortcut.label})`
          : "New thread"
      }
      aria-keyshortcuts={newThreadShortcut?.ariaKeyshortcuts}
    >
      <Icon name="MessageSquarePlus" />
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-left">New thread</span>
        {newThreadSplitIndicator.miniMap ? (
          <SplitPaneMiniMap
            slots={newThreadSplitIndicator.miniMap}
            label="New thread — open in split"
          />
        ) : null}
        <AppCommandShortcutHint shortcut={newThreadShortcut} />
      </span>
    </Button>
  );
}

export function ProjectListSearchThreadsAction({
  onSearchThreads,
}: ProjectListSearchThreadsActionProps) {
  const commandRunner = useAppCommandRunner();
  const threadSearchShortcut = useAppCommandShortcut("thread.search");

  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className={cn(
        PROJECT_LIST_ACTION_BUTTON_CLASS,
        "group/search-threads w-full pr-1",
      )}
      onClick={(event) => {
        onSearchThreads?.();
        commandRunner.dispatch("thread.search", event.currentTarget);
      }}
      aria-label={
        threadSearchShortcut
          ? `Search threads (${threadSearchShortcut.label})`
          : "Search threads"
      }
      aria-keyshortcuts={threadSearchShortcut?.ariaKeyshortcuts}
    >
      <Icon name="Search" />
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-left">
          Search threads
        </span>
        {threadSearchShortcut ? (
          <span className="inline-flex shrink-0 opacity-0 transition-opacity group-hover/search-threads:opacity-100 group-focus-visible/search-threads:opacity-100 max-md:pointer-coarse:hidden">
            <AppCommandShortcutPill shortcut={threadSearchShortcut} />
          </span>
        ) : null}
      </span>
    </Button>
  );
}
