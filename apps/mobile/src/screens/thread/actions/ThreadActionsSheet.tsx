import type { ThreadResponse } from "@bb/server-contract";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useTheme } from "@/theme";
import {
  Icon,
  ListRow,
  Separator,
  Sheet,
  Spinner,
  Text,
  useSheet,
  type SheetController,
} from "@/ui";
import { CheckRow, SheetHeader } from "../../shell/sheet-rows";
import { SheetNameForm } from "../../sidebar/SheetNameForm";
import { useThreadActions, type ThreadMenuAction } from "./use-thread-actions";

/**
 * The thread header's "…" menu as one bottom sheet whose content follows a
 * small state machine — the menu, the rename form, the move-to-section
 * list (the same shape as the sidebar's long-press menu). Delete confirms
 * through the system alert. This is the Android path; iOS renders the same
 * model (`useThreadActions`) as the native header menu in
 * `ThreadHeaderToolbar`.
 */

type SheetState = { view: "menu" } | { view: "rename" } | { view: "move" };

interface ThreadActionsSheetController {
  sheet: SheetController;
  state: SheetState | null;
  setState: (state: SheetState | null) => void;
  /** Open the sheet on the menu or straight on the rename form. */
  present: (view: "menu" | "rename") => void;
  dismiss: () => void;
}

export function useThreadActionsSheet(): ThreadActionsSheetController {
  const sheet = useSheet();
  const [state, setState] = useState<SheetState | null>(null);
  const present = useCallback(
    (view: "menu" | "rename") => {
      setState({ view });
      sheet.present();
    },
    [sheet],
  );
  const dismiss = useCallback(() => sheet.dismiss(), [sheet]);
  return useMemo(
    () => ({ sheet, state, setState, present, dismiss }),
    [dismiss, present, sheet, state],
  );
}

export type { ThreadMenuAction } from "./use-thread-actions";

function MenuRows({ actions }: { actions: readonly ThreadMenuAction[] }) {
  const { tokens } = useTheme();
  return (
    <>
      {actions.map((action) => (
        <ListRow
          key={action.key}
          title={action.label}
          leading={
            action.pending ? (
              <Spinner size="small" color={tokens.mutedForeground} />
            ) : (
              <Icon
                name={action.icon}
                size={20}
                color={
                  action.destructive
                    ? tokens.destructiveText
                    : tokens.foreground
                }
              />
            )
          }
          destructive={action.destructive}
          disabled={action.disabled || action.pending}
          onPress={action.onPress}
          testID={action.testID ?? `thread-action-${action.key}`}
        />
      ))}
    </>
  );
}

interface ThreadActionsSheetProps {
  controller: ThreadActionsSheetController;
  thread: ThreadResponse;
  /** Called after the thread was deleted (leave the screen). */
  onDeleted: () => void;
  /** "Handoff to new thread": compose seeded with a mention of this thread. */
  onHandoffToNewThread: () => void;
  /** "New thread in this worktree"; null when the thread has no reusable worktree. */
  onNewThreadInWorktree: (() => void) | null;
  /**
   * Screen-owned rows listed first (workspace panel, the
   * git action): the thread screen has no second header, so these live here.
   */
  leadingActions?: readonly ThreadMenuAction[];
  /** One-line detail under the title ("project · host · worktree · branch"). */
  headerDetail?: string | null;
}

const EMPTY_LEADING_ACTIONS: readonly ThreadMenuAction[] = [];

export function ThreadActionsSheet({
  controller,
  thread,
  onDeleted,
  onHandoffToNewThread,
  onNewThreadInWorktree,
  leadingActions = EMPTY_LEADING_ACTIONS,
  headerDetail = null,
}: ThreadActionsSheetProps) {
  const { sheet, state, setState, dismiss } = controller;
  const openRename = useCallback(
    () => setState({ view: "rename" }),
    [setState],
  );
  const openMove = useCallback(() => setState({ view: "move" }), [setState]);
  const model = useThreadActions({
    thread,
    onDeleted,
    onHandoffToNewThread,
    onNewThreadInWorktree,
    onRename: openRename,
    onMove: openMove,
    onBeforeAction: dismiss,
  });

  const renderContent = (): ReactNode => {
    if (!state) return null;
    switch (state.view) {
      case "menu":
        return (
          <>
            <SheetHeader title={model.title} message={headerDetail} />
            {leadingActions.length > 0 ? (
              <>
                <MenuRows actions={leadingActions} />
                <Separator />
              </>
            ) : null}
            <MenuRows actions={model.actions} />
          </>
        );
      case "rename":
        return (
          <SheetNameForm
            title="Rename thread"
            initialValue={model.title}
            submitLabel="Rename"
            pending={model.renamePending}
            autoCapitalize="sentences"
            onSubmit={(nextTitle) => {
              model.rename(nextTitle);
              dismiss();
            }}
            onCancel={dismiss}
            testID="thread-rename"
          />
        );
      case "move":
        return (
          <>
            <SheetHeader title="Move to section" message={model.title} />
            {model.sectionChoices.map((choice) => (
              <CheckRow
                key={choice.key}
                label={choice.label}
                icon={choice.icon}
                checked={choice.selected}
                onPress={choice.onPress}
                testID={choice.testID}
              />
            ))}
            {!model.hasSections ? (
              <Text variant="caption" className="px-4 pb-2 pt-1">
                Create sections from the sidebar display options.
              </Text>
            ) : null}
          </>
        );
    }
  };

  return (
    <Sheet
      controller={sheet}
      layout="scroll"
      deferContent={false}
      onDismiss={() => setState(null)}
    >
      {renderContent()}
    </Sheet>
  );
}

export type { SheetState as ThreadActionsSheetState };
