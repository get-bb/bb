import type { TimelineConversationAttachments } from "@bb/server-contract";
import type { PromptMentionResource, PromptTextMention } from "@bb/domain";
import type { TimelineTitleLink } from "@bb/thread-view";
import { renderTemplate } from "@bb/templates";
import type { ReactNode } from "react";
import { ConversationMessageContent } from "@/components/thread/timeline/ConversationMessageContent";
import { StoryCard, StoryRow } from "../../../../../.ladle/story-card";

export default {
  title: "thread/timeline/rows/User Message",
};

// Match production: ThreadTimelinePane's PageShell content area caps at
// 760px. Without it the message bubble stretches the full row width and
// doesn't reflect what users see.
interface TimelineStageProps {
  children: ReactNode;
}

function TimelineStage({ children }: TimelineStageProps) {
  return <div className="w-full max-w-[760px]">{children}</div>;
}

// Resolves placecats URLs (which are already absolute) and falls through for
// project-relative paths the same way the production resolver would.
const resolveImageSrc = (path: string) => path;

function resolveThreadLink(link: TimelineTitleLink): string | null {
  switch (link.kind) {
    case "thread":
      return `/projects/proj_demo/threads/${link.threadId}`;
  }
}

const acceptedMessage = {
  kind: "message" as const,
  status: "accepted" as const,
};
const pendingSteer = { kind: "steer" as const, status: "pending" as const };
const acceptedSteer = { kind: "steer" as const, status: "accepted" as const };

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

// CollapsibleMessageText kicks in at > 15 pre-wrapped lines, so this fixture
// crosses that threshold to exercise the Show more / Show less affordance.
const longMarkdownText = `Audit \`apps/app/src/components/promptbox/FollowUpPromptBox.tsx\` for the same prop trims we did on the banner.

Specifically I want you to look at:

- Optional fields that hide defaults (per AGENTS.md: "Optional contract fields are allowed only when leaving the field out has its own real semantic meaning")
- Wrapper-shape mismatches where the outer prop renames fields just to rename them back at the call site
- Boolean soup that could collapse into one discriminated union (we already did this for ComposerSubmitMode)
- Slot candidates where the wrapper passes structured data but does no logic on it
- Layout-coupling smells where a top-level prop only exists because it sits next to another visual element
- Accepted-but-overridden fields (the picker's readOnly was a recent example)
- Fields that look like they should live on a different prop block

Examples of trims we landed recently for reference:

1. \`banner\` collapsed from 13 fields to a \`ReactNode | null\` slot
2. \`ComposerMentionsProps\` shim removed in favor of canonical \`MentionsConfig\`
3. \`ComposerAttachmentsProps\` same — drop the rename, use \`AttachmentsConfig\`
4. \`provider.readOnly\` removed; locked-ness derived from \`!provider.onChange\`

Reply with a punch list, not code. Each item should call out the current shape, the recommended shape, and a one-line reason for why the current shape is wrong.

Cap at ~600 words. Lead with the highest-value trims so I can prioritize.`;

interface BuiltMessage {
  text: string;
  mentions: PromptTextMention[];
}

function buildMessage(
  text: string,
  mentionSpecs: ReadonlyArray<{
    token: string;
    resource: PromptMentionResource;
  }>,
): BuiltMessage {
  return {
    text,
    mentions: mentionSpecs.map((spec) =>
      storyMention({ resource: spec.resource, text, token: spec.token }),
    ),
  };
}

function threadMentionResource(
  threadId: string,
  label: string,
): PromptMentionResource {
  return {
    kind: "thread",
    threadId,
    projectId: "proj_demo",
    label,
  };
}

const agentInitiatedMessage = buildMessage(
  [
    '[bb message from thread:thr_ux3h8sxg65; reply with `bb thread tell thr_ux3h8sxg65 "<your response>"`]',
    "",
    "Fixed both blockers on @apps/server/src/services/manager/manager-system-messages.ts. No merge or push.",
    "",
    "Fix summary:",
    "- Clipboard blocker: `parsePromptMentionClipboardElement` now validates pasted resource metadata and derives `serializedText` from that resource.",
    "- Manager range blocker: added segment/template-slot builders and moved rich manager system message call sites to build text and ranges together.",
    "- Template docs nit: updated @packages/templates/src/templates/system-message-thread-ownership-assigned.md, then regenerated `templates.generated.ts`.",
  ].join("\n"),
  [
    {
      token: "@apps/server/src/services/manager/manager-system-messages.ts",
      resource: {
        kind: "path",
        source: "workspace",
        entryKind: "file",
        path: "apps/server/src/services/manager/manager-system-messages.ts",
        label: "manager-system-messages.ts",
      },
    },
    {
      token:
        "@packages/templates/src/templates/system-message-thread-ownership-assigned.md",
      resource: {
        kind: "path",
        source: "workspace",
        entryKind: "file",
        path: "packages/templates/src/templates/system-message-thread-ownership-assigned.md",
        label: "system-message-thread-ownership-assigned.md",
      },
    },
  ],
);

