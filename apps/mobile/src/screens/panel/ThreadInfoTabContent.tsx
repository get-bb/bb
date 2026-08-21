import { formatEnvironmentDisplay } from "@bb/core-ui";
import type {
  Environment,
  GitCheckoutRef,
  Host,
  WorkspaceCommitSummary,
  WorkspaceFileStatus,
  WorkspaceStatus,
} from "@bb/domain";
import type { ThreadResponse } from "@bb/server-contract";
import { useRouter } from "expo-router";
import { useCallback, useMemo, type ReactNode } from "react";
import { Linking, Pressable, ScrollView, View } from "react-native";
import {
  formatChangeSummary,
  formatPullRequestRowLabel,
  getEnvironmentPullRequestFromResponse,
  getGitStatusDisplay,
  getPullRequestAttentionDisplay,
  selectWorkspaceChangedFilesSections,
  shouldShowPullRequestAttentionLabel,
  toChangeTally,
  useEnvironment,
  useEnvironmentPullRequest,
  useEnvironmentWorkspace,
  type WorkspaceChangedFilesSection,
} from "@/data/environments";
import { useHosts } from "@/data/hosts";
import {
  getThreadDisplayTitle,
  useThread,
  useThreadsList,
  useUnarchiveThread,
} from "@/data/threads";
import { copyWithToast } from "@/lib/clipboard";
import { useTheme } from "@/theme";
import {
  Button,
  cn,
  Icon,
  Pill,
  Skeleton,
  Text,
  toast,
  useSheet,
  type IconName,
} from "@/ui";
import { MergeBasePickerSheet } from "../thread/context/MergeBasePickerSheet";
import {
  PullRequestStatusPill,
  pullRequestToneColor,
} from "../thread/context/PullRequestStatusPill";
import { WorkspaceChangesList } from "../thread/context/WorkspaceChangesList";
import { threadHref } from "../shell/hrefs";
import { usePanel } from "./PanelProvider";
import type { PanelTabContentProps } from "./registry";

/**
 * The Info tab: the mobile port of the web ThreadMetadataContent rows —
 * parent, forks, environment, directory, branch / checkout, merge base, git
 * status, pull request, archived, commits, changed files, thread storage.
 * Every row derives from the cached thread / environment / workspace queries
 * the screen already holds; the rows that lead somewhere (changed files →
 * Diff tab, storage → Files tab, parent / forks → thread) go through the
 * panel controller and the router.
 */

function DetailRow({
  icon,
  label,
  children,
  onPress,
  onLongPress,
  accessibilityLabel,
  chevron = true,
  testID,
}: {
  icon: IconName | null;
  label: string;
  children: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  accessibilityLabel?: string;
  /** Pressable rows lead somewhere by default; copy rows turn this off. */
  chevron?: boolean;
  testID: string;
}) {
  const { tokens } = useTheme();
  const interactive = Boolean(onPress || onLongPress);
  return (
    <Pressable
      accessibilityRole={interactive ? "button" : undefined}
      accessibilityLabel={accessibilityLabel ?? label}
      disabled={!interactive}
      onPress={onPress}
      onLongPress={onLongPress}
      className={cn(
        "min-h-10 flex-row items-center gap-3 rounded-md px-2 py-1.5",
        interactive && "active:bg-state-hover",
      )}
      testID={testID}
    >
      <View className="w-[104px] flex-row items-center gap-1.5">
        {icon ? (
          <Icon name={icon} size={14} color={tokens.mutedForeground} />
        ) : null}
        <Text variant="caption" numberOfLines={1} className="shrink">
          {label}
        </Text>
      </View>
      <View className="min-w-0 flex-1 flex-row items-center gap-2">
        {children}
      </View>
      {onPress && chevron ? (
        <Icon name="ChevronRight" size={14} color={tokens.subtleForeground} />
      ) : null}
    </Pressable>
  );
}

