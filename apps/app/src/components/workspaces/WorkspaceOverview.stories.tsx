import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { ThreadListEntry } from "@bb/domain";
import {
  EMPTY_ORDERED_MENTION_SUGGESTIONS,
  getCollapsedChildActivity,
} from "@bb/client-core";
import { FollowUpPromptBox } from "@/components/promptbox/FollowUpPromptBox";
import {
  PromptStackCard,
  PROMPT_STACK_CARD_ROW_HEIGHT,
  PROMPT_STACK_INLAY_INSET_CLASS,
} from "@/components/promptbox/banner/PromptStackCard";
import { ThreadPromptRelationshipRow } from "@/components/promptbox/banner/ThreadPromptRelationshipRow";
import { INERT_TYPEAHEAD_COMMAND_CONFIG } from "@/components/promptbox/PromptBoxInternal";
import { ModelPickerStoryQueryProvider } from "../../../.ladle/model-picker-query-provider";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import { Textarea } from "@bb/shared-ui/textarea";
import { Checkbox } from "@bb/shared-ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS,
  COARSE_POINTER_TEXT_SM_CLASS,
} from "@bb/shared-ui/coarse-pointer-sizing";
import { OptionPicker } from "@/components/pickers/OptionPicker";
import {
  DetailCard,
  DetailRow,
  DetailRowIconLabel,
} from "@/components/ui/detail-card";
import { SidebarChildToggleChevron } from "@/components/sidebar/SidebarChildToggleChevron";
import { SidebarControlButton } from "@/components/sidebar/SidebarRowControls";
import {
  CollapsedThreadStatusGlyph,
  ThreadRow,
} from "@/components/sidebar/ThreadRow";
import { SIDEBAR_ROW_BASE_CLASS } from "@/components/sidebar/sidebarRowClasses";
import { ThreadActionsProvider } from "@/components/thread/ThreadActionsProvider";
import { getThreadRoutePath } from "@/lib/route-paths";
import { getThreadDisplayTitle as threadTitle } from "@/lib/thread-title";
import {
  makeExecutionControlsProps,
  useInteractiveExecutionControls,
  makeThreadListEntry,
} from "../../../.ladle/story-fixtures";
import {
  branchThreads,
  canMoveThread,
  handOverWorkspace,
  threadAncestors,
  workspaceThreads,
  workspaces,
} from "./WorkspaceOverview.fixtures";

export default { title: "Workspaces/Draft" };

const noop = () => {};
const executionFixture = makeExecutionControlsProps();

function WorkspaceComposer({
  threadId,
  parentThread,
  onSubmit,
}: {
  threadId: string;
  parentThread: ThreadListEntry | null;
  onSubmit: (message: string) => void;
}) {
  const [message, setMessage] = useState("");
  const execution = useInteractiveExecutionControls(executionFixture);
  function submit() {
    if (message.trim()) {
      onSubmit(message.trim());
      setMessage("");
    }
  }
  return (
    <ModelPickerStoryQueryProvider>
      <FollowUpPromptBox
        attachments={{
          items: [],
          projectId: "proj_workspace_story",
          isAttaching: false,
          error: null,
          onAttachFiles: noop,
          onRemove: noop,
        }}
        stack={
          parentThread ? (
            <PromptStackCard
              ariaLabel="Thread context before sending"
              className="overflow-hidden"
              style={{ minHeight: PROMPT_STACK_CARD_ROW_HEIGHT }}
            >
              <div
                className={cn(
                  "flex items-center gap-0.5 text-xs text-muted-foreground",
                  PROMPT_STACK_INLAY_INSET_CLASS,
                )}
              >
                <ThreadPromptRelationshipRow
                  icon="UserRound"
                  label="Sub-thread of"
                  threadTitle={threadTitle(parentThread)}
                  title={`Sub-thread of ${threadTitle(parentThread)}`}
                  href={getThreadRoutePath({
                    projectId: parentThread.projectId,
                    threadId: parentThread.id,
                  })}
                />
              </div>
            </PromptStackCard>
          ) : null
        }
        environmentSummary={null}
        contextWindowUsage={null}
        execution={execution}
        permission={{
          value: "auto",
          options: [{ value: "auto", label: "Approve for me" }],
          onChange: noop,
          supported: true,
        }}
        permissionReadOnly
        composer={{
          history: {
            currentDraft: { text: message, mentions: [], attachments: [] },
            entries: [],
            onSelectEntry: noop,
          },
          isFollowUpSubmitting: false,
          message,
          mentionRanges: [],
          onChangeMessage: setMessage,
          onModifierSubmit: submit,
          onSubmit: submit,
          compactPromptPlaceholder: "Ask a follow-up…",
          promptPlaceholder: "Ask a follow-up…",
          canModifierSubmit: false,
          steerActiveThreadOnEnter: false,
          submitMode: { kind: "ready" },
          threadRuntimeDisplayStatus: "idle",
        }}
        typeahead={{
          mention: {
            results: EMPTY_ORDERED_MENTION_SUGGESTIONS,
            isLoading: false,
            isError: false,
            onQueryChange: noop,
          },
          command: INERT_TYPEAHEAD_COMMAND_CONFIG,
        }}
        collapseResetKey={threadId}
        suppressPluginComposerCustomizations
      />
    </ModelPickerStoryQueryProvider>
  );
}

