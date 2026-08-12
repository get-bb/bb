// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { PromptTextMention } from "@bb/domain";
import type { ThreadResponse } from "@bb/server-contract";
import type { TimelineTitleLink } from "@bb/thread-view";
import { RouteNavigationProvider } from "@/components/ui/app-route-anchor";
import {
  type MarkdownMessageDirectives,
  type MessageDirectiveRegistry,
} from "@/components/ui/markdown-message-directives";
import { MarkdownPreview } from "@/components/ui/markdown-preview";
import { threadQueryKey } from "@/hooks/queries/query-keys";
import { setPreferredTheme } from "@/hooks/useTheme";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";

function markdownTree(node: ReactNode) {
  return (
    <MemoryRouter>
      <RouteNavigationProvider>{node}</RouteNavigationProvider>
    </MemoryRouter>
  );
}

function resolveThreadLink(link: TimelineTitleLink): string | null {
  return link.kind === "thread"
    ? `/projects/proj_demo/threads/${link.threadId}`
    : null;
}

function resolveUpdatedThreadLink(link: TimelineTitleLink): string | null {
  return link.kind === "thread"
    ? `/projects/proj_demo/threads/${link.threadId}?updated=1`
    : null;
}

function threadResponse(
  overrides: Partial<ThreadResponse> = {},
): ThreadResponse {
  return {
    id: "thr_child",
    projectId: "proj_demo",
    environmentId: null,
    providerId: "codex",
    title: "Rebuild comments",
    titleFallback: "Rebuild comments",
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
    deletedAt: null,
    lastReadAt: 0,
    latestAttentionAt: 1,
    createdAt: 1,
    updatedAt: 1,
    runtime: {
      displayStatus: "idle",
      hostReconnectGraceExpiresAt: null,
    },
    activeBackgroundAgentCount: 0,
    canSpawnChild: true,
    ...overrides,
  };
}

function renderMarkdown(
  node: ReactNode,
  cachedThreads: readonly ThreadResponse[] = [threadResponse()],
) {
  const { queryClient, wrapper } = createQueryClientTestHarness();
  for (const thread of cachedThreads) {
    queryClient.setQueryData(threadQueryKey(thread.id), thread);
  }
  return {
    ...render(markdownTree(node), { wrapper }),
    queryClient,
  };
}

const THREAD_MENTION: PromptTextMention = {
  start: 0,
  end: "@thread:thr_child".length,
  resource: {
    kind: "thread",
    threadId: "thr_child",
    projectId: "proj_demo",
    label: "Rebuild comments",
  },
};

const UPDATED_THREAD_MENTION: PromptTextMention = {
  ...THREAD_MENTION,
  resource: {
    ...THREAD_MENTION.resource,
    label: "Updated child",
  },
};

const MESSAGE_DIRECTIVE_REGISTRY: MessageDirectiveRegistry = new Map([
  ["inline-vis", { status: "collision", pluginIds: ["plugin-a", "plugin-b"] }],
]);

const ACTIVE_MESSAGE_DIRECTIVES: MarkdownMessageDirectives = {
  registry: MESSAGE_DIRECTIVE_REGISTRY,
  message: {
    id: "msg_thread_mention",
    threadId: "thr_parent",
    turnId: "turn_thread_mention",
    projectId: "proj_demo",
  },
  openWorkspaceFile: null,
  openThreadPanel: null,
};

afterEach(() => {
  cleanup();
  setPreferredTheme("system");
});

