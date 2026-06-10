import { useState } from "react";
import type { PermissionMode, PromptTextMention } from "@bb/domain";
import {
  NewThreadPromptBoxUI,
  type NewThreadBranchConfig,
  type NewThreadEnvironmentConfig,
  type NewThreadModeConfig,
  type NewThreadProjectConfig,
  type NewThreadWorktreeConfig,
} from "@/components/promptbox/NewThreadPromptBox";
import type { HistoryConfig } from "@/components/promptbox/PromptBoxInternal";
import type { PickerOption } from "@/components/pickers/OptionPicker";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import {
  HOST_IDS,
  PROJECT_IDS,
  STORY_BRANCH_OPTIONS,
  STORY_PROJECTS,
  STORY_PROJECT_SOURCES,
  STORY_WORKTREE_OPTIONS,
  makeAttachmentsConfig as makeAttachments,
  makeExecutionControlsProps,
  makeHost,
  makeMentionsConfig as makeMentions,
} from "../../../.ladle/story-fixtures";

export default {
  title: "promptbox/New Thread Prompt Box",
};

const noop = () => {};

const baseExecution = makeExecutionControlsProps();

const baseEnvironment: NewThreadEnvironmentConfig = {
  value: `host:${HOST_IDS.local}:local`,
  onChange: noop,
  sources: STORY_PROJECT_SOURCES,
  host: makeHost({ id: HOST_IDS.local }),
  isLocal: true,
};

const baseBranch: NewThreadBranchConfig = {
  value: null,
  currentBranch: "main",
  isNew: false,
  options: STORY_BRANCH_OPTIONS,
  loading: false,
  currentOptionLabel: "Current: main",
  placeholder: "Current checkout",
  triggerLabel: "Current (main)",
  triggerTitle: "Current: main",
  onChange: noop,
  onClear: noop,
  onCreate: noop,
};

const baseWorktree: NewThreadWorktreeConfig = {
  options: STORY_WORKTREE_OPTIONS,
  value: null,
  onChange: noop,
};

const baseProject: NewThreadProjectConfig = {
  projects: STORY_PROJECTS,
  value: PROJECT_IDS.bb,
  onChange: noop,
};

const permissionModeOptions: readonly PickerOption<PermissionMode>[] = [
  { value: "full", label: "Full Access", tone: "warning" },
  { value: "workspace-write", label: "Workspace Write" },
  { value: "readonly", label: "Readonly" },
];

const basePermission = {
  value: "workspace-write" as PermissionMode,
  options: permissionModeOptions,
  onChange: noop,
  supported: true,
};

const baseHistory: HistoryConfig = {
  currentDraft: { text: "", mentions: [], attachments: [] },
  entries: [
    { text: "review thread workspace", mentions: [], attachments: [] },
    { text: "investigate timeline pagination", mentions: [], attachments: [] },
  ],
  onSelectEntry: noop,
};

function useControlledValue(initial: string) {
  const [value, setValue] = useState(initial);
  const [mentionRanges, setMentionRanges] = useState<PromptTextMention[]>([]);
  const onChange = (nextValue: string, nextMentions: PromptTextMention[]) => {
    setValue(nextValue);
    setMentionRanges(nextMentions);
  };
  return { value, mentionRanges, onChange };
}

const baseModeConfig: NewThreadModeConfig = {
  environment: baseEnvironment,
  branch: baseBranch,
  worktree: baseWorktree,
  permission: basePermission,
};

// Match production: RootComposeView wraps the prompt area in PageShell which
// caps content at 760px. Without this constraint the env-permission strip's
// justify-between drifts the permission picker far to the right.
interface PromptStageProps {
  children: React.ReactNode;
}

function PromptStage({ children }: PromptStageProps) {
  return <div className="mx-auto w-full max-w-[760px]">{children}</div>;
}

function DefaultRow() {
  const { value, mentionRanges, onChange } = useControlledValue("");
  return (
    <PromptStage>
      <NewThreadPromptBoxUI
        id="story-new-thread-default"
        value={value}
        mentionRanges={mentionRanges}
        onChange={onChange}
        onSubmit={noop}
        isSubmitting={false}
        disabled={false}
        zenModeStorageKey="bb.story.new-thread.default"
        history={baseHistory}
        mentions={makeMentions()}
        attachments={makeAttachments()}
        modeConfig={baseModeConfig}
        project={baseProject}
        execution={baseExecution}
      />
    </PromptStage>
  );
}

