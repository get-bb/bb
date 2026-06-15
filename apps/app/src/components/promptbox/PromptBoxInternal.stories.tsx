import { useState } from "react";
import type { PromptMentionResource, PromptTextMention } from "@bb/domain";
import type { UploadedPromptAttachment } from "@bb/server-contract";
import { ExecutionControls } from "@/components/promptbox/ExecutionControls";
import type {
  PromptMentionSuggestion,
  ProviderCommandSuggestion,
} from "@/components/promptbox/mentions/types";
import {
  PromptBoxInternal,
  type HistoryConfig,
  type PromptBoxSubmissionConfig,
  type PromptVoiceConfig,
} from "@/components/promptbox/PromptBoxInternal";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import {
  makeAttachmentsConfig as makeAttachments,
  makeExecutionControlsProps,
  makeTypeaheadConfig as makeTypeahead,
} from "../../../.ladle/story-fixtures";

export default {
  title: "promptbox/Prompt Box Internal",
};

const noop = () => {};

const mockExecution = makeExecutionControlsProps();

// ---------------------------------------------------------------------------
// Voice fixtures — story-only PromptVoiceConfig values for the recording UX.
// ---------------------------------------------------------------------------

const idleVoice: PromptVoiceConfig = {
  state: "idle",
  isSupported: true,
  start: noop,
  stop: noop,
  cancel: noop,
};

const recordingVoice: PromptVoiceConfig = {
  ...idleVoice,
  state: "recording",
};

const transcribingVoice: PromptVoiceConfig = {
  ...idleVoice,
  state: "transcribing",
};

// ---------------------------------------------------------------------------
// Mock attachments
// ---------------------------------------------------------------------------

const mockAttachments: UploadedPromptAttachment[] = [
  {
    type: "localImage",
    path: "https://placecats.com/300/200",
    name: "screenshot.png",
    mimeType: "image/png",
    sizeBytes: 124_000,
  },
  {
    type: "localImage",
    path: "https://placecats.com/320/180",
    name: "design-mock.png",
    mimeType: "image/png",
    sizeBytes: 96_000,
  },
  {
    type: "localFile",
    path: "/uploads/diff.patch",
    name: "diff.patch",
    mimeType: "text/x-patch",
    sizeBytes: 8_400,
  },
];

// ---------------------------------------------------------------------------
// History fixture (Up/Down recall)
// ---------------------------------------------------------------------------

const historyEntries = [
  { text: "fix the timeline pagination bug", mentions: [], attachments: [] },
  { text: "review thread workspace", mentions: [], attachments: [] },
];

const baseHistory: HistoryConfig = {
  currentDraft: { text: "", mentions: [], attachments: [] },
  entries: historyEntries,
  onSelectEntry: noop,
};

// ---------------------------------------------------------------------------
// Live @-mention corpus. The WithLiveMentions row holds the active query in
// state (fed by `onQueryChange`) and filters this corpus back into the
// `suggestions` prop — mirroring production's usePromptMentions: threads
// first, then paths, capped at PROMPT_MENTION_LIMIT.
// ---------------------------------------------------------------------------

const PROMPT_MENTION_LIMIT = 8;

function workspaceFile(path: string): PromptMentionSuggestion {
  return {
    kind: "path",
    source: "workspace",
    entryKind: "file",
    path,
    name: path.split("/").at(-1) ?? path,
    replacement: path,
  };
}

function workspaceFolder(path: string): PromptMentionSuggestion {
  return {
    kind: "path",
    source: "workspace",
    entryKind: "directory",
    path,
    name: path.split("/").at(-1) ?? path,
    replacement: `${path}/`,
  };
}

function storageFile(path: string): PromptMentionSuggestion {
  return {
    kind: "path",
    source: "thread-storage",
    entryKind: "file",
    path,
    name: path.split("/").at(-1) ?? path,
    replacement: `thread-storage:${path}`,
  };
}

const liveMentionThreads: PromptMentionSuggestion[] = [
  {
    kind: "thread",
    path: "thread:thr_qfk8ksbxkk",
    replacement: "thread:thr_qfk8ksbxkk",
    projectId: "proj_promptbox",
    threadId: "thr_qfk8ksbxkk",
    title: "Wire up promptbox stories",
  },
  {
    kind: "thread",
    path: "thread:thr_mgr_kj4n2x",
    replacement: "thread:thr_mgr_kj4n2x",
    projectId: "proj_promptbox",
    threadId: "thr_mgr_kj4n2x",
    title: "Parent: app/timeline cleanup sprint",
  },
  {
    kind: "thread",
    path: "thread:thr_4hge9xn14m",
    replacement: "thread:thr_4hge9xn14m",
    projectId: "proj_promptbox",
    threadId: "thr_4hge9xn14m",
    title: "Review flow cleanup",
  },
];

