// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RouteNavigationProvider } from "@/components/ui/app-route-anchor";
import { ConversationMessageContent } from "./ConversationMessageContent";

const markdownRenders = vi.hoisted(() => [] as string[]);
vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => {
    markdownRenders.push(children);
    return <div data-markdown-document="">{children}</div>;
  },
  defaultUrlTransform: (url: string) => url,
}));

function renderAssistantMessage(text: string, streaming: boolean) {
  const element = (
    <MemoryRouter>
      <RouteNavigationProvider>
        <ConversationMessageContent
          role="assistant"
          attachments={null}
          id="msg_stream"
          threadId="thr_stream"
          turnId="turn_stream"
          showActions={false}
          mobileActionDisplay="overflow"
          streaming={streaming}
          text={text}
          timestamp={0}
        />
      </RouteNavigationProvider>
    </MemoryRouter>
  );
  const view = render(element);
  return {
    view,
    update: (nextText: string, nextStreaming: boolean) =>
      view.rerender(
        <MemoryRouter>
          <RouteNavigationProvider>
            <ConversationMessageContent
              role="assistant"
              attachments={null}
              id="msg_stream"
              threadId="thr_stream"
              turnId="turn_stream"
              showActions={false}
              mobileActionDisplay="overflow"
              streaming={nextStreaming}
              text={nextText}
              timestamp={0}
            />
          </RouteNavigationProvider>
        </MemoryRouter>,
      ),
  };
}

function documents(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>("[data-markdown-preview]"),
    (preview) =>
      Array.from(
        preview.querySelectorAll<HTMLElement>("[data-markdown-document]"),
        (node) => node.textContent ?? "",
      ).join(""),
  );
}

beforeEach(() => {
  markdownRenders.length = 0;
});

afterEach(cleanup);

describe("ConversationMessageContent streaming split", () => {
  it("re-parses only the live tail when a delta arrives and collapses to one document once complete", () => {
    const { view, update } = renderAssistantMessage(
      "Para one.\n\nPara two.\n\nPara th",
      true,
    );
    expect(documents(view.container)).toEqual([
      "Para one.\n\n",
      "Para two.\n\nPara th",
    ]);
    expect(markdownRenders).toEqual(["Para one.\n\n", "Para two.\n\nPara th"]);

    markdownRenders.length = 0;
    update("Para one.\n\nPara two.\n\nPara three.", true);
    expect(markdownRenders).toEqual(["Para two.\n\n", "Para three."]);

    markdownRenders.length = 0;
    update("Para one.\n\nPara two.\n\nPara three!", true);
    expect(markdownRenders).toEqual(["Para three!"]);

    markdownRenders.length = 0;
    update("Para one.\n\nPara two.\n\nPara three.\n\nPara four", true);
    expect(documents(view.container)).toEqual([
      "Para one.\n\nPara two.\n\n",
      "Para three.\n\nPara four",
    ]);
    expect(markdownRenders).toEqual([
      "Para two.\n\n",
      "Para three.\n\nPara four",
    ]);

    markdownRenders.length = 0;
    update("Para one.\n\nPara two.\n\nPara three.\n\nPara four.", false);
    expect(documents(view.container)).toEqual([
      "Para one.\n\nPara two.\n\nPara three.\n\nPara four.",
    ]);
    expect(markdownRenders).toEqual(["Para three.\n\n", "Para four."]);
  });
});
