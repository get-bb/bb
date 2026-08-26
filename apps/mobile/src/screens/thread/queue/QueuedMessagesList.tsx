import type { ThreadQueuedMessage } from "@bb/domain";
import { useCallback, useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
} from "react-native-reanimated";
import {
  useDeleteThreadQueuedMessage,
  useReorderThreadQueuedMessage,
  useSendThreadQueuedMessage,
  useSetThreadQueuedMessageGroupBoundary,
} from "@/data/thread-runtime";
import { haptic } from "@/lib/haptics";
import { getMutationErrorMessage } from "@/lib/query/mutation-errors";
import { useTheme } from "@/theme";
import {
  ActionSheet,
  cn,
  Icon,
  NativeMenu,
  Spinner,
  Text,
  useSheet,
  type NativeMenuAction,
} from "@/ui";
import {
  buildQueuedMessageRowModels,
  queuedMessageGroupToggleLabel,
  queuedMessageProcessingLabel,
  type QueuedMessageProcessingAction,
  type QueuedMessageRowModel,
} from "./queued-messages-list-model";

const IS_IOS = process.env.EXPO_OS === "ios";
/** Card corners: continuous 12pt (the grouped inset-card look). */
const CARD_STYLE = { borderRadius: 12, borderCurve: "continuous" } as const;
const ROW_EXIT_MS = 160;
const ROW_ENTER_MS = 200;

export interface QueuedMessageEditRequest {
  queuedMessage: ThreadQueuedMessage;
  queuedMessageIndex: number;
}

export interface QueuedMessagesListProps {
  threadId: string;
  queuedMessages: readonly ThreadQueuedMessage[];
  /** Send now is unavailable (e.g. a pending interaction blocks the thread). */
  sendDisabled?: boolean;
  /** Every action is unavailable (thread archived / stopping / read-only). */
  actionDisabled?: boolean;
  /**
   * The message currently open in the composer's edit mode: its row shows
   * "Editing" and its actions are hidden until the edit is saved/dismissed.
   */
  editingQueuedMessageId?: string | null;
  /** Set when the composer is saving an edit (`useUpdateThreadQueuedMessage`). */
  savingQueuedMessageId?: string | null;
  /**
   * Edit is the composer's job: the integrator loads the message into the
   * composer (`queuedInputToDraft`) and submits through
   * `useUpdateThreadQueuedMessage` with the message's `updatedAt`.
   */
  onEdit: (request: QueuedMessageEditRequest) => void;
}

interface RowProps {
  row: QueuedMessageRowModel;
  total: number;
  processingAction: QueuedMessageProcessingAction | null;
  editing: boolean;
  sendDisabled: boolean;
  actionDisabled: boolean;
  onSendNow: () => void;
  /** The secondary actions (Edit, move, group, Delete). */
  menuActions: readonly NativeMenuAction[];
  /** Android: presents the shared action sheet for this row. */
  onOpenMenu: () => void;
}

