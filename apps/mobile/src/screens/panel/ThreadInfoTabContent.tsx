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
import { Linking, ScrollView, View } from "react-native";
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
  DisclosureChevron,
  GROUPED_ROW_PADDING_X,
  GroupedRow,
  GroupedSection,
  Icon,
  LIST_ROW_ICON_SIZE,
  Skeleton,
  Text,
  toast,
  useSheet,
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
 * The Info tab: the mobile port of the web ThreadMetadataContent rows as
 * inset-grouped cards — parent, forks, environment, directory, branch /
 * checkout, merge base, git status, pull request, archived; commits; changed
 * files; thread storage. Every row derives from the cached thread /
 * environment / workspace queries the screen already holds; the rows that
 * lead somewhere (changed files → Diff tab, storage → Files tab, parent /
 * forks → thread) go through the panel controller and the router. The cards
 * sit on the panel's raised surface (`surface="raised"`).
 */

/**
 * Separator inset of the detail cards: every row leads with a glyph, so the
 * hairlines start at the text column (row padding + glyph + gap).
 */
const GLYPH_ROW_SEPARATOR_INSET =
  GROUPED_ROW_PADDING_X + LIST_ROW_ICON_SIZE + 12;

function ValueText({
  children,
  mono = false,
  tone = "muted",
  testID,
}: {
  children: string;
  mono?: boolean;
  tone?: "muted" | "foreground" | "destructive";
  testID?: string;
}) {
  return (
    <Text
      variant={mono ? "mono" : "bodyLarge"}
      tone={tone}
      numeric={mono}
      numberOfLines={1}
      className={cn("shrink", mono && "text-xs")}
      testID={testID}
    >
      {children}
    </Text>
  );
}

/** A row's right-hand slot: value(s) plus an optional glyph, capped so the label keeps room. */
function Trailing({ children }: { children: ReactNode }) {
  return (
    <View className="min-w-0 max-w-[65%] flex-row items-center gap-2">
      {children}
    </View>
  );
}

function CopyGlyph() {
  const { tokens } = useTheme();
  return <Icon name="Copy" size={16} color={tokens.subtleForeground} />;
}

// ---------------------------------------------------------------------------
// Rows

function ParentRow({ parentId }: { parentId: string }) {
  const router = useRouter();
  const parentQuery = useThread(parentId);
  const title = parentQuery.data
    ? getThreadDisplayTitle(parentQuery.data)
    : "Parent thread";
  return (
    <GroupedRow
      leading="Fork"
      title="Parent"
      value={title}
      trailing="chevron"
      onPress={() => router.push(threadHref(parentId))}
      testID="panel-info-parent"
    />
  );
}

function ForksSection({ thread }: { thread: ThreadResponse }) {
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
    <GroupedSection
      title="Forks"
      surface="raised"
      separatorInset={GLYPH_ROW_SEPARATOR_INSET}
      testID="panel-info-forks"
    >
      {forks.map((fork) => {
        const title = getThreadDisplayTitle(fork);
        return (
          <GroupedRow
            key={fork.id}
            leading="Fork"
            title={title}
            trailing="chevron"
            onPress={() => router.push(threadHref(fork.id))}
            accessibilityLabel={`Open fork ${title}`}
            testID="panel-info-fork"
          />
        );
      })}
    </GroupedSection>
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
  const hostSuffix = host
    ? ` · ${host.name}${host.status === "connected" ? "" : " (offline)"}`
    : "";
  return (
    <GroupedRow
      leading={environment.isWorktree ? "FolderGit" : "Folder"}
      title="Environment"
      trailing={
        <Trailing>
          <Text
            variant="bodyLarge"
            tone="muted"
            numberOfLines={1}
            className="shrink"
            testID="panel-info-environment-label"
          >
            {display.compactModeLabel}
            {hostSuffix}
          </Text>
          {environment.managed ? (
            <View
              className="rounded-full bg-secondary px-2 py-0.5"
              style={{ borderCurve: "continuous" }}
            >
              <Text variant="chrome" tone="foreground">
                managed
              </Text>
            </View>
          ) : null}
        </Trailing>
      }
      testID="panel-info-environment"
    />
  );
}

