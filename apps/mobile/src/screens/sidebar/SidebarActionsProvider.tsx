import {
  isThreadRead,
  type SidebarSectionDefinition,
  type SidebarSectionId,
} from "@bb/client-core";
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
import { View } from "react-native";
import { useRenameProject, useDeleteProject } from "@/data/projects";
import {
  useCreateSection,
  useDeleteSection,
  useRenameSection,
} from "@/data/sections";
import {
  listSidebarSectionOrderEntries,
  mergeHiddenSectionOrder,
  useSidebarBootstrap,
  useSidebarModel,
  useSidebarPreferences,
  useSidebarSectionOrder,
  type SidebarOrganizeMode,
  type SidebarPreferenceActions,
  type SidebarPreferences,
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
import { describeError } from "@/lib/describe-error";
import { haptic } from "@/lib/haptics";
import { useTheme } from "@/theme";
import {
  confirmDestructive,
  Icon,
  ListRow,
  promptName,
  Separator,
  Sheet,
  Text,
  toast,
  useSheet,
  type IconName,
  type NamePromptOptions,
} from "@/ui";
import { CenteredRow, CheckRow, SheetHeader } from "../shell/sheet-rows";
import {
  newThreadHref,
  newProjectHref,
  projectSettingsHref,
  threadHref,
} from "../shell/hrefs";
import { SectionReorderList } from "./SectionReorderList";
import { SheetNameForm } from "./SheetNameForm";

/**
 * The actions behind sidebar rows (thread, project, section) and the
 * organize/sort options. Thread mutations (read, pin, rename, move,
 * archive, delete) are exposed on the context so the swipe actions call
 * them directly; the long-press sheet (the thread row menu and the project
 * / section header menus, on both platforms — a native context menu would
 * hide the row from VoiceOver) is one bottom sheet whose content follows a
 * small state machine, so a menu action swaps the content in place. Renames
 * use the system prompt where the platform has one (`promptName`) and the
 * sheet form elsewhere; destructive actions confirm through the system
 * alert. Mirrors the web ThreadActionsMenu / ProjectActionsMenu / section
 * menu.
 */

type SheetState =
  | { kind: "thread-menu"; thread: ThreadListEntry }
  | { kind: "thread-rename"; thread: ThreadListEntry }
  | { kind: "thread-move"; thread: ThreadListEntry }
  | { kind: "project-menu"; project: SidebarProject }
  | { kind: "project-rename"; project: SidebarProject }
  | { kind: "section-menu"; section: SidebarSectionDefinition }
  | { kind: "section-rename"; section: SidebarSectionDefinition }
  | {
      kind: "section-create";
      /** When set, the thread moves into the new section on success. */
      moveThread: ThreadListEntry | null;
    }
  | { kind: "display-options" }
  | { kind: "section-reorder" };

export interface SidebarActions {
  /** The long-press menu for a thread row (a heavy haptic, then the sheet). */
  openThreadMenu(thread: ThreadListEntry): void;
  openProjectMenu(project: SidebarProject): void;
  openSectionMenu(section: SidebarSectionDefinition): void;
  /** The Android organize / sort sheet (iOS uses the header menu). */
  openDisplayOptions(): void;
  /** The drag-to-reorder list of top-level sections for the current mode. */
  openSectionReorder(): void;
  /**
   * Create a section by name (system prompt or sheet form); a thread passed
   * in moves into it on success.
   */
  openSectionCreate(moveThread?: ThreadListEntry | null): void;
  /** Navigate to the thread detail. */
  openThread(thread: Pick<ThreadListEntry, "id">): void;
  /** Navigate to the composer, preselecting a project and/or section. */
  createThread(target?: { projectId?: string; sectionId?: string }): void;
  createProject(): void;
  toggleThreadRead(thread: ThreadListEntry): void;
  toggleThreadPinned(thread: ThreadListEntry): void;
  renameThread(thread: ThreadListEntry): void;
  moveThreadToSection(thread: ThreadListEntry, sectionId: string | null): void;
  /** Archives with an undo toast. */
  archiveThread(thread: ThreadListEntry): void;
  unarchiveThread(thread: ThreadListEntry): void;
  /** Confirms (with the child count) before deleting. */
  deleteThread(thread: ThreadListEntry): void;
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

const EMPTY_SECTIONS: readonly SidebarSectionDefinition[] = [];

export const ORGANIZE_OPTIONS: readonly {
  label: string;
  mode: SidebarOrganizeMode;
  icon: IconName;
}[] = [
  { label: "By project", mode: "project", icon: "Folder" },
  { label: "By machine", mode: "machine", icon: "Laptop" },
  { label: "Manually", mode: "manual", icon: "Layers" },
];

export const SORT_OPTIONS: readonly {
  label: string;
  sort: SidebarSortMode;
  icon: IconName;
}[] = [
  { label: "Updated at", sort: "updated", icon: "Clock" },
  { label: "Created at", sort: "created", icon: "Calendar" },
  { label: "Alphabetical", sort: "alpha", icon: "Sort" },
];

function sectionErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof BbHttpError && error.code === "section_name_conflict") {
    return "Section name already exists.";
  }
  return describeError(error) || fallback;
}