const agentSteerMessage = buildMessage(
  [
    '[bb message from thread:thr_h4u3fgr6be; reply with `bb thread tell thr_h4u3fgr6be "<your response>"`]',
    "",
    "Committed the two scoped fixes touching @apps/app/src/components/thread/timeline/ConversationMessageContent.tsx. Worktree is clean.",
  ].join("\n"),
  [
    {
      token:
        "@apps/app/src/components/thread/timeline/ConversationMessageContent.tsx",
      resource: {
        kind: "path",
        source: "workspace",
        entryKind: "file",
        path: "apps/app/src/components/thread/timeline/ConversationMessageContent.tsx",
        label: "ConversationMessageContent.tsx",
      },
    },
  ],
);

const systemAssignedMessage = buildMessage(
  renderTemplate("systemMessageThreadOwnershipAssigned", {
    threadMention: "@thread:thr_4z3cyhcufk",
  }),
  [
    {
      token: "@thread:thr_4z3cyhcufk",
      resource: threadMentionResource(
        "thr_4z3cyhcufk",
        "Investigate flaky storybook layout",
      ),
    },
  ],
);

const systemChildOutcomeBatchMessage = buildMessage(
  renderTemplate("systemMessageChildThreadOutcomeBatch", {
    updates: [
      "Child thread updates:",
      "",
      "- @thread:thr_ux3h8sxg65 completed.",
      "- @thread:thr_cpf5sq7pyr completed.",
      "- @thread:thr_h4u3fgr6be failed.",
    ].join("\n"),
  }),
  [
    {
      token: "@thread:thr_ux3h8sxg65",
      resource: threadMentionResource(
        "thr_ux3h8sxg65",
        "Render Rich Thread Names",
      ),
    },
    {
      token: "@thread:thr_cpf5sq7pyr",
      resource: threadMentionResource(
        "thr_cpf5sq7pyr",
        "Investigate lost thread stop retry",
      ),
    },
    {
      token: "@thread:thr_h4u3fgr6be",
      resource: threadMentionResource(
        "thr_h4u3fgr6be",
        "Full QA post-rebase: prompt timeline app data voice",
      ),
    },
  ],
);

