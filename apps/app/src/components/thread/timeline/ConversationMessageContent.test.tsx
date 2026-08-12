// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ThreadListEntry } from "@bb/domain";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ThreadTitleMentionResourcesProvider } from "@/components/thread/ThreadTitleMentions";
import { RouteNavigationProvider } from "@/components/ui/app-route-anchor";
import {
  MessageDirectiveRegistryProvider,
  type MessageDirectiveRegistry,
} from "@/components/ui/markdown-message-directives";
import { ConversationMessageContent } from "./ConversationMessageContent";
import { USER_MESSAGE_CHAR_CAP } from "./conversation-message-limits";

afterEach(cleanup);

function threadListEntry(
  overrides: Partial<ThreadListEntry> = {},
): ThreadListEntry {
  return {
    id: "thr_test",
    projectId: "proj_test",
    environmentId: null,
    providerId: "codex",
    title: "Thread",
    titleFallback: "Thread",
    sectionId: null,
    status: "idle",
    parentThreadId: null,
    sourceThreadId: null,
    originKind: null,
    originPluginId: null,
    visibility: "visible",
    childOrigin: null,
    archivedAt: null,
    pinnedAt: null,
    pinSortKey: null,
    deletedAt: null,
    lastReadAt: 0,
    latestAttentionAt: 1,
    createdAt: 1,
    updatedAt: 1,
    activity: {
      activeWorkflowCount: 0,
      activeBackgroundAgentCount: 0,
      activeBackgroundCommandCount: 0,
      activePlanModeCount: 0,
      activeGoalCount: 0,
    },
    hasPendingInteraction: false,
    environmentHostId: null,
    environmentName: null,
    environmentBranchName: null,
    environmentWorkspaceDisplayKind: "other",
    runtime: {
      displayStatus: "idle",
      hostReconnectGraceExpiresAt: null,
    },
    ...overrides,
  };
}

describe("ConversationMessageContent assistant images", () => {
  it("serves local Markdown images through the thread host-file route", () => {
    render(
      <MemoryRouter>
        <RouteNavigationProvider>
          <ConversationMessageContent
            role="assistant"
            attachments={null}
            id="msg_image"
            threadId="thr_image"
            turnId="turn_image"
            sourceSeqStart={1}
            sourceSeqEnd={2}
            showActions={false}
            mobileActionDisplay="overflow"
            text="![Generated diagram](/workspace/output/diagram.png)"
            turnRequest={null}
          />
        </RouteNavigationProvider>
      </MemoryRouter>,
    );

    expect(
      screen
        .getByRole("img", { name: "Generated diagram" })
        .getAttribute("src"),
    ).toBe(
      "/api/v1/threads/thr_image/host-files/content?path=%2Fworkspace%2Foutput%2Fdiagram.png",
    );
  });
});

describe("ConversationMessageContent assistant thread mentions", () => {
  it("renders an agent-authored thread token with the referenced thread title", () => {
    const mentionedThread = threadListEntry({
      id: "thr_xpxxt2ipz8",
      projectId: "proj_personal",
      title: "Plugin composer support on root new-thread page",
    });
    const messageDirectiveRegistry: MessageDirectiveRegistry = new Map([
      [
        "inline-vis",
        { status: "collision", pluginIds: ["plugin-a", "plugin-b"] },
      ],
    ]);

    render(
      <MemoryRouter>
        <RouteNavigationProvider>
          <ThreadTitleMentionResourcesProvider
            sectionNamesById={new Map()}
            projectNamesById={new Map()}
            threadById={new Map([[mentionedThread.id, mentionedThread]])}
          >
            <MessageDirectiveRegistryProvider
              registry={messageDirectiveRegistry}
            >
              <ConversationMessageContent
                role="assistant"
                attachments={null}
                id="msg_spawned"
                threadId="thr_parent"
                turnId="turn_spawned"
                sourceSeqStart={1}
                sourceSeqEnd={2}
                showActions={false}
                mobileActionDisplay="overflow"
                text="Spawned and parented: @thread:thr_xpxxt2ipz8"
                turnRequest={null}
              />
            </MessageDirectiveRegistryProvider>
          </ThreadTitleMentionResourcesProvider>
        </RouteNavigationProvider>
      </MemoryRouter>,
    );

    const mentionLink = screen.getByRole("link", {
      name: "Plugin composer support on root new-thread page",
    });
    expect(mentionLink.getAttribute("href")).toBe("/threads/thr_xpxxt2ipz8");
    expect(screen.queryByText("@thread", { exact: false })).toBeNull();
  });
});

