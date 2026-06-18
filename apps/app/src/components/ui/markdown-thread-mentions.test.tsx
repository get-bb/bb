// @vitest-environment jsdom

import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { PromptTextMention } from "@bb/domain";
import type { TimelineTitleLink } from "@bb/thread-view";
import { RouteNavigationProvider } from "@/components/ui/app-route-anchor";
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
        threadMentions={{ mentions: [], resolveLinkHref: resolveThreadLink }}
      />,
    );

    const pill = screen.getByText("thr_unknown").closest("a");
    expect(pill).not.toBeNull();
    expect(pill?.getAttribute("href")).toBe(
      "/projects/proj_demo/threads/thr_unknown",
    );
  });

  it("renders markdown structure (heading, bold, list, inline code) as real elements", () => {
    const { container } = renderMarkdown(
      <MarkdownPreview
        content={[
          "# Report",
          "",
          "Status: **done** with `pnpm test`.",
          "",
          "- item one",
          "- item two",
        ].join("\n")}
        threadMentions={{ mentions: [], resolveLinkHref: resolveThreadLink }}
      />,
    );

    expect(container.querySelector("h1")?.textContent).toBe("Report");
    expect(container.querySelector("strong")?.textContent).toBe("done");
    expect(container.querySelector("code")?.textContent).toBe("pnpm test");
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });

  it("renders markdown around a mention pill in the same body", () => {
    const { container } = renderMarkdown(
      <MarkdownPreview
        content={[
          "## Update",
          "",
          "Handed off to @thread:thr_child — see **details**.",
        ].join("\n")}
        threadMentions={{
          mentions: [THREAD_MENTION],
          resolveLinkHref: resolveThreadLink,
        }}
      />,
    );

    expect(container.querySelector("h2")?.textContent).toBe("Update");
    expect(container.querySelector("strong")?.textContent).toBe("details");
    expect(screen.getByText("Rebuild comments")).toBeTruthy();
  });

  it("breaks a single newline in a mention body onto two visual lines (remark-breaks)", () => {
    const { container } = renderMarkdown(
      <MarkdownPreview
        content={"first line\nsecond line"}
        threadMentions={{ mentions: [], resolveLinkHref: resolveThreadLink }}
      />,
    );

    // A single `\n` is a CommonMark soft break (a space); remark-breaks turns it
    // into a hard `<br>` so multi-line generated bodies don't collapse onto one
    // visual line (the prior `whitespace-pre-wrap` behavior).
    expect(container.querySelector("br")).not.toBeNull();
    expect(screen.getByText(/first line/u)).toBeTruthy();
    expect(screen.getByText(/second line/u)).toBeTruthy();
  });

  it("keeps assistant content (no threadMentions) on soft breaks — single newline is not a <br>", () => {
    const { container } = renderMarkdown(
      <MarkdownPreview content={"first line\nsecond line"} />,
    );

    // No threadMentions → unchanged `[remarkGfm]` pipeline, no remark-breaks.
    expect(container.querySelector("br")).toBeNull();
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