const parentChildSystemMessageFixtures = [
  {
    label: "assigned",
    hint: "new parent receives the child thread assignment notice",
    message: buildMessage(
      renderTemplate("systemMessageThreadOwnershipAssigned", {
        threadMention: "@thread:thr_indexer",
      }),
      [
        {
          token: "@thread:thr_indexer",
          resource: threadMentionResource(
            "thr_indexer",
            "Build search index worker",
          ),
        },
      ],
    ),
  },
  {
    label: "removed",
    hint: "previous parent receives the unassignment notice",
    message: buildMessage(
      renderTemplate("systemMessageThreadOwnershipRemoved", {
        threadMention: "@thread:thr_indexer",
      }),
      [
        {
          token: "@thread:thr_indexer",
          resource: threadMentionResource(
            "thr_indexer",
            "Build search index worker",
          ),
        },
      ],
    ),
  },
  {
    label: "needs attention",
    hint: "child thread is blocked on a pending interaction",
    message: buildMessage(
      renderTemplate("systemMessageChildThreadNeedsAttention", {
        blockerSummary: [
          "Blocked on command approval:",
          "Command: git push origin bb/child-thread-parent-message-plan",
        ].join("\n"),
        threadMention: "@thread:thr_deployer",
      }),
      [
        {
          token: "@thread:thr_deployer",
          resource: threadMentionResource(
            "thr_deployer",
            "Deploy release candidate",
          ),
        },
      ],
    ),
  },
  {
    label: "completed",
    hint: "single child thread completion includes its final output excerpt",
    message: buildMessage(
      renderTemplate("systemMessageChildThreadOutcomeBatch", {
        updates: [
          "@thread:thr_schema completed:",
          "",
          "Migrated the thread ownership queries to targeted joins and added regression coverage. Validation passed for @bb/server.",
        ].join("\n"),
      }),
      [
        {
          token: "@thread:thr_schema",
          resource: threadMentionResource(
            "thr_schema",
            "Tighten ownership queries",
          ),
        },
      ],
    ),
  },
  {
    label: "failed",
    hint: "single child thread failure asks the parent to inspect before deciding next steps",
    message: buildMessage(
      renderTemplate("systemMessageChildThreadOutcomeBatch", {
        updates: [
          "@thread:thr_rebase failed.",
          "",
          "Review the thread before deciding next steps.",
        ].join("\n"),
      }),
      [
        {
          token: "@thread:thr_rebase",
          resource: threadMentionResource(
            "thr_rebase",
            "Rebase integration branch",
          ),
        },
      ],
    ),
  },
  {
    label: "interrupted",
    hint: "single child thread interruption carries the manual-stop guidance",
    message: buildMessage(
      renderTemplate("systemMessageChildThreadOutcomeBatch", {
        updates: [
          "@thread:thr_docs was interrupted.",
          "",
          "Review the thread before deciding next steps.",
          "",
          "If the user stopped it manually, do not resume, restart, retry, replace, or continue the work unless the user explicitly asks.",
        ].join("\n"),
      }),
      [
        {
          token: "@thread:thr_docs",
          resource: threadMentionResource(
            "thr_docs",
            "Refresh onboarding guide",
          ),
        },
      ],
    ),
  },
  {
    label: "mixed batch",
    hint: "multiple child thread outcomes collapse into one parent-facing system turn",
    message: buildMessage(
      renderTemplate("systemMessageChildThreadOutcomeBatch", {
        updates: [
          "Child thread updates:",
          "",
          "- @thread:thr_schema completed.",
          "- @thread:thr_rebase failed.",
          "- @thread:thr_docs was interrupted.",
          "",
          "If the user stopped any interrupted thread manually, do not resume, restart, retry, replace, or continue the work unless the user explicitly asks.",
        ].join("\n"),
      }),
      [
        {
          token: "@thread:thr_schema",
          resource: threadMentionResource(
            "thr_schema",
            "Tighten ownership queries",
          ),
        },
        {
          token: "@thread:thr_rebase",
          resource: threadMentionResource(
            "thr_rebase",
            "Rebase integration branch",
          ),
        },
        {
          token: "@thread:thr_docs",
          resource: threadMentionResource(
            "thr_docs",
            "Refresh onboarding guide",
          ),
        },
      ],
    ),
  },
];

const longSystemMessage = buildMessage(
  [
    "[bb system]",
    "",
    "@thread:thr_cpf5sq7pyr completed:",
    "",
    "Rebased and tightened the branch. No merge or push.",
    "",
    "Changed files:",
    "- @apps/server/src/services/threads/thread-lifecycle.ts",
    "- @apps/server/test/threads/thread-stop-retry.test.ts",
    "",
    "Behavior summary:",
    "- The `stopping` status remains durable stop intent.",
    "- Live `thread.stop` RPC dedupe now uses a separate in-memory in-flight set.",
    "- Failed stop RPC clears the in-flight marker, so `stop-requested-thread-retry` can redeliver.",
    "- Sweep does not queue duplicate stop RPCs while one is already in flight.",
    "",
    "Validation:",
    "- `pnpm exec turbo run test --filter=@bb/server -- test/threads/thread-stop-retry.test.ts` passed, 2 tests.",
    "- `pnpm exec turbo run typecheck --filter=@bb/server` passed.",
    "",
    "Blockers: none. Worktree status: clean.",
  ].join("\n"),
  [
    {
      token: "@thread:thr_cpf5sq7pyr",
      resource: {
        kind: "thread",
        threadId: "thr_cpf5sq7pyr",
        projectId: "proj_demo",
        label: "Investigate lost thread stop retry",
      },
    },
    {
      token: "@apps/server/src/services/threads/thread-lifecycle.ts",
      resource: {
        kind: "path",
        source: "workspace",
        entryKind: "file",
        path: "apps/server/src/services/threads/thread-lifecycle.ts",
        label: "thread-lifecycle.ts",
      },
    },
    {
      token: "@apps/server/test/threads/thread-stop-retry.test.ts",
      resource: {
        kind: "path",
        source: "workspace",
        entryKind: "file",
        path: "apps/server/test/threads/thread-stop-retry.test.ts",
        label: "thread-stop-retry.test.ts",
      },
    },
  ],
);

