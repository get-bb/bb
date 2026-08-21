import { formatPendingInteractionSummary } from "@bb/core-ui";
import type { ThreadPullRequest, WorkspaceFileStatus } from "@bb/domain";
import type { PullRequestMergeMethod } from "@bb/server-contract";
import { Pressable, View } from "react-native";
import {
  formatChangeSummary,
  getPullRequestAttentionDisplay,
  PULL_REQUEST_MERGE_ACTIONS,
  PULL_REQUEST_STATE_DISPLAY,
  resolvePullRequestBannerAction,
  shouldShowPullRequestAttentionLabel,
  toChangeTally,
} from "@/data/environments";
import type { ChildThreadPendingAttention } from "@/data/interactions";
import { useTheme } from "@/theme";
import { Button, Icon, ListRow, Text } from "@/ui";
import { PromptChip } from "../cards/PromptChip";
import {
  mergeChildThreadItems,
  PARENT_SECTION_COPY,
  PARENT_SECTION_ICON,
  type ThreadContextLayout,
} from "./context-model";
import {
  PullRequestStatusPill,
  pullRequestToneColor,
} from "./PullRequestStatusPill";
import { WorkspaceChangesList } from "./WorkspaceChangesList";

interface ThreadContextPullRequestActions {
  isPending: boolean;
  onMarkReady: () => void;
  onMerge: (method: PullRequestMergeMethod) => void;
  onConvertToDraft: () => void;
}

interface ThreadContextMergeBase {
  branch: string;
  /** Opens the merge-base picker. */
  onPress: () => void;
}

/**
 * Data for the context chips (web ThreadPromptContextBanner props as
 * assembled by use-thread-context-chips.ts).
 */
export interface ThreadContextChipsProps {
  layout: ThreadContextLayout;
  onOpenThread: (threadId: string) => void;
  onPressFile: (file: WorkspaceFileStatus) => void;
  /** "Open diff" in the changes sheet (the workspace panel's Diff tab); null hides it. */
  onOpenDiff: (() => void) | null;
  onOpenPullRequest: (url: string) => void;
  /** Null when the environment has no merge base to pick (default branch). */
  mergeBase: ThreadContextMergeBase | null;
  /** Null when PR actions are unavailable (no environment / not git). */
  pullRequestActions: ThreadContextPullRequestActions | null;
  /** Archived threads: the Unarchive action (null when unavailable). */
  unarchive: { pending: boolean; onPress: () => void } | null;
}

/** Does any context chip render for this layout and these pending children? */
export function hasThreadContextChips(
  layout: ThreadContextLayout,
  childPendingInteractions: readonly ChildThreadPendingAttention[],
): boolean {
  return layout.kind !== "hidden" || childPendingInteractions.length > 0;
}

/** The sheet's stretch of file rows; the sheet scrolls past this many. */
const CHANGES_SHEET_MAX_ROWS = 30;

/**
 * Archived thread / gone environment: one read-only status chip whose sheet
 * explains the state and offers Unarchive when the environment still exists.
 */
export function ThreadStatusChip({
  layout,
  unarchive,
}: Pick<ThreadContextChipsProps, "layout" | "unarchive">) {
  if (layout.kind !== "read-only") return null;
  return (
    <PromptChip
      icon={layout.icon}
      label={layout.statusLabel}
      title={layout.statusLabel}
      testID="thread-chip-status"
    >
      <Text className="text-sm text-foreground/90">{layout.description}</Text>
      {layout.offerUnarchive && unarchive ? (
        <Button
          variant="outline"
          icon="ArchiveRestore"
          loading={unarchive.pending}
          onPress={unarchive.onPress}
          className="mt-3"
          testID="thread-chip-unarchive"
        >
          {unarchive.pending ? "Unarchiving…" : "Unarchive"}
        </Button>
      ) : null}
    </PromptChip>
  );
}

/**
 * Active child threads (web ThreadPromptContextBanner's children section
 * plus the inline child pending-interaction banners): "Needs input" in the
 * warning tone while any child waits on the user, otherwise a count. Each
 * sheet row opens the child, whose own banner resolves the interaction.
 */
