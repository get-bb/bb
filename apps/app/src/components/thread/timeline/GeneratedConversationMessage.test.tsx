// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { TimelineTitleLink } from "@bb/thread-view";
import { ConversationMessageContent } from "./ConversationMessageContent";
import { RouteNavigationProvider } from "@/components/ui/app-route-anchor";

function resolveThreadLink(link: TimelineTitleLink): string | null {
  return link.kind === "thread"
    ? `/projects/proj_demo/threads/${link.threadId}`
    : null;
}

const MARKDOWN_BODY = [
  "# Final report",
  "",
  "Status: **done**. Handed off to @thread:thr_child.",
  "",
  "- migration landed",
  "- `pnpm test` green",
].join("\n");

function renderChildCompleted() {
  const token = "@thread:thr_child";
  const start = MARKDOWN_BODY.indexOf(token);
  return render(
    <MemoryRouter>
      <RouteNavigationProvider>
        <ConversationMessageContent
          role="user"
          initiator="system"
          childOrigin={null}
          senderThreadId={null}
          senderThreadTitle={null}
          senderChildOrigin={null}
          resolveSegmentLinkHref={resolveThreadLink}
          systemMessageKind="child-completed"
          systemMessageSubject={{
            kind: "thread",
            threadId: "thr_child",
            threadName: "Rebuild comments",
          }}
          attachments={null}
          mentions={[
            {
              start,
              end: start + token.length,
              resource: {
                kind: "thread",
                threadId: "thr_child",
                projectId: "proj_demo",
                label: "Rebuild comments",
              },
            },
          ]}
          text={MARKDOWN_BODY}
          turnRequest={{ kind: "message", status: "accepted" }}
          projectId="proj_demo"
        />
      </RouteNavigationProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const TWO_LINE_BODY = "first report line\nsecond report line";

function renderChildCompletedBody(
  text: string,
  onOpenLink?: (link: { href: string }) => boolean,
) {
  return render(
    <MemoryRouter>
      <RouteNavigationProvider>
        <ConversationMessageContent
          role="user"
          initiator="system"
          childOrigin={null}
          senderThreadId={null}
          senderThreadTitle={null}
          senderChildOrigin={null}
          resolveSegmentLinkHref={resolveThreadLink}
          systemMessageKind="child-completed"
          systemMessageSubject={{
            kind: "thread",
            threadId: "thr_child",
            threadName: "Rebuild comments",
          }}
          attachments={null}
          mentions={[]}
          onOpenLink={onOpenLink}
          text={text}
          turnRequest={{ kind: "message", status: "accepted" }}
          projectId="proj_demo"
        />
      </RouteNavigationProvider>
    </MemoryRouter>,
  );
}

// An agent-generated body that carries an offset-based `path` mention and a
// leading `#` (markdown heading syntax). The agent path must NOT route through
// markdown — it keeps the offset renderer — so the `#` stays literal text and
// the path mention still renders.
const AGENT_BODY = "# notes\nedited path:src/app.ts here";
const AGENT_PATH_TOKEN = "path:src/app.ts";
const AGENT_PATH_START = AGENT_BODY.indexOf(AGENT_PATH_TOKEN);
const OVERFLOWING_ONE_LINE_AGENT_BODY =
  "TEST RESULT refines the diagnosis — RULE OUT eviction. A fire-and-forget direct POST with no wait parameter and no client-held stream should still render the complete report after expansion.";

function renderAgentMessage(text = AGENT_BODY) {
  const mentions =
    text === AGENT_BODY
      ? [
          {
            start: AGENT_PATH_START,
            end: AGENT_PATH_START + AGENT_PATH_TOKEN.length,
            resource: {
              kind: "path" as const,
              source: "workspace" as const,
              entryKind: "file" as const,
              path: "src/app.ts",
              label: "src/app.ts",
            },
          },
        ]
      : [];

  return render(
    <MemoryRouter>
      <RouteNavigationProvider>
        <ConversationMessageContent
          role="user"
          initiator="agent"
          childOrigin={null}
          senderThreadId="thr_agent"
          senderThreadTitle="Worker"
          senderChildOrigin={null}
          resolveSegmentLinkHref={resolveThreadLink}
          systemMessageKind="unlabeled"
          systemMessageSubject={null}
          attachments={null}
          mentions={mentions}
          text={text}
          turnRequest={{ kind: "message", status: "accepted" }}
          projectId="proj_demo"
        />
      </RouteNavigationProvider>
    </MemoryRouter>,
  );
}

function mockInnerPreviewTextOverflow(text: string): void {
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(20);
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(20);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(100);
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(
    function scrollWidth(this: HTMLElement) {
      return this.tagName === "SPAN" && this.textContent === text ? 240 : 100;
    },
  );
}

describe("GeneratedConversationMessage markdown body", () => {
  it("renders a single-newline system body on two visual lines (remark-breaks)", () => {
    const { container } = renderChildCompletedBody(TWO_LINE_BODY);

    fireEvent.click(
      screen.getByRole("button", { name: /Rebuild comments finished/u }),
    );

    // remark-breaks turns the single `\n` into a hard <br>, so the two lines
    // don't collapse onto one (the prior `whitespace-pre-wrap` behavior).
    expect(container.querySelector("br")).not.toBeNull();
    expect(screen.getByText(/first report line/u)).toBeTruthy();
    expect(screen.getByText(/second report line/u)).toBeTruthy();
  });

  it("keeps the agent body on the offset renderer (no markdown, no <br>) and renders its path mention", () => {
    const { container } = renderAgentMessage();

    fireEvent.click(screen.getByRole("button", { name: /Message from/u }));

    // Offset renderer: markdown is not parsed (leading `#` stays literal text,
    // no <h1>) and remark-breaks does not run (no <br>).
    expect(container.querySelector("h1")).toBeNull();
    expect(container.querySelector("br")).toBeNull();
    expect(container.querySelector("p.whitespace-pre-wrap")).not.toBeNull();

    // The offset-based `path` mention is preserved (would regress to plain text
    // under the markdown path, which only understands `@thread:<id>` tokens).
    expect(screen.getByText("src/app.ts")).toBeTruthy();
  });

  it("expands a one-line agent message when its preview text overflows", () => {
    mockInnerPreviewTextOverflow(OVERFLOWING_ONE_LINE_AGENT_BODY);
    const { container } = renderAgentMessage(OVERFLOWING_ONE_LINE_AGENT_BODY);

    const toggle = screen.getByRole("button", { name: /Message from Worker/u });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("...")).toBeNull();

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector("p.whitespace-pre-wrap")?.textContent).toBe(
      OVERFLOWING_ONE_LINE_AGENT_BODY,
    );
  });
});

