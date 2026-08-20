import { isThreadRead, type SidebarSectionDefinition } from "@bb/client-core";
import type { ThreadListEntry } from "@bb/domain";
import { BbHttpError } from "@bb/sdk/browser";
import { useRouter } from "expo-router";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Pressable, View } from "react-native";
import { useRenameProject, useDeleteProject } from "@/data/projects";
import {
  useCreateSection,
  useDeleteSection,
  useRenameSection,
} from "@/data/sections";
import {
  useSidebarBootstrap,
  useSidebarPreferences,
  type SidebarOrganizeMode,
  type SidebarProject,
  type SidebarSortMode,
} from "@/data/sidebar";
import {
  getThreadDisplayTitle,
  useArchiveThread,
  useDeleteThread,
  useMarkThreadRead,
  useMarkThreadUnread,
  useMoveThreadToSection,
  usePinThread,
  useRenameThread,
  useThreadChildSummary,
  useUnarchiveThread,
  useUnpinThread,
} from "@/data/threads";
import { useTheme } from "@/theme";
import {
  Icon,
  ListRow,
  Separator,
  Sheet,
  Text,
  toast,
  useSheet,
  type IconName,
} from "@/ui";
import {
  newThreadHref,
  newProjectHref,
  projectSettingsHref,
  threadHref,
} from "../shell/hrefs";
import { SheetNameForm } from "./SheetNameForm";

/**
 * The long-press menus and follow-up forms for sidebar rows (thread, project,
 * section) plus the organize/sort options, rendered as one bottom sheet whose
 * content follows a small state machine. One sheet instead of a stack of
 * modals: a menu action swaps the content in place (rename form, confirm,
 * section picker), so nothing has to wait for a previous sheet to dismiss.
 * Mirrors the web ThreadActionsMenu / ProjectActionsMenu / section row menu.
 */

type SheetState =
  | { kind: "thread-menu"; thread: ThreadListEntry }
  | { kind: "thread-rename"; thread: ThreadListEntry }
  | { kind: "thread-move"; thread: ThreadListEntry }
  | {
      kind: "thread-delete";
      thread: ThreadListEntry;
      /** Null while the child summary loads. */
      childThreadCount: number | null;
    }
  | { kind: "project-menu"; project: SidebarProject }
  | { kind: "project-rename"; project: SidebarProject }
  | { kind: "project-remove"; project: SidebarProject }
  | { kind: "section-menu"; section: SidebarSectionDefinition }
  | { kind: "section-rename"; section: SidebarSectionDefinition }
  | {
      kind: "section-create";
      /** When set, the thread moves into the new section on success. */
      moveThread: ThreadListEntry | null;
    }
  | { kind: "section-delete"; section: SidebarSectionDefinition }
  | { kind: "display-options" };

export interface SidebarActions {
  openThreadMenu(thread: ThreadListEntry): void;
  openProjectMenu(project: SidebarProject): void;
  openSectionMenu(section: SidebarSectionDefinition): void;
  openDisplayOptions(): void;
  openCreateSection(): void;
  /** Navigate to the thread detail. */
  openThread(thread: Pick<ThreadListEntry, "id">): void;
  /** Navigate to the composer, preselecting a project and/or section. */
  createThread(target?: { projectId?: string; sectionId?: string }): void;
  createProject(): void;
}

const SidebarActionsContext = createContext<SidebarActions | null>(null);

export function useSidebarActions(): SidebarActions {
  const value = useContext(SidebarActionsContext);
  if (!value) {
    throw new Error(
      "useSidebarActions must be used inside <SidebarActionsProvider>",
    );
  }
  return value;
}

const ARCHIVE_UNDO_TOAST_DURATION_MS = 8000;

const ORGANIZE_OPTIONS: readonly {
  label: string;
  mode: SidebarOrganizeMode;
  icon: IconName;
}[] = [
  { label: "By project", mode: "project", icon: "Folder" },
  { label: "By machine", mode: "machine", icon: "Laptop" },
  { label: "Manually", mode: "manual", icon: "Layers" },
];

const SORT_OPTIONS: readonly {
  label: string;
  sort: SidebarSortMode;
  icon: IconName;
}[] = [
  { label: "Updated at", sort: "updated", icon: "Clock" },
  { label: "Created at", sort: "created", icon: "Calendar" },
  { label: "Alphabetical", sort: "alpha", icon: "Sort" },
];

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sectionErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof BbHttpError && error.code === "section_name_conflict") {
    return "Section name already exists.";
  }
  return describeError(error) || fallback;
}