function ValueText({
  children,
  mono = false,
  tone,
  testID,
}: {
  children: string;
  mono?: boolean;
  tone?: "muted" | "destructive";
  testID?: string;
}) {
  return (
    <Text
      variant={mono ? "mono" : "body"}
      numberOfLines={1}
      className={cn(
        "min-w-0 shrink text-sm",
        tone === "muted" && "text-muted-foreground",
        tone === "destructive" && "text-destructive-text",
      )}
      testID={testID}
    >
      {children}
    </Text>
  );
}

function SectionHeader({ children }: { children: string }) {
  return (
    <Text variant="sectionLabel" className="px-2 pb-1 pt-4">
      {children}
    </Text>
  );
}

// ---------------------------------------------------------------------------
// Rows

function ParentRow({ thread }: { thread: ThreadResponse }) {
  const router = useRouter();
  const parentId = thread.parentThreadId;
  const parentQuery = useThread(parentId ?? "", { enabled: parentId !== null });
  if (parentId === null) return null;
  const title = parentQuery.data
    ? getThreadDisplayTitle(parentQuery.data)
    : "Parent thread";
  return (
    <DetailRow
      icon="Fork"
      label="Parent"
      onPress={() => router.push(threadHref(parentId))}
      testID="panel-info-parent"
    >
      <ValueText>{title}</ValueText>
    </DetailRow>
  );
}

function ForksRow({ thread }: { thread: ThreadResponse }) {
  const router = useRouter();
  const forksQuery = useThreadsList({
    projectId: thread.projectId,
    sourceThreadId: thread.id,
    originKind: "fork",
    archived: false,
  });
  const forks = forksQuery.data ?? [];
  if (forks.length === 0) return null;
  return (
    <View testID="panel-info-forks">
      {forks.map((fork, index) => (
        <DetailRow
          key={fork.id}
          icon={index === 0 ? "Fork" : null}
          label={index === 0 ? "Forks" : ""}
          onPress={() => router.push(threadHref(fork.id))}
          accessibilityLabel={`Open fork ${getThreadDisplayTitle(fork)}`}
          testID="panel-info-fork"
        >
          <ValueText>{getThreadDisplayTitle(fork)}</ValueText>
        </DetailRow>
      ))}
    </View>
  );
}

function EnvironmentRow({
  environment,
  host,
}: {
  environment: Environment;
  host: Host | null;
}) {
  const display = formatEnvironmentDisplay({
    environment,
    // A phone has no host daemon of its own: every machine is remote.
    host: {
      locality: "remote",
      identity: host
        ? { name: host.name, connected: host.status === "connected" }
        : null,
    },
  });
  return (
    <DetailRow
      icon={environment.isWorktree ? "FolderGit" : "Folder"}
      label="Environment"
      testID="panel-info-environment"
    >
      <Text
        className="min-w-0 shrink text-sm"
        numberOfLines={1}
        testID="panel-info-environment-label"
      >
        {display.compactModeLabel}
        {host ? (
          <Text className="text-sm text-muted-foreground">{` · ${host.name}${
            host.status === "connected" ? "" : " (offline)"
          }`}</Text>
        ) : null}
      </Text>
      {environment.managed ? (
        <Pill variant="outline" size="sm">
          managed
        </Pill>
      ) : null}
    </DetailRow>
  );
}

function DirectoryRow({ path }: { path: string }) {
  return (
    <DetailRow
      icon="Folder"
      label="Directory"
      onPress={() => copyWithToast(path, "Directory copied")}
      accessibilityLabel="Copy directory"
      chevron={false}
      testID="panel-info-directory"
    >
      <ValueText mono testID="panel-info-directory-path">
        {path}
      </ValueText>
      <CopyGlyph />
    </DetailRow>
  );
}

function CopyGlyph() {
  const { tokens } = useTheme();
  return <Icon name="Copy" size={14} color={tokens.mutedForeground} />;
}