describe("GeneratedConversationMessage markdown body (system)", () => {
  it("renders the collapsed preview as markdown, first line only", () => {
    const { container } = renderChildCompleted();

    // Collapsed: the first body line renders as markdown (the heading element
    // is present, flattened inline by COLLAPSED_MARKDOWN_PREVIEW_CLASS) rather
    // than showing the raw `# Final report` source...
    expect(container.querySelector("h1")?.textContent).toBe("Final report");
    // ...but only the first line shows — later-line block nodes (the list) are
    // not rendered until the row is expanded.
    expect(container.querySelector("li")).toBeNull();
  });

  it("renders the expanded body as markdown with a linked mention pill", () => {
    const { container } = renderChildCompleted();

    fireEvent.click(
      screen.getByRole("button", { name: /Rebuild comments finished/u }),
    );

    // Expanded: real markdown elements.
    expect(container.querySelector("h1")?.textContent).toBe("Final report");
    expect(container.querySelector("strong")?.textContent).toBe("done");
    expect(container.querySelector("code")?.textContent).toBe("pnpm test");
    expect(container.querySelectorAll("li")).toHaveLength(2);

    // The @thread token rendered as a linked pill via resolveSegmentLinkHref.
    const pill = screen.getAllByText("Rebuild comments").find((node) =>
      node.closest("a"),
    );
    expect(pill?.closest("a")?.getAttribute("href")).toBe(
      "/projects/proj_demo/threads/thr_child",
    );
  });

  it("routes system markdown web links through the shared open-link handler", () => {
    const onOpenLink = vi.fn(() => true);
    renderChildCompletedBody(
      "Generated summary\n\n[Docs](https://example.com/docs)",
      onOpenLink,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /Rebuild comments finished/u }),
    );
    fireEvent.click(screen.getByRole("link", { name: "Docs" }));

    expect(onOpenLink).toHaveBeenCalledWith({
      href: "https://example.com/docs",
    });
  });
});
