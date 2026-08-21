import type { WorkspaceFileStatus } from "@bb/domain";
import type { PullRequestMergeMethod } from "@bb/server-contract";
import { useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import {
  formatChangedFilesSectionLabel,
  formatPullRequestRowLabel,
  getPullRequestAttentionDisplay,
  resolvePullRequestBannerAction,
  shouldShowPullRequestAttentionLabel,
} from "@/data/environments";
import { useTheme } from "@/theme";
import { cn, Icon, Text, useSheet, type IconName } from "@/ui";
import {
  PARENT_SECTION_COPY,
  PARENT_SECTION_ICON,
  type ThreadBannerChildThreadsSection,
  type ThreadBannerLayout,
  type ThreadBannerParentSection,
} from "./banner-model";
import { PullRequestMergeSheet } from "./PullRequestMergeSheet";
import {
  PullRequestStatusPill,
  pullRequestToneColor,
} from "./PullRequestStatusPill";
import { WorkspaceChangesList } from "./WorkspaceChangesList";

interface ThreadContextBannerPullRequestActions {
  isPending: boolean;
  onMarkReady: () => void;
  onMerge: (method: PullRequestMergeMethod) => void;
  onConvertToDraft: () => void;
}

interface ThreadContextBannerMergeBase {
  branch: string;
  /** Opens the merge-base picker. */
  onPress: () => void;
}

export interface ThreadContextBannerProps {
  layout: ThreadBannerLayout;
  onOpenThread: (threadId: string) => void;
  onPressFile: (file: WorkspaceFileStatus) => void;
  /** "Open diff" on the changed-files row (the workspace panel's Diff tab); null hides it. */
  onOpenDiff: (() => void) | null;
  onOpenPullRequest: (url: string) => void;
  /** Null when the environment has no merge base to pick (default branch). */
  mergeBase: ThreadContextBannerMergeBase | null;
  /** Null when PR actions are unavailable (no environment / not git). */
  pullRequestActions: ThreadContextBannerPullRequestActions | null;
  /** Archived threads: the Unarchive action (null when unavailable). */
  unarchive: { pending: boolean; onPress: () => void } | null;
}

function Card({ children, testID }: { children: ReactNode; testID: string }) {
  return (
    <View
      className="overflow-hidden rounded-md border border-border bg-surface-raised-solid"
      testID={testID}
    >
      {children}
    </View>
  );
}

function Row({
  icon,
  iconColor,
  label,
  labelNode,
  trailing,
  onPress,
  accessibilityLabel,
  expanded,
  testID,
}: {
  icon: IconName | null;
  iconColor?: string;
  label?: string;
  labelNode?: ReactNode;
  trailing?: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  expanded?: boolean;
  testID: string;
}) {
  const { tokens } = useTheme();
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={expanded === undefined ? undefined : { expanded }}
      disabled={!onPress}
      onPress={onPress}
      className="min-h-9 flex-row items-center gap-2 px-3 py-1.5 active:bg-state-hover"
      testID={testID}
    >
      {icon ? (
        <Icon
          name={icon}
          size={14}
          color={iconColor ?? tokens.mutedForeground}
        />
      ) : null}
      {labelNode ?? (
        <Text className="min-w-0 flex-1 text-xs" numberOfLines={1}>
          {label}
        </Text>
      )}
      {trailing}
    </Pressable>
  );
}

function ActionButton({
  label,
  onPress,
  disabled,
  icon,
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled: boolean;
  icon?: IconName;
  testID: string;
}) {
  const { tokens } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      className={cn(
        "h-7 flex-row items-center gap-1 rounded border border-border bg-background px-2 active:bg-state-hover",
        disabled && "opacity-60",
      )}
      testID={testID}
    >
      <Text variant="caption" className="text-foreground">
        {label}
      </Text>
      {icon ? (
        <Icon name={icon} size={12} color={tokens.mutedForeground} />
      ) : null}
    </Pressable>
  );
}

