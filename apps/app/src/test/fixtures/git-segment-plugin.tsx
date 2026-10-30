import { createContext, useContext, useEffect, type ReactNode } from "react";
import type { ExperimentalThreadContextSegmentProps } from "@get-bb/plugin-sdk";
import { experimental_THREAD_CONTEXT_SEGMENT_GROUPS } from "@get-bb/plugin-sdk/app";
import type {
  WorkspaceChangedFilesSection,
} from "@bb/shared-ui/workspace-change-summary";
import {
  removePluginSlotRegistrations,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import {
  ChangedFilesSegmentView,
  MergeBaseActionView,
} from "../../../../../plugins/git/ui/segment/ChangedFilesSegment";
import type { MergeBaseState } from "../../../../../plugins/git/ui/merge-base";
import type { WorkspaceFileStatus } from "bb-plugin-bb--git/contract";

const noop = () => {};

export const GIT_SEGMENT_FIXTURE_PLUGIN_ID = "bb--git";

export type GitSegmentFixture =
  | {
      section: WorkspaceChangedFilesSection<WorkspaceFileStatus>;
      mergeBase: MergeBaseState | null;
      onFileClick?: () => void;
    };

export function gitSegmentFixtureMergeBase(
  overrides: Partial<MergeBaseState> = {},
): MergeBaseState {
  return {
    effectiveMergeBaseBranch: "main",
    showMergeBase: true,
    showBranchComparison: true,
    selectedBranchRef: null,
    options: ["main", "develop", "release/2026-05"],
    remoteOptions: [],
    optionsLoading: false,
    optionsLoaded: true,
    onChange: noop,
    onPickerOpenChange: noop,
    onSearchQueryChange: noop,
    ...overrides,
  };
}

const GitSegmentFixtureContext = createContext<GitSegmentFixture | null>(null);

function fixtureChangedFilesPart(part: "summary" | "action" | "details") {
  return function FixtureChangedFilesPart(
    props: ExperimentalThreadContextSegmentProps,
  ) {
    const git = useContext(GitSegmentFixtureContext);
    if (git === null) return null;
    return (
      <ChangedFilesSegmentView
        {...props}
        part={part}
        section={git.section}
        action={
          git.mergeBase ? (
            <MergeBaseActionView mergeBase={git.mergeBase} />
          ) : null
        }
        onFileClick={git.onFileClick ?? noop}
      />
    );
  };
}

function useFixtureVisible() {
  const git = useContext(GitSegmentFixtureContext);
  return git !== null;
}

export function registerGitSegmentFixture(): void {
  setPluginSlotRegistrations(
    GIT_SEGMENT_FIXTURE_PLUGIN_ID,
    makePluginRegistrationSet({
      threadContextSegments: [
        {
          id: "changed-files",
          title: "Changed files",
          group: experimental_THREAD_CONTEXT_SEGMENT_GROUPS.git,
          order: 10,
          summary: fixtureChangedFilesPart("summary"),
          action: fixtureChangedFilesPart("action"),
          details: fixtureChangedFilesPart("details"),
          useVisible: useFixtureVisible,
        },
      ],
    }),
  );
}

export function GitSegmentFixtureProvider({
  value,
  children,
}: {
  value: GitSegmentFixture | null;
  children: ReactNode;
}) {
  useEffect(() => {
    registerGitSegmentFixture();
    return () => removePluginSlotRegistrations(GIT_SEGMENT_FIXTURE_PLUGIN_ID);
  }, []);
  return (
    <GitSegmentFixtureContext.Provider value={value}>
      {children}
    </GitSegmentFixtureContext.Provider>
  );
}
