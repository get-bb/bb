// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { TimelineTitleLink } from "@bb/thread-view";
import { ConversationMessageContent } from "./ConversationMessageContent";
import { RouteNavigationProvider } from "@/components/ui/app-route-anchor";
import type { TimelineTitleActionResolver } from "./TimelineTitleView";

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
  vi.unstubAllGlobals();
});

// An agent-generated body that carries an offset-based `path` mention and a
// leading `#` (markdown heading syntax). The agent path must NOT route through
// markdown — it keeps the offset renderer — so the `#` stays literal text and
// the path mention still renders.
const AGENT_BODY = "# notes\nedited path:src/app.ts here";
const AGENT_PATH_TOKEN = "path:src/app.ts";
const AGENT_PATH_START = AGENT_BODY.indexOf(AGENT_PATH_TOKEN);
const OVERFLOWING_ONE_LINE_AGENT_BODY =
  "TEST RESULT refines the diagnosis — RULE OUT eviction. A fire-and-forget direct POST with no wait parameter and no client-held stream should still render the complete report after expansion.";

function renderAgentMessage(
  text = AGENT_BODY,
  {
    senderChildOrigin,
    senderThreadTitle = "Worker",
    onTitleAction,
  }: {
    onTitleAction?: TimelineTitleActionResolver;
    senderChildOrigin?: "side-chat" | null;
    senderThreadTitle?: string;
  } = {},
) {
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
          senderThreadTitle={senderThreadTitle}
          senderChildOrigin={senderChildOrigin ?? null}
          onTitleAction={onTitleAction}
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

function mockContinuationSensitiveOverflow(): () => void {
  const resizeCallbacks: Array<() => void> = [];

  class ResizeObserverMock {
    constructor(callback: ResizeObserverCallback) {
      resizeCallbacks.push(() =>
        callback([], this as unknown as ResizeObserver),
      );
    }

    observe(): void {}
    disconnect(): void {}
  }

  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(20);
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(20);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(
    function clientWidth(this: HTMLElement) {
      const continuation = Array.from(this.parentElement?.children ?? []).find(
        (child) => child.textContent === "...",
      );
      return continuation ? 90 : 100;
    },
  );
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(100);

  return () => {
    act(() => {
      for (const callback of resizeCallbacks) callback();
    });
  };
}

describe("GeneratedConversationMessage markdown body", () => {
  it("renders the source as a thread pill with title mentions resolved to display text", () => {
    const { container } = renderAgentMessage(AGENT_BODY, {
      senderThreadTitle:
        "Ask @thread:thr_target. Review @docs/foo.test.ts. Keep @owner/repo literal",
    });

    const sourcePill = container.querySelector(
      '[data-prompt-mention-serialized-text="@thread:thr_agent"]',
    );
    expect(sourcePill).not.toBeNull();
    expect(sourcePill?.textContent).toBe(
      "Ask thr_target. Review foo.test.ts. Keep @owner/repo literal",
    );
    expect(screen.queryByText(/@thread:thr_target/u)).toBeNull();
    expect(sourcePill?.className).toContain("prompt-mention-pill");
    expect(sourcePill?.tagName).toBe("A");
    expect(sourcePill?.getAttribute("href")).toBe(
      "/projects/proj_demo/threads/thr_agent",
    );
  });

  it("keeps the agent body on the offset renderer (no markdown, no <br>) and renders its path mention", () => {
    renderAgentMessage();

    fireEvent.click(screen.getByRole("button", { name: /Message from/u }));

    expect(screen.getByText(/# notes/u)).toBeTruthy();
    expect(screen.getByText("src/app.ts")).toBeTruthy();
  });

  it("expands a one-line agent message when its preview text overflows", () => {
    mockInnerPreviewTextOverflow(OVERFLOWING_ONE_LINE_AGENT_BODY);
    renderAgentMessage(OVERFLOWING_ONE_LINE_AGENT_BODY);

    const toggle = screen.getByRole("button", { name: /Message from Worker/u });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("...").className).toContain("invisible");

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(OVERFLOWING_ONE_LINE_AGENT_BODY)).toBeTruthy();
  });

  it("renders side-chat handoffs as markdown", () => {
    const openSideChat = vi.fn();
    renderAgentMessage("**Ready** to merge.\n\n- checks passed", {
      senderChildOrigin: "side-chat",
      onTitleAction: (action) =>
        action.kind === "open-side-chat" ? openSideChat : null,
    });

    expect(screen.getByText("Ready").tagName).toBe("STRONG");
    expect(screen.queryByText("**Ready** to merge.")).toBeNull();

    const toggle = screen.getByRole("button", {
      name: /Message from side chat/u,
    });
    fireEvent.click(screen.getByRole("link", { name: "side chat" }));
    expect(openSideChat).toHaveBeenCalledOnce();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(toggle);

    expect(screen.getByRole("list").textContent).toContain("checks passed");
  });
});

describe("GeneratedConversationMessage markdown body (system)", () => {
  it("keeps the continuation width stable when it makes the preview overflow", () => {
    const notifyResize = mockContinuationSensitiveOverflow();
    renderChildCompleted();

    const continuation = screen.getByText("...");
    expect(continuation.className).toContain("invisible");

    notifyResize();
    notifyResize();

    expect(screen.getByText("...")).toBe(continuation);
    expect(continuation.className).toContain("invisible");
  });

  it("shows a first-line preview and reveals the rest when expanded", () => {
    renderChildCompleted();

    expect(screen.getByText("Final report")).toBeTruthy();
    expect(screen.queryByText("migration landed")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: /Rebuild comments finished/u }),
    );

    expect(screen.getByText("migration landed")).toBeTruthy();
  });
});