function childThreadsMessage(count: number): string {
  const children = `${count} child ${count === 1 ? "thread" : "threads"} will be deleted.`;
  return count > 0
    ? `${children} This action cannot be undone.`
    : "This action cannot be undone.";
}

interface MenuAction {
  key: string;
  label: string;
  icon: IconName;
  destructive?: boolean;
  disabled?: boolean;
  onPress: () => void;
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

interface SidebarActionsProviderProps {
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
  const bootstrapSections = bootstrap.data?.sections;
  const sections = useMemo(
    () => bootstrapSections ?? EMPTY_SECTIONS,
    [bootstrapSections],
  );

  const { mutate: renameThreadMutate, isPending: renameThreadPending } =
    useRenameThread();
  const { mutate: moveThreadMutate } = useMoveThreadToSection();
  const { mutate: pinThreadMutate } = usePinThread();
  const { mutate: unpinThreadMutate } = useUnpinThread();
  const { mutate: archiveThreadMutate } = useArchiveThread();
  const { mutate: unarchiveThreadMutate } = useUnarchiveThread();
  const { mutate: deleteThreadMutate } = useDeleteThread();
  const { mutateAsync: fetchChildSummary } = useThreadChildSummary();
  const { mutate: markReadMutate } = useMarkThreadRead();
  const { mutate: markUnreadMutate } = useMarkThreadUnread();
  const renameProject = useRenameProject();
  const { mutate: deleteProjectMutate } = useDeleteProject();
  const createSection = useCreateSection();
  const { mutate: createSectionMutate, reset: resetCreateSection } =
    createSection;
  const renameSection = useRenameSection();
  const { reset: resetRenameSection } = renameSection;
  const { mutate: deleteSectionMutate } = useDeleteSection();
  const { organize } = preferences;
  const { setOrganize } = preferenceActions;

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

  /**
   * Rename through the system prompt when the platform has one, otherwise
   * swap the sheet to its form.
   */
  const renameWithPrompt = useCallback(
    (options: NamePromptOptions, fallback: SheetState) => {
      if (promptName(options)) {
        dismiss();
        return;
      }
      setState(fallback);
    },
    [dismiss],
  );

  const unarchiveMany = useCallback(
    (threadIds: readonly string[]) => {
      for (const id of threadIds) unarchiveThreadMutate({ id });
    },
    [unarchiveThreadMutate],
  );

