import type {
  PendingInteraction,
  ProviderPendingInteraction,
} from "@bb/domain";
import { ThreadPendingInteractionBanner } from "@/components/thread/pending-interactions/ThreadPendingInteractionBanner";
import { ThreadPromptContextBanner } from "@/components/promptbox/banner/ThreadPromptContextBanner";
import { StoryCard, StoryRow } from "../../../../.ladle/story-card";

export default {
  title: "thread/Pending Interaction/Approval",
};

// Match production: ThreadDetailPromptArea renders inside PageShell's footer
// (max-w-[760px]). Without it the banner stretches the full row width.
function PromptStage({ children }: { children: React.ReactNode }) {
  return <div className="w-full max-w-[760px]">{children}</div>;
}

// The common fields; each story pairs its own payload with its resolution.
function basePendingInteraction(): Omit<
  ProviderPendingInteraction,
  "payload" | "resolution"
> {
  return {
    id: "pi_demo",
    threadId: "thr_qfk8ksbxkk",
    turnId: "turn_demo",
    providerId: "codex",
    providerThreadId: "provider-thread-demo",
    providerRequestId: "request-demo",
    status: "pending",
    statusReason: null,
    createdAt: 1,
    resolvedAt: null,
  };
}

const commandApproval: PendingInteraction = {
  ...basePendingInteraction(),
  resolution: null,
  payload: {
    kind: "approval",
    subject: {
      kind: "command",
      itemId: "item_cmd",
      command: "git push origin bb/promptbox-stories",
      cwd: "/Users/michael/Projects/bb",
      actions: [],
      sessionGrant: null,
    },
    reason: "Run a command that updates the remote",
    availableDecisions: ["allow_once", "allow_for_session", "deny"],
  },
};

const longCommandApproval: PendingInteraction = {
  ...basePendingInteraction(),
  resolution: null,
  id: "pi_demo_long",
  payload: {
    kind: "approval",
    subject: {
      kind: "command",
      itemId: "item_cmd_long",
      command:
        "pnpm exec turbo run typecheck --filter=@bb/app --filter=@bb/server --filter=@bb/domain --filter=@bb/server-contract --force",
      cwd: "/Users/michael/Projects/bb",
      actions: [],
      sessionGrant: null,
    },
    reason: "Run a long monorepo typecheck across multiple packages",
    availableDecisions: ["allow_once", "allow_for_session", "deny"],
  },
};

const resolvingCommandApproval: PendingInteraction = {
  ...commandApproval,
  id: "pi_demo_resolving",
  status: "resolving",
  resolution: {
    decision: "allow_for_session",
    grantedPermissions: null,
  },
};

const fileChange: PendingInteraction = {
  ...basePendingInteraction(),
  resolution: null,
  id: "pi_demo_file",
  payload: {
    kind: "approval",
    subject: {
      kind: "file_change",
      itemId: "item_file",
      writeScope: null,
      sessionGrant: null,
    },
    reason: "Write apps/app/src/components/promptbox/banner/ContextBanner.tsx",
    availableDecisions: ["allow_once", "allow_for_session", "deny"],
  },
};

const permissionGrant: PendingInteraction = {
  ...basePendingInteraction(),
  resolution: null,
  id: "pi_demo_perm",
  payload: {
    kind: "approval",
    subject: {
      kind: "permission_grant",
      itemId: "item_perm",
      toolName: "Edit",
      permissions: {
        network: null,
        fileSystem: {
          read: [
            "/Users/michael/Projects/bb/apps/app",
            "/Users/michael/Projects/bb/packages",
          ],
          write: [
            "/Users/michael/Projects/bb/apps/app/src/components/promptbox",
          ],
        },
      },
    },
    reason: "Need promptbox write access for the banner refactor",
    availableDecisions: ["allow_once", "allow_for_session", "deny"],
  },
};