interface MenuAction {
  key: string;
  label: string;
  icon: IconName;
  destructive?: boolean;
  disabled?: boolean;
  onPress: () => void;
}

function SheetHeader({
  title,
  message,
}: {
  title: string;
  message?: string | null;
}) {
  return (
    <>
      <View className="gap-1 px-4 pb-3 pt-1">
        <Text variant="heading" numberOfLines={2}>
          {title}
        </Text>
        {message ? <Text variant="caption">{message}</Text> : null}
      </View>
      <Separator />
    </>
  );
}

function MenuRows({ actions }: { actions: readonly MenuAction[] }) {
  const { tokens } = useTheme();
  return (
    <>
      {actions.map((action) => (
        <ListRow
          key={action.key}
          title={action.label}
          leading={
            <Icon
              name={action.icon}
              size={20}
              color={
                action.destructive ? tokens.destructiveText : tokens.foreground
              }
            />
          }
          destructive={action.destructive}
          disabled={action.disabled}
          onPress={action.onPress}
          testID={`sidebar-action-${action.key}`}
        />
      ))}
    </>
  );
}

function CheckRow({
  label,
  icon,
  checked,
  onPress,
  testID,
}: {
  label: string;
  icon: IconName;
  checked: boolean;
  onPress: () => void;
  testID: string;
}) {
  const { tokens } = useTheme();
  return (
    <ListRow
      title={label}
      leading={icon}
      selected={checked}
      trailing={
        checked ? (
          <Icon name="Check" size={18} color={tokens.foreground} />
        ) : null
      }
      onPress={onPress}
      testID={testID}
    />
  );
}

/** Full-width secondary row with centered copy (Cancel / Done). */
function CenteredRow({
  label,
  onPress,
  testID,
}: {
  label: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className="min-h-[44px] items-center justify-center px-4 active:bg-state-hover"
      testID={testID}
    >
      <Text variant="label">{label}</Text>
    </Pressable>
  );
}