  const archiveWithUndo = useCallback(
    (thread: ThreadListEntry) => {
      archiveThreadMutate(
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
    [archiveThreadMutate, unarchiveMany],
  );

  const deleteWithConfirm = useCallback(
    (thread: ThreadListEntry) => {
      const title = getThreadDisplayTitle(thread);
      fetchChildSummary(thread.id).then(
        (summary) => {
          const count = summary.nonDeletedChildCount;
          confirmDestructive({
            title: `Delete ${title}?`,
            message: childThreadsMessage(count),
            actionLabel: "Delete thread",
            onConfirm: () => {
              deleteThreadMutate(
                { id: thread.id, childThreadsConfirmed: count > 0 },
                { onSuccess: () => toast.success("Thread deleted") },
              );
            },
          });
        },
        (error: unknown) => {
          toast.error("Could not check child threads", {
            description: describeError(error),
          });
        },
      );
    },
    [deleteThreadMutate, fetchChildSummary],
  );

  const createSectionNamed = useCallback(
    (name: string, moveThread: ThreadListEntry | null) => {
      createSectionMutate(
        { name },
        {
          onSuccess: (section) => {
            if (moveThread) {
              moveThreadMutate({ id: moveThread.id, sectionId: section.id });
            }
            if (organize !== "manual") setOrganize("manual");
          },
          onError: (error) => {
            toast.error(
              sectionErrorMessage(error, "Failed to create section."),
            );
          },
        },
      );
    },
    [createSectionMutate, moveThreadMutate, organize, setOrganize],
  );

  const actions = useMemo<SidebarActions>(
    () => ({
      openThreadMenu: (thread) => {
        haptic("impact-heavy");
        present({ kind: "thread-menu", thread });
      },
      openProjectMenu: (project) => {
        haptic("impact-heavy");
        present({ kind: "project-menu", project });
      },
      openSectionMenu: (section) => {
        haptic("impact-heavy");
        present({ kind: "section-menu", section });
      },
      openDisplayOptions: () => present({ kind: "display-options" }),
      openSectionReorder: () => present({ kind: "section-reorder" }),
      openSectionCreate: (moveThread = null) => {
        const handled = promptName({
          title: "New section",
          message: moveThread
            ? `${getThreadDisplayTitle(moveThread)} moves into it.`
            : "Create a section for threads.",
          initialValue: "",
          submitLabel: "Create",
          onSubmit: (name) => createSectionNamed(name, moveThread),
        });
        if (!handled) present({ kind: "section-create", moveThread });
      },
      openThread: (thread) => navigate(threadHref(thread.id)),
      createThread: (target) => {
        if (onCreateThread?.(target)) return;
        // Home already sits at the bottom of the stack: navigate (not push)
        // returns to it with the new params.
        router.navigate(newThreadHref(target));
      },
      createProject: () => navigate(newProjectHref()),
      toggleThreadRead: (thread) => {
        if (isThreadRead(thread)) markUnreadMutate(thread.id);
        else markReadMutate(thread.id);
      },
      toggleThreadPinned: (thread) => {
        if (thread.pinnedAt !== null) unpinThreadMutate({ id: thread.id });
        else pinThreadMutate({ id: thread.id });
      },
      renameThread: (thread) => {
        const handled = promptName({
          title: "Rename thread",
          initialValue: getThreadDisplayTitle(thread),
          submitLabel: "Rename",
          onSubmit: (title) => renameThreadMutate({ id: thread.id, title }),
        });
        if (!handled) present({ kind: "thread-rename", thread });
      },
      moveThreadToSection: (thread, sectionId) => {
        if (thread.sectionId === sectionId) return;
        moveThreadMutate({ id: thread.id, sectionId });
      },
      archiveThread: archiveWithUndo,
      unarchiveThread: (thread) => unarchiveThreadMutate({ id: thread.id }),
      deleteThread: deleteWithConfirm,
    }),
    [
      archiveWithUndo,
      createSectionNamed,
      deleteWithConfirm,
      markReadMutate,
      markUnreadMutate,
      moveThreadMutate,
      navigate,
      onCreateThread,
      pinThreadMutate,
      present,
      renameThreadMutate,
      router,
      unarchiveThreadMutate,
      unpinThreadMutate,
    ],
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
              actions.toggleThreadRead(thread);
            },
          },
          {
            key: isPinned ? "unpin" : "pin",
            label: isPinned ? "Unpin" : "Pin",
            icon: isPinned ? "PinOff" : "Pin",
            onPress: () => {
              dismiss();
              actions.toggleThreadPinned(thread);
            },
          },
          {
            key: "rename",
            label: "Rename",
            icon: "Edit",
            onPress: () =>
              renameWithPrompt(
                {
                  title: "Rename thread",
                  initialValue: getThreadDisplayTitle(thread),
                  submitLabel: "Rename",
                  onSubmit: (title) =>
                    renameThreadMutate({ id: thread.id, title }),
                },
                { kind: "thread-rename", thread },
              ),
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
              if (isArchived) actions.unarchiveThread(thread);
              else actions.archiveThread(thread);
            },
          },
          {
            key: "delete",
            label: "Delete",
            icon: "Trash2",
            destructive: true,
            onPress: () => {
              dismiss();
              actions.deleteThread(thread);
            },
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
            pending={renameThreadPending}
            autoCapitalize="sentences"
            onSubmit={(title) => {
              renameThreadMutate(
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
                  actions.moveThreadToSection(thread, section.id);
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
                actions.moveThreadToSection(thread, null);
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
            onPress: () =>
              renameWithPrompt(
                {
                  title: "Rename project",
                  initialValue: project.name,
                  submitLabel: "Rename",
                  onSubmit: (name) =>
                    renameProject.mutate({ id: project.id, name }),
                },
                { kind: "project-rename", project },
              ),
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
            key: "reorder",
            label: "Reorder sections",
            icon: "ArrowUpDown",
            onPress: () => setState({ kind: "section-reorder" }),
          },
          {
            key: "remove",
            label: "Remove",
            icon: "Trash2",
            destructive: true,
            onPress: () => {
              dismiss();
              confirmDestructive({
                title: "Remove project?",
                message: `Remove "${project.name}" and all of its threads? This cannot be undone.`,
                actionLabel: "Remove project",
                onConfirm: () => {
                  deleteProjectMutate(project.id, {
                    onSuccess: () => toast.success(`Removed ${project.name}`),
                  });
                },
              });
            },
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
            onPress: () =>
              renameWithPrompt(
                {
                  title: "Rename section",
                  initialValue: section.name,
                  submitLabel: "Rename",
                  onSubmit: (name) =>
                    renameSection.mutate(
                      { id: section.id, name },
                      {
                        onError: (error) =>
                          toast.error(
                            sectionErrorMessage(
                              error,
                              "Failed to rename section.",
                            ),
                          ),
                      },
                    ),
                },
                { kind: "section-rename", section },
              ),
          },
          {
            key: "reorder",
            label: "Reorder sections",
            icon: "ArrowUpDown",
            onPress: () => setState({ kind: "section-reorder" }),
          },
          {
            key: "delete",
            label: "Delete",
            icon: "Trash2",
            destructive: true,
            onPress: () => {
              dismiss();
              confirmDestructive({
                title: `Delete ${section.name}?`,
                message: "Threads in this section move back to Unorganized.",
                actionLabel: "Delete section",
                onConfirm: () => deleteSectionMutate({ id: section.id }),
              });
            },
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
              createSectionMutate(
                { name },
                {
                  onSuccess: (section) => {
                    if (moveThreadId) {
                      moveThreadMutate({
                        id: moveThreadId,
                        sectionId: section.id,
                      });
                    }
                    if (organize !== "manual") setOrganize("manual");
                    dismiss();
                  },
                },
              );
            }}
            onCancel={dismiss}
            testID="section-create"
          />
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
            <ListRow
              title="Reorder sections…"
              leading="ArrowUpDown"
              onPress={() => setState({ kind: "section-reorder" })}
              testID="sidebar-reorder-sections"
            />
            <CenteredRow
              label="Done"
              onPress={dismiss}
              testID="sidebar-display-done"
            />
          </>
        );
      case "section-reorder":
        return (
          <>
            <SheetHeader
              title="Reorder sections"
              message="Drag a section to move it. The order is saved for this organize mode."
            />
            <SectionReorderSheetBody
              organize={preferences.organize}
              sort={preferences.sort}
              preferences={preferences}
              preferenceActions={preferenceActions}
            />
            <CenteredRow
              label="Done"
              onPress={dismiss}
              testID="sidebar-reorder-done"
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
        // The reorder list owns vertical drags, so it gets a plain view body
        // and the sheet stops following the finger.
        layout={state?.kind === "section-reorder" ? "view" : "scroll"}
        enableContentPanningGesture={state?.kind !== "section-reorder"}
        deferContent={false}
        onDismiss={() => {
          setState(null);
          resetCreateSection();
          resetRenameSection();
        }}
      >
        {renderContent()}
      </Sheet>
    </SidebarActionsContext.Provider>
  );
}

/**
 * Mounted only while the reorder sheet is open: builds the model for the
 * current mode to label the sections, and writes each drop back to the
 * per-mode order.
 */
function SectionReorderSheetBody({
  organize,
  sort,
  preferences,
  preferenceActions,
}: {
  organize: SidebarOrganizeMode;
  sort: SidebarSortMode;
  preferences: SidebarPreferences;
  preferenceActions: SidebarPreferenceActions;
}) {
  const { model } = useSidebarModel({ organize, sort });
  const order = useSidebarSectionOrder(model, preferences, preferenceActions);
  const entries = useMemo(
    () => listSidebarSectionOrderEntries(model, order),
    [model, order],
  );
  const onReorder = useCallback(
    (visibleOrder: SidebarSectionId[]) =>
      preferenceActions.setSectionOrder(
        organize,
        mergeHiddenSectionOrder(order, visibleOrder),
      ),
    [order, organize, preferenceActions],
  );
  return (
    <View className="py-2">
      <SectionReorderList entries={entries} onReorder={onReorder} />
    </View>
  );
}
