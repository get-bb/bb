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
import { ScrollView, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Composer, type ComposerAction, type ComposerHandle } from "@/composer";
import type { ChildThreadPendingAttention } from "@/data/interactions";
import { useCancelThreadPlan, useClearThreadGoal } from "@/data/thread-runtime";
import { useTheme } from "@/theme";
import { Button, Icon, Text } from "@/ui";
import {
  ThreadContextBanner,
  type ThreadContextBannerProps,
} from "../banner/ThreadContextBanner";
import {
  hasThreadPromptChips,
  ThreadContextWindowIndicator,
  ThreadModelFallbackCard,
  ThreadPromptChips,
} from "../cards/ThreadPromptStackChips";
import {
  ChildThreadPendingInteractions,
  PendingInteractionBanner,
} from "../interactions";
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
  contextBanner: ThreadContextBannerProps;
  /** "Handoff to new thread" (compose seeded with a `@thread:` mention). */
  onHandoffToNewThread: () => void;
}

/** Share of the window the stack + composer may take before the stack scrolls. */
const MAX_PROMPT_AREA_WINDOW_FRACTION = 0.6;

/**
 * The bottom of the thread screen (port of apps/app ThreadDetailPromptArea):
 * either the pending-interaction banner (with the child rows and the plan /
 * goal chips) or the prompt stack — child rows, the chip row (workflows,
 * background commands, plan, goal, to-dos), the context banner, model
 * fallback, the queued-message list — above the follow-up composer with its
 * execution pills and context-window readout. Archived threads and gone
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
  contextBanner,
  onHandoffToNewThread,
}: ThreadPromptAreaProps) {
  const insets = useSafeAreaInsets();
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
  // Skip the stack's bottom gap when nothing renders in it.
  const stackHasContent =
    childPendingInteractions.length > 0 ||
    hasThreadPromptChips(stackChips) ||
    contextBanner.layout.kind !== "hidden" ||
    modelFallback !== null ||
    (!composer.hidden && queuedMessages.length > 0);
  return (
    <View
      className="bg-background px-3 pt-1"
      style={{
        paddingBottom: Math.max(insets.bottom, 8),
        maxHeight: windowHeight * MAX_PROMPT_AREA_WINDOW_FRACTION,
      }}
      testID="thread-prompt-area"
    >
      {showBanner ? (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ gap: 8 }}
          testID="thread-prompt-area-banner"
        >
          <ChildThreadPendingInteractions items={childPendingInteractions} />
          <ThreadPromptChips
            {...chipActions}
            workflows={[]}
            backgroundCommands={[]}
            pendingTodos={null}
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
            <ChildThreadPendingInteractions items={childPendingInteractions} />
            <ThreadPromptChips {...chipActions} {...stackChips} />
            <ThreadContextBanner {...contextBanner} />
            {modelFallback ? (
              <ThreadModelFallbackCard
                key={`${threadId}:${modelFallback.sourceSeq}`}
                fallback={modelFallback}
              />
            ) : null}
            {!composer.hidden && queuedMessages.length > 0 ? (
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
      <Text variant="caption" className="min-w-0 flex-1" numberOfLines={1}>
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
