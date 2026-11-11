import { useEffect, useMemo, useState } from "react";
import {
  experimental_resolveThreadStatus as resolveThreadStatus,
  experimental_ThreadStatusGlyph as ThreadStatusGlyph,
  experimental_useAppPanel as useAppPanel,
  experimental_usePanelTabs as usePanelTabs,
  experimental_useSidebarThreads as useSidebarThreads,
  experimental_useThreadActions as useThreadActions,
  ThreadTitle,
  useBbNavigate,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Icon } from "@/components/ui/icon";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useThreadSurfaceRegistration } from "../bridge.js";
import { runWorkspaceScript } from "../scripts/run.js";
import { formatLineCount } from "../sidebar/model.js";
import { useWorkspaceChanges } from "../sidebar/reads.js";
import { toActionTarget } from "../thread-target.js";
import { findDiffTabKey, tabAfterClose, workspaceChats } from "./model.js";
import { deferCloseUntilOpen, takePendingClose } from "./pending-close.js";

export interface WorkspaceTabsProps {
  threadId: string;
  projectId: string;
  environment: { id: string } | null;
}

const ARCHIVE_ACTION_KEY = "bb--core/archive";
const TAB_CLASS =
  "group/tab relative flex max-w-56 min-w-0 shrink-0 items-center gap-1.5 px-2.5 text-sm";
const ACTIVE_TAB_CLASS =
  "text-foreground after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-foreground";
const IDLE_TAB_CLASS = "text-muted-foreground hover:text-foreground";
const CLOSE_BUTTON_CLASS =
  "relative z-10 -mr-1 inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-subtle-foreground opacity-0 hover:bg-state-hover hover:text-foreground focus-visible:opacity-100 group-hover/tab:opacity-100";

function TabStatus({ thread }: { thread: PluginSidebarThread }) {
  const status = resolveThreadStatus({
    thread,
    hiddenThreads: [],
    hasUnsubmittedDraft: false,
    rowStatus: null,
  });
  if (!status.isWorking && status.indicator !== "waiting-for-input") {
    return null;
  }
  return (
    <span className="inline-flex size-3.5 shrink-0 items-center justify-center">
      <ThreadStatusGlyph indicator={status.indicator} size="compact" />
    </span>
  );
}

function CloseTab({
  thread,
  activeThreadId,
  nextThreadId,
}: {
  thread: PluginSidebarThread;
  activeThreadId: string | null;
  nextThreadId: string | null;
}) {
  const navigate = useBbNavigate();
  const actions = useThreadActions(toActionTarget(thread), {
    keys: [ARCHIVE_ACTION_KEY],
  });
  const archive = actions.find((entry) => entry.key === ARCHIVE_ACTION_KEY);
  useEffect(() => {
    if (archive === undefined) return;
    if (takePendingClose(thread.id, activeThreadId)) {
      void archive.action.run();
    }
  }, [activeThreadId, archive, thread.id]);
  if (archive === undefined) return null;
  return (
    <button
      type="button"
      aria-label={`Close ${thread.displayTitle}`}
      className={CLOSE_BUTTON_CLASS}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (thread.id === activeThreadId && nextThreadId !== null) {
          deferCloseUntilOpen(thread.id, nextThreadId);
          navigate.toThread(nextThreadId);
          return;
        }
        void archive.action.run();
      }}
    >
      <Icon name="X" className="size-3" />
    </button>
  );
}