export function ThreadChildThreadsChip({
  layout,
  childPendingInteractions,
  onOpenThread,
}: Pick<ThreadContextChipsProps, "layout" | "onOpenThread"> & {
  childPendingInteractions: readonly ChildThreadPendingAttention[];
}) {
  const { tokens } = useTheme();
  const items = mergeChildThreadItems(
    layout.kind === "live" ? layout.children : null,
    childPendingInteractions.map((item) => ({
      id: item.childThreadId,
      title: item.childTitle,
      pendingSummary: formatPendingInteractionSummary({
        interaction: item.interaction,
        surface: "app",
      }),
    })),
  );
  if (items.length === 0) return null;
  const pendingCount = items.filter(
    (item) => item.hasPendingInteraction,
  ).length;
  const needsInput = pendingCount > 0;
  return (
    <PromptChip
      icon={needsInput ? "CircleQuestion" : "UserRound"}
      iconColor={needsInput ? tokens.warningText : undefined}
      label={
        needsInput
          ? "Needs input"
          : `${items.length} ${items.length === 1 ? "child" : "children"}`
      }
      detail={needsInput ? String(pendingCount) : undefined}
      title="Child threads"
      testID="thread-chip-children"
    >
      {(sheet) => (
        <View className="-mx-2">
          {items.map((item) => (
            <ListRow
              key={item.id}
              leading={
                item.hasPendingInteraction ? "CircleQuestion" : "UserRound"
              }
              title={item.title}
              subtitle={
                item.pendingSummary ??
                (item.hasPendingInteraction ? "Needs input" : undefined)
              }
              trailing="chevron"
              onPress={() => {
                sheet.dismiss();
                onOpenThread(item.id);
              }}
              testID={`thread-chip-child-${item.id}`}
            />
          ))}
        </View>
      )}
    </PromptChip>
  );
}

/**
 * Changed files (web changed-files row): the chip is the file count; the
 * sheet holds the line tally, the file list (each row opens the diff at
 * that file), the merge-base picker, and Open diff.
 */
export function ThreadChangesChip({
  layout,
  onPressFile,
  onOpenDiff,
  mergeBase,
}: Pick<
  ThreadContextChipsProps,
  "layout" | "onPressFile" | "onOpenDiff" | "mergeBase"
>) {
  const { tokens } = useTheme();
  if (layout.kind !== "live" || layout.git === null) return null;
  const section = layout.git.changedFiles;
  const tally = toChangeTally(section.stats);
  const fileCount = section.files.length;
  return (
    <PromptChip
      icon="FileDiff"
      label={`${fileCount} ${fileCount === 1 ? "file" : "files"}`}
      title={`${section.label} changes`}
      testID="thread-chip-changes"
    >
      {(sheet) => (
        <>
          <Text variant="caption" className="pb-2">
            {formatChangeSummary(tally)}
          </Text>
          <WorkspaceChangesList
            files={section.files}
            onPressFile={(file) => {
              sheet.dismiss();
              onPressFile(file);
            }}
            maxRows={CHANGES_SHEET_MAX_ROWS}
          />
          {mergeBase ? (
            <Pressable
              accessibilityRole="button"
              onPress={mergeBase.onPress}
              className="mt-1.5 min-h-9 flex-row items-center gap-1.5 rounded-sm px-1 active:bg-state-hover"
              testID="thread-chip-merge-base"
            >
              <Icon name="GitMerge" size={14} color={tokens.mutedForeground} />
              <Text variant="caption">Merge base</Text>
              <Text
                variant="mono"
                className="min-w-0 flex-1 text-xs"
                numberOfLines={1}
              >
                {mergeBase.branch}
              </Text>
              <Icon
                name="ChevronDown"
                size={12}
                color={tokens.subtleForeground}
              />
            </Pressable>
          ) : null}
          {onOpenDiff ? (
            <Button
              variant="outline"
              icon="FileDiff"
              onPress={() => {
                sheet.dismiss();
                onOpenDiff();
              }}
              className="mt-3"
              testID="thread-chip-open-diff"
            >
              Open diff
            </Button>
          ) : null}
        </>
      )}
    </PromptChip>
  );
}

/**
 * Pull request (web pull request row): state + checks glyphs, the number,
 * and the state as detail when it is not simply open. The sheet carries
 * the attention label, Open on GitHub, and Mark ready / the merge methods /
 * Convert to draft (the web split-button menu).
 */