function WorkspaceStory({
  createInitially = false,
  surface = "overview",
}: {
  createInitially?: boolean;
  surface?: "overview" | "sidebar" | "info";
}) {
  const [threads, setThreads] = useState(workspaceThreads);
  const [spaces, setSpaces] = useState(workspaces);
  const [collapsed, setCollapsed] = useState(
    new Set(workspaces.map((workspace) => workspace.id)),
  );
  const [collapsedThreads, setCollapsedThreads] = useState(new Set<string>());
  const [dialog, setDialog] = useState<"create" | "convert" | "thread" | null>(
    createInitially ? "create" : null,
  );
  const [name, setName] = useState("");
  const [context, setContext] = useState("");
  const [selection, setSelection] = useState<string[]>([
    "thr_workspace_investigation",
  ]);
  const [newAgentId, setNewAgentId] = useState("new");
  const [messages, setMessages] = useState<Record<string, string[]>>({});
  const [infoOpen, setInfoOpen] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();
  const selected =
    threads.find((thread) => location.pathname.endsWith(`/${thread.id}`)) ??
    threads[surface === "info" ? 5 : 0];
  const ancestors = threadAncestors(threads, selected.id);
  const workspace = spaces.find((space) =>
    ancestors.includes(space.agentThreadId),
  );
  const isWorkspaceAgent = workspace?.agentThreadId === selected.id;
  const directThreads = threads.filter(
    (thread) => thread.parentThreadId === selected.id,
  );
  const availableParents = threads.filter((thread) =>
    canMoveThread(threads, selected.id, thread.id),
  );
  const selectedMembers = workspace
    ? branchThreads(threads, workspace.agentThreadId)
    : [];
  const eligibleAgents = selectedMembers.filter((member) => {
    const next = handOverWorkspace(
      threads,
      workspace!.agentThreadId,
      member.id,
    );
    return branchThreads(next, member.id).every(
      (thread) => threadAncestors(next, thread.id).length <= 4,
    );
  });
  const standaloneRoots = threads.filter(
    (thread) =>
      !thread.parentThreadId &&
      !spaces.some((space) => space.agentThreadId === thread.id),
  );
  const selectable = threads.filter(
    (thread) => !spaces.some((space) => space.agentThreadId === thread.id),
  );
  const selectedRoots = selection.filter(
    (id) =>
      !threadAncestors(threads, id)
        .slice(1)
        .some((ancestor) => selection.includes(ancestor)),
  );
  const selectedBranch = threads.filter((thread) =>
    selectedRoots.some((id) =>
      threadAncestors(threads, thread.id).includes(id),
    ),
  );
  const conversionFits = selectedBranch.every((thread) => {
    const root = selectedRoots.find((id) =>
      threadAncestors(threads, thread.id).includes(id),
    );
    const depth = threadAncestors(threads, thread.id).indexOf(root!) + 1;
    return depth + (root === newAgentId ? 0 : 1) <= 4;
  });

  function openThread(id: string) {
    navigate(
      getThreadRoutePath({ projectId: "proj_workspace_story", threadId: id }),
    );
  }

  function toggle(id: string, setter: typeof setCollapsed) {
    setter((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openDialog(kind: "create" | "convert" | "thread") {
    setName("");
    setContext("");
    setNewAgentId("new");
    setSelection(isWorkspaceAgent ? [] : [selected.id]);
    setDialog(kind);
  }

  function create() {
    const id = `thr_workspace_${crypto.randomUUID()}`;
    const newThread = makeThreadListEntry({
      id,
      projectId: "proj_workspace_story",
      title: name.trim(),
      titleFallback: name.trim(),
      lastReadAt: 300,
      latestAttentionAt: 200,
    });
    if (dialog === "thread") {
      setThreads((current) => [
        ...current,
        { ...newThread, parentThreadId: selected.id },
      ]);
      setCollapsedThreads(
        (current) =>
          new Set([...current].filter((value) => value !== selected.id)),
      );
      if (workspace)
        setCollapsed(
          (current) =>
            new Set([...current].filter((value) => value !== workspace.id)),
        );
      openThread(id);
    } else {
      const agentId =
        dialog === "convert" && newAgentId !== "new" ? newAgentId : id;
      const nextThreads = agentId === id ? [...threads, newThread] : threads;
      setThreads(
        nextThreads.map((thread) => {
          if (thread.id === agentId) return { ...thread, parentThreadId: null };
          if (dialog === "convert" && selectedRoots.includes(thread.id))
            return { ...thread, parentThreadId: agentId };
          return thread;
        }),
      );
      const space = {
        id: `workspace_${id}`,
        name: name.trim(),
        agentThreadId: agentId,
        context,
      };
      setSpaces((current) => [...current, space]);
      setCollapsed((current) => new Set([...current, space.id]));
      openThread(agentId);
    }
    setDialog(null);
  }

  function renderBranch(thread: ThreadListEntry, depth = 0) {
    const children = threads.filter(
      (candidate) => candidate.parentThreadId === thread.id,
    );
    const isCollapsed = collapsedThreads.has(thread.id);
    return (
      <div key={thread.id}>
        <ThreadRow
          projectId="proj_workspace_story"
          crossProjectId={null}
          thread={thread}
          isActive={selected.id === thread.id}
          hasComposerDraft={false}
          options={
            children.length
              ? {
                  kind: "parent",
                  depth,
                  isCompact: false,
                  isCollapsed,
                  childCount: children.length,
                  childActivity: getCollapsedChildActivity(
                    branchThreads(threads, thread.id).filter(
                      (child) => child.id !== thread.id,
                    ),
                  ),
                  onToggleCollapsed: (id) => toggle(id, setCollapsedThreads),
                }
              : { kind: "default", depth, isCompact: false }
          }
        />
        {!isCollapsed &&
          children.map((child) => renderBranch(child, depth + 1))}
      </div>
    );
  }

  return (
    <ThreadActionsProvider>
      <div
        data-workspace-story=""
        className={cn(
          "m-4 flex h-[760px] max-h-[calc(100dvh-2rem)] min-h-[560px] overflow-hidden rounded-lg border border-border bg-background text-foreground",
          surface === "overview"
            ? "min-w-[1000px]"
            : surface === "sidebar"
              ? "max-w-80"
              : "max-w-[480px]",
        )}
      >
        <aside
          aria-label="Workspace sidebar"
          className={cn(
            "flex w-80 shrink-0 flex-col bg-sidebar text-sidebar-foreground",
            surface === "info" && "hidden",
            surface === "overview" && "border-r border-border",
            surface === "sidebar" && "w-full",
          )}
        >
          <div className="flex h-12 items-center justify-between px-4">
            <span className="text-sm font-medium">bb</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" aria-label="Create">
                  <Icon name="Plus" className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" mobileTitle="Create">
                <DropdownMenuItem onSelect={() => openDialog("create")}>
                  New workspace
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openDialog("convert")}>
                  Create workspace from threads
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-2">
            <div className="mb-2 px-2 text-xs text-muted-foreground">
              Workspaces
            </div>
            <div className="space-y-1">
              {spaces.map((space) => {
                const root = threads.find(
                  (thread) => thread.id === space.agentThreadId,
                )!;
                const isCollapsed = collapsed.has(space.id);
                const activity = getCollapsedChildActivity(
                  branchThreads(threads, root.id),
                );
                return (
                  <div key={space.id} data-workspace={space.id}>
                    <div
                      className={cn(
                        SIDEBAR_ROW_BASE_CLASS,
                        COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS,
                        "relative gap-1 border px-2",
                        isCollapsed
                          ? "border-border bg-surface-raised"
                          : "border-transparent",
                        workspace?.id === space.id &&
                          selected.id === root.id &&
                          "bg-state-active",
                      )}
                    >
                      <Icon
                        name="Folder"
                        className="size-3.5 shrink-0 text-muted-foreground"
                      />
                      <button
                        type="button"
                        aria-label={`Open ${space.name}`}
                        onClick={() => openThread(root.id)}
                        className="min-w-0 flex-1 truncate rounded-sm py-1 text-left text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                      >
                        {space.name}
                      </button>
                      <SidebarChildToggleChevron
                        isCollapsed={isCollapsed}
                        expandLabel={`Expand ${space.name}`}
                        collapseLabel={`Collapse ${space.name}`}
                        onToggle={() => toggle(space.id, setCollapsed)}
                      />
                      {isCollapsed && (
                        <CollapsedThreadStatusGlyph activity={activity} />
                      )}
                    </div>
                    {!isCollapsed && (
                      <div className="mt-0.5">{renderBranch(root)}</div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mb-2 mt-6 px-2 text-xs text-muted-foreground">
              Threads
            </div>
            {standaloneRoots.map((thread) => renderBranch(thread))}
          </div>
        </aside>
        <section
          className={cn(
            "flex min-w-0 flex-1 flex-col",
            surface !== "overview" && "hidden",
          )}
          aria-label="Conversation"
        >
          <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
            <h1 className="min-w-0 truncate text-sm font-medium">
              {threadTitle(selected)}
            </h1>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setInfoOpen((value) => !value)}
              aria-pressed={infoOpen}
            >
              Info
            </Button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-8 text-sm leading-relaxed">
            <p>
              {isWorkspaceAgent && workspace
                ? `I’m coordinating ${workspace.name}. I can delegate work to sub-threads and keep our shared context up to date.`
                : selected.id === "thr_workspace_payments"
                  ? "I’ve delegated the retry investigation to Retry failed payments. I’ll incorporate its findings into the payments implementation."
                  : `Continue working on ${threadTitle(selected).toLowerCase()}.`}
            </p>
            {(messages[selected.id] ?? []).map((message, index) => (
              <p key={index} className="mt-6 rounded-md bg-surface-raised p-3">
                {message}
              </p>
            ))}
          </div>
          <div className="m-4">
            <WorkspaceComposer
              key={selected.id}
              threadId={selected.id}
              parentThread={
                threads.find(
                  (thread) => thread.id === selected.parentThreadId,
                ) ?? null
              }
              onSubmit={(message) =>
                setMessages((current) => ({
                  ...current,
                  [selected.id]: [...(current[selected.id] ?? []), message],
                }))
              }
            />
          </div>
        </section>
        {infoOpen && surface !== "sidebar" && (
          <aside
            aria-label="Thread Info"
            className={cn(
              "shrink-0 overflow-y-auto",
              surface === "info" ? "w-full" : "w-80 border-l border-border",
            )}
          >
            <div className="flex h-12 items-center border-b border-border px-4 text-sm font-medium">
              Info
            </div>
            <div className="space-y-5 p-4">
              <DetailCard appearance="flat" labelWidth="136px">
                <DetailRow
                  label={
                    <DetailRowIconLabel icon="Folder">
                      Workspace
                    </DetailRowIconLabel>
                  }
                >
                  <span className="block truncate" title={workspace?.name}>
                    {workspace?.name ?? "None"}
                  </span>
                </DetailRow>
                <DetailRow
                  label={
                    <DetailRowIconLabel icon="UserRound">
                      {isWorkspaceAgent ? "Workspace agent" : "Sub-thread of"}
                    </DetailRowIconLabel>
                  }
                >
                  <OptionPicker
                    label={
                      isWorkspaceAgent ? "Workspace agent" : "Sub-thread of"
                    }
                    value={
                      isWorkspaceAgent
                        ? selected.id
                        : (selected.parentThreadId ?? "none")
                    }
                    options={
                      isWorkspaceAgent
                        ? eligibleAgents.map((thread) => ({
                            value: thread.id,
                            label: threadTitle(thread),
                          }))
                        : [
                            { value: "none", label: "None" },
                            ...availableParents.map((thread) => ({
                              value: thread.id,
                              label: threadTitle(thread),
                            })),
                          ]
                    }
                    className={cn(
                      "-mx-1 h-5 py-0 text-foreground",
                      COARSE_POINTER_TEXT_SM_CLASS,
                    )}
                    onChange={(id) => {
                      if (isWorkspaceAgent && workspace) {
                        setThreads(
                          handOverWorkspace(
                            threads,
                            workspace.agentThreadId,
                            id,
                          ),
                        );
                        setSpaces(
                          spaces.map((space) =>
                            space.id === workspace.id
                              ? { ...space, agentThreadId: id }
                              : space,
                          ),
                        );
                        openThread(id);
                      } else {
                        setThreads(
                          threads.map((thread) =>
                            thread.id === selected.id
                              ? {
                                  ...thread,
                                  parentThreadId: id === "none" ? null : id,
                                }
                              : thread,
                          ),
                        );
                      }
                    }}
                  />
                </DetailRow>
                <DetailRow
                  label={
                    <DetailRowIconLabel icon="GitBranch">
                      Branch
                    </DetailRowIconLabel>
                  }
                >
                  {workspace?.id === "workspace_atlas"
                    ? "feature/atlas-checkout"
                    : workspace?.id === "workspace_mobile"
                      ? "feature/mobile-refresh"
                      : "main"}
                </DetailRow>
              </DetailCard>
              <div className="border-t border-border pt-3">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Sub-threads {directThreads.length}</span>
                  <SidebarControlButton
                    label="New sub-thread"
                    icon="Plus"
                    disabled={ancestors.length >= 4}
                    onClick={() => openDialog("thread")}
                  />
                </div>
                <div className="space-y-1">
                  {directThreads.map((thread) => (
                    <button
                      key={thread.id}
                      onClick={() => openThread(thread.id)}
                      className="flex w-full items-center justify-between gap-2 rounded-md px-1 py-1.5 text-left text-xs hover:bg-state-hover"
                    >
                      <span className="truncate">{threadTitle(thread)}</span>
                      <CollapsedThreadStatusGlyph
                        activity={getCollapsedChildActivity(
                          branchThreads(threads, thread.id),
                        )}
                      />
                    </button>
                  ))}
                </div>
              </div>
              {workspace && (
                <div className="border-t border-border pt-4">
                  <label
                    htmlFor="workspace-context"
                    className="mb-2 block text-xs text-muted-foreground"
                  >
                    Shared context
                  </label>
                  <Textarea
                    id="workspace-context"
                    value={workspace.context}
                    onChange={(event) =>
                      setSpaces(
                        spaces.map((space) =>
                          space.id === workspace.id
                            ? { ...space, context: event.target.value }
                            : space,
                        ),
                      )
                    }
                    className="min-h-28 text-xs"
                  />
                </div>
              )}
              {!isWorkspaceAgent && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="-ml-2 text-xs"
                  onClick={() => openDialog("convert")}
                >
                  Create workspace from thread
                </Button>
              )}
            </div>
          </aside>
        )}
      </div>
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      >
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>
              {dialog === "thread"
                ? "New sub-thread"
                : dialog === "convert"
                  ? "Create workspace from threads"
                  : "New workspace"}
            </DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (
                name.trim() &&
                (dialog !== "convert" ||
                  (selectedRoots.length && conversionFits))
              )
                create();
            }}
          >
            <div className="space-y-2">
              <label htmlFor="workspace-name" className="text-sm">
                Name
              </label>
              <Input
                id="workspace-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoFocus
              />
            </div>
            {dialog !== "thread" && (
              <div className="space-y-2">
                <label htmlFor="new-workspace-context" className="text-sm">
                  Shared context
                </label>
                <Textarea
                  id="new-workspace-context"
                  value={context}
                  onChange={(event) => setContext(event.target.value)}
                />
              </div>
            )}
            {dialog === "convert" && (
              <>
                <div className="max-h-48 space-y-2 overflow-y-auto">
                  {selectable.map((thread) => (
                    <label
                      key={thread.id}
                      className="flex items-center gap-2 text-sm"
                    >
                      <Checkbox
                        checked={selection.includes(thread.id)}
                        onCheckedChange={(checked) => {
                          setSelection((current) =>
                            checked
                              ? [...current, thread.id]
                              : current.filter((id) => id !== thread.id),
                          );
                          setNewAgentId("new");
                        }}
                      />
                      {threadTitle(thread)}
                    </label>
                  ))}
                </div>
                <DetailCard appearance="flat" labelWidth="112px">
                  <DetailRow label="Workspace agent">
                    <OptionPicker
                      label="Workspace agent"
                      value={newAgentId}
                      options={[
                        { value: "new", label: "New thread" },
                        ...threads
                          .filter((thread) => selectedRoots.includes(thread.id))
                          .map((thread) => ({
                            value: thread.id,
                            label: threadTitle(thread),
                          })),
                      ]}
                      onChange={setNewAgentId}
                    />
                  </DetailRow>
                </DetailCard>
                <p className="text-xs text-muted-foreground">
                  {selectedBranch.length + (newAgentId === "new" ? 1 : 0)}{" "}
                  threads
                </p>
                {!conversionFits && (
                  <p role="alert" className="text-sm text-destructive">
                    This selection exceeds four thread levels.
                  </p>
                )}
              </>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setDialog(null)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  !name.trim() ||
                  (dialog === "convert" &&
                    (!selectedRoots.length || !conversionFits))
                }
              >
                {dialog === "thread" ? "Create thread" : "Create workspace"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </ThreadActionsProvider>
  );
}

export function Overview() {
  return <WorkspaceStory />;
}
export function CreateWorkspace() {
  return <WorkspaceStory createInitially />;
}

export function Sidebar() {
  return <WorkspaceStory surface="sidebar" />;
}
export function ThreadInfo() {
  return <WorkspaceStory surface="info" />;
}
