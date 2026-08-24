import {
  assertNever,
  buildPendingInteractionApprovalResolution,
  type PendingInteractionToolUseAsk,
} from "@bb/core-ui";
import {
  isApprovalPendingInteractionPayload,
  isPluginExtensionInteractionRequestPayload,
  isPluginPendingInteraction,
  isUserQuestionPendingInteractionPayload,
  parseExtensionKind,
  parseNamespacedGlyph,
  type ApprovalPendingInteractionPayload,
  type PendingInteraction,
  type PendingInteractionApprovalDecision,
  type PluginExtensionInteractionRequestPayload,
  type PluginPendingInteraction,
  type ProviderPendingInteraction,
  type UserQuestionPendingInteractionPayload,
} from "@bb/domain";
import { useCallback, useMemo } from "react";
import { ScrollView, View } from "react-native";
import {
  approvalDecisionButtonVariant,
  approvalResolutionDecision,
  buildAskUserQuestionResponse,
  buildUserAnswerResolution,
  describeApprovalSubject,
  labelForApprovalDecision,
  normalizeUserQuestions,
  parsePluginInteractionForm,
  useCancelPluginInteraction,
  useResolvePendingInteraction,
  useRespondPluginInteraction,
  type QuestionFormState,
} from "@/data/interactions";
import { haptic } from "@/lib/haptics";
import { useStopThread } from "@/data/thread-runtime";
import { getMutationErrorMessage } from "@/lib/query/mutation-errors";
import { Markdown } from "@/markdown";
import { Button, Icon, isIconName, Text, type IconName } from "@/ui";
import { useTheme } from "@/theme";
import { usePluginList } from "@/data/plugins";
import { ServerSvgIcon } from "@/screens/plugins/ServerSvgIcon";
import {
  presentationTintColor,
  resolvePluginIconUrl,
} from "@/screens/thread/timeline/renderers/work/work-row-model";
import {
  InteractionBannerShell,
  type InteractionSourceThread,
} from "./InteractionBannerShell";
import { QuestionForm } from "./QuestionForm";
import { SecretRequestForm } from "./SecretRequestForm";

const DETAIL_SCROLL_MAX_HEIGHT = 220;

interface PendingInteractionBannerProps {
  interaction: PendingInteraction;
  /** The thread the interaction belongs to (a child's id for child banners). */
  threadId: string;
  sourceThread?: InteractionSourceThread;
}

function fireSuccessHaptic(): void {
  haptic("success");
}

/**
 * The latest pending interaction of a thread, rendered above the composer
 * (mirrors ThreadPendingInteractionBanner.tsx + PluginPendingInteractionComposer.tsx
 * on the web): approvals with their decisions, user questions, and the two
 * bundled plugin forms natively; any other plugin renderer gets a "needs the
 * desktop app" card with Cancel.
 */
export function PendingInteractionBanner({
  interaction,
  threadId,
  sourceThread,
}: PendingInteractionBannerProps) {
  if (isPluginPendingInteraction(interaction)) {
    return (
      <PluginInteractionBanner
        interaction={interaction}
        threadId={threadId}
        sourceThread={sourceThread}
      />
    );
  }
  const payload = interaction.payload;
  if (isUserQuestionPendingInteractionPayload(payload)) {
    return (
      <UserQuestionInteractionBanner
        interaction={interaction}
        payload={payload}
        threadId={threadId}
        sourceThread={sourceThread}
      />
    );
  }
  if (isApprovalPendingInteractionPayload(payload)) {
    return (
      <ApprovalInteractionBanner
        interaction={interaction}
        payload={payload}
        threadId={threadId}
        sourceThread={sourceThread}
      />
    );
  }
  if (isPluginExtensionInteractionRequestPayload(payload)) {
    return (
      <ProviderPluginRequestBanner
        interaction={interaction}
        payload={payload}
        threadId={threadId}
        sourceThread={sourceThread}
      />
    );
  }
  return assertNever(payload);
}

// --- Provider plugin request -------------------------------------------------------

/**
 * A plugin-defined request the agent raised (`"<pluginId>/<kind>"`). The
 * phone mounts no plugin form, so the card points at the desktop app; like
 * a provider's question, backing out stops the turn.
 */
