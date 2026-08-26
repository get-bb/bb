import type {
  PendingInteraction,
  ThreadQueuedMessage,
  ThreadTimelineActivePromptMode,
  ThreadTimelineGoal,
  ThreadTimelineModelFallback,
  ThreadTimelinePendingTodos,
} from "@bb/domain";
import type {
  ThreadContextWindowUsage,
  ThreadResponse,
  TimelineWorkflowWorkRow,
} from "@bb/server-contract";
import { useMemo, type RefObject } from "react";
import {
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type ViewProps,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Composer, type ComposerAction, type ComposerHandle } from "@/composer";
import type { ChildThreadPendingAttention } from "@/data/interactions";
import { useCancelThreadPlan, useClearThreadGoal } from "@/data/thread-runtime";
import { useTheme } from "@/theme";
import { Button, Icon, Text } from "@/ui";
import {
  hasThreadPromptChips,
  ThreadContextWindowIndicator,
  ThreadPromptChips,
} from "../cards/ThreadPromptStackChips";
import type { ThreadContextChipsProps } from "../context/ThreadContextChips";
import { PendingInteractionBanner } from "../interactions";
import { QueuedMessagesList } from "../queue";
import type { FollowUpComposerController } from "./use-follow-up-composer";

interface ThreadPromptAreaProps {
  threadId: string;
  thread: ThreadResponse | undefined;
  /** The environment / host ids the `@` menu searches (from the bootstrap). */
  environmentId: string | null;
  hostId: string | null;
  composer: FollowUpComposerController;
  composerRef: RefObject<ComposerHandle | null>;
  /** The latest pending interaction; replaces the composer while set. */
  pendingInteraction: PendingInteraction | null;
  childPendingInteractions: readonly ChildThreadPendingAttention[];
  queuedMessages: readonly ThreadQueuedMessage[];
  activeWorkflows: readonly TimelineWorkflowWorkRow[];
  activeBackgroundCommands: readonly TimelineWorkflowWorkRow[];
  activePromptMode: ThreadTimelineActivePromptMode | null;
  goal: ThreadTimelineGoal | null;
  pendingTodos: ThreadTimelinePendingTodos | null;
  modelFallback: ThreadTimelineModelFallback | null;
  contextWindowUsage: ThreadContextWindowUsage | undefined;
  contextChips: ThreadContextChipsProps;
  /** "Handoff to new thread" (compose seeded with a `@thread:` mention). */
  onHandoffToNewThread: () => void;
  /**
   * Liquid Glass: float over the bottom of the timeline (absolute, no page
   * fill, no seam) instead of docking under it — the composer and the chips
   * are glass capsules; the banner (a form) and the queued list (cards) sit
   * on raised panels. The screen pads the timeline for the height
   * `onLayout` reports.
   */
  floating?: boolean;
  onLayout?: ViewProps["onLayout"];
}

/** Share of the window the stack + composer may take before the stack scrolls. */
const MAX_PROMPT_AREA_WINDOW_FRACTION = 0.6;
const IS_IOS = process.env.EXPO_OS === "ios";
/** The floating host: pinned to the bottom of the overlay bounds. */
const FLOATING_HOST_STYLE: ViewStyle = {
  position: "absolute",
  left: 0,
  right: 0,
  bottom: 0,
};

/**
 * The bottom of the thread screen (port of apps/app ThreadDetailPromptArea):
 * either the pending-interaction banner (with the child-thread, plan and
 * goal chips) or the prompt stack — one chip row (workflows, background
 * commands, changed files, pull request, plan, goal, to-dos, model
 * fallback, related and child threads, archive state) and the
 * queued-message list — above the follow-up composer with its execution
 * pills and context-window readout. Archived threads and gone
 * environments keep the stack but hide the composer; so does a thread that
 * is still loading (web parity: the prompt area needs the loaded thread), so
 * nothing is ever typed into a draft keyed on a placeholder project id.
 */
