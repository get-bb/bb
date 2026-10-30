import { useEffect, useMemo, useRef, type ReactNode } from "react";
import {
  experimental_useThreadContextKind,
  type ExperimentalThreadContextSegmentInput,
  type ExperimentalThreadContextSegmentProps,
} from "@get-bb/plugin-sdk/app";
import { BranchPicker } from "@bb/shared-ui/branch-picker";
import { Icon } from "@bb/shared-ui/icon";
import {
  getMergeBaseBranchCandidateGroups,
} from "../merge-base-branch-candidates";
import { BannerActionSlot } from "@bb/shared-ui/prompt-banner-actions";
import {
  AnimatedDisclosureBody,
  SectionToggleButton,
} from "@bb/shared-ui/prompt-stack-disclosure";
import {
  CHANGED_FILES_KIND_PREFIX,
  formatChangeSummary,
  renderChangeSummary,
  selectWorkspaceChangedFilesSection,
  toChangeTally,
  type WorkspaceChangedFilesSection,
} from "@bb/shared-ui/workspace-change-summary";
import { WorkspaceChangesList } from "@bb/shared-ui/workspace-changes-list";
import { useChangedFileActions } from "../changed-files.js";
import { useMergeBase, type MergeBaseState } from "../merge-base.js";
import { useGitStatus, useShowGitChanges } from "../queries.js";
import type { WorkspaceFileStatus, WorkspaceStatus } from "../../contract.js";

const TOGGLE_ID = "thread-prompt-banner-git-toggle";
const BODY_ID = "thread-prompt-banner-git-body";

type FocusTarget = "trigger" | "collapse";

const pendingFocus = new Map<string, FocusTarget>();

type SegmentPart = "summary" | "action" | "details";

function useFocusHandoff(
  threadId: string,
  target: FocusTarget,
  isExpanded: boolean,
) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (pendingFocus.get(threadId) !== target) return;
    pendingFocus.delete(threadId);
    ref.current?.focus();
  }, [isExpanded, target, threadId]);
  return ref;
}

export function useChangedFilesSegmentVisible({
  environment,
}: ExperimentalThreadContextSegmentInput): boolean {
  const show = useShowGitChanges();
  const kind = experimental_useThreadContextKind();
  const environmentId =
    show && kind === "banner" ? (environment?.id ?? null) : null;
  const { workspace } = useGitStatus(environmentId);
  return (
    environmentId !== null &&
    selectWorkspaceChangedFilesSection(workspace) !== null
  );
}

export function MergeBaseActionView({
  mergeBase,
}: {
  mergeBase: MergeBaseState;
}) {
  const branch = mergeBase.effectiveMergeBaseBranch;
  const candidates = useMemo(
    () =>
      getMergeBaseBranchCandidateGroups({
        mergeBaseBranch: branch,
        mergeBaseBranchRef: mergeBase.selectedBranchRef,
        mergeBaseBranchOptions: mergeBase.options,
        remoteMergeBaseBranchOptions: mergeBase.remoteOptions,
      }),
    [
      branch,
      mergeBase.options,
      mergeBase.remoteOptions,
      mergeBase.selectedBranchRef,
    ],
  );
  if (!mergeBase.showMergeBase || !branch) return null;
  return (
    <BannerActionSlot hideInCompact>
      <Icon name="GitMerge" className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="shrink-0">Merge base</span>
      <BranchPicker
        value={branch}
        options={candidates.options}
        remoteOptions={candidates.remoteOptions}
        variant="minimal"
        emphasizeTriggerValue={false}
        loading={mergeBase.optionsLoading}
        onChange={mergeBase.onChange}
        onOpenChange={mergeBase.onPickerOpenChange}
        onSearchQueryChange={mergeBase.onSearchQueryChange}
        className="max-w-[10rem]"
        muted
        popoverAlign="end"
      />
    </BannerActionSlot>
  );
}

function MergeBaseAction({
  environmentId,
  workspace,
}: {
  environmentId: string;
  workspace: WorkspaceStatus;
}) {
  return (
    <MergeBaseActionView mergeBase={useMergeBase(environmentId, workspace)} />
  );
}

export function ChangedFilesSegmentView({
  threadId,
  part,
  segments,
  isExpanded,
  onToggle,
  section,
  action,
  onFileClick,
}: Pick<
  ExperimentalThreadContextSegmentProps,
  "threadId" | "segments" | "isExpanded" | "onToggle"
> & {
  part: SegmentPart;
  section: WorkspaceChangedFilesSection<WorkspaceFileStatus>;
  action: ReactNode;
  onFileClick: (file: WorkspaceFileStatus) => void;
}) {
  const focusTarget = part === "summary" ? "trigger" : "collapse";
  const focusRef = useFocusHandoff(threadId, focusTarget, isExpanded);
  if (part === "summary") {
    const tally = toChangeTally(section.stats);
    const prefix = CHANGED_FILES_KIND_PREFIX[section.kind];
    return (
      <SectionToggleButton
        buttonRef={focusRef}
        fillRow
        id={TOGGLE_ID}
        controlsId={BODY_ID}
        icon={
          <Icon
            name="FileDiff"
            className="size-3.5 shrink-0"
            aria-hidden="true"
          />
        }
        label={
          <>
            {prefix} · {renderChangeSummary(tally)}
          </>
        }
        compactLabel={renderChangeSummary(tally)}
        hideLabelInCompact={segments.length > 2}
        ariaLabel={`Changed files: ${prefix}, ${formatChangeSummary(tally)}`}
        isExpanded={isExpanded}
        onToggle={() => {
          if (!isExpanded) pendingFocus.set(threadId, "collapse");
          onToggle();
        }}
      />
    );
  }
  if (part === "action") return segments.length === 1 ? action : null;
  return (
    <AnimatedDisclosureBody
      collapsedBorder="reserve"
      id={BODY_ID}
      labelledBy={TOGGLE_ID}
      isExpanded={isExpanded}
      collapseLabel="Collapse changed files"
      collapseRef={focusRef}
      onCollapse={() => {
        pendingFocus.set(threadId, "trigger");
        onToggle();
      }}
    >
      <WorkspaceChangesList
        files={section.files}
        fileCount={section.stats.fileCount}
        className="max-h-32 px-3 pb-2 pt-1"
        onFileClick={onFileClick}
      />
    </AnimatedDisclosureBody>
  );
}

function SegmentContent({
  environmentId,
  ...props
}: ExperimentalThreadContextSegmentProps & {
  environmentId: string;
  part: SegmentPart;
}) {
  const { workspace } = useGitStatus(environmentId);
  const actions = useChangedFileActions(environmentId);
  const section = selectWorkspaceChangedFilesSection(workspace);
  if (workspace === undefined || section === null) return null;
  return (
    <ChangedFilesSegmentView
      {...props}
      section={section}
      action={
        props.part === "action" ? (
          <MergeBaseAction environmentId={environmentId} workspace={workspace} />
        ) : null
      }
      onFileClick={(file) => actions.onChangedFileClick({ file, section })}
    />
  );
}

export function changedFilesSegmentPart(part: SegmentPart) {
  return function ChangedFilesSegmentPart(
    props: ExperimentalThreadContextSegmentProps,
  ) {
    return props.environment === null ? null : (
      <SegmentContent
        {...props}
        part={part}
        environmentId={props.environment.id}
      />
    );
  };
}