function DirectoryRow({ path }: { path: string }) {
  return (
    <GroupedRow
      leading="Folder"
      title="Directory"
      trailing={
        <Trailing>
          <ValueText mono testID="panel-info-directory-path">
            {path}
          </ValueText>
          <CopyGlyph />
        </Trailing>
      }
      onPress={() => copyWithToast(path, "Directory copied")}
      accessibilityLabel="Copy directory"
      testID="panel-info-directory"
    />
  );
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
  const copyValue = display.copyValue;
  return (
    <GroupedRow
      leading="GitBranch"
      title={display.rowLabel}
      trailing={
        <Trailing>
          <ValueText mono testID="panel-info-branch-name">
            {display.label}
          </ValueText>
          {copyValue === null ? null : <CopyGlyph />}
        </Trailing>
      }
      onPress={
        copyValue === null
          ? undefined
          : () => copyWithToast(copyValue, display.copiedMessage)
      }
      accessibilityLabel={`${display.rowLabel}: ${display.label}`}
      testID="panel-info-branch"
    />
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
    <GroupedRow
      leading="GitMerge"
      title="Merge base"
      trailing={
        <Trailing>
          <ValueText mono>{branch}</ValueText>
          {onPress ? <DisclosureChevron /> : null}
        </Trailing>
      }
      onPress={onPress ?? undefined}
      testID="panel-info-merge-base"
    />
  );
}

function GitStatusRow({ label, summary }: { label: string; summary: string }) {
  return (
    <GroupedRow
      leading="FileDiff"
      title="Git status"
      trailing={
        <Trailing>
          <ValueText tone={label === "Dirty" ? "destructive" : "foreground"}>
            {label}
          </ValueText>
          {summary ? <ValueText>{summary}</ValueText> : null}
        </Trailing>
      }
      testID="panel-info-git-status"
    />
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
    <GroupedRow
      leading="GitPullRequestArrow"
      title="Pull request"
      trailing={
        <Trailing>
          <PullRequestStatusPill pullRequest={pullRequest} />
          <ValueText tone="foreground">
            {formatPullRequestRowLabel(pullRequest)}
          </ValueText>
          {attention ? (
            <Text
              variant="footnote"
              numberOfLines={1}
              className="shrink"
              style={{ color: pullRequestToneColor(tokens, attention.tone) }}
            >
              {attention.label}
            </Text>
          ) : null}
          <DisclosureChevron />
        </Trailing>
      }
      onPress={open}
      accessibilityLabel={`Open pull request ${pullRequest.number}`}
      testID="panel-info-pull-request"
    />
  );
}

function ArchivedRow({ thread }: { thread: ThreadResponse }) {
  const unarchive = useUnarchiveThread();
  const pending = unarchive.isPending && unarchive.variables?.id === thread.id;
  return (
    <GroupedRow
      leading="PackageReceive"
      title="Archived"
      trailing={
        <Button
          variant="outline"
          size="sm"
          loading={pending}
          onPress={() => unarchive.mutate({ id: thread.id })}
          testID="panel-info-unarchive"
        >
          Unarchive
        </Button>
      }
      testID="panel-info-archived"
    />
  );
}

function CommitsSection({
  commits,
}: {
  commits: readonly WorkspaceCommitSummary[];
}) {
  if (commits.length === 0) return null;
  return (
    <GroupedSection
      title="Commits"
      surface="raised"
      testID="panel-info-commits"
    >
      {commits.map((commit) => (
        <GroupedRow
          key={commit.sha}
          title={commit.subject}
          trailing={
            <Text variant="mono" tone="subtle" numeric className="text-xs">
              {commit.shortSha}
            </Text>
          }
          onPress={() => copyWithToast(commit.sha, "Commit SHA copied")}
          accessibilityLabel={`Copy commit ${commit.shortSha}`}
          testID="panel-info-commit"
        />
      ))}
    </GroupedSection>
  );
}