function ParentRow({
  section,
  onOpenThread,
}: {
  section: ThreadBannerParentSection;
  onOpenThread: (threadId: string) => void;
}) {
  const { tokens } = useTheme();
  const copy = PARENT_SECTION_COPY[section.relationship];
  return (
    <Row
      icon={PARENT_SECTION_ICON[section.relationship]}
      labelNode={
        <Text className="min-w-0 flex-1 text-xs" numberOfLines={1}>
          <Text className="text-xs text-muted-foreground">{`${copy.verb} `}</Text>
          <Text className="text-xs underline">{section.title}</Text>
        </Text>
      }
      trailing={
        <Icon name="ChevronRight" size={14} color={tokens.subtleForeground} />
      }
      onPress={() => onOpenThread(section.threadId)}
      accessibilityLabel={`${copy.verb} ${section.title}`}
      testID="thread-banner-parent"
    />
  );
}

function ChildThreadsCard({
  section,
  onOpenThread,
}: {
  section: ThreadBannerChildThreadsSection;
  onOpenThread: (threadId: string) => void;
}) {
  const { tokens } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const needsInput = section.pendingCount > 0;
  const otherCount = section.items.length - 1;
  return (
    <Card testID="thread-banner-children">
      <Row
        icon={needsInput ? "CircleQuestion" : "UserRound"}
        iconColor={needsInput ? tokens.warningText : tokens.mutedForeground}
        labelNode={
          <Text className="min-w-0 flex-1 text-xs" numberOfLines={1}>
            <Text className="text-xs text-muted-foreground">
              {needsInput ? "Needs your input: " : "Active child thread: "}
            </Text>
            <Text className="text-xs font-medium">{section.primary.title}</Text>
          </Text>
        }
        trailing={
          <View className="flex-row items-center gap-1.5">
            {otherCount > 0 ? (
              <Text variant="caption">{`+${otherCount} more`}</Text>
            ) : null}
            <Icon
              name={expanded ? "ChevronUp" : "ChevronDown"}
              size={14}
              color={tokens.mutedForeground}
            />
          </View>
        }
        onPress={() => setExpanded((value) => !value)}
        accessibilityLabel={`${section.label}: ${section.primary.title}`}
        expanded={expanded}
        testID="thread-banner-children-toggle"
      />
      {expanded ? (
        <View className="border-t border-border bg-popover py-1">
          {section.items.map((item) => (
            <Row
              key={item.id}
              icon={
                item.hasPendingInteraction ? "CircleQuestion" : "ChevronRight"
              }
              label={item.title}
              trailing={
                item.hasPendingInteraction ? (
                  <Text variant="caption">Needs input</Text>
                ) : null
              }
              onPress={() => onOpenThread(item.id)}
              testID={`thread-banner-child-${item.id}`}
            />
          ))}
        </View>
      ) : null}
    </Card>
  );
}

/**
 * The thread's high-signal context above the composer (web
 * ThreadPromptContextBanner as stacked rows): the active-children card, then
 * one card with the parent / fork row, the pull request row with its
 * actions, and the changed-files row that expands into the file list and
 * the merge-base row. Archived / environment-gone threads show a single
 * read-only status row (+ the parent row).
 */
