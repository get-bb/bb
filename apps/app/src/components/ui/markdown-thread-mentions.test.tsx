// @vitest-environment jsdom

import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { PromptTextMention } from "@bb/domain";
import type { TimelineTitleLink } from "@bb/thread-view";
import { RouteNavigationProvider } from "@/components/ui/app-route-anchor";
import {
  type MarkdownMessageDirectives,
  type MessageDirectiveRegistry,
} from "@/components/ui/markdown-message-directives";
import { MarkdownPreview } from "@/components/ui/markdown-preview";
import { setPreferredTheme } from "@/hooks/useTheme";

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

function renderMarkdown(node: ReactNode) {
  return render(markdownTree(node));
}

function expectDisplayOnlyPill(label: string): void {
  const labelNode = screen.getByText(label);
  const pill = labelNode.closest<HTMLElement>("[data-prompt-mention]");
  expect(pill).not.toBeNull();
  expect(pill?.closest("a")).toBeNull();
  expect(pill?.classList.contains("font-normal")).toBe(true);
  expect(pill?.classList.contains("cursor-default")).toBe(true);
  expect(pill?.classList.contains("cursor-pointer")).toBe(false);
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
  it("renders an @thread token inside a markdown body as a linked pill", () => {
    renderMarkdown(
      <MarkdownPreview
        content="See @thread:thr_child for the report."
        threadMentions={{
          mentions: [THREAD_MENTION],
          preserveSoftBreaks: true,
          resolveLinkHref: resolveThreadLink,
        }}
      />,
    );

    const pill = screen.getByText("Rebuild comments").closest("a");
    expect(pill).not.toBeNull();
    expect(pill?.getAttribute("href")).toBe(
      "/projects/proj_demo/threads/thr_child",
    );
  });

  it("updates rendered mention pills when thread mention props change without content changing", () => {
    const { rerender } = renderMarkdown(
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
    );

    const pill = screen.getByText("thr_unknown").closest("a");
    expect(pill).not.toBeNull();
    expect(pill?.getAttribute("href")).toBe(
      "/projects/proj_demo/threads/thr_unknown",
    );
  });

  it("leaves a labeled text directive on the authored directive rendering path", () => {
    renderMarkdown(
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

    expect(screen.getByText("@thread")).toBeTruthy();
    expect(screen.getByText("label")).toBeTruthy();
    expect(screen.queryByText("Rebuild comments")).toBeNull();
  });

  it("leaves an attributed text directive on the authored directive rendering path", () => {
    renderMarkdown(
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

    expect(screen.getByText("@thread")).toBeTruthy();
    expect(screen.queryByText("Rebuild comments")).toBeNull();
  });

  it("lifts a non-interactive thread pill out of an authored Markdown link", () => {
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

    expectDisplayOnlyPill("Rebuild comments");
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText("@thread:thr_child")).toBeNull();
  });

  it("lifts a directive-split thread pill out of an authored Markdown link", () => {
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

    expectDisplayOnlyPill("Rebuild comments");
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText("@thread:thr_child")).toBeNull();
  });

  it("lifts a non-interactive thread pill out of an authored Markdown link reference", () => {
    renderMarkdown(
      <MarkdownPreview
        content={
          "[@thread:thr_child][reference]\n\n[reference]: https://example.com"
        }
        threadMentions={{
          mentions: [THREAD_MENTION],
          preserveSoftBreaks: true,
          resolveLinkHref: resolveThreadLink,
        }}
      />,
    );

    expectDisplayOnlyPill("Rebuild comments");
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText("@thread:thr_child")).toBeNull();
  });

  it("lifts a directive-split thread pill out of a link reference", () => {
    renderMarkdown(
      <MarkdownPreview
        content={
          "[@thread:thr_child][reference]\n\n[reference]: https://example.com"
        }
        threadMentions={{
          mentions: [THREAD_MENTION],
          preserveSoftBreaks: true,
          resolveLinkHref: resolveThreadLink,
        }}
        messageDirectives={ACTIVE_MESSAGE_DIRECTIVES}
      />,
    );

    expectDisplayOnlyPill("Rebuild comments");
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText("@thread:thr_child")).toBeNull();
  });

  it("preserves surrounding authored link text while lifting the mention pill", () => {
    renderMarkdown(
      <MarkdownPreview
        content="[Read @thread:thr_child details](https://example.com)"
        threadMentions={{
          mentions: [THREAD_MENTION],
          preserveSoftBreaks: true,
          resolveLinkHref: resolveThreadLink,
        }}
      />,
    );

    expectDisplayOnlyPill("Rebuild comments");
    expect(
      screen.getByRole("link", { name: "Read" }).getAttribute("href"),
    ).toBe("https://example.com");
    expect(
      screen.getByRole("link", { name: "details" }).getAttribute("href"),
    ).toBe("https://example.com");
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });

  it("lifts a non-interactive thread pill out of formatted authored link text", () => {
    renderMarkdown(
      <MarkdownPreview
        content="[**@thread:thr_child**](https://example.com)"
        threadMentions={{
          mentions: [THREAD_MENTION],
          preserveSoftBreaks: true,
          resolveLinkHref: resolveThreadLink,
        }}
      />,
    );

    expectDisplayOnlyPill("Rebuild comments");
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText("@thread:thr_child")).toBeNull();
  });

  it("lifts a directive-split thread pill out of a formatted link reference", () => {
    renderMarkdown(
      <MarkdownPreview
        content={
          "[*@thread:thr_child*][reference]\n\n[reference]: https://example.com"
        }
        threadMentions={{
          mentions: [THREAD_MENTION],
          preserveSoftBreaks: true,
          resolveLinkHref: resolveThreadLink,
        }}
        messageDirectives={ACTIVE_MESSAGE_DIRECTIVES}
      />,
    );

    expectDisplayOnlyPill("Rebuild comments");
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText("@thread:thr_child")).toBeNull();
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
});