function describeCheckout(checkout: GitCheckoutRef): {
  rowLabel: "Branch" | "Checkout";
  label: string;
  copyValue: string | null;
  copiedMessage: string;
} {
  switch (checkout.kind) {
    case "branch":
      return {
        rowLabel: "Branch",
        label: checkout.branchName,
        copyValue: checkout.branchName,
        copiedMessage: "Branch name copied",
      };
    case "detached":
      return {
        rowLabel: "Checkout",
        label:
          checkout.headSha === null
            ? "detached HEAD"
            : `detached ${checkout.headSha.slice(0, 7)}`,
        copyValue: checkout.headSha,
        copiedMessage: "Commit SHA copied",
      };
    case "unborn":
      return {
        rowLabel: "Checkout",
        label:
          checkout.branchName !== null
            ? `${checkout.branchName} (empty)`
            : "empty repo",
        copyValue: null,
        copiedMessage: "",
      };
    case "unknown":
      return {
        rowLabel: "Checkout",
        label: "unknown checkout",
        copyValue: null,
        copiedMessage: "",
      };
  }
}

function BranchRow({ checkout }: { checkout: GitCheckoutRef }) {
  const display = describeCheckout(checkout);
  return (
    <DetailRow
      icon="GitBranch"
      label={display.rowLabel}
      onPress={
        display.copyValue === null
          ? undefined
          : () => copyWithToast(display.copyValue ?? "", display.copiedMessage)
      }
      accessibilityLabel={`${display.rowLabel}: ${display.label}`}
      chevron={false}
      testID="panel-info-branch"
    >
      <ValueText mono testID="panel-info-branch-name">
        {display.label}
      </ValueText>
    </DetailRow>
  );
}

function MergeBaseRow({
  branch,
  onPress,
}: {
  branch: string;
  onPress: (() => void) | null;
}) {
  return (
    <DetailRow
      icon="GitMerge"
      label="Merge base"
      onPress={onPress ?? undefined}
      testID="panel-info-merge-base"
    >
      <ValueText mono>{branch}</ValueText>
    </DetailRow>
  );
}

function GitStatusRow({ label, summary }: { label: string; summary: string }) {
  return (
    <DetailRow
      icon="FileDiff"
      label="Git status"
      testID="panel-info-git-status"
    >
      <ValueText tone={label === "Dirty" ? "destructive" : undefined}>
        {label}
      </ValueText>
      {summary ? <ValueText tone="muted">{summary}</ValueText> : null}
    </DetailRow>
  );
}

function PullRequestRow({
  pullRequest,
}: {
  pullRequest: NonNullable<
    ReturnType<typeof getEnvironmentPullRequestFromResponse>
  >;
}) {
  const { tokens } = useTheme();
  const attention = shouldShowPullRequestAttentionLabel(pullRequest)
    ? getPullRequestAttentionDisplay(pullRequest)
    : null;
  const open = () => {
    Linking.openURL(pullRequest.url).catch(() => {
      toast.error("Could not open the pull request");
    });
  };
  return (
    <DetailRow
      icon="GitPullRequestArrow"
      label="Pull request"
      onPress={open}
      accessibilityLabel={`Open pull request ${pullRequest.number}`}
      testID="panel-info-pull-request"
    >
      <PullRequestStatusPill pullRequest={pullRequest} />
      <ValueText>{formatPullRequestRowLabel(pullRequest)}</ValueText>
      {attention ? (
        <Text
          className="min-w-0 shrink text-sm"
          numberOfLines={1}
          style={{ color: pullRequestToneColor(tokens, attention.tone) }}
        >
          {attention.label}
        </Text>
      ) : null}
    </DetailRow>
  );
}

function ArchivedRow({ thread }: { thread: ThreadResponse }) {
  const unarchive = useUnarchiveThread();
  if (thread.archivedAt === null) return null;
  const pending = unarchive.isPending && unarchive.variables?.id === thread.id;
  return (
    <DetailRow
      icon="PackageReceive"
      label="Archived"
      testID="panel-info-archived"
    >
      <Button
        variant="outline"
        size="sm"
        loading={pending}
        onPress={() => unarchive.mutate({ id: thread.id })}
        testID="panel-info-unarchive"
      >
        Unarchive
      </Button>
    </DetailRow>
  );
}