function ProviderPluginRequestBanner({
  interaction,
  payload,
  threadId,
  sourceThread,
}: {
  interaction: ProviderPendingInteraction;
  payload: PluginExtensionInteractionRequestPayload;
  threadId: string;
  sourceThread?: InteractionSourceThread;
}) {
  const stopThread = useStopThread();
  const { pluginId } = parseExtensionKind(payload.kind);
  const errorMessage = stopThread.error
    ? getMutationErrorMessage({
        error: stopThread.error,
        fallbackMessage: "Failed to stop the thread",
      })
    : null;
  const handleStop = useCallback(() => {
    stopThread.mutate(threadId);
  }, [stopThread, threadId]);

  return (
    <InteractionBannerShell
      title={payload.title}
      subtitle={`The agent asks through ${pluginId}`}
      sourceThread={sourceThread}
      errorMessage={errorMessage}
      testID="pending-interaction-provider-plugin-request"
      footer={
        <Button
          size="sm"
          variant="outline"
          disabled={interaction.status === "resolving"}
          loading={stopThread.isPending}
          onPress={handleStop}
          testID="provider-plugin-request-stop"
        >
          Stop turn
        </Button>
      }
    >
      <Text className="text-sm text-muted-foreground">
        This request needs the desktop app. Answer it there, or stop the turn to
        continue.
      </Text>
    </InteractionBannerShell>
  );
}

// --- Approval ----------------------------------------------------------------

function ApprovalInteractionBanner({
  interaction,
  payload,
  threadId,
  sourceThread,
}: {
  interaction: ProviderPendingInteraction;
  payload: ApprovalPendingInteractionPayload;
  threadId: string;
  sourceThread?: InteractionSourceThread;
}) {
  const resolve = useResolvePendingInteraction();
  const isResolving = interaction.status === "resolving";
  const submittedDecision = approvalResolutionDecision(interaction.resolution);
  const subject = useMemo(
    () => describeApprovalSubject(interaction, payload),
    [interaction, payload],
  );
  const errorMessage = resolve.error
    ? getMutationErrorMessage({
        error: resolve.error,
        fallbackMessage: "Failed to resolve pending interaction",
      })
    : null;
  const submitDisabled = resolve.isPending || isResolving;

  const submitDecision = (decision: PendingInteractionApprovalDecision) => {
    resolve.mutate(
      {
        threadId,
        interactionId: interaction.id,
        resolution: buildPendingInteractionApprovalResolution(
          interaction,
          decision,
        ),
      },
      { onSuccess: fireSuccessHaptic },
    );
  };

  return (
    <InteractionBannerShell
      title={subject.title}
      sourceThread={sourceThread}
      errorMessage={errorMessage}
      testID="pending-interaction-approval"
      footer={payload.availableDecisions.map((decision) => (
        <Button
          key={decision}
          size="sm"
          variant={approvalDecisionButtonVariant(decision)}
          disabled={submitDisabled}
          loading={
            (isResolving && submittedDecision === decision) ||
            (resolve.isPending &&
              resolve.variables?.resolution &&
              "decision" in resolve.variables.resolution &&
              resolve.variables.resolution.decision === decision)
          }
          haptic={decision === "deny" ? "light" : "medium"}
          onPress={() => submitDecision(decision)}
          testID={`approval-${decision}`}
        >
          {labelForApprovalDecision(decision, payload.subject.kind)}
        </Button>
      ))}
    >
      {subject.command !== null ? (
        <View className="overflow-hidden rounded-lg border border-border bg-card">
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            nestedScrollEnabled
          >
            <Text
              variant="mono"
              className="px-3 py-2 text-xs"
              selectable
              testID="approval-command"
            >
              $ {subject.command}
            </Text>
          </ScrollView>
          {subject.detailLines.length > 0 ? (
            <ApprovalDetailList
              className="border-t border-border px-3 py-2"
              lines={subject.detailLines}
            />
          ) : null}
        </View>
      ) : subject.plan !== null ? (
        <View className="overflow-hidden rounded-lg border border-border bg-card">
          <ScrollView
            style={{ maxHeight: DETAIL_SCROLL_MAX_HEIGHT }}
            nestedScrollEnabled
            contentContainerStyle={{
              paddingHorizontal: 12,
              paddingVertical: 8,
            }}
          >
            <Markdown content={subject.plan} selectable={false} />
          </ScrollView>
          {subject.detailLines.length > 0 ? (
            <ApprovalDetailList
              className="border-t border-border px-3 py-2"
              lines={subject.detailLines}
              mono
            />
          ) : null}
        </View>
      ) : subject.toolUse !== null ? (
        <ToolUseAskCard ask={subject.toolUse} />
      ) : subject.detailLines.length > 0 ? (
        <ApprovalDetailList
          className="rounded-lg border border-border bg-card px-3 py-2"
          lines={subject.detailLines}
        />
      ) : null}
    </InteractionBannerShell>
  );
}