function QueuedMessageRow({
  row,
  total,
  processingAction,
  editing,
  sendDisabled,
  actionDisabled,
  onSendNow,
  menuActions,
  onOpenMenu,
}: RowProps) {
  const { tokens } = useTheme();
  const busy = processingAction !== null;
  const ordinal = row.index + 1;
  const sendInert = busy || actionDisabled || sendDisabled;
  const menuInert = busy || actionDisabled;
  const menuGlyph = (
    <Icon
      name="MoreHorizontal"
      symbol="ellipsis.circle"
      size={IS_IOS ? 22 : 18}
      color={IS_IOS ? tokens.primary : tokens.foreground}
    />
  );
  return (
    <Animated.View
      entering={FadeIn.duration(ROW_ENTER_MS)}
      exiting={FadeOut.duration(ROW_EXIT_MS)}
      layout={LinearTransition.duration(ROW_ENTER_MS)}
      className={cn(
        "flex-row items-center gap-2 px-3 py-2",
        row.index > 0 && "border-t border-border-hairline",
        row.isGroupBoundary && "border-b border-dashed border-border",
        busy && "opacity-70",
      )}
      accessibilityLabel={`Queued message ${ordinal} of ${total}`}
      testID={`queued-message-${row.index}`}
    >
      <View
        className={cn(
          "h-6 w-6 items-center justify-center rounded-full",
          row.inLeadGroup ? "bg-primary/15" : "bg-muted",
        )}
        accessibilityElementsHidden
      >
        {busy ? (
          <Spinner size="small" color={tokens.mutedForeground} />
        ) : (
          <Text
            variant="chrome"
            className="font-medium text-foreground"
            numeric
          >
            {ordinal}
          </Text>
        )}
      </View>
      <View className="min-w-0 flex-1">
        <Text
          className="text-sm"
          numberOfLines={2}
          testID="queued-message-preview"
        >
          {row.preview}
        </Text>
        {busy ? (
          <Text variant="caption">
            {queuedMessageProcessingLabel(processingAction)}
          </Text>
        ) : editing ? (
          <Text variant="caption">Editing in the composer</Text>
        ) : row.attachmentCount > 0 || row.inLeadGroup ? (
          <Text variant="caption" numberOfLines={1}>
            {[
              row.attachmentCount > 0
                ? `${row.attachmentCount} attachment${row.attachmentCount === 1 ? "" : "s"}`
                : null,
              row.inLeadGroup ? "Grouped: sends in one turn" : null,
            ]
              .filter((part) => part !== null)
              .join(" · ")}
          </Text>
        ) : null}
      </View>
      {!editing ? (
        <View className="flex-row items-center">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Send queued message ${ordinal} now`}
            disabled={sendInert}
            onPress={() => {
              haptic("impact-medium");
              onSendNow();
            }}
            className="h-9 w-9 items-center justify-center rounded-full active:opacity-60"
            style={{ opacity: sendInert ? 0.4 : 1 }}
            hitSlop={4}
            testID="queued-message-send-now"
          >
            <Icon
              name="Sent"
              symbol="paperplane.fill"
              size={IS_IOS ? 20 : 18}
              color={IS_IOS ? tokens.primary : tokens.foreground}
            />
          </Pressable>
          {IS_IOS ? (
            // An icon-only trigger: the menu host is the accessible element
            // (label, role, state, testID); the glyph view inside is not.
            <NativeMenu
              title={`Queued message ${ordinal}`}
              actions={menuActions}
              disabled={menuInert}
              accessibilityLabel={`Queued message ${ordinal} actions`}
              testID="queued-message-menu"
            >
              <View
                className="h-9 w-9 items-center justify-center"
                style={{ opacity: menuInert ? 0.4 : 1 }}
              >
                {menuGlyph}
              </View>
            </NativeMenu>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Queued message ${ordinal} actions`}
              disabled={menuInert}
              onPress={onOpenMenu}
              className="h-9 w-9 items-center justify-center rounded-md active:bg-state-hover"
              style={{ opacity: menuInert ? 0.4 : 1 }}
              hitSlop={4}
              testID="queued-message-menu"
            >
              {menuGlyph}
            </Pressable>
          )}
        </View>
      ) : null}
    </Animated.View>
  );
}

/**
 * Messages queued behind the running turn, listed under the composer
 * (mirrors apps/app/src/components/promptbox/banner/QueuedMessagesList.tsx
 * without drag). Per row: one Send now button and a "…" menu (a native
 * menu on iOS, the action sheet on Android) with Edit (handed to the
 * composer through `onEdit`), Move up / Move down, the group toggle ("send
 * together with the messages above" / "send separately"), and Delete. The
 * lead group that sends as one turn is tinted and closed by a dashed
 * divider. Mutations are optimistic (see `@/data/thread-runtime`); the
 * last error shows inline under the list. Rows fade out as they leave and
 * the card reflows.
 */