function SubmittingRow() {
  const { value, mentionRanges, onChange } = useControlledValue(
    "Investigate the timeline pagination flicker.",
  );
  return (
    <PromptStage>
      <NewThreadPromptBoxUI
        id="story-new-thread-submitting"
        value={value}
        mentionRanges={mentionRanges}
        onChange={onChange}
        onSubmit={noop}
        isSubmitting
        disabled
        zenModeStorageKey="bb.story.new-thread.submitting"
        history={baseHistory}
        mentions={makeMentions()}
        attachments={makeAttachments()}
        modeConfig={baseModeConfig}
        project={baseProject}
        execution={baseExecution}
      />
    </PromptStage>
  );
}

function ClaudeProviderRow() {
  const { value, mentionRanges, onChange } = useControlledValue("");
  return (
    <PromptStage>
      <NewThreadPromptBoxUI
        id="story-new-thread-claude"
        value={value}
        mentionRanges={mentionRanges}
        onChange={onChange}
        onSubmit={noop}
        isSubmitting={false}
        disabled={false}
        zenModeStorageKey="bb.story.new-thread.claude"
        history={baseHistory}
        mentions={makeMentions()}
        attachments={makeAttachments()}
        modeConfig={baseModeConfig}
        project={baseProject}
        execution={{
          ...baseExecution,
          provider: { ...baseExecution.provider, selectedId: "claude-code" },
          model: {
            active: { model: "claude-sonnet-4-6" },
            selected: "claude-sonnet-4-6",
            options: [
              { value: "claude-opus-4-7", label: "Claude Opus 4.7" },
              { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
              { value: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
            ],
            onChange: noop,
          },
          serviceTier: { ...baseExecution.serviceTier!, supported: false },
        }}
      />
    </PromptStage>
  );
}

function FullAccessRow() {
  const { value, mentionRanges, onChange } = useControlledValue("");
  return (
    <PromptStage>
      <NewThreadPromptBoxUI
        id="story-new-thread-full-access"
        value={value}
        mentionRanges={mentionRanges}
        onChange={onChange}
        onSubmit={noop}
        isSubmitting={false}
        disabled={false}
        zenModeStorageKey="bb.story.new-thread.full-access"
        history={baseHistory}
        mentions={makeMentions()}
        attachments={makeAttachments()}
        modeConfig={{
          ...baseModeConfig,
          permission: { ...basePermission, value: "full" },
        }}
        project={baseProject}
        execution={baseExecution}
      />
    </PromptStage>
  );
}

function ProjectlessThreadRow() {
  const { value, mentionRanges, onChange } = useControlledValue("");
  return (
    <PromptStage>
      <NewThreadPromptBoxUI
        id="story-new-thread-projectless"
        value={value}
        mentionRanges={mentionRanges}
        onChange={onChange}
        onSubmit={noop}
        isSubmitting={false}
        disabled={false}
        zenModeStorageKey="bb.story.new-thread.projectless"
        history={baseHistory}
        mentions={makeMentions()}
        attachments={makeAttachments()}
        modeConfig={baseModeConfig}
        project={{
          ...baseProject,
          value: null,
          allowNoProject: true,
        }}
        execution={baseExecution}
      />
    </PromptStage>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="default"
        hint="codex + workspace-write + local-direct env"
      >
        <DefaultRow />
      </StoryRow>
      <StoryRow label="submitting" hint="create-thread mutation in flight">
        <SubmittingRow />
      </StoryRow>
      <StoryRow label="claude-code provider" hint="no fast mode toggle">
        <ClaudeProviderRow />
      </StoryRow>
      <StoryRow label="full access" hint='permission tone="warning"'>
        <FullAccessRow />
      </StoryRow>
      <StoryRow
        label="projectless"
        hint="host picker replaces environment picker"
      >
        <ProjectlessThreadRow />
      </StoryRow>
    </StoryCard>
  );
}