const toolUse: PendingInteraction = {
  ...basePendingInteraction(),
  resolution: null,
  id: "pi_demo_tool_use",
  providerId: "acp",
  payload: {
    kind: "approval",
    subject: {
      kind: "tool_use",
      itemId: "call_tool_use",
      tool: "mcp__github__create_issue",
      presentation: {
        label: { pending: "Creating issue", completed: "Created issue" },
        icon: { glyph: "Globe" },
        title: "get-bb/bb · Banner clips long titles",
        detail: "Opens a **bug** issue with the repro steps from this thread.",
        tint: { light: "#2563eb", dark: "#93c5fd" },
      },
    },
    reason: null,
    availableDecisions: ["allow_once", "allow_for_session", "deny"],
  },
};

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="parent thread when a child needs approval"
        hint="the parent composer shows the child's prompt plus the needs-approval banner"
      >
        <PromptStage>
          <ThreadPendingInteractionBanner
            interaction={commandApproval}
            sourceThread={{
              href: "/projects/proj-1/threads/thr_blocked",
              title: "Install workspace tools",
            }}
            threadId={commandApproval.threadId}
          />
          <ThreadPromptContextBanner
            gitSection={null}
            gitSectionPending={false}
            archivedSection={null}
            environmentGoneSection={null}
            parentThreadSection={null}
            childThreadsSection={{
              items: [
                {
                  id: "thr_blocked",
                  title: "Install workspace tools",
                  href: "/projects/proj-1/threads/thr_blocked",
                  hasPendingInteraction: true,
                },
              ],
            }}
            pullRequestSection={null}
            expandedSection={null}
            onToggleSection={() => {}}
          />
        </PromptStage>
      </StoryRow>
      <StoryRow
        label="command approval from a child thread"
        hint="parent composer surfaces the child's permission prompt with a link back to that child"
      >
        <PromptStage>
          <ThreadPendingInteractionBanner
            interaction={commandApproval}
            sourceThread={{
              href: "/projects/proj-1/threads/thr_blocked",
              title: "Install workspace tools",
            }}
            threadId={commandApproval.threadId}
          />
        </PromptStage>
      </StoryRow>
      <StoryRow
        label="command approval"
        hint="agent wants to run a shell command; default selection is the first decision"
      >
        <PromptStage>
          <ThreadPendingInteractionBanner
            interaction={commandApproval}
            threadId={commandApproval.threadId}
          />
        </PromptStage>
      </StoryRow>
      <StoryRow
        label="command approval (long command)"
        hint="long command scrolls inside the pre block"
      >
        <PromptStage>
          <ThreadPendingInteractionBanner
            interaction={longCommandApproval}
            threadId={longCommandApproval.threadId}
          />
        </PromptStage>
      </StoryRow>
      <StoryRow
        label="resolving"
        hint="user submitted a decision; banner shows Delivering pill and disables interaction"
      >
        <PromptStage>
          <ThreadPendingInteractionBanner
            interaction={resolvingCommandApproval}
            threadId={resolvingCommandApproval.threadId}
          />
        </PromptStage>
      </StoryRow>
      <StoryRow label="file change approval" hint="agent wants to write a file">
        <PromptStage>
          <ThreadPendingInteractionBanner
            interaction={fileChange}
            threadId={fileChange.threadId}
          />
        </PromptStage>
      </StoryRow>
      <StoryRow
        label="permission grant"
        hint="agent requests fs read/write permission for specific paths"
      >
        <PromptStage>
          <ThreadPendingInteractionBanner
            interaction={permissionGrant}
            threadId={permissionGrant.threadId}
          />
        </PromptStage>
      </StoryRow>
      <StoryRow
        label="tool use"
        hint="a generic tool call (MCP, provider-native) described by the bridge's presentation alone"
      >
        <PromptStage>
          <ThreadPendingInteractionBanner
            interaction={toolUse}
            threadId={toolUse.threadId}
          />
        </PromptStage>
      </StoryRow>
    </StoryCard>
  );
}
