import { useState } from "react";
import type { TimelineRow } from "@bb/server-contract";
import { EMPTY_ORDERED_MENTION_SUGGESTIONS } from "@bb/client-core";
import { Switch } from "@bb/shared-ui/switch";
import { FollowUpPromptBox } from "@/components/promptbox/FollowUpPromptBox";
import type { ExecutionPermissionConfig } from "@/components/promptbox/ExecutionControls";
import {
  INERT_TYPEAHEAD_COMMAND_CONFIG,
  type AttachmentsConfig,
  type TypeaheadConfig,
} from "@/components/promptbox/PromptBoxInternal";
import { ThreadTimelinePane } from "@/views/thread-detail/ThreadTimelinePane";
import { makeExecutionControlsProps } from "../../../../.ladle/story-fixtures";

export default {
  title: "thread/timeline/Catch-up indicator",
};

const THREAD_ID = "thr_catch_up_story";
const now = 1_800_000_000_000;

function conversationRow(
  index: number,
  role: "user" | "assistant",
  text: string,
): TimelineRow {
  const base = {
    id: `row_${role}_${index}`,
    threadId: THREAD_ID,
    turnId: `turn_${Math.floor(index / 2)}`,
    sourceSeqStart: index + 1,
    sourceSeqEnd: index + 1,
    startedAt: now + index * 1_000,
    createdAt: now + index * 1_000,
    kind: "conversation" as const,
    text,
    attachments: null,
  };
  if (role === "user") {
    return {
      ...base,
      role: "user",
      initiator: "user",
      senderThreadId: null,
      systemMessageKind: "unlabeled",
      systemMessageSubject: null,
      turnRequest: { isGrouped: false, kind: "message", status: "accepted" },
      mentions: [],
    };
  }
  return { ...base, role: "assistant", turnRequest: null };
}

const earlierRows: TimelineRow[] = Array.from({ length: 4 }, (_, turn) => [
  conversationRow(
    turn * 2,
    "user",
    `Earlier request ${turn + 1}: check the audit log query plan and the flag rollout.`,
  ),
  conversationRow(
    turn * 2 + 1,
    "assistant",
    `Earlier reply ${turn + 1}: the query plan looks fine and the flag defaults to off, so nothing ships until we flip it.`,
  ),
]).flat();

const cachedRows: TimelineRow[] = [
  ...earlierRows,
  conversationRow(
    8,
    "user",
    "Add pagination to the audit log and ship it behind a feature flag.",
  ),
  conversationRow(
    9,
    "assistant",
    "I added cursor pagination to the audit log query and wired the flag. The query now uses the covering index instead of a scan.",
  ),
  conversationRow(10, "user", "Run the integration suite before you finish."),
  conversationRow(
    11,
    "assistant",
    "Running the integration suite now. These are the rows cached from your last visit; newer ones are still being fetched.",
  ),
];

const noop = () => {};

const typeahead: TypeaheadConfig = {
  mention: {
    results: EMPTY_ORDERED_MENTION_SUGGESTIONS,
    isLoading: false,
    isError: false,
    onQueryChange: noop,
  },
  command: INERT_TYPEAHEAD_COMMAND_CONFIG,
};

const attachments: AttachmentsConfig = {
  items: [],
  projectId: "proj_demo",
  isAttaching: false,
  error: null,
  onAttachFiles: noop,
  onRemove: noop,
};

const permission: ExecutionPermissionConfig = {
  value: "auto",
  options: [
    { value: "accept-edits", label: "Accept Edits" },
    { value: "auto", label: "Approve for me" },
    { value: "full", label: "Full Access", tone: "warning" },
  ],
  onChange: noop,
  supported: true,
};

const execution = makeExecutionControlsProps();

function ToggleControl({
  checked,
  label,
  onCheckedChange,
}: {
  checked: boolean;
  label: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-muted-foreground">
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
      {label}
    </label>
  );
}

export function Overview() {
  const [isCatchingUp, setIsCatchingUp] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [message, setMessage] = useState("");
  const threadRuntimeDisplayStatus = isRunning ? "active" : "idle";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-4">
        <ToggleControl
          checked={isCatchingUp}
          label="Catching up"
          onCheckedChange={setIsCatchingUp}
        />
        <ToggleControl
          checked={isRunning}
          label="Agent running"
          onCheckedChange={setIsRunning}
        />
      </div>
      <div className="h-[640px] min-h-0 overflow-hidden rounded-lg border border-border bg-background">
        <ThreadTimelinePane
          activeThinking={null}
          canSpawnChild={false}
          contextBoundarySeq={null}
          footer={
            <FollowUpPromptBox
              attachments={attachments}
              stack={null}
              composer={{
                history: {
                  currentDraft: {
                    text: message,
                    mentions: [],
                    attachments: [],
                  },
                  entries: [],
                  onSelectEntry: noop,
                },
                isFollowUpSubmitting: false,
                message,
                mentionRanges: [],
                onChangeMessage: setMessage,
                onModifierSubmit: noop,
                onSubmit: noop,
                compactPromptPlaceholder: "Ask for a follow-up",
                promptPlaceholder: "Ask for a follow-up",
                canModifierSubmit: false,
                steerActiveThreadOnEnter: false,
                submitMode: isRunning
                  ? { kind: "queue", onStop: noop }
                  : { kind: "ready" },
                threadRuntimeDisplayStatus,
              }}
              environmentSummary={null}
              contextWindowUsage={null}
              execution={execution}
              permission={permission}
              promptActions={[]}
              typeahead={typeahead}
              collapseResetKey={THREAD_ID}
            />
          }
          hasOlderTimelineRows={false}
          isCatchingUpTimeline={isCatchingUp}
          isLoadingOlderTimelineRows={false}
          isStopping={false}
          isThreadTimelinePending={false}
          onLoadOlderRows={noop}
          resolveMentionLink={() => null}
          showOngoingIndicator={isRunning}
          stoppingAnchorAt={0}
          threadId={THREAD_ID}
          threadRuntimeDisplayStatus={threadRuntimeDisplayStatus}
          timelineError={false}
          timelineRows={cachedRows}
          unreadDividerAutoScroll={false}
          unreadDividerPlacement={null}
          workspaceRootPath={undefined}
        />
      </div>
    </div>
  );
}