/**
 * A presentation's `detail` is agent-authored Markdown: an image in it
 * renders as its alt text on every surface (docs/provider-plugin-api.md §3),
 * never as a fetch the user did not decide on.
 */
const noPresentationImageSource = () => null;

/**
 * The tool-use ask from the bridge's presentation alone (web
 * `ToolUseAskCard`): the row's glyph and tint, the headline or the tool
 * name, and the bridge's Markdown detail.
 */
function ToolUseAskCard({ ask }: { ask: PendingInteractionToolUseAsk }) {
  const { tokens, mode } = useTheme();
  // The same resolution as the timeline row: a plugin-declared icon by its
  // namespaced glyph when the installed-plugin list still has it, else the
  // host glyph, else Terminal.
  const plugins = usePluginList();
  const namespaced = parseNamespacedGlyph(ask.icon.glyph);
  const iconUrl =
    namespaced === null ? null : resolvePluginIconUrl(namespaced, plugins.data);
  const fallbackIcon: IconName = isIconName(ask.icon.glyph)
    ? ask.icon.glyph
    : "Terminal";
  const iconColor = presentationTintColor(ask.tint, mode) ?? tokens.foreground;
  return (
    <View
      className="overflow-hidden rounded-lg border border-border bg-card px-3 py-2"
      testID="approval-tool-use"
    >
      <View className="flex-row items-center gap-2">
        {iconUrl !== null ? (
          <ServerSvgIcon
            path={iconUrl}
            fallbackIcon={fallbackIcon}
            size={16}
            color={iconColor}
          />
        ) : (
          <Icon name={fallbackIcon} size={16} color={iconColor} />
        )}
        <Text
          variant="mono"
          className="min-w-0 flex-1 text-xs"
          numberOfLines={1}
        >
          {ask.headline ?? ask.tool}
        </Text>
      </View>
      {ask.headline !== null ? (
        <Text variant="caption" className="mt-1">
          Tool: {ask.tool}
        </Text>
      ) : null}
      {ask.detail !== null ? (
        <View className="mt-1">
          <Markdown
            content={ask.detail}
            selectable={false}
            resolveImageSource={noPresentationImageSource}
          />
        </View>
      ) : null}
    </View>
  );
}

function ApprovalDetailList({
  className,
  lines,
  mono = false,
}: {
  className: string;
  lines: readonly string[];
  mono?: boolean;
}) {
  return (
    <View className={className}>
      {lines.map((line) => (
        <Text
          key={line}
          variant={mono ? "mono" : "caption"}
          className={mono ? "text-xs text-muted-foreground" : undefined}
          numberOfLines={mono ? 1 : undefined}
        >
          {line}
        </Text>
      ))}
    </View>
  );
}

// --- User question ---------------------------------------------------------------

