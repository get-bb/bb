// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { PromptMentionResource, PromptTextMention } from "@bb/domain";
import type { TimelineTitleLink } from "@bb/thread-view";
import { ConversationMessageContent } from "./ConversationMessageContent";
import { RouteNavigationProvider } from "@/components/ui/app-route-anchor";
import { setPreferredTheme } from "@/hooks/useTheme";

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
  path: "src/app.ts",
  label: "app.ts",
};

function mentionAt(
  text: string,
  token: string,
  resource: PromptMentionResource,
): PromptTextMention {
  const start = text.indexOf(token);
  if (start < 0) throw new Error(`token ${token} not found`);
  return { start, end: start + token.length, resource };
}

const ACCEPTED_MESSAGE = { kind: "message", status: "accepted" } as const;

// Renders the regular (initiator="user") message bubble — the surface that now
// renders its body as markdown.
function renderUserMessage(options: {
  text: string;
  mentions?: readonly PromptTextMention[];
  resolveMentionLink?: (resource: PromptMentionResource) => (() => void) | null;
}) {
  return render(
    <MemoryRouter>
      <RouteNavigationProvider>
        <ConversationMessageContent
          role="user"
          initiator="user"
          childOrigin={null}
          senderThreadId={null}
          senderThreadTitle={null}
          senderChildOrigin={null}
          resolveSegmentLinkHref={resolveThreadLink}
          resolveMentionLink={options.resolveMentionLink}
          systemMessageKind="unlabeled"
          systemMessageSubject={null}
          attachments={null}
          mentions={options.mentions ?? []}
          projectId="proj_demo"
          turnRequest={ACCEPTED_MESSAGE}
          text={options.text}
        />
      </RouteNavigationProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  setPreferredTheme("system");
});

describe("ConversationMessageContent user message markdown", () => {
  it("renders markdown structure (heading, bold, list, inline code) as elements", () => {
    const { container } = renderUserMessage({
      text: [
        "# Plan",
        "",
        "Status: **done** with `pnpm test`.",
        "",
        "- one",
        "- two",
      ].join("\n"),
    });

    expect(container.querySelector("h1")?.textContent).toBe("Plan");
    expect(container.querySelector("strong")?.textContent).toBe("done");
    expect(container.querySelector("code")?.textContent).toBe("pnpm test");
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });

  it("renders thread and file mentions as pills", () => {
    const text = "Ask @thread:thr_child to check @src/app.ts.";
    renderUserMessage({
      text,
      mentions: [
        mentionAt(text, "@thread:thr_child", THREAD_RESOURCE),
        mentionAt(text, "@src/app.ts", PATH_RESOURCE),
      ],
      resolveMentionLink: () => () => {},
    });

    const threadPill = screen.getByText("Rebuild comments").closest("a");
    expect(threadPill?.getAttribute("href")).toBe(
      "/projects/proj_demo/threads/thr_child",
    );
    expect(screen.getByText("app.ts").closest("button")).not.toBeNull();
  });

  it("renders a `> ` line as a blockquote", () => {
    const { container } = renderUserMessage({
      text: "> quoted context\nand a reply",
    });
    expect(container.querySelector("blockquote")).not.toBeNull();
    expect(screen.getByText(/quoted context/u)).toBeTruthy();
  });

  it("wraps the body in a message bubble", () => {
    const { container } = renderUserMessage({ text: "hello there" });
    const bubble = container.querySelector(".bg-surface-recessed");
    expect(bubble).not.toBeNull();
    expect(bubble?.textContent).toContain("hello there");
  });

  it("renders a plain (non-markdown) message as its text", () => {
    renderUserMessage({ text: "just a normal sentence" });
    expect(screen.getByText("just a normal sentence")).toBeTruthy();
  });
});