export function ThreadPullRequestChip({
  layout,
  onOpenPullRequest,
  pullRequestActions,
}: Pick<
  ThreadContextChipsProps,
  "layout" | "onOpenPullRequest" | "pullRequestActions"
>) {
  if (layout.kind !== "live" || layout.pullRequest === null) return null;
  const pullRequest = layout.pullRequest.pullRequest;
  const state = PULL_REQUEST_STATE_DISPLAY[pullRequest.state];
  return (
    <PromptChip
      icon={state.icon}
      leading={<PullRequestStatusPill pullRequest={pullRequest} />}
      label={`#${pullRequest.number}`}
      detail={pullRequest.state === "open" ? undefined : state.label}
      title={`Pull request #${pullRequest.number}`}
      testID="thread-chip-pull-request"
    >
      {(sheet) => (
        <PullRequestSheetBody
          pullRequest={pullRequest}
          onOpenPullRequest={(url) => {
            sheet.dismiss();
            onOpenPullRequest(url);
          }}
          pullRequestActions={
            pullRequestActions && {
              ...pullRequestActions,
              onMarkReady: () => {
                sheet.dismiss();
                pullRequestActions.onMarkReady();
              },
              onMerge: (method) => {
                sheet.dismiss();
                pullRequestActions.onMerge(method);
              },
              onConvertToDraft: () => {
                sheet.dismiss();
                pullRequestActions.onConvertToDraft();
              },
            }
          }
        />
      )}
    </PromptChip>
  );
}

function PullRequestSheetBody({
  pullRequest,
  onOpenPullRequest,
  pullRequestActions,
}: {
  pullRequest: ThreadPullRequest;
  onOpenPullRequest: (url: string) => void;
  pullRequestActions: ThreadContextPullRequestActions | null;
}) {
  const { tokens } = useTheme();
  const action = resolvePullRequestBannerAction(pullRequest);
  const attention = shouldShowPullRequestAttentionLabel(pullRequest)
    ? getPullRequestAttentionDisplay(pullRequest)
    : null;
  const state = PULL_REQUEST_STATE_DISPLAY[pullRequest.state];
  return (
    <View className="gap-3">
      <View className="flex-row items-center gap-2">
        <PullRequestStatusPill pullRequest={pullRequest} size={16} />
        <Text className="text-sm" numberOfLines={1}>
          {state.label}
        </Text>
        {attention ? (
          <Text
            className="min-w-0 shrink text-sm"
            numberOfLines={1}
            style={{ color: pullRequestToneColor(tokens, attention.tone) }}
          >
            {`· ${attention.label}`}
          </Text>
        ) : null}
      </View>
      <Button
        variant="outline"
        icon="ExternalLink"
        onPress={() => onOpenPullRequest(pullRequest.url)}
        testID="thread-chip-pull-request-open"
      >
        Open on GitHub
      </Button>
      {pullRequestActions && action?.kind === "mark-ready" ? (
        <Button
          icon="GitPullRequestArrow"
          loading={pullRequestActions.isPending}
          onPress={pullRequestActions.onMarkReady}
          testID="thread-chip-pull-request-ready"
        >
          {pullRequestActions.isPending ? "Marking…" : "Mark ready"}
        </Button>
      ) : null}
      {pullRequestActions && action?.kind === "merge" ? (
        <View className="-mx-2 border-t border-border-hairline pt-1">
          {PULL_REQUEST_MERGE_ACTIONS.map((merge) => (
            <ListRow
              key={merge.method}
              leading="GitMerge"
              title={merge.label}
              disabled={pullRequestActions.isPending}
              onPress={() => pullRequestActions.onMerge(merge.method)}
              testID={`thread-chip-pull-request-merge-${merge.method}`}
            />
          ))}
          <ListRow
            leading="GitPullRequestDraft"
            title="Convert to draft"
            disabled={pullRequestActions.isPending}
            onPress={pullRequestActions.onConvertToDraft}
            testID="thread-chip-pull-request-draft"
          />
        </View>
      ) : null}
    </View>
  );
}

/**
 * Related thread (web parent / fork / side-chat row): "Forked from <title>";
 * a tap opens that thread. Shown for live and read-only layouts.
 */
export function ThreadRelatedThreadChip({
  layout,
  onOpenThread,
}: Pick<ThreadContextChipsProps, "layout" | "onOpenThread">) {
  if (layout.kind === "hidden" || layout.parent === null) return null;
  const section = layout.parent;
  const copy = PARENT_SECTION_COPY[section.relationship];
  return (
    <PromptChip
      icon={PARENT_SECTION_ICON[section.relationship]}
      label={`${copy.verb} ${section.title}`}
      title={copy.verb}
      onPress={() => onOpenThread(section.threadId)}
      testID="thread-chip-related-thread"
    />
  );
}
