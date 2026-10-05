import { useState } from "react";
import type { TimelineRow } from "@bb/server-contract";
import { Switch } from "@bb/shared-ui/switch";
import { FollowUpPromptBox } from "@/components/promptbox/FollowUpPromptBox";
import type { ExecutionPermissionConfig } from "@/components/promptbox/ExecutionControls";
import { ThreadTimelinePane } from "@/views/thread-detail/ThreadTimelinePane";
import {
  makeAttachmentsConfig,
  makeExecutionControlsProps,
  makeTypeaheadConfig,
} from "../../../../.ladle/story-fixtures";

export default {
  title: "thread/timeline/Catch-up indicator",
};

const THREAD_ID = "thr_catch_up_story";
const now = 1_800_000_000_000;

function conversationRow(index: number): TimelineRow {
  const base = {
    id: `row_${index}`,
    threadId: THREAD_ID,
    turnId: `turn_${Math.floor(index / 2)}`,
    sourceSeqStart: index + 1,
    sourceSeqEnd: index + 1,
    messageSeq: index + 1,
    startedAt: now + index * 1_000,
    createdAt: now + index * 1_000,
    kind: "conversation" as const,
    attachments: null,
  };
  if (index % 2 === 0) {
    return {
      ...base,
      text: `Request ${index / 2 + 1}: check the audit log query plan and the flag rollout.`,
      role: "user",
      initiator: "user",
      senderThreadId: null,
      systemMessageKind: "unlabeled",
      systemMessageSubject: null,
      turnRequest: { isGrouped: false, kind: "message", status: "accepted" },
      mentions: [],
    };
  }
  return {
    ...base,
    text: `Reply ${(index + 1) / 2}: the query uses the covering index and the flag defaults to off.`,
    role: "assistant",
    turnRequest: null,
  };
}

const cachedRows: TimelineRow[] = Array.from({ length: 12 }, (_, index) =>
  conversationRow(index),
);

const noop = () => {};

const typeahead = makeTypeaheadConfig();

const attachments = makeAttachmentsConfig();

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
