// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RouteNavigationProvider } from "@/components/ui/app-route-anchor";
import { longResponse } from "@/test/fixtures/bench-stream-markdown/long-response";
import { ConversationMessageContent } from "./ConversationMessageContent";
import {
  repairStreamingMarkdownTail,
  splitStreamingMarkdown,
} from "./streaming-markdown-split";

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
    (preview) =>
      Array.from(
        preview.querySelectorAll<HTMLElement>("[data-markdown-document]"),
        (node) => node.textContent ?? "",
      ).join(""),
  );
}

function renderedMarkdownLength(): number {
  return markdownRenders.reduce((total, source) => total + source.length, 0);
}

beforeEach(() => {
  markdownRenders.length = 0;
});

afterEach(cleanup);

describe("ConversationMessageContent streaming split", () => {
  it.each([
    ["**Streaming bold", "**Streaming bold**"],
    ["`streaming code", "`streaming code`"],
    ["Read [the docs](https://example", "Read the docs"],
    ["Image ![preview](/workspace/preview", "Image "],
  ])(
    "repairs an unsplit live tail and restores raw source on completion: %s",
    (source, repaired) => {
      const { view, update } = renderAssistantMessage(source, true);
      expect(documents(view.container)).toEqual([repaired]);

      update(source, false);
      expect(documents(view.container)).toEqual([source]);
    },
  );

  it("repairs only the live split tail without re-parsing the settled prefix", () => {
    const { view, update } = renderAssistantMessage(
      "Settled **source.\n\nSecond paragraph.\n\n`live code",
      true,
    );
    expect(documents(view.container)).toEqual([
      "Settled **source.\n\n",
      "Second paragraph.\n\n`live code`",
    ]);

    markdownRenders.length = 0;
    update("Settled **source.\n\nSecond paragraph.\n\n`live code grows", true);
    expect(markdownRenders).toEqual([
      "Second paragraph.\n\n",
      "`live code grows`",
    ]);

    markdownRenders.length = 0;
    update(
      "Settled **source.\n\nSecond paragraph.\n\n`live code grows more",
      true,
    );
    expect(markdownRenders).toEqual(["`live code grows more`"]);
  });

  it("repairs unfinished formatting after ordinary double-colon text", () => {
    const source = "Call Namespace::Method, then **live bold";
    const { view, update } = renderAssistantMessage(source, true);
    expect(documents(view.container)).toEqual([
      "Call Namespace::Method, then **live bold**",
    ]);

    update(`Settled.\n\nSecond paragraph.\n\n${source}`, true);
    expect(documents(view.container)).toEqual([
      "Settled.\n\n",
      `Second paragraph.\n\n${source}**`,
    ]);
  });

  it.each([
    "::inline-vis[label",
    "  ::inline-vis[label",
    "> ::inline-vis[label",
    "- ::inline-vis[label",
    '::inline-vis{file="[draft.html"}',
    '::inline-vis{file="a__b.html"}',
    '::unknown{title="**source"}',
  ])("preserves directive source in a live tail: %s", (source) => {
    const { view } = renderAssistantMessage(source, true);
    expect(documents(view.container)).toEqual([source]);
  });

  it("resumes repair after a directive moves into the settled prefix", () => {
    const source = '::inline-vis{file="[draft.html"}';
    const { view, update } = renderAssistantMessage(
      source + "\n\n**live",
      true,
    );
    expect(documents(view.container)).toEqual([source + "\n\n**live"]);

    update(source + "\n\nSecond paragraph.\n\n**live", true);
    expect(documents(view.container)).toEqual([
      source + "\n\n",
      "Second paragraph.\n\n**live**",
    ]);
  });

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
      "Para three.\n\n",
      "Para four",
    ]);

    markdownRenders.length = 0;
    update("Para one.\n\nPara two.\n\nPara three.\n\nPara four.", false);
    expect(documents(view.container)).toEqual([
      "Para one.\n\nPara two.\n\nPara three.\n\nPara four.",
    ]);
    expect(markdownRenders).toEqual(["Para three.\n\n", "Para four."]);
  });

  it("parses the settled prefix once while a mixed message streams line by line", () => {
    const text = longResponse.slice(
      0,
      longResponse.indexOf("\n\n## 2. Session store"),
    );
    const lines = text.split("\n");
    const { update } = renderAssistantMessage(lines[0] ?? "", true);
    let liveTailLength = (lines[0] ?? "").length;
    for (let index = 2; index <= lines.length; index += 1) {
      const streamed = lines.slice(0, index).join("\n");
      update(streamed, true);
      liveTailLength += repairStreamingMarkdownTail(
        splitStreamingMarkdown(streamed)?.tail ?? streamed,
      ).length;
    }
    update(text, false);

    expect(text.length).toBeGreaterThan(5_000);
    expect(renderedMarkdownLength() - liveTailLength).toBeLessThanOrEqual(
      text.length * 2,
    );
  });

  it("parses only the former tail on completion and matches a fresh completed render", () => {
    const streamed =
      "Intro.\n\n```ts\nconst a = 1;\n```\n\n- one\n- two\n\nMiddle.\n\nTail **live";
    const completed = `${streamed} text**.`;
    const { view, update } = renderAssistantMessage(streamed, true);
    expect(documents(view.container)).toEqual([
      "Intro.\n\n```ts\nconst a = 1;\n```\n\n- one\n- two\n\n",
      "Middle.\n\nTail **live**",
    ]);

    markdownRenders.length = 0;
    update(completed, false);
    expect(markdownRenders).toEqual(["Middle.\n\n", "Tail **live text**."]);

    const fresh = renderAssistantMessage(completed, false);
    expect(documents(view.container)).toEqual(documents(fresh.view.container));
  });

  it.each([
    '~~~ts\nconst x = "**text";\n',
    '> ~~~ts\n> const x = "**text";\n',
    '- ```ts\n  const x = "**text";\n',
  ])("preserves fenced code verbatim in the live tail: %s", (source) => {
    const { view } = renderAssistantMessage(source, true);
    expect(documents(view.container)).toEqual([source]);
  });

  it("keeps an open fenced block inside the live tail", () => {
    const { view } = renderAssistantMessage(
      "Intro.\n\n```ts\nconst a = 1;\n\nconst b = 2;\n",
      true,
    );
    expect(documents(view.container)).toEqual([
      "Intro.\n\n",
      "```ts\nconst a = 1;\n\nconst b = 2;\n",
    ]);
  });

  it("renders a single document when no boundary is available or when not streaming", () => {
    const { view, update } = renderAssistantMessage("Only one paragraph", true);
    expect(documents(view.container)).toEqual(["Only one paragraph"]);

    update("Para one.\n\nPara two.\n\nPara three", false);
    expect(documents(view.container)).toEqual([
      "Para one.\n\nPara two.\n\nPara three",
    ]);
  });
});
