import { openChangedFile } from "./open-changed-file.js";
import {
  BranchPicker,
  getMergeBaseBranchCandidateGroups,
} from "@bb/shared-ui/branch-picker";
import { BannerActionSlot } from "@bb/shared-ui/prompt-banner-actions";
import { useMergeBase } from "./merge-base.js";
import { useEffect, useState } from "react";
import {
  experimental_useAppPanel,
  useBbNavigate,
} from "@get-bb/plugin-sdk/app";
import type { ExperimentalThreadContextSegmentProps } from "@get-bb/plugin-sdk";
import { Icon } from "@bb/shared-ui/icon";
import { PromptStackSectionToggleButton } from "@bb/shared-ui/prompt-stack-section-toggle";
import { AnimatedDisclosureBody } from "@bb/shared-ui/prompt-stack-body";
import {
  createDisclosureFocusRefs,
  useDisclosureFocusHandoff,
} from "@bb/shared-ui/prompt-stack-disclosure";
import { useThreadGitStatus } from "./read-hooks.js";
import {
  selectWorkspaceChangedFilesSection,
  toChangeTally,
  renderChangeSummary,
  formatChangeSummary,
} from "./workspace-change-summary.js";
import { WorkspaceChangesList } from "./WorkspaceChangesList.js";

const focuses = new Map<
  string,
  { refs: ReturnType<typeof createDisclosureFocusRefs>; mounts: number }
>();
function useSegmentFocus(id: string, expanded: boolean, toggle: () => void) {
  const [scope] = useState(() => {
    let scope = focuses.get(id);
    if (!scope) {
      scope = { refs: createDisclosureFocusRefs(), mounts: 0 };
      focuses.set(id, scope);
    }
    return scope;
  });
  useEffect(() => {
    scope.mounts += 1;
    focuses.set(id, scope);
    return () => {
      scope.mounts -= 1;
      if (scope.mounts === 0 && focuses.get(id) === scope) focuses.delete(id);
    };
  }, [id, scope]);
  return useDisclosureFocusHandoff(expanded, toggle, scope.refs);
}
export function useComposerGitVisible({ threadId }: { threadId: string }) {
  const data = useThreadGitStatus(threadId);
  return (
    data.visible &&
    data.context.data?.archivedAt == null &&
    selectWorkspaceChangedFilesSection(data.workspace) !== null
  );
}
export function ComposerGitSegment(
  props: ExperimentalThreadContextSegmentProps,
) {
  const data = useThreadGitStatus(props.threadId);
  const panel = experimental_useAppPanel();
  const navigate = useBbNavigate();
  const section = selectWorkspaceChangedFilesSection(data.workspace);
  const mergeBase = useMergeBase(data.environment, data.workspace);
  return (
    <ComposerGitPresentation
      {...props}
      section={section}
      mergeBase={
        mergeBase.selectedMergeBaseBranch
          ? {
              branch: mergeBase.selectedMergeBaseBranch,
              branchRef: mergeBase.mergeBaseBranchRef,
              options: mergeBase.mergeBaseBranchOptions,
              remoteOptions: mergeBase.mergeBaseRemoteBranchOptions,
              optionsLoading: mergeBase.isLoadingMergeBaseBranchOptions,
              onChange: mergeBase.onMergeBaseBranchChange,
              onPickerOpenChange: mergeBase.onMergeBasePickerOpenChange,
              onSearchQueryChange: mergeBase.onMergeBaseBranchSearchQueryChange,
            }
          : null
      }
      onFileClick={(file) => {
        if (section && data.environment)
          openChangedFile(
            { file, section },
            data.environment.id,
            navigate,
            panel,
          );
      }}
    />
  );
}

export interface ComposerGitPresentationProps extends ExperimentalThreadContextSegmentProps {
  section: ReturnType<typeof selectWorkspaceChangedFilesSection>;
  mergeBase: {
    branch: string;
    branchRef?: import("@bb/domain").GitBranchRefClassification | null;
    options?: readonly string[];
    remoteOptions?: readonly string[];
    optionsLoading?: boolean;
    onChange: (branch: string) => void;
    onPickerOpenChange?: (open: boolean) => void;
    onSearchQueryChange?: (query: string) => void;
  } | null;
  onFileClick: (file: import("bb-git-contract").WorkspaceFileStatus) => void;
}
export function ComposerGitPresentation(props: ComposerGitPresentationProps) {
  const focus = useSegmentFocus(
    props.experimental_instanceId,
    props.isExpanded,
    props.onToggle,
  );
  const section = props.section;
  if (!section) return null;
  const tally = toChangeTally(section.stats);
  const prefix =
    section.kind === "committed"
      ? "Committed"
      : section.kind === "untracked"
        ? "Untracked"
        : "Uncommitted";
  const toggleId = `${props.experimental_instanceId}-toggle`;
  const bodyId = `${props.experimental_instanceId}-body`;
  const candidates = getMergeBaseBranchCandidateGroups({
    mergeBaseBranch: props.mergeBase?.branch,
    mergeBaseBranchRef: props.mergeBase?.branchRef,
    mergeBaseBranchOptions: props.mergeBase?.options,
    remoteMergeBaseBranchOptions: props.mergeBase?.remoteOptions,
  });
  if (props.part === "summary")
    return (
      <>
        <PromptStackSectionToggleButton
          buttonRef={focus.triggerRef}
          fillRow
          id={toggleId}
          controlsId={bodyId}
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
          hideLabelInCompact={props.segmentCount > 2}
          ariaLabel={`Changed files: ${prefix}, ${formatChangeSummary(tally)}`}
          isExpanded={props.isExpanded}
          onToggle={focus.onTriggerClick}
        />
        {props.segmentCount === 1 && props.mergeBase ? (
          <BannerActionSlot hideInCompact>
            <Icon
              name="GitMerge"
              className="size-3.5 shrink-0"
              aria-hidden="true"
            />
            <span className="shrink-0">Merge base</span>
            <BranchPicker
              value={props.mergeBase.branch}
              options={candidates.options}
              remoteOptions={candidates.remoteOptions}
              variant="minimal"
              emphasizeTriggerValue={false}
              loading={props.mergeBase.optionsLoading}
              onChange={props.mergeBase.onChange}
              onOpenChange={props.mergeBase.onPickerOpenChange}
              onSearchQueryChange={props.mergeBase.onSearchQueryChange}
              className="max-w-[10rem]"
              muted
              popoverAlign="end"
            />
          </BannerActionSlot>
        ) : null}
      </>
    );
  return (
    <AnimatedDisclosureBody
      collapsedBorder="reserve"
      id={bodyId}
      labelledBy={toggleId}
      isExpanded={props.isExpanded}
      collapseLabel="Collapse changed files"
      collapseRef={focus.collapseRef}
      onCollapse={focus.onCollapseClick}
    >
      <WorkspaceChangesList
        files={section.files}
        fileCount={section.stats.fileCount}
        className="max-h-32 px-3 pb-2 pt-1"
        onFileClick={props.onFileClick}
      />
    </AnimatedDisclosureBody>
  );
}
