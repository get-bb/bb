import { useMemo } from "react";
import type { PromptTextMention } from "@bb/domain";
import { ExecutionControls } from "@/components/promptbox/ExecutionControls";
import { PromptBoxInternal } from "@/components/promptbox/PromptBoxInternal";
import { PromptBoxShell } from "@/components/promptbox/PromptBoxShell";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import {
  makeAttachmentsConfig,
  makeExecutionControlsProps,
  makeTypeaheadConfig,
} from "../../../.ladle/story-fixtures";

export default {
  title: "promptbox/Prompt Box Shell",
};

const noop = () => {};

const SAVED_DRAFT = "Refactor the settings page to use the new form primitives";
const SAVED_DRAFT_WITH_MENTION = "Look at @src/components/settings.tsx first";
const SAVED_DRAFT_MENTIONS: readonly PromptTextMention[] = [
  {
    start: 8,
    end: 36,
    resource: {
      kind: "path",
      source: "workspace",
      entryKind: "file",
      path: "src/components/settings.tsx",
      label: "settings.tsx",
    },
  },
];

function useSharedProps() {
  const typeahead = useMemo(() => makeTypeaheadConfig(), []);
  const attachments = useMemo(() => makeAttachmentsConfig(), []);
  const execution = useMemo(() => makeExecutionControlsProps(), []);
  return { typeahead, attachments, execution };
}

/**
 * The shell must be indistinguishable from the real composer at rest: same
 * frame, placeholder, action row, and send button. Each row pairs the shell
 * (top) with the mounted editor (bottom, autoFocus off so it stays closed).
 */
export function ShellVersusMountedEditor() {
  const { typeahead, attachments, execution } = useSharedProps();
  const footerStart = <ExecutionControls {...execution} />;

  return (
    <StoryCard labelWidth="140px">
      <StoryRow label="Shell, empty draft">
        <div className="w-[640px]">
          <PromptBoxShell
            value=""
            mentionRanges={[]}
            placeholder="Ask anything. @ to mention files, folders, or sections"
            attachments={attachments}
            footerStart={footerStart}
            onSubmitIntent={noop}
            onPromptAction={noop}
          />
        </div>
      </StoryRow>
      <StoryRow label="Editor, empty draft">
        <div className="w-[640px]">
          <PromptBoxInternal
            value=""
            mentionRanges={[]}
            onChange={noop}
            onSubmit={noop}
            autoFocus={false}
            typeahead={typeahead}
            mentionMenuPlacement="bottom"
            attachments={attachments}
            footerStart={footerStart}
          />
        </div>
      </StoryRow>
      <StoryRow label="Shell, saved draft">
        <div className="w-[640px]">
          <PromptBoxShell
            value={SAVED_DRAFT}
            mentionRanges={[]}
            placeholder="Ask anything. @ to mention files, folders, or sections"
            attachments={attachments}
            footerStart={footerStart}
            onSubmitIntent={noop}
            onPromptAction={noop}
          />
        </div>
      </StoryRow>
      <StoryRow label="Editor, saved draft">
        <div className="w-[640px]">
          <PromptBoxInternal
            value={SAVED_DRAFT}
            mentionRanges={[]}
            onChange={noop}
            onSubmit={noop}
            autoFocus={false}
            typeahead={typeahead}
            mentionMenuPlacement="bottom"
            attachments={attachments}
            footerStart={footerStart}
          />
        </div>
      </StoryRow>
      <StoryRow label="Shell, mention pill">
        <div className="w-[640px]">
          <PromptBoxShell
            value={SAVED_DRAFT_WITH_MENTION}
            mentionRanges={SAVED_DRAFT_MENTIONS}
            placeholder="Ask anything. @ to mention files, folders, or sections"
            attachments={attachments}
            footerStart={footerStart}
            onSubmitIntent={noop}
            onPromptAction={noop}
          />
        </div>
      </StoryRow>
      <StoryRow label="Editor, mention pill">
        <div className="w-[640px]">
          <PromptBoxInternal
            value={SAVED_DRAFT_WITH_MENTION}
            mentionRanges={SAVED_DRAFT_MENTIONS}
            onChange={noop}
            onSubmit={noop}
            autoFocus={false}
            typeahead={typeahead}
            mentionMenuPlacement="bottom"
            attachments={attachments}
            footerStart={footerStart}
          />
        </div>
      </StoryRow>
    </StoryCard>
  );
}

/** One-line mobile presentation parity: 48px row, actions pinned right. */
export function CompactShellVersusMountedEditor() {
  const { typeahead, attachments } = useSharedProps();

  return (
    <StoryCard labelWidth="140px">
      <StoryRow label="Shell, compact">
        <div className="w-[360px]">
          <PromptBoxShell
            value=""
            mentionRanges={[]}
            placeholder="Ask for a follow-up"
            compact={{ isCompact: true, placeholder: "Ask a follow-up" }}
            attachments={attachments}
            onSubmitIntent={noop}
            onPromptAction={noop}
          />
        </div>
      </StoryRow>
      <StoryRow label="Editor, compact">
        <div className="w-[360px]">
          <PromptBoxInternal
            value=""
            mentionRanges={[]}
            onChange={noop}
            onSubmit={noop}
            autoFocus={false}
            placeholder="Ask for a follow-up"
            compact={{ isCompact: true, placeholder: "Ask a follow-up" }}
            typeahead={typeahead}
            mentionMenuPlacement="bottom"
            attachments={attachments}
          />
        </div>
      </StoryRow>
    </StoryCard>
  );
}