const liveMentionPaths: PromptMentionSuggestion[] = [
  workspaceFile("apps/app/src/components/promptbox/PromptBoxInternal.tsx"),
  workspaceFile("apps/app/src/components/promptbox/FollowUpPromptBox.tsx"),
  workspaceFile("apps/app/src/components/promptbox/NewThreadPromptBox.tsx"),
  workspaceFile("apps/app/src/hooks/usePromptMentions.ts"),
  workspaceFolder("apps/app/src/components/promptbox/mentions"),
  storageFile("notes/status.md"),
];

const liveCommandSuggestions: ProviderCommandSuggestion[] = [
  {
    kind: "command",
    name: "moss-hardening-review",
    source: "skill",
    origin: "user",
    description: "Run a hardening review for Moss persistence paths",
    argumentHint: "[branch | staged] [base=<ref>]",
  },
  {
    kind: "command",
    name: "github:gh-fix-ci",
    source: "skill",
    origin: "user",
    description: "Debug failing GitHub Actions checks",
    argumentHint: null,
  },
  {
    kind: "command",
    name: "browser:control-in-app-browser",
    source: "skill",
    origin: "user",
    description: "Open and inspect local web targets",
    argumentHint: null,
  },
  {
    kind: "command",
    name: "frontend:component",
    source: "command",
    origin: "project",
    description: "Create or update a project component",
    argumentHint: "$ARGUMENTS",
  },
  {
    kind: "command",
    name: "review",
    source: "command",
    origin: "user",
    description: "Review local changes",
    argumentHint: "[target]",
  },
];

function suggestionHaystack(suggestion: PromptMentionSuggestion): string {
  return suggestion.kind === "thread"
    ? `${suggestion.title ?? ""} ${suggestion.threadId}`.toLowerCase()
    : `${suggestion.path} ${suggestion.name}`.toLowerCase();
}

function filterLiveMentions(query: string): PromptMentionSuggestion[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [];
  const matches = (suggestion: PromptMentionSuggestion) =>
    suggestionHaystack(suggestion).includes(needle);
  return [
    ...liveMentionThreads.filter(matches),
    ...liveMentionPaths.filter(matches),
  ].slice(0, PROMPT_MENTION_LIMIT);
}

function commandHaystack(suggestion: ProviderCommandSuggestion): string {
  return [
    suggestion.name,
    suggestion.description ?? "",
    suggestion.argumentHint ?? "",
  ]
    .join(" ")
    .toLowerCase();
}

function filterLiveCommands(query: string): ProviderCommandSuggestion[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return liveCommandSuggestions;
  return liveCommandSuggestions.filter((suggestion) =>
    commandHaystack(suggestion).includes(needle),
  );
}

// ---------------------------------------------------------------------------
// Per-row controlled value + helpers
// ---------------------------------------------------------------------------

interface StoryMentionArgs {
  resource: PromptMentionResource;
  text: string;
  token: string;
}

function storyMention({
  resource,
  text,
  token,
}: StoryMentionArgs): PromptTextMention {
  const start = text.indexOf(token);
  if (start < 0) {
    throw new Error(`Missing story mention token: ${token}`);
  }
  return {
    start,
    end: start + token.length,
    resource,
  };
}

function useControlledValue(
  initial: string,
  initialMentions: PromptTextMention[] = [],
) {
  const [value, setValue] = useState(initial);
  const [mentionRanges, setMentionRanges] = useState(initialMentions);
  const onChange = (nextValue: string, nextMentions: PromptTextMention[]) => {
    setValue(nextValue);
    setMentionRanges(nextMentions);
  };
  return { value, mentionRanges, onChange };
}