function CommitsSection({
  commits,
}: {
  commits: readonly WorkspaceCommitSummary[];
}) {
  if (commits.length === 0) return null;
  return (
    <View testID="panel-info-commits">
      <SectionHeader>Commits</SectionHeader>
      {commits.map((commit) => (
        <Pressable
          key={commit.sha}
          accessibilityRole="button"
          accessibilityLabel={`Copy commit ${commit.shortSha}`}
          onLongPress={() => copyWithToast(commit.sha, "Commit SHA copied")}
          className="min-h-9 flex-row items-center gap-2 rounded-md px-2 py-1 active:bg-state-hover"
          testID="panel-info-commit"
        >
          <Text className="min-w-0 flex-1 text-sm" numberOfLines={1}>
            {commit.subject}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Copy commit ${commit.shortSha} SHA`}
            hitSlop={6}
            onPress={() => copyWithToast(commit.sha, "Commit SHA copied")}
            className="rounded-sm px-1.5 py-0.5 active:bg-state-hover"
          >
            <Text variant="mono" className="text-xs text-subtle-foreground">
              {commit.shortSha}
            </Text>
          </Pressable>
        </Pressable>
      ))}
    </View>
  );
}

function ChangedFilesSection({
  sections,
  onOpenDiff,
}: {
  sections: readonly WorkspaceChangedFilesSection[];
  onOpenDiff: (path: string | null) => void;
}) {
  const { tokens } = useTheme();
  if (sections.length === 0) return null;
  const onPressFile = (file: WorkspaceFileStatus) => onOpenDiff(file.path);
  return (
    <View testID="panel-info-changed-files">
      <SectionHeader>Changed files</SectionHeader>
      {sections.map((section) => (
        <View key={section.kind} className="gap-1 pb-2">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open diff: ${section.label}`}
            onPress={() => onOpenDiff(null)}
            className="min-h-9 flex-row items-center gap-2 rounded-md px-2 py-1 active:bg-state-hover"
            testID={`panel-info-changed-files-${section.kind}`}
          >
            <Icon name="FileDiff" size={14} color={tokens.mutedForeground} />
            <Text className="min-w-0 flex-1 text-sm" numberOfLines={1}>
              {`${section.label} · ${formatChangeSummary(toChangeTally(section.stats))}`}
            </Text>
            <Icon
              name="ChevronRight"
              size={14}
              color={tokens.subtleForeground}
            />
          </Pressable>
          <View className="px-2">
            <WorkspaceChangesList
              files={section.files}
              onPressFile={onPressFile}
              maxRows={5}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

function ThreadStorageRow({ onPress }: { onPress: () => void }) {
  return (
    <DetailRow
      icon="FolderOpen"
      label="Storage"
      onPress={onPress}
      accessibilityLabel="Browse thread storage"
      testID="panel-info-storage"
    >
      <ValueText tone="muted">Files the thread saved</ValueText>
    </DetailRow>
  );
}

// ---------------------------------------------------------------------------
// Composition

function InfoSkeleton() {
  return (
    <View className="gap-3 px-4 pt-4" testID="panel-info-loading">
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-4 w-3/4" />
    </View>
  );
}

export function ThreadInfoTabContent({ scope }: PanelTabContentProps) {
  const panel = usePanel();
  const threadId = scope.kind === "thread" ? scope.threadId : null;
  const threadQuery = useThread(threadId ?? "", { enabled: threadId !== null });
  const thread = threadQuery.data;
  const environmentId = thread?.environmentId ?? null;
  const environmentQuery = useEnvironment(environmentId);
  const environment = environmentQuery.data;
  const hostsQuery = useHosts();
  const host =
    environment && hostsQuery.data
      ? (hostsQuery.data.find(
          (candidate) => candidate.id === environment.hostId,
        ) ?? null)
      : null;
  const canUseGitUi =
    thread !== undefined &&
    environmentId !== null &&
    environment?.isGitRepo === true;
  const workspace = useEnvironmentWorkspace({
    environment,
    enabled: canUseGitUi,
  });
  const pullRequestQuery = useEnvironmentPullRequest(environmentId, {
    enabled: canUseGitUi,
  });
  const pullRequest = getEnvironmentPullRequestFromResponse(
    pullRequestQuery.data,
  );
  const mergeBaseSheet = useSheet();
  const workspaceStatus: WorkspaceStatus | undefined =
    workspace.workspaceStatus;
  const changedFileSections = useMemo(
    () => selectWorkspaceChangedFilesSections(workspaceStatus),
    [workspaceStatus],
  );
  const commits = useMemo(
    () => (workspaceStatus?.mergeBase?.commits ?? []).slice().reverse(),
    [workspaceStatus],
  );
  const gitStatus = getGitStatusDisplay(workspaceStatus, {
    mergeBaseBranch: workspace.mergeBase.effectiveMergeBaseBranch,
    showBranchComparison: workspace.mergeBase.showBranchComparison,
    error: workspace.statusError ?? undefined,
    workspaceUnavailable: workspace.workspaceUnavailable,
    workspaceDeleted: environment?.status === "destroyed",
  });
  const showGitStatus =
    thread !== undefined &&
    (workspaceStatus !== undefined ||
      workspace.statusError !== null ||
      workspace.workspaceUnavailable !== undefined ||
      environment?.status === "destroyed") &&
    !(thread.archivedAt !== null && environment?.managed !== true);

  const openDiff = useCallback(
    (path: string | null) => panel.openDiff(path),
    [panel],
  );
  const openStorage = useCallback(
    () => panel.openFiles({ section: "storage" }),
    [panel],
  );

  if (threadId === null) return null;
  if (thread === undefined) {
    return threadQuery.isError ? (
      <View className="px-4 pt-4" testID="panel-info-error">
        <Text variant="caption">Could not load this thread.</Text>
      </View>
    ) : (
      <InfoSkeleton />
    );
  }

  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{ paddingHorizontal: 8, paddingVertical: 8 }}
      keyboardShouldPersistTaps="handled"
      testID="panel-info"
    >
      <ParentRow thread={thread} />
      <ForksRow thread={thread} />
      {environment ? (
        <EnvironmentRow environment={environment} host={host} />
      ) : null}
      {environment?.path ? <DirectoryRow path={environment.path} /> : null}
      {workspaceStatus ? (
        <BranchRow checkout={workspaceStatus.checkout} />
      ) : null}
      {workspace.mergeBase.showMergeBase &&
      workspace.mergeBase.effectiveMergeBaseBranch ? (
        <MergeBaseRow
          branch={workspace.mergeBase.effectiveMergeBaseBranch}
          onPress={mergeBaseSheet.present}
        />
      ) : null}
      {showGitStatus ? (
        <GitStatusRow label={gitStatus.label} summary={gitStatus.summary} />
      ) : null}
      {pullRequest ? <PullRequestRow pullRequest={pullRequest} /> : null}
      <ArchivedRow thread={thread} />
      <CommitsSection commits={commits} />
      <ChangedFilesSection
        sections={changedFileSections}
        onOpenDiff={openDiff}
      />
      <View className="pt-2">
        <ThreadStorageRow onPress={openStorage} />
      </View>
      {canUseGitUi ? (
        <MergeBasePickerSheet
          controller={mergeBaseSheet}
          environmentId={environmentId}
          mergeBaseBranch={workspace.mergeBase.effectiveMergeBaseBranch}
          onSelect={workspace.mergeBase.setMergeBaseBranch}
        />
      ) : null}
    </ScrollView>
  );
}