export function ThreadContextBanner({
  layout,
  onOpenThread,
  onPressFile,
  onOpenDiff,
  onOpenPullRequest,
  mergeBase,
  pullRequestActions,
  unarchive,
}: ThreadContextBannerProps) {
  const { tokens } = useTheme();
  const [gitExpanded, setGitExpanded] = useState(false);
  const mergeSheet = useSheet();

  if (layout.kind === "hidden") return null;

  if (layout.kind === "read-only") {
    return (
      <Card testID="thread-banner-read-only">
        {layout.parent ? (
          <ParentRow section={layout.parent} onOpenThread={onOpenThread} />
        ) : null}
        <Row
          icon={layout.icon}
          label={layout.statusLabel}
          trailing={
            layout.offerUnarchive && unarchive ? (
              <ActionButton
                label={unarchive.pending ? "Unarchiving…" : "Unarchive"}
                onPress={unarchive.onPress}
                disabled={unarchive.pending}
                testID="thread-banner-unarchive"
              />
            ) : null
          }
          accessibilityLabel={layout.statusLabel}
          testID="thread-banner-status"
        />
      </Card>
    );
  }

  const pullRequest = layout.pullRequest?.pullRequest ?? null;
  const pullRequestAction =
    pullRequest === null ? null : resolvePullRequestBannerAction(pullRequest);
  const attention =
    pullRequest && shouldShowPullRequestAttentionLabel(pullRequest)
      ? getPullRequestAttentionDisplay(pullRequest)
      : null;
  const hasContextCard =
    layout.parent !== null ||
    layout.pullRequest !== null ||
    layout.git !== null;

  return (
    <View className="gap-2" testID="thread-context-banner">
      {layout.children ? (
        <ChildThreadsCard
          section={layout.children}
          onOpenThread={onOpenThread}
        />
      ) : null}
      {hasContextCard ? (
        <Card testID="thread-banner-context">
          {layout.parent ? (
            <ParentRow section={layout.parent} onOpenThread={onOpenThread} />
          ) : null}
          {pullRequest ? (
            <Row
              icon={null}
              labelNode={
                <View className="min-w-0 flex-1 flex-row items-center gap-1.5">
                  <PullRequestStatusPill pullRequest={pullRequest} />
                  <Text className="text-xs" numberOfLines={1}>
                    {formatPullRequestRowLabel(pullRequest)}
                  </Text>
                  {attention ? (
                    <Text
                      className="min-w-0 shrink text-xs"
                      numberOfLines={1}
                      style={{
                        color: pullRequestToneColor(tokens, attention.tone),
                      }}
                    >
                      {`· ${attention.label}`}
                    </Text>
                  ) : null}
                </View>
              }
              trailing={
                pullRequestActions &&
                pullRequestAction?.kind === "mark-ready" ? (
                  <ActionButton
                    label={
                      pullRequestActions.isPending ? "Marking…" : "Mark ready"
                    }
                    onPress={pullRequestActions.onMarkReady}
                    disabled={pullRequestActions.isPending}
                    testID="thread-banner-pr-ready"
                  />
                ) : pullRequestActions &&
                  pullRequestAction?.kind === "merge" ? (
                  <ActionButton
                    label="Merge"
                    icon="ChevronDown"
                    onPress={mergeSheet.present}
                    disabled={pullRequestActions.isPending}
                    testID="thread-banner-pr-merge"
                  />
                ) : null
              }
              onPress={() => onOpenPullRequest(pullRequest.url)}
              accessibilityLabel={`Pull request ${pullRequest.number}`}
              testID="thread-banner-pull-request"
            />
          ) : null}
          {layout.git ? (
            <>
              <Row
                icon="FileDiff"
                label={formatChangedFilesSectionLabel(layout.git.changedFiles)}
                trailing={
                  <View className="flex-row items-center gap-1.5">
                    {onOpenDiff ? (
                      <ActionButton
                        label="Open diff"
                        onPress={onOpenDiff}
                        disabled={false}
                        icon="FileDiff"
                        testID="thread-banner-open-diff"
                      />
                    ) : null}
                    <Icon
                      name={gitExpanded ? "ChevronUp" : "ChevronDown"}
                      size={14}
                      color={tokens.mutedForeground}
                    />
                  </View>
                }
                onPress={() => setGitExpanded((value) => !value)}
                expanded={gitExpanded}
                testID="thread-banner-git"
              />
              {gitExpanded ? (
                <View className="border-t border-border bg-popover px-2 pb-2 pt-1.5">
                  <WorkspaceChangesList
                    files={layout.git.changedFiles.files}
                    onPressFile={onPressFile}
                  />
                  {mergeBase ? (
                    <Pressable
                      accessibilityRole="button"
                      onPress={mergeBase.onPress}
                      className="mt-1.5 min-h-7 flex-row items-center gap-1.5 rounded-sm px-1 active:bg-state-hover"
                      testID="thread-banner-merge-base"
                    >
                      <Icon
                        name="GitMerge"
                        size={14}
                        color={tokens.mutedForeground}
                      />
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
                </View>
              ) : null}
            </>
          ) : null}
        </Card>
      ) : null}
      {pullRequest && pullRequestActions ? (
        <PullRequestMergeSheet
          controller={mergeSheet}
          pullRequestNumber={pullRequest.number}
          onMerge={pullRequestActions.onMerge}
          onConvertToDraft={pullRequestActions.onConvertToDraft}
          disabled={pullRequestActions.isPending}
        />
      ) : null}
    </View>
  );
}