function makeSubmission(
  overrides?: Partial<PromptBoxSubmissionConfig>,
): PromptBoxSubmissionConfig {
  return {
    isSubmitting: false,
    disabled: false,
    title: "Submit (Enter)",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Story rows. Each row is its own controlled instance.
// ---------------------------------------------------------------------------

function DefaultRow() {
  const { value, mentionRanges, onChange } = useControlledValue("");
  return (
    <PromptBoxInternal
      value={value}
      mentionRanges={mentionRanges}
      onChange={onChange}
      onSubmit={noop}
      typeahead={makeTypeahead()}
      mentionMenuPlacement="bottom"
      attachments={makeAttachments()}
      history={baseHistory}
      submission={makeSubmission()}
      voice={idleVoice}
      footerStart={<ExecutionControls {...mockExecution} />}
    />
  );
}

function WithAttachmentsRow() {
  const { value, mentionRanges, onChange } = useControlledValue(
    "Take a look at this screenshot and the diff.",
  );
  return (
    <PromptBoxInternal
      value={value}
      mentionRanges={mentionRanges}
      onChange={onChange}
      onSubmit={noop}
      typeahead={makeTypeahead()}
      mentionMenuPlacement="bottom"
      attachments={makeAttachments({ items: mockAttachments })}
      history={baseHistory}
      submission={makeSubmission()}
      voice={idleVoice}
      footerStart={<ExecutionControls {...mockExecution} />}
    />
  );
}

function WithMentionsRow() {
  const initialValue =
    "Ask @thread:thr_parent to inspect @apps/app/src/components/promptbox/PromptBoxInternal.tsx.";
  const { value, mentionRanges, onChange } = useControlledValue(initialValue, [
    storyMention({
      text: initialValue,
      token: "@thread:thr_parent",
      resource: {
        kind: "thread",
        threadId: "thr_parent",
        label: "Prompt UX thread",
      },
    }),
    storyMention({
      text: initialValue,
      token: "@apps/app/src/components/promptbox/PromptBoxInternal.tsx",
      resource: {
        kind: "path",
        source: "workspace",
        entryKind: "file",
        path: "apps/app/src/components/promptbox/PromptBoxInternal.tsx",
        label: "PromptBoxInternal.tsx",
      },
    }),
  ]);
  return (
    <PromptBoxInternal
      value={value}
      mentionRanges={mentionRanges}
      onChange={onChange}
      onSubmit={noop}
      typeahead={makeTypeahead()}
      mentionMenuPlacement="bottom"
      attachments={makeAttachments()}
      history={baseHistory}
      submission={makeSubmission()}
      voice={idleVoice}
      footerStart={<ExecutionControls {...mockExecution} />}
    />
  );
}

function WithSkillPillRow() {
  const argumentHint = "[branch | staged] [base=<ref>]";
  const initialValue = "$moss-hardening-review";
  const { value, mentionRanges, onChange } = useControlledValue(initialValue, [
    storyMention({
      text: initialValue,
      token: "$moss-hardening-review",
      resource: {
        kind: "command",
        trigger: "$",
        name: "moss-hardening-review",
        source: "skill",
        origin: "user",
        label: "moss-hardening-review",
        argumentHint,
      },
    }),
  ]);
  return (
    <PromptBoxInternal
      value={value}
      mentionRanges={mentionRanges}
      onChange={onChange}
      onSubmit={noop}
      typeahead={makeTypeahead()}
      mentionMenuPlacement="bottom"
      attachments={makeAttachments()}
      history={baseHistory}
      submission={makeSubmission()}
      voice={idleVoice}
      footerStart={<ExecutionControls {...mockExecution} />}
    />
  );
}

function WithLiveSkillsRow() {
  const { value, mentionRanges, onChange } = useControlledValue("");
  const [query, setQuery] = useState<string | null>(null);
  const suggestions =
    query === null ? [] : filterLiveCommands(query).slice(0, 4);
  return (
    <PromptBoxInternal
      value={value}
      mentionRanges={mentionRanges}
      onChange={onChange}
      onSubmit={noop}
      placeholder="Type $ to insert a skill or command"
      typeahead={makeTypeahead(
        {},
        {
          trigger: "$",
          suggestions,
          isLoading: false,
          isError: false,
          hasMore: query !== null && filterLiveCommands(query).length > 4,
          isLoadingMore: false,
          loadMore: noop,
          onQueryChange: setQuery,
        },
      )}
      mentionMenuPlacement="bottom"
      attachments={makeAttachments()}
      history={baseHistory}
      submission={makeSubmission()}
      voice={idleVoice}
      footerStart={<ExecutionControls {...mockExecution} />}
    />
  );
}

function WithLiveMentionsRow() {
  const { value, mentionRanges, onChange } = useControlledValue("");
  const [query, setQuery] = useState<string | null>(null);
  const suggestions = filterLiveMentions(query ?? "");
  return (
    <PromptBoxInternal
      value={value}
      mentionRanges={mentionRanges}
      onChange={onChange}
      onSubmit={noop}
      placeholder="Type @ to mention a file, folder, or thread"
      typeahead={makeTypeahead({
        suggestions,
        onQueryChange: setQuery,
      })}
      mentionMenuPlacement="bottom"
      attachments={makeAttachments()}
      history={baseHistory}
      submission={makeSubmission()}
      voice={idleVoice}
      footerStart={<ExecutionControls {...mockExecution} />}
    />
  );
}

function SubmittingRow() {
  const { value, mentionRanges, onChange } = useControlledValue(
    "Review thread workspace.",
  );
  return (
    <PromptBoxInternal
      value={value}
      mentionRanges={mentionRanges}
      onChange={onChange}
      onSubmit={noop}
      typeahead={makeTypeahead()}
      mentionMenuPlacement="bottom"
      attachments={makeAttachments()}
      history={baseHistory}
      submission={makeSubmission({
        isSubmitting: true,
        disabled: true,
        title: "Submitting...",
      })}
      voice={idleVoice}
      footerStart={<ExecutionControls {...mockExecution} />}
    />
  );
}

function RunningWithStopRow() {
  const { value, mentionRanges, onChange } = useControlledValue("");
  return (
    <PromptBoxInternal
      value={value}
      mentionRanges={mentionRanges}
      onChange={onChange}
      onSubmit={noop}
      placeholder="Ask for a follow-up. @ to mention files, folders, or threads"
      typeahead={makeTypeahead()}
      mentionMenuPlacement="bottom"
      attachments={makeAttachments()}
      history={baseHistory}
      submission={makeSubmission({
        isRunning: true,
        onStop: noop,
        title: "Queue follow-up (Enter)",
      })}
      voice={idleVoice}
      footerStart={<ExecutionControls {...mockExecution} />}
    />
  );
}

function RecordingActiveRow() {
  const { value, mentionRanges, onChange } = useControlledValue("");
  return (
    <PromptBoxInternal
      value={value}
      mentionRanges={mentionRanges}
      onChange={onChange}
      onSubmit={noop}
      typeahead={makeTypeahead()}
      mentionMenuPlacement="bottom"
      attachments={makeAttachments()}
      history={baseHistory}
      submission={makeSubmission()}
      voice={recordingVoice}
      footerStart={<ExecutionControls {...mockExecution} />}
    />
  );
}

function RecordingProcessingRow() {
  const { value, mentionRanges, onChange } = useControlledValue("");
  return (
    <PromptBoxInternal
      value={value}
      mentionRanges={mentionRanges}
      onChange={onChange}
      onSubmit={noop}
      typeahead={makeTypeahead()}
      mentionMenuPlacement="bottom"
      attachments={makeAttachments()}
      history={baseHistory}
      submission={makeSubmission()}
      voice={transcribingVoice}
      footerStart={<ExecutionControls {...mockExecution} />}
    />
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="default" hint="empty draft, no in-flight state">
        <DefaultRow />
      </StoryRow>
      <StoryRow
        label="with attachments"
        hint="image + file attached to the draft"
      >
        <WithAttachmentsRow />
      </StoryRow>
      <StoryRow
        label="with mentions"
        hint="thread and file mentions render as editor pills"
      >
        <WithMentionsRow />
      </StoryRow>
      <StoryRow
        label="selected skill"
        hint="skill command pill plus the SKILL.md argument hint text"
      >
        <WithSkillPillRow />
      </StoryRow>
      <StoryRow
        label="live skills"
        hint="type $ then select a skill; argument hints insert after the pill"
      >
        <WithLiveSkillsRow />
      </StoryRow>
      <StoryRow
        label="live mentions"
        hint="type @ then a query (e.g. @prompt, @timeline) — menu filters live"
      >
        <WithLiveMentionsRow />
      </StoryRow>
      <StoryRow label="submitting" hint="mutation in flight">
        <SubmittingRow />
      </StoryRow>
      <StoryRow
        label="running with stop"
        hint="isRunning=true → stop button shown"
      >
        <RunningWithStopRow />
      </StoryRow>
      <StoryRow
        label="recording active"
        hint="voice.state === 'recording' → live waveform + cancel"
      >
        <RecordingActiveRow />
      </StoryRow>
      <StoryRow
        label="recording processing"
        hint="voice.state === 'transcribing' → spinner + cancel"
      >
        <RecordingProcessingRow />
      </StoryRow>
    </StoryCard>
  );
}
