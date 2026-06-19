// @vitest-environment jsdom

import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { PromptMentionResource, PromptTextMention } from "@bb/domain";
import type { TimelineTitleLink } from "@bb/thread-view";
import { RouteNavigationProvider } from "@/components/ui/app-route-anchor";
import { MarkdownPreview } from "@/components/ui/markdown-preview";
import { setPreferredTheme } from "@/hooks/useTheme";

// Pure `substitutePromptMentions` cases live in the sibling `.test.ts` (node
// env); this file covers the rendered pill output and needs jsdom.

function markdownTree(node: ReactNode) {
  return (
    <MemoryRouter>
      <RouteNavigationProvider>{node}</RouteNavigationProvider>
    </MemoryRouter>
  );
}

function renderMarkdown(node: ReactNode) {
  return render(markdownTree(node));
}

function resolveThreadLink(link: TimelineTitleLink): string | null {
  return link.kind === "thread"
    ? `/projects/proj_demo/threads/${link.threadId}`
    : null;
}

const THREAD_RESOURCE: PromptMentionResource = {
  kind: "thread",
  threadId: "thr_child",
  projectId: "proj_demo",
  label: "Rebuild comments",
};

const PATH_RESOURCE: PromptMentionResource = {
  kind: "path",
  source: "workspace",
  entryKind: "file",
  path: "src/foo_bar.ts",
  label: "foo_bar.ts",
};

const COMMAND_RESOURCE: PromptMentionResource = {
  kind: "command",
  trigger: "/",
  name: "deploy",
  source: "command",
  origin: "user",
  label: "deploy",
  argumentHint: null,
};

// Builds a mention spanning the first occurrence of `token` in `text`.
function mentionAt(
  text: string,
  token: string,
  resource: PromptMentionResource,
): PromptTextMention {
  const start = text.indexOf(token);
  if (start < 0) {
    throw new Error(`token ${token} not found in ${text}`);
  }
  return { start, end: start + token.length, resource };
}

afterEach(() => {
  cleanup();
  setPreferredTheme("system");
});

describe("MarkdownPreview prompt mentions", () => {
  it("renders a thread mention as a linked pill resolved from the offsets", () => {
    const text = "See @thread:thr_child for the report.";
    renderMarkdown(
      <MarkdownPreview
        content={text}
        promptMentions={{
          mentions: [mentionAt(text, "@thread:thr_child", THREAD_RESOURCE)],
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

  it("renders a file/path mention as an interactive pill (kept whole)", () => {
    const text = "Open @src/foo_bar.ts please.";
    renderMarkdown(
      <MarkdownPreview
        content={text}
        promptMentions={{
          mentions: [mentionAt(text, "@src/foo_bar.ts", PATH_RESOURCE)],
          resolveLinkHref: resolveThreadLink,
          resolveMentionLink: () => () => {},
        }}
      />,
    );

    // A file mention has no `@thread:` token shape, so the offset pipeline is the
    // only thing that can surface it — proving the generalization over the
    // thread-only regex path. The underscore-bearing label stays one pill.
    const labels = screen.getAllByText("foo_bar.ts");
    expect(labels).toHaveLength(1);
    expect(labels[0]?.closest("button")).not.toBeNull();
  });

  it("renders a slash-command mention as a display-only pill", () => {
    const text = "Then run /deploy to ship.";
    renderMarkdown(
      <MarkdownPreview
        content={text}
        promptMentions={{
          mentions: [mentionAt(text, "/deploy", COMMAND_RESOURCE)],
          resolveLinkHref: resolveThreadLink,
        }}
      />,
    );

    expect(screen.getByText("deploy")).toBeTruthy();
  });

  it("renders markdown structure around the mention pills", () => {
    const text = [
      "## Plan",
      "",
      "Hand off to @thread:thr_child — see **details** and `pnpm test`.",
      "",
      "- step one",
      "- step two",
    ].join("\n");
    const { container } = renderMarkdown(
      <MarkdownPreview
        content={text}
        promptMentions={{
          mentions: [mentionAt(text, "@thread:thr_child", THREAD_RESOURCE)],
          resolveLinkHref: resolveThreadLink,
        }}
      />,
    );

    expect(container.querySelector("h2")?.textContent).toBe("Plan");
    expect(container.querySelector("strong")?.textContent).toBe("details");
    expect(container.querySelector("code")?.textContent).toBe("pnpm test");
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(screen.getByText("Rebuild comments")).toBeTruthy();
  });

  it("turns a single newline into a hard break (remark-breaks)", () => {
    const { container } = renderMarkdown(
      <MarkdownPreview
        content={"first line\nsecond line"}
        promptMentions={{ mentions: [], resolveLinkHref: resolveThreadLink }}
      />,
    );

    expect(container.querySelector("br")).not.toBeNull();
  });
});