function UserQuestionInteractionBanner({
  interaction,
  payload,
  threadId,
  sourceThread,
}: {
  interaction: ProviderPendingInteraction;
  payload: UserQuestionPendingInteractionPayload;
  threadId: string;
  sourceThread?: InteractionSourceThread;
}) {
  const resolve = useResolvePendingInteraction();
  const stopThread = useStopThread();
  const isResolving = interaction.status === "resolving";
  const questions = useMemo(
    () => normalizeUserQuestions(payload.questions),
    [payload.questions],
  );
  const errorMessage = resolve.error
    ? getMutationErrorMessage({
        error: resolve.error,
        fallbackMessage: "Failed to submit answer",
      })
    : null;

  const handleSubmit = useCallback(
    (formState: QuestionFormState) => {
      resolve.mutate(
        {
          threadId,
          interactionId: interaction.id,
          resolution: buildUserAnswerResolution(questions, formState),
        },
        { onSuccess: fireSuccessHaptic },
      );
    },
    [interaction.id, questions, resolve, threadId],
  );
  // Cancelling a provider question means stopping the turn (web parity).
  const handleCancel = useCallback(() => {
    stopThread.mutate(threadId);
  }, [stopThread, threadId]);

  return (
    <InteractionBannerShell
      sourceThread={sourceThread}
      errorMessage={errorMessage}
      testID="pending-interaction-question"
    >
      <QuestionForm
        interactionId={interaction.id}
        questions={questions}
        disabled={resolve.isPending || isResolving || stopThread.isPending}
        submitting={resolve.isPending || isResolving}
        onSubmit={handleSubmit}
        onCancel={handleCancel}
      />
    </InteractionBannerShell>
  );
}

// --- Plugin -------------------------------------------------------------------------

function PluginInteractionBanner({
  interaction,
  threadId,
  sourceThread,
}: {
  interaction: PluginPendingInteraction;
  threadId: string;
  sourceThread?: InteractionSourceThread;
}) {
  const respond = useRespondPluginInteraction();
  const cancel = useCancelPluginInteraction();
  const form = useMemo(
    () => parsePluginInteractionForm(interaction),
    [interaction],
  );
  const isResolving = interaction.status === "resolving";
  const busy = respond.isPending || cancel.isPending || isResolving;
  const error = respond.error ?? cancel.error;
  const errorMessage = error
    ? getMutationErrorMessage({
        error,
        fallbackMessage: "Failed to update the plugin request",
      })
    : null;
  const subtitle = `Requested by ${interaction.origin.pluginId}`;

  const handleCancel = useCallback(() => {
    cancel.mutate({ threadId, interactionId: interaction.id });
  }, [cancel, interaction.id, threadId]);

  const submitValue = useCallback(
    (value: Parameters<typeof respond.mutate>[0]["value"]) => {
      respond.mutate(
        { threadId, interactionId: interaction.id, value },
        { onSuccess: fireSuccessHaptic },
      );
    },
    [interaction.id, respond, threadId],
  );

  switch (form.kind) {
    case "ask-user-question":
      return (
        <InteractionBannerShell
          title={interaction.payload.title}
          subtitle={subtitle}
          sourceThread={sourceThread}
          errorMessage={errorMessage}
          testID="pending-interaction-plugin-question"
        >
          <QuestionForm
            interactionId={interaction.id}
            questions={form.questions}
            disabled={busy}
            submitting={respond.isPending || isResolving}
            onSubmit={(formState) =>
              submitValue(
                buildAskUserQuestionResponse(form.questions, formState),
              )
            }
            onCancel={handleCancel}
          />
        </InteractionBannerShell>
      );
    case "secret-request":
      return (
        <InteractionBannerShell
          title={interaction.payload.title}
          subtitle={subtitle}
          sourceThread={sourceThread}
          errorMessage={errorMessage}
          testID="pending-interaction-plugin-secrets"
        >
          <SecretRequestForm
            interactionId={interaction.id}
            payload={form.payload}
            disabled={busy}
            submitting={respond.isPending || isResolving}
            onSubmit={(result) => submitValue(result.response)}
            onCancel={handleCancel}
          />
        </InteractionBannerShell>
      );
    case "invalid":
    case "unsupported":
      return (
        <InteractionBannerShell
          title={interaction.payload.title}
          subtitle={subtitle}
          sourceThread={sourceThread}
          errorMessage={errorMessage}
          testID="pending-interaction-plugin-unsupported"
          footer={
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              loading={cancel.isPending}
              onPress={handleCancel}
              testID="plugin-interaction-cancel"
            >
              Cancel
            </Button>
          }
        >
          <Text className="text-sm text-muted-foreground">
            {form.kind === "invalid"
              ? "This request could not be displayed. Cancel it to continue."
              : "This interaction needs the desktop app. Answer it there, or cancel it to continue."}
          </Text>
        </InteractionBannerShell>
      );
    default:
      return assertNever(form);
  }
}