export function ThreadPromptArea({
  threadId,
  thread,
  environmentId,
  hostId,
  composer,
  composerRef,
  pendingInteraction,
  childPendingInteractions,
  queuedMessages,
  activeWorkflows,
  activeBackgroundCommands,
  activePromptMode,
  goal,
  pendingTodos,
  modelFallback,
  contextWindowUsage,
  contextChips,
  onHandoffToNewThread,
  floating = false,
  onLayout,
}: ThreadPromptAreaProps) {
  const insets = useSafeAreaInsets();
  const { tokens } = useTheme();
  const { height: windowHeight } = useWindowDimensions();
  const cancelPlan = useCancelThreadPlan();
  const clearGoal = useClearThreadGoal();
  const chipActions = {
    activePromptMode,
    onExitPlanMode: composer.hidden
      ? undefined
      : () => cancelPlan.mutate(threadId),
    isExitPending: cancelPlan.isPending,
    goal,
    onClearGoal: composer.hidden ? undefined : () => clearGoal.mutate(threadId),
    isClearPending: clearGoal.isPending,
  };
  const stackChips = {
    workflows: activeWorkflows,
    backgroundCommands: activeBackgroundCommands,
    activePromptMode,
    goal,
    pendingTodos: composer.hidden ? null : pendingTodos,
    context: contextChips,
    childPendingInteractions,
    modelFallback,
  };
  const composerActions = useMemo<ComposerAction[]>(
    () => [
      {
        key: "handoff",
        label: "Handoff to new thread",
        icon: "Sent",
        onPress: onHandoffToNewThread,
      },
    ],
    [onHandoffToNewThread],
  );

  const showBanner = pendingInteraction !== null && !composer.hidden;
  // Floating host: the banner (a form) and the queued list (a card list)
  // lose the page fill behind them, so each sits on a raised panel. The
  // chips are not on it: each is its own glass capsule over the timeline,
  // like the composer below them.
  const floatingPanelStyle: ViewStyle | undefined = floating
    ? {
        backgroundColor: tokens.surfaceRaisedSolid,
        borderRadius: 18,
        borderCurve: "continuous",
        overflow: "hidden",
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.18)",
      }
    : undefined;
  const showQueue = !composer.hidden && queuedMessages.length > 0;
  // Skip the stack's bottom gap when nothing renders in it.
  const stackHasContent = hasThreadPromptChips(stackChips) || showQueue;
  return (
    <View
      className={floating ? "px-3 pt-2" : "bg-background px-3 pt-2"}
      // Floating: the host's own margins let touches through to the rows
      // scrolling under them; its children take theirs as usual.
      pointerEvents={floating ? "box-none" : undefined}
      style={[
        {
          paddingBottom: Math.max(insets.bottom, 8),
          maxHeight: windowHeight * MAX_PROMPT_AREA_WINDOW_FRACTION,
        },
        floating
          ? FLOATING_HOST_STYLE
          : // iOS: a hairline seam between the timeline and the input
            // region, the Messages-style bottom bar edge.
            IS_IOS
            ? {
                borderTopWidth: StyleSheet.hairlineWidth,
                borderTopColor: tokens.borderHairline,
              }
            : null,
      ]}
      onLayout={onLayout}
      testID="thread-prompt-area"
    >
      {showBanner ? (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          style={[floatingPanelStyle, floating ? { marginBottom: 8 } : null]}
          contentContainerStyle={{ gap: 8, padding: floating ? 8 : 0 }}
          testID="thread-prompt-area-banner"
        >
          <ThreadPromptChips
            {...chipActions}
            workflows={[]}
            backgroundCommands={[]}
            pendingTodos={null}
            // Only children that need input: the workspace context would
            // crowd the form.
            context={{ ...contextChips, layout: { kind: "hidden" } }}
            childPendingInteractions={childPendingInteractions}
            modelFallback={null}
            testID="thread-prompt-area-banner-chips"
          />
          <PendingInteractionBanner
            interaction={pendingInteraction}
            threadId={threadId}
          />
        </ScrollView>
      ) : (
        <>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            style={{ flexGrow: 0, flexShrink: 1 }}
            contentContainerStyle={{
              gap: 8,
              paddingBottom: stackHasContent ? 8 : 0,
            }}
            testID="thread-prompt-stack"
          >
            <ThreadPromptChips {...chipActions} {...stackChips} />
            {showQueue ? (
              // The queued list is the one stack item that keeps a panel
              // when floating: its card surface is translucent.
              <View
                style={floating ? [floatingPanelStyle, { padding: 8 }] : null}
              >
                <QueuedMessagesList
                  threadId={threadId}
                  queuedMessages={queuedMessages}
                  sendDisabled={composer.queueSendDisabled}
                  actionDisabled={composer.queueActionDisabled}
                  editingQueuedMessageId={
                    composer.editing?.kind === "queued-message"
                      ? composer.editing.queuedMessageId
                      : null
                  }
                  savingQueuedMessageId={composer.savingQueuedMessageId}
                  onEdit={composer.beginQueuedMessageEdit}
                />
              </View>
            ) : null}
          </ScrollView>
          {composer.hidden || thread === undefined ? null : (
            <Composer
              ref={composerRef}
              value={composer.value}
              onChange={composer.setValue}
              attachments={composer.attachments}
              onAttachmentsChange={composer.setAttachments}
              scope={{
                projectId: thread.projectId,
                threadId,
                environmentId,
                hostId,
                providerId: thread.providerId,
              }}
              submitMode={composer.submitMode}
              submitLabel={composer.submitLabel}
              onSubmit={composer.submit}
              isSubmitting={composer.isSubmitting}
              placeholder={composer.placeholder}
              actions={composerActions}
              executionControls={composer.executionControls}
              header={
                composer.editing ? (
                  <EditModeHeader
                    kind={composer.editing.kind}
                    onCancel={composer.cancelEdit}
                  />
                ) : null
              }
              footerAccessory={
                <ThreadContextWindowIndicator usage={contextWindowUsage} />
              }
              typeaheadPlacement="above"
              collapsible
              testID="thread-composer"
            />
          )}
        </>
      )}
    </View>
  );
}

function EditModeHeader({
  kind,
  onCancel,
}: {
  kind: "queued-message" | "sent-message";
  onCancel: () => void;
}) {
  const { tokens } = useTheme();
  return (
    <View
      className="flex-row items-center gap-2 border-b border-border-hairline px-3 py-1.5"
      testID="thread-composer-edit-header"
    >
      <Icon name="Edit" size={14} color={tokens.mutedForeground} />
      <Text
        variant="footnote"
        tone="muted"
        className="min-w-0 flex-1"
        numberOfLines={1}
      >
        {kind === "queued-message"
          ? "Editing queued message"
          : "Editing sent message"}
      </Text>
      <Button
        variant="ghost"
        size="sm"
        onPress={onCancel}
        testID="thread-composer-edit-cancel"
      >
        Cancel
      </Button>
    </View>
  );
}
