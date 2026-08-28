// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { RouteNavigationProvider } from "@/components/ui/app-route-anchor";
import { ConversationMessageContent } from "./ConversationMessageContent";

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
            />
          </RouteNavigationProvider>
        </MemoryRouter>,
      ),
  };
}

function documents(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>("[data-markdown-preview]"),
  ).map((node) => (node.textContent ?? "").replace(/\s+/gu, " ").trim());
}

afterEach(cleanup);

describe("ConversationMessageContent streaming split", () => {
  it("re-parses only the live tail when a delta arrives and collapses to one document once complete", () => {
    const { view, update } = renderAssistantMessage(
      "Para one.\n\nPara two.\n\nPara th",
      true,
    );
    expect(documents(view.container)).toEqual([
      "Para one.",
      "Para two. Para th",
    ]);
    update("Para one.\n\nPara two.\n\nPara three.", true);

    update("Para one.\n\nPara two.\n\nPara three.\n\nPara four", true);
    expect(documents(view.container)).toEqual([
      "Para one. Para two.",
      "Para three. Para four",
    ]);

    update("Para one.\n\nPara two.\n\nPara three.\n\nPara four.", false);
    expect(documents(view.container)).toEqual([
      "Para one. Para two. Para three. Para four.",
    ]);
  });

  it("keeps an open fenced block inside the live tail", () => {
    const { view } = renderAssistantMessage(
      "Intro.\n\n```ts\nconst a = 1;\n\nconst b = 2;\n",
      true,
    );
    expect(documents(view.container)).toEqual([
      "Intro.",
      "tsconst a = 1; const b = 2;",
    ]);
  });

  it("renders a single document when no boundary is available or when not streaming", () => {
    const { view, update } = renderAssistantMessage("Only one paragraph", true);
    expect(documents(view.container)).toEqual(["Only one paragraph"]);

    update("Para one.\n\nPara two.\n\nPara three", false);
    expect(documents(view.container)).toEqual([
      "Para one. Para two. Para three",
    ]);
  });
});
