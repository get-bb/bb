import type { ThreadQueuedMessage } from "@bb/domain";
import { useCallback, useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import {
  useDeleteThreadQueuedMessage,
  useReorderThreadQueuedMessage,
  useSendThreadQueuedMessage,
  useSetThreadQueuedMessageGroupBoundary,
} from "@/data/thread-runtime";
import { getMutationErrorMessage } from "@/lib/query/mutation-errors";
import { useTheme } from "@/theme";
import {
  ActionSheet,
  cn,
  Icon,
  Spinner,
  Text,
  useSheet,
  type ActionSheetAction,
} from "@/ui";
import {
  buildQueuedMessageRowModels,
  queuedMessageGroupToggleLabel,
  queuedMessageProcessingLabel,
  type QueuedMessageProcessingAction,
  type QueuedMessageRowModel,
} from "./queued-messages-list-model";

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
  onEdit: () => void;
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
  onEdit,
  onOpenMenu,
}: RowProps) {
  const { tokens } = useTheme();
  const busy = processingAction !== null;
  const ordinal = row.index + 1;
  return (
    <View
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
          <Text variant="chrome" className="font-medium text-foreground">
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
            disabled={busy || actionDisabled || sendDisabled}
            onPress={onSendNow}
            className="h-9 w-9 items-center justify-center rounded-md active:bg-state-hover"
            style={{
              opacity: busy || actionDisabled || sendDisabled ? 0.4 : 1,
            }}
            hitSlop={4}
            testID="queued-message-send-now"
          >
            <Icon name="Sent" size={18} color={tokens.foreground} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Edit queued message ${ordinal}`}
            disabled={busy || actionDisabled}
            onPress={onEdit}
            className="h-9 w-9 items-center justify-center rounded-md active:bg-state-hover"
            style={{ opacity: busy || actionDisabled ? 0.4 : 1 }}
            hitSlop={4}
            testID="queued-message-edit"
          >
            <Icon name="Edit" size={18} color={tokens.foreground} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Queued message ${ordinal} actions`}
            disabled={busy || actionDisabled}
            onPress={onOpenMenu}
            className="h-9 w-9 items-center justify-center rounded-md active:bg-state-hover"
            style={{ opacity: busy || actionDisabled ? 0.4 : 1 }}
            hitSlop={4}
            testID="queued-message-menu"
          >
            <Icon name="MoreHorizontal" size={18} color={tokens.foreground} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Messages queued behind the running turn, listed under the composer
 * (mirrors apps/app/src/components/promptbox/banner/QueuedMessagesList.tsx
 * without drag). Per row: Send now, Edit (handed to the composer through
 * `onEdit`), and a "…" sheet with Move up / Move down, the group toggle
 * ("send together with the messages above" / "send separately"), and
 * Delete. The lead group that sends as one turn is tinted and closed by a
 * dashed divider. Mutations are optimistic (see `@/data/thread-runtime`);
 * the last error shows inline under the list.
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

  const menuRow = menuRowId
    ? (rows.find((row) => row.id === menuRowId) ?? null)
    : null;
  const menuActions = useMemo<ActionSheetAction[]>(() => {
    if (!menuRow) return [];
    const actions: ActionSheetAction[] = [];
    if (menuRow.moveUp) {
      const request = menuRow.moveUp;
      actions.push({
        key: "move-up",
        label: "Move up",
        icon: "ArrowUp",
        onPress: () => reorder.mutate({ id: threadId, ...request }),
      });
    }
    if (menuRow.moveDown) {
      const request = menuRow.moveDown;
      actions.push({
        key: "move-down",
        label: "Move down",
        icon: "ArrowDown",
        onPress: () => reorder.mutate({ id: threadId, ...request }),
      });
    }
    if (menuRow.groupToggle) {
      const toggle = menuRow.groupToggle;
      actions.push({
        key: "group-toggle",
        label: queuedMessageGroupToggleLabel(toggle),
        icon: "Layers",
        onPress: () =>
          setGroupBoundary.mutate({ id: threadId, ...toggle.request }),
      });
    }
    actions.push({
      key: "delete",
      label: "Delete",
      icon: "Trash2",
      destructive: true,
      onPress: () =>
        deleteMessage.mutate({ id: threadId, queuedMessageId: menuRow.id }),
    });
    return actions;
  }, [deleteMessage, menuRow, reorder, setGroupBoundary, threadId]);

  if (rows.length === 0) return null;

  return (
    <View
      className="overflow-hidden rounded-lg border border-border bg-surface-recessed"
      testID="queued-messages-list"
    >
      <View className="flex-row items-center gap-2 border-b border-border-hairline px-3 py-1.5">
        <Icon name="ListView" size={14} color={tokens.mutedForeground} />
        <Text variant="caption" className="flex-1">
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
          onEdit={() => {
            const queuedMessage = byId.get(row.id);
            if (queuedMessage) {
              onEdit({ queuedMessage, queuedMessageIndex: row.index });
            }
          }}
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
      <ActionSheet
        controller={menu}
        title={
          menuRow ? `Queued message ${menuRow.index + 1}` : "Queued message"
        }
        message={menuRow?.preview}
        actions={menuActions}
        onDismiss={() => setMenuRowId(null)}
      />
    </View>
  );
}