function ToolbarButton({
  label,
  icon,
  onClick,
  children,
  shortcut,
}: {
  label: string;
  icon: string;
  onClick(): void;
  children?: React.ReactNode;
  shortcut?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground"
          onClick={onClick}
        >
          <Icon name={icon} className="size-3.5" />
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {label}
        {shortcut === undefined ? null : (
          <span className="ml-2 text-primary-foreground/70">{shortcut}</span>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

export const NEW_CHAT_PANEL_PATH = "new";

export function useOpenNewChat(): (environmentId: string) => void {
  const navigate = useBbNavigate();
  return (environmentId) =>
    navigate.toPluginPanel(NEW_CHAT_PANEL_PATH, { subPath: environmentId });
}

export function TabStrip({
  chats,
  activeThreadId,
  untitled,
  onNewChat,
  onCloseUntitled,
  trailing,
}: {
  chats: readonly PluginSidebarThread[];
  activeThreadId: string | null;
  untitled: boolean;
  onNewChat(): void;
  onCloseUntitled?: () => void;
  trailing?: React.ReactNode;
}) {
  const closable = chats.length + (untitled ? 1 : 0) > 1;
  return (
    <div
      data-conductor-workspace-tabs=""
      className="flex h-9 shrink-0 items-stretch gap-1 border-b border-border-hairline px-2"
    >
      <div
        role="tablist"
        aria-label="Chats in this workspace"
        className="flex min-w-0 flex-1 items-stretch gap-0.5 overflow-x-auto [scrollbar-width:none]"
      >
        {chats.map((chat) => {
          const isActive = chat.id === activeThreadId;
          return (
            <div
              key={chat.id}
              className={cn(
                TAB_CLASS,
                isActive ? ACTIVE_TAB_CLASS : IDLE_TAB_CLASS,
              )}
            >
              <a
                role="tab"
                aria-selected={isActive}
                href={chat.href}
                draggable={false}
                className="absolute inset-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <TabStatus thread={chat} />
              <span className="pointer-events-none min-w-0 truncate">
                <ThreadTitle threadId={chat.id} />
              </span>
              {closable ? (
                <CloseTab
                  thread={chat}
                  activeThreadId={activeThreadId}
                  nextThreadId={tabAfterClose(chats, chat.id)?.id ?? null}
                />
              ) : null}
            </div>
          );
        })}
        {untitled ? (
          <div className={cn(TAB_CLASS, ACTIVE_TAB_CLASS)}>
            <span role="tab" aria-selected={true} className="min-w-0 truncate">
              Untitled
            </span>
            {closable && onCloseUntitled !== undefined ? (
              <button
                type="button"
                aria-label="Close Untitled"
                className={CLOSE_BUTTON_CLASS}
                onClick={onCloseUntitled}
              >
                <Icon name="X" className="size-3" />
              </button>
            ) : null}
          </div>
        ) : null}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="New chat in this workspace"
              className="my-1 inline-flex w-7 shrink-0 items-center justify-center rounded-md text-subtle-foreground hover:bg-state-hover hover:text-foreground"
              onClick={onNewChat}
            >
              <Icon name="Plus" className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            New chat in this workspace
          </TooltipContent>
        </Tooltip>
      </div>
      {trailing === undefined ? null : (
        <div className="flex shrink-0 items-center gap-0.5">{trailing}</div>
      )}
    </div>
  );
}

export function WorkspaceTabs({ threadId, environment }: WorkspaceTabsProps) {
  useThreadSurfaceRegistration(threadId);
  const openNewChat = useOpenNewChat();
  const panel = useAppPanel();
  const panelTabs = usePanelTabs();
  const { threads } = useSidebarThreads();
  const environmentId = environment?.id ?? null;
  const chats = useMemo(
    () => workspaceChats(threads, environmentId, threadId),
    [environmentId, threadId, threads],
  );
  const changes = useWorkspaceChanges(
    environmentId === null ? [] : [environmentId],
  );
  const workspaceChanges =
    environmentId === null ? undefined : changes.get(environmentId);
  const diffTabKey = findDiffTabKey(panelTabs.tabs);
  const [running, setRunning] = useState(false);

  if (environmentId === null || chats.length === 0) return null;

  return (
    <TabStrip
      chats={chats}
      activeThreadId={threadId}
      untitled={false}
      onNewChat={() => openNewChat(environmentId)}
      trailing={
        <>
          {diffTabKey === null ? null : (
            <ToolbarButton
              label="All changes"
              icon="GitBranch"
              onClick={() => panel.selectTab(diffTabKey)}
            >
              {workspaceChanges !== undefined &&
              (workspaceChanges.insertions > 0 ||
                workspaceChanges.deletions > 0) ? (
                <span className="tabular-nums">
                  <span className="text-success-foreground">
                    +{formatLineCount(workspaceChanges.insertions)}
                  </span>{" "}
                  <span className="text-destructive">
                    -{formatLineCount(workspaceChanges.deletions)}
                  </span>
                </span>
              ) : (
                "Changes"
              )}
            </ToolbarButton>
          )}
          <ToolbarButton
            label={running ? "Starting…" : "Run"}
            icon="Play"
            shortcut="⌘R"
            onClick={() => {
              if (running) return;
              setRunning(true);
              void runWorkspaceScript(
                threadId,
                chats.map((chat) => chat.id),
              )
                .catch((error: unknown) =>
                  toast.error(
                    error instanceof Error
                      ? `Could not run the workspace script: ${error.message}`
                      : "Could not run the workspace script.",
                  ),
                )
                .finally(() => setRunning(false));
            }}
          >
            Run
          </ToolbarButton>
        </>
      }
    />
  );
}
