// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { PromptMentionResource } from "@bb/domain";
import { ConversationMessageContent } from "./ConversationMessageContent";
import { USER_MESSAGE_CHAR_CAP } from "./conversation-message-limits";
import {
  installDriveableResizeObserver,
  installElementOverflowMetrics,
  restoreElementOverflowMetrics,
} from "./conversation-message-overflow.test-utils";
import { AppRouteNavigationProvider } from "@/components/ui/app-route-anchor";

interface LocationProbeProps {
  label: string;
}

function LocationProbe({ label }: LocationProbeProps) {
  const location = useLocation();
  return (
    <span data-testid={label}>
      {location.pathname}
      {location.search}
      {location.hash}
    </span>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ConversationMessageContent", () => {
  it("routes assistant web links through onOpenLink and prevents default", () => {
    const onOpenLink = vi.fn(() => true);
    render(
      <ConversationMessageContent
        role="assistant"
        attachments={null}
        text="[Docs](https://example.com/docs)"
        turnRequest={null}
        onOpenLink={onOpenLink}
      />,
    );

    const link = screen.getByRole("link", { name: "Docs" });
    const notDefaultPrevented = fireEvent.click(link);

    expect(onOpenLink).toHaveBeenCalledTimes(1);
    expect(onOpenLink).toHaveBeenCalledWith({
      href: "https://example.com/docs",
    });
    expect(notDefaultPrevented).toBe(false);
  });

  it("routes assistant local file links with line fragments through onOpenLocalFileLink", () => {
    const onOpenLocalFileLink = vi.fn(() => true);
    render(
      <ConversationMessageContent
        role="assistant"
        attachments={null}
        text="[File](file:///Users/michael/.bb-dev/projects-bb-492f14c06eb6/worktrees/env_ncc55uc2cs/bb/apps/app/src/components/sidebar/ProjectList.test.tsx#L327-L330)"
        turnRequest={null}
        onOpenLocalFileLink={onOpenLocalFileLink}
      />,
    );

    const notDefaultPrevented = fireEvent.click(
      screen.getByRole("link", { name: "File" }),
    );

    expect(onOpenLocalFileLink).toHaveBeenCalledWith({
      lineRange: { startLineNumber: 327, endLineNumber: 330 },
      path: "/Users/michael/.bb-dev/projects-bb-492f14c06eb6/worktrees/env_ncc55uc2cs/bb/apps/app/src/components/sidebar/ProjectList.test.tsx",
    });
    expect(notDefaultPrevented).toBe(false);
  });

  it("renders user message content as plain text with no link surface", () => {
    render(
      <ConversationMessageContent
        role="user"
        initiator="user"
        senderThreadId={null}
        senderThreadTitle={null}
        attachments={null}
        mentions={[]}
        text="Visit https://example.com/docs"
        turnRequest={{ kind: "message", status: "accepted" }}
      />,
    );

    // User messages are plain text (CollapsibleMessageText), never markdown —
    // so there is no anchor to route, which is why `onOpenLink` is assistant
    // only and the user variant does not accept it.
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Visit https://example.com/docs")).toBeTruthy();
  });

  it("renders user message thread mentions as router links", () => {
    const token = "@thread:thr_parent";
    const resource: PromptMentionResource = {
      kind: "thread",
      threadId: "thr_parent",
      projectId: "proj_target",
      label: "Prompt UX thread",
    };
    render(
      <MemoryRouter>
        <ConversationMessageContent
          role="user"
          initiator="user"
          senderThreadId={null}
          senderThreadTitle={null}
          attachments={null}
          mentions={[
            {
              start: 4,
              end: `Ask ${token}`.length,
              resource,
            },
          ]}
          projectId="proj_current"
          text={`Ask ${token} to review this.`}
          turnRequest={{ kind: "message", status: "accepted" }}
        />
      </MemoryRouter>,
    );

    // The pill's accessible name is the resource label; the serialized form
    // stays available as data attributes for editor round-tripping.
    const mention = screen.getByRole("link", {
      name: "Prompt UX thread",
    });
    expect(mention.getAttribute("title")).toBe("Thread: Prompt UX thread");
    expect(mention.getAttribute("href")).toBe(
      "/projects/proj_target/threads/thr_parent",
    );
    expect(mention.getAttribute("data-prompt-mention")).toBe("true");
    expect(
      mention.getAttribute("data-prompt-mention-serialized-text"),
    ).toBe(token);
    expect(mention.getAttribute("data-prompt-mention-resource")).toBe(
      JSON.stringify(resource),
    );
  });

  it("renders user message file mentions as display-only pills with full path hover title", () => {
    render(
      <ConversationMessageContent
        role="user"
        initiator="user"
        senderThreadId={null}
        senderThreadTitle={null}
        attachments={null}
        mentions={[
          {
            start: 5,
            end: 26,
            resource: {
              kind: "path",
              source: "workspace",
              entryKind: "file",
              path: "apps/app/src/App.tsx",
              label: "App.tsx",
            },
          },
        ]}
        text="Open @apps/app/src/App.tsx"
        turnRequest={{ kind: "message", status: "accepted" }}
      />,
    );

    const pill = screen
      .getByText("App.tsx")
      .closest('[data-prompt-mention="true"]');
    expect(pill?.tagName).toBe("SPAN");
    expect(pill?.getAttribute("title")).toBe("apps/app/src/App.tsx");
    expect(screen.queryByRole("button", { name: "App.tsx" })).toBeNull();
    expect(screen.queryByRole("link", { name: "App.tsx" })).toBeNull();
  });

  it("clips user message text before a mention that crosses the visible boundary", () => {
    const token = "@partial-visible-thread-token";
    const visibleTokenLength = 8;
    const prefix = "x".repeat(USER_MESSAGE_CHAR_CAP - visibleTokenLength);
    const text = `${prefix}${token} after`;
    const start = text.indexOf(token);

    const { container } = render(
      <MemoryRouter>
        <ConversationMessageContent
          role="user"
          initiator="user"
          senderThreadId={null}
          senderThreadTitle={null}
          attachments={null}
          mentions={[
            {
              start,
              end: start + token.length,
              resource: {
                kind: "thread",
                threadId: "thr_boundary",
                projectId: "proj_boundary",
                label: "Boundary thread",
              },
            },
          ]}
          text={text}
          turnRequest={{ kind: "message", status: "accepted" }}
        />
      </MemoryRouter>,
    );

    expect(container.textContent).not.toContain(
      token.slice(0, visibleTokenLength),
    );
    expect(screen.queryByRole("link", { name: "Boundary thread" })).toBeNull();
  });

  it("expands a multi-line agent-originated row, routes the sender link, and hides bb chrome from the rendered body", () => {
    const messageBody =
      "Line 1\nLine 2\nLine 3\nLine 4\nAdditional details that make this generated message long enough to expand.";
    render(
      <MemoryRouter initialEntries={["/"]}>
        <AppRouteNavigationProvider>
          <ConversationMessageContent
            role="user"
            initiator="agent"
            resolveSegmentLinkHref={(link) => {
              switch (link.kind) {
                case "thread":
                  return `/projects/proj_123/threads/${link.threadId}`;
                default:
                  return null;
              }
            }}
            senderThreadId="thr_sender123"
            senderThreadTitle="Frontend thread"
            attachments={null}
            mentions={[]}
            text={`[bb message from thread:thr_sender123]\n\n${messageBody}`}
            turnRequest={{ kind: "message", status: "accepted" }}
          />
          <LocationProbe label="location" />
        </AppRouteNavigationProvider>
      </MemoryRouter>,
    );

    const toggle = screen.getByRole("button", {
      name: /Message from Frontend thread/u,
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    // Clicking the sender thread link navigates and does NOT also toggle the
    // row — this is the AppRouteAnchor stopPropagation contract that lets a
    // <a> live inside the header <button> without HTML's nested-button
    // restriction surfacing as a UX bug.
    const senderLink = screen.getByRole("link", { name: "Frontend thread" });
    expect(senderLink.getAttribute("href")).toBe(
      "/projects/proj_123/threads/thr_sender123",
    );
    expect(fireEvent.click(senderLink)).toBe(false);
    expect(screen.getByTestId("location").textContent).toBe(
      "/projects/proj_123/threads/thr_sender123",
    );
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    // Body should expose all body lines and strip the bb prefix from the
    // rendered text — the prefix is chrome for the writer, not the reader.
    expect(screen.getAllByText(/Line 4/u).length).toBeGreaterThan(0);
    expect(screen.queryByText(/\[bb message from thread/u)).toBeNull();
  });

  it("renders short agent-originated messages as static rows with no expansion affordance", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <AppRouteNavigationProvider>
          <ConversationMessageContent
            role="user"
            initiator="agent"
            resolveSegmentLinkHref={(link) => {
              switch (link.kind) {
                case "thread":
                  return `/projects/proj_123/threads/${link.threadId}`;
                default:
                  return null;
              }
            }}
            senderThreadId="thr_sender123"
            senderThreadTitle="Frontend thread"
            attachments={null}
            mentions={[]}
            text={"[bb message from thread:thr_sender123]\n\nDone."}
            turnRequest={{ kind: "message", status: "accepted" }}
          />
        </AppRouteNavigationProvider>
      </MemoryRouter>,
    );

    expect(
      screen.queryByRole("button", {
        name: /Message from Frontend thread/u,
      }),
    ).toBeNull();
    expect(screen.getByText("Done.")).toBeTruthy();
  });

  it(
    // Regression: a long one-line agent-originated body must stay expanded
    // after the collapsed preview detaches (mid-click, the ResizeObserver
    // would otherwise fire against the detached node and the row would
    // collapse itself before the user saw the body).
    "expands a one-line agent-originated body on click and stays expanded after the post-click resize tick",
    () => {
      const descriptors = installElementOverflowMetrics({
        clientHeight: 20,
        scrollHeight: 20,
        clientWidth: 100,
        scrollWidth: 200,
      });
      const resizeObserver = installDriveableResizeObserver();
      const messageBody =
        "Reviewed, validated, and landed onto local main as commit fc3a5b7. No further edits needed. This stays on one physical line even when the preview truncates in a narrow story frame.";
      try {
        render(
          <MemoryRouter initialEntries={["/"]}>
            <AppRouteNavigationProvider>
              <ConversationMessageContent
                role="user"
                initiator="agent"
                resolveSegmentLinkHref={(link) => {
                  switch (link.kind) {
                    case "thread":
                      return `/projects/proj_123/threads/${link.threadId}`;
                  }
                  return null;
                }}
                senderThreadId="thr_sender123"
                senderThreadTitle="Frontend thread"
                attachments={null}
                mentions={[]}
                text={`[bb message from thread:thr_sender123]\n\n${messageBody}`}
                turnRequest={{ kind: "message", status: "accepted" }}
              />
            </AppRouteNavigationProvider>
          </MemoryRouter>,
        );

        const getTitleToggle = () =>
          screen.getByRole("button", {
            name: /Message from Frontend thread/u,
          });
        expect(getTitleToggle().getAttribute("aria-expanded")).toBe("false");

        fireEvent.click(screen.getByRole("button", { name: /Reviewed/u }));

        expect(getTitleToggle().getAttribute("aria-expanded")).toBe("true");
        expect(screen.getByText(messageBody)).toBeTruthy();

        // Simulate the browser firing the ResizeObserver after the collapsed
        // preview unmounted (its node is now detached). Before the fix, this
        // callback reported "fits" → `expandable` collapsed to false → the
        // title turned back into a non-button div and the toggle disappeared.
        act(() => {
          resizeObserver.triggerAll();
        });

        expect(getTitleToggle().getAttribute("aria-expanded")).toBe("true");
        // And the user can still collapse it back.
        fireEvent.click(getTitleToggle());
        expect(getTitleToggle().getAttribute("aria-expanded")).toBe("false");
      } finally {
        resizeObserver.restore();
        restoreElementOverflowMetrics(descriptors);
      }
    },
  );

  it("renders one-line system messages with mention pills as static generated rows", () => {
    const token = "@thread:thr_target";
    const text = `[bb system]\n\n${token} completed.`;
    const start = text.indexOf(token);

    render(
      <MemoryRouter>
        <ConversationMessageContent
          role="user"
          initiator="system"
          senderThreadId={null}
          senderThreadTitle={null}
          attachments={null}
          mentions={[
            {
              start,
              end: start + token.length,
              resource: {
                kind: "thread",
                threadId: "thr_target",
                projectId: "proj_target",
                label: "Worker thread",
              },
            },
          ]}
          text={text}
          turnRequest={{ kind: "message", status: "accepted" }}
        />
      </MemoryRouter>,
    );

    expect(
      screen.queryByRole("button", { name: "System Message" }),
    ).toBeNull();
    expect(screen.getByRole("link", { name: "Worker thread" })).toBeTruthy();
    expect(screen.getByText("completed.")).toBeTruthy();
  });

  it("renders generated agent steer status inside the expanded body", () => {
    render(
      <ConversationMessageContent
        role="user"
        initiator="agent"
        senderThreadId="thr_sender123"
        senderThreadTitle="Frontend thread"
        attachments={null}
        mentions={[]}
        text={
          "[bb message from thread:thr_sender123]\n\nAgent-to-agent status update."
        }
        turnRequest={{ kind: "steer", status: "accepted" }}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Message from Frontend thread" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /steer/iu })).toBeNull();
    expect(screen.queryByText("Steer")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Message from Frontend thread" }),
    );

    expect(screen.getByText("Steer")).toBeTruthy();
  });

  it("renders mention pills in agent-originated rows with shifted offsets", () => {
    const token = "@thread:thr_target";
    const text = `[bb message from thread:thr_sender123]\n\nAsk ${token} to review the parent-thread cleanup details and confirm the route copy still reads clearly.`;
    const start = text.indexOf(token);

    render(
      <MemoryRouter>
        <ConversationMessageContent
          role="user"
          initiator="agent"
          resolveSegmentLinkHref={(link) => {
            switch (link.kind) {
              case "thread":
                return `/projects/proj_current/threads/${link.threadId}`;
              default:
                return null;
            }
          }}
          senderThreadId="thr_sender123"
          senderThreadTitle="Frontend thread"
          attachments={null}
          mentions={[
            {
              start,
              end: start + token.length,
              resource: {
                kind: "thread",
                threadId: "thr_target",
                projectId: "proj_target",
                label: "API planning",
              },
            },
          ]}
          text={text}
          turnRequest={{ kind: "message", status: "accepted" }}
        />
      </MemoryRouter>,
    );

    const mention = screen.getByRole("link", { name: "API planning" });
    expect(mention.getAttribute("href")).toBe(
      "/projects/proj_target/threads/thr_target",
    );
    expect(screen.queryByText(/\[bb message from thread/u)).toBeNull();
    expect(screen.queryByText(token)).toBeNull();
  });

});