describe("MarkdownPreview thread mentions", () => {
  it("resolves and links a thread absent from sidebar resources through the authoritative thread query", () => {
    const queriedThread = threadResponse({
      id: "thr_archived",
      projectId: "proj_archive",
      title: "Archived investigation",
      titleFallback: "Archived investigation",
      archivedAt: 10,
    });
    renderMarkdown(
      <MarkdownPreview
        content="See @thread:thr_archived for the report."
        threadMentions={{
          mentions: [],
          preserveSoftBreaks: true,
        }}
      />,
      [queriedThread],
    );

    const pill = screen.getByText("Archived investigation").closest("a");
    expect(pill).not.toBeNull();
    expect(pill?.getAttribute("href")).toBe(
      "/projects/proj_archive/threads/thr_archived",
    );
  });

  it("updates rendered mention pills when thread mention props change without content changing", () => {
    const { queryClient, rerender } = renderMarkdown(
      <MarkdownPreview
        content="See @thread:thr_child for the report."
        threadMentions={{
          mentions: [THREAD_MENTION],
          preserveSoftBreaks: true,
          resolveLinkHref: resolveThreadLink,
        }}
      />,
    );

    expect(screen.getByText("Rebuild comments")).toBeTruthy();

    act(() => {
      queryClient.setQueryData(
        threadQueryKey("thr_child"),
        threadResponse({ title: "Updated child" }),
      );
    });

    rerender(
      markdownTree(
        <MarkdownPreview
          content="See @thread:thr_child for the report."
          threadMentions={{
            mentions: [UPDATED_THREAD_MENTION],
            preserveSoftBreaks: true,
            resolveLinkHref: resolveUpdatedThreadLink,
          }}
        />,
      ),
    );

    expect(screen.queryByText("Rebuild comments")).toBeNull();
    const pill = screen.getByText("Updated child").closest("a");
    expect(pill).not.toBeNull();
    expect(pill?.getAttribute("href")).toBe(
      "/projects/proj_demo/threads/thr_child?updated=1",
    );
  });

  it("falls back to the thread id when no mention resource matches", () => {
    renderMarkdown(
      <MarkdownPreview
        content="See @thread:thr_unknown please."
        threadMentions={{
          mentions: [],
          preserveSoftBreaks: true,
          resolveLinkHref: resolveThreadLink,
        }}
      />,
      [
        threadResponse({
          id: "thr_unknown",
          title: "thr_unknown",
          titleFallback: "thr_unknown",
        }),
      ],
    );

    const pill = screen.getByText("thr_unknown").closest("a");
    expect(pill).not.toBeNull();
    expect(pill?.getAttribute("href")).toBe(
      "/projects/proj_demo/threads/thr_unknown",
    );
  });

  it("leaves a labeled text directive on the authored directive rendering path", () => {
    const { container } = renderMarkdown(
      <MarkdownPreview
        content="@thread:thr_child[label]"
        threadMentions={{
          mentions: [THREAD_MENTION],
          preserveSoftBreaks: true,
          resolveLinkHref: resolveThreadLink,
        }}
        messageDirectives={ACTIVE_MESSAGE_DIRECTIVES}
      />,
    );

    // The token is not a mention here, so it stays verbatim prose — one text
    // node, no pill and no directive mount.
    const paragraph = container.querySelector("p");
    expect(paragraph?.textContent).toBe("@thread:thr_child[label]");
    expect(paragraph?.querySelector("a")).toBeNull();
    expect(screen.queryByText("Rebuild comments")).toBeNull();
  });

  it("leaves an attributed text directive on the authored directive rendering path", () => {
    const { container } = renderMarkdown(
      <MarkdownPreview
        content="@thread:thr_child{#authored-directive}"
        threadMentions={{
          mentions: [THREAD_MENTION],
          preserveSoftBreaks: true,
          resolveLinkHref: resolveThreadLink,
        }}
        messageDirectives={ACTIVE_MESSAGE_DIRECTIVES}
      />,
    );

    const paragraph = container.querySelector("p");
    expect(paragraph?.textContent).toBe(
      "@thread:thr_child{#authored-directive}",
    );
    expect(paragraph?.querySelector("a")).toBeNull();
    expect(screen.queryByText("Rebuild comments")).toBeNull();
  });

  it("leaves a raw thread token inside an authored Markdown link", () => {
    renderMarkdown(
      <MarkdownPreview
        content="[@thread:thr_child](https://example.com)"
        threadMentions={{
          mentions: [THREAD_MENTION],
          preserveSoftBreaks: true,
          resolveLinkHref: resolveThreadLink,
        }}
      />,
    );

    const link = screen.getByRole("link", { name: "@thread:thr_child" });
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.queryByText("Rebuild comments")).toBeNull();
  });

  it("reconstructs a directive-split thread token inside an authored Markdown link", () => {
    renderMarkdown(
      <MarkdownPreview
        content="[@thread:thr_child](https://example.com)"
        threadMentions={{
          mentions: [THREAD_MENTION],
          preserveSoftBreaks: true,
          resolveLinkHref: resolveThreadLink,
        }}
        messageDirectives={ACTIVE_MESSAGE_DIRECTIVES}
      />,
    );

    const link = screen.getByRole("link", { name: "@thread:thr_child" });
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.queryByText("Rebuild comments")).toBeNull();
  });

  it("leaves assistant content (no mentions prop) untouched — token stays literal", () => {
    renderMarkdown(
      <MarkdownPreview content="See @thread:thr_child for the report." />,
    );

    // No mentions prop → no remark plugin → token is plain text, no pill anchor.
    expect(screen.queryByText("Rebuild comments")).toBeNull();
    expect(
      screen.getByText(/@thread:thr_child/u, { exact: false }),
    ).toBeTruthy();
  });

  it.each([
    ["without message directives", undefined],
    ["with message directives", ACTIVE_MESSAGE_DIRECTIVES],
  ])("uses complete token boundaries %s", (_label, messageDirectives) => {
    const content =
      "foo@thread:thr_embedded @thread:thr_continued/path @thread:thr_child";
    const { container } = renderMarkdown(
      <MarkdownPreview
        content={content}
        threadMentions={{
          mentions: [THREAD_MENTION],
          preserveSoftBreaks: true,
          resolveLinkHref: resolveThreadLink,
        }}
        messageDirectives={messageDirectives}
      />,
    );

    expect(screen.getAllByText("Rebuild comments")).toHaveLength(1);
    expect(container.textContent).toContain("foo@thread:thr_embedded");
    expect(container.textContent).toContain("@thread:thr_continued/path");
  });
});