export function QueuedMessagesList({
  threadId,
  queuedMessages,
  sendDisabled = false,
  actionDisabled = false,
  editingQueuedMessageId = null,
  savingQueuedMessageId = null,
  onEdit,
}: QueuedMessagesListProps) {
  const { tokens } = useTheme();
  const sendNow = useSendThreadQueuedMessage();
  const deleteMessage = useDeleteThreadQueuedMessage();
  const reorder = useReorderThreadQueuedMessage();
  const setGroupBoundary = useSetThreadQueuedMessageGroupBoundary();
  const menu = useSheet();
  const [menuRowId, setMenuRowId] = useState<string | null>(null);

  const rows = useMemo(
    () => buildQueuedMessageRowModels(queuedMessages),
    [queuedMessages],
  );
  const byId = useMemo(
    () => new Map(queuedMessages.map((message) => [message.id, message])),
    [queuedMessages],
  );

  const processingFor = useCallback(
    (id: string): QueuedMessageProcessingAction | null => {
      if (sendNow.isPending && sendNow.variables?.queuedMessageId === id) {
        return "send";
      }
      if (
        deleteMessage.isPending &&
        deleteMessage.variables?.queuedMessageId === id
      ) {
        return "delete";
      }
      if (savingQueuedMessageId === id) return "edit";
      return null;
    },
    [
      deleteMessage.isPending,
      deleteMessage.variables?.queuedMessageId,
      savingQueuedMessageId,
      sendNow.isPending,
      sendNow.variables?.queuedMessageId,
    ],
  );

  const anyPending =
    sendNow.isPending ||
    deleteMessage.isPending ||
    reorder.isPending ||
    setGroupBoundary.isPending;

  const error =
    sendNow.error ??
    deleteMessage.error ??
    reorder.error ??
    setGroupBoundary.error;
  const errorMessage = error
    ? getMutationErrorMessage({
        error,
        fallbackMessage: "Queue action failed",
      })
    : null;

  const edit = useCallback(
    (row: QueuedMessageRowModel) => {
      const queuedMessage = byId.get(row.id);
      if (queuedMessage) {
        onEdit({ queuedMessage, queuedMessageIndex: row.index });
      }
    },
    [byId, onEdit],
  );

  // The "…" menu for one row (the same items feed the native menu and the
  // Android sheet).
  const menuActionsFor = useCallback(
    (row: QueuedMessageRowModel): NativeMenuAction[] => {
      const actions: NativeMenuAction[] = [
        {
          key: "edit",
          label: "Edit",
          icon: "Edit",
          onPress: () => edit(row),
        },
      ];
      if (row.moveUp) {
        const request = row.moveUp;
        actions.push({
          key: "move-up",
          label: "Move up",
          icon: "ArrowUp",
          onPress: () => {
            haptic("selection");
            reorder.mutate({ id: threadId, ...request });
          },
        });
      }
      if (row.moveDown) {
        const request = row.moveDown;
        actions.push({
          key: "move-down",
          label: "Move down",
          icon: "ArrowDown",
          onPress: () => {
            haptic("selection");
            reorder.mutate({ id: threadId, ...request });
          },
        });
      }
      if (row.groupToggle) {
        const toggle = row.groupToggle;
        actions.push({
          key: "group-toggle",
          label: queuedMessageGroupToggleLabel(toggle),
          icon: "Layers",
          onPress: () => {
            haptic("selection");
            setGroupBoundary.mutate({ id: threadId, ...toggle.request });
          },
        });
      }
      actions.push({
        key: "delete",
        label: "Delete",
        icon: "Trash2",
        destructive: true,
        onPress: () => {
          haptic("warning");
          deleteMessage.mutate({ id: threadId, queuedMessageId: row.id });
        },
      });
      return actions;
    },
    [deleteMessage, edit, reorder, setGroupBoundary, threadId],
  );

  const menuRow = menuRowId
    ? (rows.find((row) => row.id === menuRowId) ?? null)
    : null;
  const sheetActions = useMemo(
    () => (menuRow ? menuActionsFor(menuRow) : []),
    [menuActionsFor, menuRow],
  );

  if (rows.length === 0) return null;

  return (
    <Animated.View
      layout={LinearTransition.duration(ROW_ENTER_MS)}
      className="overflow-hidden rounded-lg border border-border bg-surface-recessed"
      style={CARD_STYLE}
      testID="queued-messages-list"
    >
      <View className="flex-row items-center gap-2 border-b border-border-hairline px-3 py-1.5">
        <Icon name="ListView" size={14} color={tokens.mutedForeground} />
        <Text variant="caption" className="flex-1" numeric>
          {rows.length === 1
            ? "1 queued message"
            : `${rows.length} queued messages`}
        </Text>
        {anyPending ? (
          <Spinner size="small" color={tokens.mutedForeground} />
        ) : null}
      </View>
      {rows.map((row) => (
        <QueuedMessageRow
          key={row.id}
          row={row}
          total={rows.length}
          processingAction={processingFor(row.id)}
          editing={editingQueuedMessageId === row.id}
          sendDisabled={sendDisabled}
          actionDisabled={actionDisabled || editingQueuedMessageId !== null}
          onSendNow={() =>
            sendNow.mutate({
              id: threadId,
              queuedMessageId: row.id,
              mode: "auto",
            })
          }
          menuActions={IS_IOS ? menuActionsFor(row) : []}
          onOpenMenu={() => {
            setMenuRowId(row.id);
            menu.present();
          }}
        />
      ))}
      {errorMessage ? (
        <View
          className="border-t border-surface-destructive-border bg-surface-destructive px-3 py-1.5"
          accessibilityRole="alert"
          testID="queued-messages-error"
        >
          <Text className="text-xs text-destructive-text">{errorMessage}</Text>
        </View>
      ) : null}
      {IS_IOS ? null : (
        <ActionSheet
          controller={menu}
          title={
            menuRow ? `Queued message ${menuRow.index + 1}` : "Queued message"
          }
          message={menuRow?.preview}
          actions={sheetActions}
          onDismiss={() => setMenuRowId(null)}
        />
      )}
    </Animated.View>
  );
}