function ChangedFilesSection({
  sections,
  onOpenDiff,
}: {
  sections: readonly WorkspaceChangedFilesSection[];
  onOpenDiff: (path: string | null) => void;
}) {
  if (sections.length === 0) return null;
  const onPressFile = (file: WorkspaceFileStatus) => onOpenDiff(file.path);
  return (
    <View className="gap-6" testID="panel-info-changed-files">
      {sections.map((section, index) => (
        <GroupedSection
          key={section.kind}
          title={index === 0 ? "Changed files" : undefined}
          surface="raised"
          separatorInset={GLYPH_ROW_SEPARATOR_INSET}
        >
          <GroupedRow
            leading="FileDiff"
            title={section.label}
            value={formatChangeSummary(toChangeTally(section.stats))}
            trailing="chevron"
            onPress={() => onOpenDiff(null)}
            accessibilityLabel={`Open diff: ${section.label}`}
            testID={`panel-info-changed-files-${section.kind}`}
          />
          <View className="px-3 py-2">
            <WorkspaceChangesList
              files={section.files}
              onPressFile={onPressFile}
              maxRows={5}
            />
          </View>
        </GroupedSection>
      ))}
    </View>
  );
}

function StorageSection({ onPress }: { onPress: () => void }) {
  return (
    <GroupedSection surface="raised">
      <GroupedRow
        leading="FolderOpen"
        title="Thread storage"
        subtitle="Files the thread saved"
        trailing="chevron"
        onPress={onPress}
        accessibilityLabel="Browse thread storage"
        testID="panel-info-storage"
      />
    </GroupedSection>
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
  const mergeBaseBranch =
    workspace.mergeBase.showMergeBase &&
    workspace.mergeBase.effectiveMergeBaseBranch
      ? workspace.mergeBase.effectiveMergeBaseBranch
      : null;

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

  const hasDetails =
    thread.parentThreadId !== null ||
    environment !== undefined ||
    workspaceStatus !== undefined ||
    mergeBaseBranch !== null ||
    showGitStatus ||
    pullRequest !== null ||
    thread.archivedAt !== null;

  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 32,
        gap: 24,
      }}
      keyboardShouldPersistTaps="handled"
      testID="panel-info"
    >
      {/* Rows are conditional here, not inside the row components: the
          section draws a hairline between every rendered child, so a child
          that rendered null would leave a doubled separator. */}
      {hasDetails ? (
        <GroupedSection
          surface="raised"
          separatorInset={GLYPH_ROW_SEPARATOR_INSET}
          testID="panel-info-details"
        >
          {thread.parentThreadId !== null ? (
            <ParentRow parentId={thread.parentThreadId} />
          ) : null}
          {environment ? (
            <EnvironmentRow environment={environment} host={host} />
          ) : null}
          {environment?.path ? <DirectoryRow path={environment.path} /> : null}
          {workspaceStatus ? (
            <BranchRow checkout={workspaceStatus.checkout} />
          ) : null}
          {mergeBaseBranch !== null ? (
            <MergeBaseRow
              branch={mergeBaseBranch}
              onPress={mergeBaseSheet.present}
            />
          ) : null}
          {showGitStatus ? (
            <GitStatusRow label={gitStatus.label} summary={gitStatus.summary} />
          ) : null}
          {pullRequest ? <PullRequestRow pullRequest={pullRequest} /> : null}
          {thread.archivedAt !== null ? <ArchivedRow thread={thread} /> : null}
        </GroupedSection>
      ) : null}
      <ForksSection thread={thread} />
      <CommitsSection commits={commits} />
      <ChangedFilesSection
        sections={changedFileSections}
        onOpenDiff={openDiff}
      />
      <StorageSection onPress={openStorage} />
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