function ConfirmRows({
  confirmLabel,
  confirmIcon,
  pending,
  onConfirm,
  onCancel,
}: {
  confirmLabel: string;
  confirmIcon: IconName;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { tokens } = useTheme();
  return (
    <>
      <ListRow
        title={pending ? `${confirmLabel}…` : confirmLabel}
        leading={
          <Icon name={confirmIcon} size={20} color={tokens.destructiveText} />
        }
        destructive
        disabled={pending}
        onPress={onConfirm}
        testID="sidebar-confirm"
      />
      <Separator />
      <CenteredRow label="Cancel" onPress={onCancel} testID="sidebar-cancel" />
    </>
  );
}

export interface SidebarActionsProviderProps {
  children: ReactNode;
  /**
   * Handles "new thread" in place of navigating home with params (the home
   * screen opens its own dock directly). Return `false` to navigate.
   */
  onCreateThread?: (
    target: { projectId?: string; sectionId?: string } | undefined,
  ) => boolean;
}

export function SidebarActionsProvider({
  children,
  onCreateThread,
}: SidebarActionsProviderProps) {
  const router = useRouter();
  const { tokens } = useTheme();
  const sheet = useSheet();
  const [state, setState] = useState<SheetState | null>(null);
  const [preferences, preferenceActions] = useSidebarPreferences();
  const bootstrap = useSidebarBootstrap();
  const sections = bootstrap.data?.sections ?? [];

  const renameThread = useRenameThread();
  const moveThread = useMoveThreadToSection();
  const pinThread = usePinThread();
  const unpinThread = useUnpinThread();
  const archiveThread = useArchiveThread();
  const unarchiveThread = useUnarchiveThread();
  const deleteThread = useDeleteThread();
  const childSummary = useThreadChildSummary();
  const markRead = useMarkThreadRead();
  const markUnread = useMarkThreadUnread();
  const renameProject = useRenameProject();
  const deleteProject = useDeleteProject();
  const createSection = useCreateSection();
  const renameSection = useRenameSection();
  const deleteSection = useDeleteSection();

  const present = useCallback(
    (next: SheetState) => {
      setState(next);
      sheet.present();
    },
    [sheet],
  );
  const dismiss = useCallback(() => sheet.dismiss(), [sheet]);

  const navigate = useCallback(
    (href: Parameters<typeof router.push>[0]) => router.push(href),
    [router],
  );

  const actions = useMemo<SidebarActions>(
    () => ({
      openThreadMenu: (thread) => present({ kind: "thread-menu", thread }),
      openProjectMenu: (project) => present({ kind: "project-menu", project }),
      openSectionMenu: (section) => present({ kind: "section-menu", section }),
      openDisplayOptions: () => present({ kind: "display-options" }),
      openCreateSection: () =>
        present({ kind: "section-create", moveThread: null }),
      openThread: (thread) => navigate(threadHref(thread.id)),
      createThread: (target) => {
        if (onCreateThread?.(target)) return;
        // Home already sits at the bottom of the stack: navigate (not push)
        // returns to it with the new params.
        router.navigate(newThreadHref(target));
      },
      createProject: () => navigate(newProjectHref()),
    }),
    [navigate, onCreateThread, present, router],
  );

  const unarchiveMany = useCallback(
    (threadIds: readonly string[]) => {
      for (const id of threadIds) unarchiveThread.mutate({ id });
    },
    [unarchiveThread],
  );

  const archiveWithUndo = useCallback(
    (thread: ThreadListEntry) => {
      archiveThread.mutate(
        { id: thread.id },
        {
          onSuccess: (response) => {
            const count = response.archivedThreadIds.length;
            const toastId = `thread-archived-${thread.id}`;
            toast.success(
              count > 1
                ? `Archived ${getThreadDisplayTitle(thread)} and ${count - 1} child ${count - 1 === 1 ? "thread" : "threads"}`
                : `Archived ${getThreadDisplayTitle(thread)}`,
              {
                duration: ARCHIVE_UNDO_TOAST_DURATION_MS,
                action: {
                  label: "Undo",
                  onClick: () => {
                    toast.dismiss(toastId);
                    unarchiveMany(response.archivedThreadIds);
                  },
                },
              },
            );
          },
        },
      );
    },
    [archiveThread, unarchiveMany],
  );

  const requestDelete = useCallback(
    (thread: ThreadListEntry) => {
      setState({ kind: "thread-delete", thread, childThreadCount: null });
      childSummary.mutateAsync(thread.id).then(
        (summary) => {
          setState((current) =>
            current?.kind === "thread-delete" && current.thread.id === thread.id
              ? { ...current, childThreadCount: summary.nonDeletedChildCount }
              : current,
          );
        },
        (error: unknown) => {
          toast.error("Could not check child threads", {
            description: describeError(error),
          });
          dismiss();
        },
      );
    },
    [childSummary, dismiss],
  );

  const renderContent = (): ReactNode => {
    if (!state) return null;
    switch (state.kind) {
      case "thread-menu": {
        const { thread } = state;
        const isRead = isThreadRead(thread);
        const isPinned = thread.pinnedAt !== null;
        const isArchived = thread.archivedAt !== null;
        const menu: MenuAction[] = [
          {
            key: "open",
            label: "Open",
            icon: "MessageSquare",
            onPress: () => {
              dismiss();
              actions.openThread(thread);
            },
          },
          {
            key: isRead ? "mark-unread" : "mark-read",
            label: isRead ? "Mark unread" : "Mark read",
            icon: isRead ? "Mail" : "MailOpen",
            onPress: () => {
              dismiss();
              if (isRead) markUnread.mutate(thread.id);
              else markRead.mutate(thread.id);
            },
          },
          {
            key: isPinned ? "unpin" : "pin",
            label: isPinned ? "Unpin" : "Pin",
            icon: isPinned ? "PinOff" : "Pin",
            onPress: () => {
              dismiss();
              if (isPinned) unpinThread.mutate({ id: thread.id });
              else pinThread.mutate({ id: thread.id });
            },
          },
          {
            key: "rename",
            label: "Rename",
            icon: "Edit",
            onPress: () => setState({ kind: "thread-rename", thread }),
          },
          {
            key: "move",
            label: "Move to section",
            icon: "Layers",
            onPress: () => setState({ kind: "thread-move", thread }),
          },
          {
            key: isArchived ? "unarchive" : "archive",
            label: isArchived ? "Unarchive" : "Archive",
            icon: isArchived ? "ArchiveRestore" : "Archive",
            onPress: () => {
              dismiss();
              if (isArchived) unarchiveThread.mutate({ id: thread.id });
              else archiveWithUndo(thread);
            },
          },
          {
            key: "delete",
            label: "Delete",
            icon: "Trash2",
            destructive: true,
            onPress: () => requestDelete(thread),
          },
        ];
        return (
          <>
            <SheetHeader title={getThreadDisplayTitle(thread)} />
            <MenuRows actions={menu} />
          </>
        );
      }
      case "thread-rename":
        return (
          <SheetNameForm
            title="Rename thread"
            initialValue={getThreadDisplayTitle(state.thread)}
            submitLabel="Rename"
            pending={renameThread.isPending}
            autoCapitalize="sentences"
            onSubmit={(title) => {
              renameThread.mutate(
                { id: state.thread.id, title },
                { onSettled: dismiss },
              );
            }}
            onCancel={dismiss}
            testID="rename"
          />
        );
      case "thread-move": {
        const { thread } = state;
        return (
          <>
            <SheetHeader
              title="Move to section"
              message={getThreadDisplayTitle(thread)}
            />
            {sections.map((section) => (
              <CheckRow
                key={section.id}
                label={section.name}
                icon="Layers"
                checked={thread.sectionId === section.id}
                onPress={() => {
                  dismiss();
                  if (thread.sectionId !== section.id) {
                    moveThread.mutate({ id: thread.id, sectionId: section.id });
                  }
                }}
                testID={`sidebar-move-${section.id}`}
              />
            ))}
            <CheckRow
              label="Unorganized"
              icon="Circle"
              checked={thread.sectionId === null}
              onPress={() => {
                dismiss();
                if (thread.sectionId !== null) {
                  moveThread.mutate({ id: thread.id, sectionId: null });
                }
              }}
              testID="sidebar-move-none"
            />
            <Separator />
            <ListRow
              title="New section…"
              leading={
                <Icon name="SectionAdd" size={20} color={tokens.foreground} />
              }
              onPress={() =>
                setState({ kind: "section-create", moveThread: thread })
              }
              testID="sidebar-move-new-section"
            />
          </>
        );
      }
      case "thread-delete": {
        const { thread, childThreadCount } = state;
        const message =
          childThreadCount === null
            ? "Checking child threads…"
            : [
                childThreadCount > 0
                  ? `${childThreadCount} child ${childThreadCount === 1 ? "thread" : "threads"} will be deleted.`
                  : null,
                "This action cannot be undone.",
              ]
                .filter((part): part is string => part !== null)
                .join(" ");
        return (
          <>
            <SheetHeader
              title={`Delete ${getThreadDisplayTitle(thread)}?`}
              message={message}
            />
            <ConfirmRows
              confirmLabel="Delete thread"
              confirmIcon="Trash2"
              pending={childThreadCount === null || deleteThread.isPending}
              onConfirm={() => {
                if (childThreadCount === null) return;
                deleteThread.mutate(
                  {
                    id: thread.id,
                    childThreadsConfirmed: childThreadCount > 0,
                  },
                  {
                    onSuccess: () => toast.success("Thread deleted"),
                    onSettled: dismiss,
                  },
                );
              }}
              onCancel={dismiss}
            />
          </>
        );
      }
      case "project-menu": {
        const { project } = state;
        const menu: MenuAction[] = [
          {
            key: "new-thread",
            label: "New thread",
            icon: "MessageSquarePlus",
            onPress: () => {
              dismiss();
              actions.createThread({ projectId: project.id });
            },
          },
          {
            key: "project-settings",
            label: "Project settings",
            icon: "Settings",
            onPress: () => {
              dismiss();
              navigate(projectSettingsHref(project.id));
            },
          },
          {
            key: "rename",
            label: "Rename",
            icon: "Edit",
            onPress: () => setState({ kind: "project-rename", project }),
          },
          {
            key: "add-local-path",
            label: "Add local path",
            icon: "FolderPlus",
            onPress: () => {
              dismiss();
              navigate(projectSettingsHref(project.id));
            },
          },
          {
            key: "remove",
            label: "Remove",
            icon: "Trash2",
            destructive: true,
            onPress: () => setState({ kind: "project-remove", project }),
          },
        ];
        return (
          <>
            <SheetHeader title={project.name} />
            <MenuRows actions={menu} />
          </>
        );
      }
      case "project-rename":
        return (
          <SheetNameForm
            title="Rename project"
            initialValue={state.project.name}
            submitLabel="Rename"
            pending={renameProject.isPending}
            onSubmit={(name) => {
              renameProject.mutate(
                { id: state.project.id, name },
                { onSettled: dismiss },
              );
            }}
            onCancel={dismiss}
            testID="rename"
          />
        );
      case "project-remove":
        return (
          <>
            <SheetHeader
              title="Remove project?"
              message={`Remove "${state.project.name}" and all of its threads? This cannot be undone.`}
            />
            <ConfirmRows
              confirmLabel="Remove project"
              confirmIcon="Trash2"
              pending={deleteProject.isPending}
              onConfirm={() => {
                deleteProject.mutate(state.project.id, {
                  onSuccess: () =>
                    toast.success(`Removed ${state.project.name}`),
                  onSettled: dismiss,
                });
              }}
              onCancel={dismiss}
            />
          </>
        );
      case "section-menu": {
        const { section } = state;
        const menu: MenuAction[] = [
          {
            key: "new-thread",
            label: "New thread here",
            icon: "MessageSquarePlus",
            onPress: () => {
              dismiss();
              actions.createThread({ sectionId: section.id });
            },
          },
          {
            key: "rename",
            label: "Rename",
            icon: "Edit",
            onPress: () => setState({ kind: "section-rename", section }),
          },
          {
            key: "delete",
            label: "Delete",
            icon: "Trash2",
            destructive: true,
            onPress: () => setState({ kind: "section-delete", section }),
          },
        ];
        return (
          <>
            <SheetHeader title={section.name} />
            <MenuRows actions={menu} />
          </>
        );
      }
      case "section-rename":
        return (
          <SheetNameForm
            title="Rename section"
            initialValue={state.section.name}
            submitLabel="Rename"
            pending={renameSection.isPending}
            errorMessage={
              renameSection.error
                ? sectionErrorMessage(
                    renameSection.error,
                    "Failed to rename section.",
                  )
                : null
            }
            onSubmit={(name) => {
              renameSection.mutate(
                { id: state.section.id, name },
                { onSuccess: dismiss },
              );
            }}
            onCancel={dismiss}
            testID="rename"
          />
        );
      case "section-create":
        return (
          <SheetNameForm
            title="New section"
            message={
              state.moveThread
                ? `${getThreadDisplayTitle(state.moveThread)} moves into it.`
                : "Create a section for threads."
            }
            initialValue=""
            placeholder="Section name"
            submitLabel="Create section"
            pending={createSection.isPending}
            errorMessage={
              createSection.error
                ? sectionErrorMessage(
                    createSection.error,
                    "Failed to create section.",
                  )
                : null
            }
            onSubmit={(name) => {
              const moveThreadId = state.moveThread?.id ?? null;
              createSection.mutate(
                { name },
                {
                  onSuccess: (section) => {
                    if (moveThreadId) {
                      moveThread.mutate({
                        id: moveThreadId,
                        sectionId: section.id,
                      });
                    }
                    if (preferences.organize !== "manual") {
                      preferenceActions.setOrganize("manual");
                    }
                    dismiss();
                  },
                },
              );
            }}
            onCancel={dismiss}
            testID="section-create"
          />
        );
      case "section-delete":
        return (
          <>
            <SheetHeader
              title={`Delete ${state.section.name}?`}
              message="Threads in this section move back to Unorganized."
            />
            <ConfirmRows
              confirmLabel="Delete section"
              confirmIcon="Trash2"
              pending={deleteSection.isPending}
              onConfirm={() => {
                deleteSection.mutate(
                  { id: state.section.id },
                  { onSettled: dismiss },
                );
              }}
              onCancel={dismiss}
            />
          </>
        );
      case "display-options":
        return (
          <>
            <Text variant="sectionLabel" className="px-4 pb-1 pt-1">
              Organize
            </Text>
            {ORGANIZE_OPTIONS.map((option) => (
              <CheckRow
                key={option.mode}
                label={option.label}
                icon={option.icon}
                checked={preferences.organize === option.mode}
                onPress={() => preferenceActions.setOrganize(option.mode)}
                testID={`sidebar-organize-${option.mode}`}
              />
            ))}
            <View className="py-2">
              <Separator />
            </View>
            <Text variant="sectionLabel" className="px-4 pb-1">
              Sort by
            </Text>
            {SORT_OPTIONS.map((option) => (
              <CheckRow
                key={option.sort}
                label={option.label}
                icon={option.icon}
                checked={preferences.sort === option.sort}
                onPress={() => preferenceActions.setSort(option.sort)}
                testID={`sidebar-sort-${option.sort}`}
              />
            ))}
            <View className="py-2">
              <Separator />
            </View>
            <ListRow
              title="New section…"
              leading="SectionAdd"
              onPress={() =>
                setState({ kind: "section-create", moveThread: null })
              }
              testID="sidebar-new-section"
            />
            <CenteredRow
              label="Done"
              onPress={dismiss}
              testID="sidebar-display-done"
            />
          </>
        );
    }
  };

  return (
    <SidebarActionsContext.Provider value={actions}>
      {children}
      <Sheet
        controller={sheet}
        layout="scroll"
        deferContent={false}
        onDismiss={() => {
          setState(null);
          createSection.reset();
          renameSection.reset();
        }}
      >
        {renderContent()}
      </Sheet>
    </SidebarActionsContext.Provider>
  );
}