const singleImageAttachments: TimelineConversationAttachments = {
  webImages: 0,
  localImages: 1,
  localFiles: 0,
  imageUrls: [],
  localImagePaths: ["https://placecats.com/300/200"],
  localFilePaths: [],
};

const mixedAttachments: TimelineConversationAttachments = {
  webImages: 1,
  localImages: 2,
  localFiles: 1,
  imageUrls: ["https://placecats.com/360/220"],
  localImagePaths: [
    "https://placecats.com/300/180",
    "https://placecats.com/320/200",
  ],
  localFilePaths: ["docs/refactor-notes.md"],
};

const mentionedMessageText =
  "Ask @thread:thr_parent and @apps/app/src/components/promptbox/PromptBoxInternal.tsx to review the prompt mention flow.";
const mentionedMessageMentions: PromptTextMention[] = [
  storyMention({
    text: mentionedMessageText,
    token: "@thread:thr_parent",
    resource: {
      kind: "thread",
      threadId: "thr_parent",
      projectId: "proj_bb",
      label: "Prompt UX thread",
    },
  }),
  storyMention({
    text: mentionedMessageText,
    token: "@apps/app/src/components/promptbox/PromptBoxInternal.tsx",
    resource: {
      kind: "path",
      source: "workspace",
      entryKind: "file",
      path: "apps/app/src/components/promptbox/PromptBoxInternal.tsx",
      label: "PromptBoxInternal.tsx",
    },
  }),
];

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="short">
        <TimelineStage>
          <ConversationMessageContent
            role="user"
            initiator="user"
            senderThreadId={null}
            senderThreadTitle={null}
            text="Walk me through how ThreadDetailView wires the prompt context banner."
            attachments={null}
            mentions={[]}
            turnRequest={acceptedMessage}
          />
        </TimelineStage>
      </StoryRow>
      <StoryRow
        label="mentions"
        hint="thread mentions link; file mentions are display-only pills with full-path hover"
      >
        <TimelineStage>
          <ConversationMessageContent
            role="user"
            initiator="user"
            senderThreadId={null}
            senderThreadTitle={null}
            text={mentionedMessageText}
            attachments={null}
            mentions={mentionedMessageMentions}
            projectId="proj_bb"
            turnRequest={acceptedMessage}
          />
        </TimelineStage>
      </StoryRow>
      <StoryRow
        label="long"
        hint="multi-line markdown with code fence + bullets"
      >
        <TimelineStage>
          <ConversationMessageContent
            role="user"
            initiator="user"
            senderThreadId={null}
            senderThreadTitle={null}
            text={longMarkdownText}
            attachments={null}
            mentions={[]}
            turnRequest={acceptedMessage}
          />
        </TimelineStage>
      </StoryRow>
      <StoryRow
        label="pending"
        hint="turnRequest.kind = steer, status = pending — interruption mid-turn"
      >
        <TimelineStage>
          <ConversationMessageContent
            role="user"
            initiator="user"
            senderThreadId={null}
            senderThreadTitle={null}
            text="Hold on — also include the queue API in that audit, please."
            attachments={null}
            mentions={[]}
            turnRequest={pendingSteer}
          />
        </TimelineStage>
      </StoryRow>
      <StoryRow
        label="accepted steer"
        hint="steer that the runtime has acknowledged and folded into the turn"
      >
        <TimelineStage>
          <ConversationMessageContent
            role="user"
            initiator="user"
            senderThreadId={null}
            senderThreadTitle={null}
            text="Hold on — also include the queue API in that audit, please."
            attachments={null}
            mentions={[]}
            turnRequest={acceptedSteer}
          />
        </TimelineStage>
      </StoryRow>
      <StoryRow label="with image" hint="single localImage attachment">
        <TimelineStage>
          <ConversationMessageContent
            role="user"
            initiator="user"
            senderThreadId={null}
            senderThreadTitle={null}
            text="Repro of the layout regression in the prompt context banner."
            attachments={singleImageAttachments}
            mentions={[]}
            turnRequest={acceptedMessage}
            resolveUserAttachmentImageSrc={resolveImageSrc}
          />
        </TimelineStage>
      </StoryRow>
      <StoryRow
        label="with images and mixed attachments"
        hint="2 local images + 1 web image + 1 local file"
      >
        <TimelineStage>
          <ConversationMessageContent
            role="user"
            initiator="user"
            senderThreadId={null}
            senderThreadTitle={null}
            text="Three screenshots from the design review and the spec doc."
            attachments={mixedAttachments}
            mentions={[]}
            turnRequest={acceptedMessage}
            resolveUserAttachmentImageSrc={resolveImageSrc}
            onOpenLocalFileLink={() => false}
          />
        </TimelineStage>
      </StoryRow>
      <StoryRow
        label="agent-initiated"
        hint="file mentions in the body collapse to one-line pills with full-path hover"
      >
        <TimelineStage>
          <ConversationMessageContent
            role="user"
            initiator="agent"
            resolveSegmentLinkHref={resolveThreadLink}
            senderThreadId="thr_ux3h8sxg65"
            senderThreadTitle="Render Rich Thread Names"
            text={agentInitiatedMessage.text}
            attachments={null}
            mentions={agentInitiatedMessage.mentions}
            projectId="proj_demo"
            turnRequest={acceptedMessage}
          />
        </TimelineStage>
      </StoryRow>
      <StoryRow
        label="generated steers"
        hint="steer status appears in the expanded body, not the row title"
      >
        <div className="flex w-full max-w-[760px] flex-col gap-3">
          <ConversationMessageContent
            role="user"
            initiator="agent"
            resolveSegmentLinkHref={resolveThreadLink}
            senderThreadId="thr_h4u3fgr6be"
            senderThreadTitle="Full QA post-rebase: prompt timeline app data voice"
            text={agentSteerMessage.text}
            attachments={null}
            mentions={agentSteerMessage.mentions}
            projectId="proj_demo"
            turnRequest={acceptedSteer}
          />
          <ConversationMessageContent
            role="user"
            initiator="system"
            senderThreadId={null}
            senderThreadTitle={null}
            text={systemAssignedMessage.text}
            attachments={null}
            mentions={systemAssignedMessage.mentions}
            projectId="proj_demo"
            turnRequest={pendingSteer}
          />
        </div>
      </StoryRow>
      <StoryRow
        label="system-initiated (assigned)"
        hint="single-line system activity with a thread mention pill"
      >
        <TimelineStage>
          <ConversationMessageContent
            role="user"
            initiator="system"
            senderThreadId={null}
            senderThreadTitle={null}
            text={systemAssignedMessage.text}
            attachments={null}
            mentions={systemAssignedMessage.mentions}
            projectId="proj_demo"
            turnRequest={acceptedMessage}
          />
        </TimelineStage>
      </StoryRow>
      <StoryRow
        label="system-initiated (child outcome batch)"
        hint="multi-thread updates render as a list of pill mentions"
      >
        <TimelineStage>
          <ConversationMessageContent
            role="user"
            initiator="system"
            senderThreadId={null}
            senderThreadTitle={null}
            text={systemChildOutcomeBatchMessage.text}
            attachments={null}
            mentions={systemChildOutcomeBatchMessage.mentions}
            projectId="proj_demo"
            turnRequest={acceptedMessage}
          />
        </TimelineStage>
      </StoryRow>
      <StoryRow
        label="system-initiated (long)"
        hint="expanded body shows the full generated message with mixed pills"
      >
        <TimelineStage>
          <ConversationMessageContent
            role="user"
            initiator="system"
            senderThreadId={null}
            senderThreadTitle={null}
            text={longSystemMessage.text}
            attachments={null}
            mentions={longSystemMessage.mentions}
            projectId="proj_demo"
            turnRequest={acceptedMessage}
          />
        </TimelineStage>
      </StoryRow>
    </StoryCard>
  );
}

export function ParentChildSystemMessages() {
  return (
    <StoryCard>
      {parentChildSystemMessageFixtures.map((fixture) => (
        <StoryRow
          key={fixture.label}
          label={fixture.label}
          hint={fixture.hint}
        >
          <TimelineStage>
            <ConversationMessageContent
              role="user"
              initiator="system"
              senderThreadId={null}
              senderThreadTitle={null}
              text={fixture.message.text}
              attachments={null}
              mentions={fixture.message.mentions}
              projectId="proj_demo"
              turnRequest={acceptedMessage}
            />
          </TimelineStage>
        </StoryRow>
      ))}
    </StoryCard>
  );
}