describe("ConversationMessageContent long user messages", () => {
  it("renders the complete message after expanding a capped preview", () => {
    const hiddenTail = "FULL_MESSAGE_TAIL";
    const text = `${"a".repeat(USER_MESSAGE_CHAR_CAP)}\n\n${hiddenTail}`;

    render(
      <MemoryRouter>
        <RouteNavigationProvider>
          <ConversationMessageContent
            role="user"
            attachments={null}
            childOrigin={null}
            initiator="user"
            mentions={[]}
            senderThreadId={null}
            senderThreadTitle={null}
            senderIsPluginSideChat={false}
            systemMessageKind="unlabeled"
            systemMessageSubject={null}
            text={text}
            turnRequest={{
              isGrouped: false,
              kind: "message",
              status: "accepted",
            }}
          />
        </RouteNavigationProvider>
      </MemoryRouter>,
    );

    expect(screen.queryByText(hiddenTail)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show more" }));

    expect(screen.getByText(hiddenTail)).not.toBeNull();
    expect(screen.queryByText("[truncated]")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show less" }));

    expect(screen.queryByText(hiddenTail)).toBeNull();
  });
});

describe("ConversationMessageContent user thread mentions", () => {
  it("renders a raw thread token as the canonical pill when structured mentions are empty", () => {
    const mentionedThread = threadListEntry({
      id: "thr_ti4st72wgs",
      projectId: "proj_personal",
      title: "Mention pill QA thread",
    });

    render(
      <MemoryRouter>
        <RouteNavigationProvider>
          <ThreadTitleMentionResourcesProvider
            sectionNamesById={new Map()}
            projectNamesById={new Map()}
            threadById={new Map([[mentionedThread.id, mentionedThread]])}
          >
            <ConversationMessageContent
              role="user"
              attachments={null}
              childOrigin={null}
              initiator="user"
              mentions={[]}
              senderThreadId={null}
              senderThreadTitle={null}
              senderIsPluginSideChat={false}
              systemMessageKind="unlabeled"
              systemMessageSubject={null}
              text="Why was @thread:thr_ti4st72wgs not a pill?"
              turnRequest={{
                isGrouped: false,
                kind: "message",
                status: "accepted",
              }}
            />
          </ThreadTitleMentionResourcesProvider>
        </RouteNavigationProvider>
      </MemoryRouter>,
    );

    const mentionLink = screen.getByRole("link", {
      name: "Mention pill QA thread",
    });
    expect(mentionLink.getAttribute("href")).toBe("/threads/thr_ti4st72wgs");
    expect(screen.queryByText("@thread", { exact: false })).toBeNull();
  });

  it("routes a raw thread token through the target thread project", () => {
    const mentionedThread = threadListEntry({
      id: "thr_cross_project",
      projectId: "proj_target",
      title: "Cross-project mention",
    });

    render(
      <MemoryRouter>
        <RouteNavigationProvider>
          <ThreadTitleMentionResourcesProvider
            sectionNamesById={new Map()}
            projectNamesById={new Map()}
            threadById={new Map([[mentionedThread.id, mentionedThread]])}
          >
            <ConversationMessageContent
              role="user"
              attachments={null}
              childOrigin={null}
              initiator="user"
              mentions={[]}
              resolveSegmentLinkHref={(link) =>
                link.kind === "thread"
                  ? `/projects/proj_current/threads/${link.threadId}`
                  : null
              }
              senderThreadId={null}
              senderThreadTitle={null}
              senderIsPluginSideChat={false}
              systemMessageKind="unlabeled"
              systemMessageSubject={null}
              text="See @thread:thr_cross_project for the result."
              turnRequest={{
                isGrouped: false,
                kind: "message",
                status: "accepted",
              }}
            />
          </ThreadTitleMentionResourcesProvider>
        </RouteNavigationProvider>
      </MemoryRouter>,
    );

    expect(
      screen
        .getByRole("link", { name: "Cross-project mention" })
        .getAttribute("href"),
    ).toBe("/projects/proj_target/threads/thr_cross_project");
  });
});
