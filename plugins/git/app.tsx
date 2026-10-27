import {
  definePluginApp,
  experimental_THREAD_CONTEXT_SEGMENT_GROUPS,
  experimental_THREAD_INFO_ROW_GROUPS,
  experimental_THREAD_INFO_SECTION_GROUPS,
} from "@get-bb/plugin-sdk/app";
import { GIT_DIFF_TAB_ID } from "./contract.js";
import { DiffTab, useDiffTabVisible } from "./ui/diff/DiffTab.js";
import { gitDiffTabTarget } from "./ui/diff-tab-target.js";
import {
  BranchInfoRow,
  GitStatusInfoRow,
  MergeBaseInfoRow,
} from "./ui/info/GitInfoRows.js";
import { CommitsInfoSection } from "./ui/info/CommitsInfoSection.js";
import { UncommittedChangesInfoSection } from "./ui/info/UncommittedChangesInfoSection.js";
import {
  changedFilesSegmentPart,
  useChangedFilesSegmentVisible,
} from "./ui/segment/ChangedFilesSegment.js";
import { commitThreadAction } from "./ui/commit/commit-action.js";
import { CommitDialogOverlay } from "./ui/commit/CommitDialog.js";

const TOGGLE_DIFF_COMMAND_ID = "toggle-diff";

export default definePluginApp((app) => {
  app.commands.register({
    id: TOGGLE_DIFF_COMMAND_ID,
    title: "Toggle diff",
    defaultShortcut: { key: "d", mod: true },
    isAvailable: (context) => context.threadId !== null,
    run(context) {
      context.experimental_panel.toggleTab({
        tab: {
          id: GIT_DIFF_TAB_ID,
          context: { kind: "thread" },
          availability: "fixed",
        },
      });
    },
  });
  app.slots.experimental_tab({
    context: { kind: "thread" },
    availability: "fixed",
    id: GIT_DIFF_TAB_ID,
    title: "Diff",
    icon: "FileDiff",
    layout: "flush",
    component: DiffTab,
    useVisible: useDiffTabVisible,
    experimental_target: gitDiffTabTarget,
  });
  app.slots.experimental_threadInfoRow({
    id: "branch",
    group: experimental_THREAD_INFO_ROW_GROUPS.git,
    order: 10,
    component: BranchInfoRow,
  });
  app.slots.experimental_threadInfoRow({
    id: "merge-base",
    group: experimental_THREAD_INFO_ROW_GROUPS.git,
    order: 20,
    component: MergeBaseInfoRow,
  });
  app.slots.experimental_threadInfoRow({
    id: "git-status",
    group: experimental_THREAD_INFO_ROW_GROUPS.git,
    order: 30,
    component: GitStatusInfoRow,
  });
  app.slots.experimental_threadInfoSection({
    id: "commits",
    group: experimental_THREAD_INFO_SECTION_GROUPS.changes,
    order: 10,
    component: CommitsInfoSection,
  });
  app.slots.experimental_threadInfoSection({
    id: "uncommitted-changes",
    group: experimental_THREAD_INFO_SECTION_GROUPS.changes,
    order: 20,
    component: UncommittedChangesInfoSection,
  });
  app.slots.experimental_threadContextSegment({
    id: "changed-files",
    title: "Changed files",
    group: experimental_THREAD_CONTEXT_SEGMENT_GROUPS.git,
    order: 10,
    summary: changedFilesSegmentPart("summary"),
    action: changedFilesSegmentPart("action"),
    details: changedFilesSegmentPart("details"),
    useVisible: useChangedFilesSegmentVisible,
  });
  app.slots.experimental_threadAction(commitThreadAction);
  app.slots.experimental_appOverlay({
    id: "commit-dialog",
    component: CommitDialogOverlay,
  });
});
