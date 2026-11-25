// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import type { Options } from "react-markdown";
import type { Processor } from "unified";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk";
import type { MarkdownLinkRouting } from "./markdown-link-routing";
import { buildMessageDirectiveRegistry } from "./markdown-message-directives";
import { MarkdownPreview } from "./markdown-preview";
import {
  MessageSlotRegistriesProvider,
  useMessageDirectives,
} from "./message-markdown-slots";

const parses = vi.hoisted(() => ({ documents: [] as string[] }));

vi.mock("react-markdown", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-markdown")>();
  function remarkCountParses(this: Processor) {
    const parse = this.parser!;
    this.parser = (document, file) => {
      parses.documents.push(document);
      return parse(document, file);
    };
  }
  return {
    ...actual,
    default: (options: Options) =>
      actual.default({
        ...options,
        remarkPlugins: [remarkCountParses, ...(options.remarkPlugins ?? [])],
      }),
  };
});

afterEach(() => {
  cleanup();
});

function parseCount(document: string): number {
  return parses.documents.filter((parsed) => parsed === document).length;
}

function workspaceRouting(): MarkdownLinkRouting {
  return {
    localFile: {
      absoluteLinks: { kind: "trusted-host" },
      hostId: null,
      onOpenLink: () => true,
      relativeLinks: { baseDir: "/workspace", rootPath: "/workspace" },
    },
  };
}

const remountMessage = {
  id: "msg_remount",
  threadId: "thr_remount",
  turnId: "turn_remount",
  projectId: null,
};

function AssistantMarkdown({ content }: { content: string }) {
  const messageDirectives = useMessageDirectives(remountMessage, null);
  return (
    <MarkdownPreview
      allowHtml
      content={content}
      incrementalBlocks
      linkRouting={workspaceRouting()}
      messageDirectives={messageDirectives}
      threadMentions={{ mentions: [], preserveSoftBreaks: false }}
    />
  );
}

function InlineVis({ attributes }: PluginMessageDirectiveProps) {
  return <div data-testid="inline-vis" data-file={attributes.file ?? ""} />;
}

const messageDirectives = {
  registry: buildMessageDirectiveRegistry(
    [
      {
        id: "inline-vis",
        pluginId: "demo",
        generation: 1,
        component: InlineVis,
      },
    ],
    {
      unclaimed: "literal",
      picks: {},
      boot: { bbPluginIds: new Set(), settledOnce: true },
    },
  ),
  message: remountMessage,
  openWorkspaceFile: null,
};

describe("MarkdownPreview remounts", () => {
  it("parses a finished message once across unmount and remount and renders the same HTML", () => {
    const content = [
      "## Remount summary",
      "Open [the store](src/store.ts) and read `readRows`.",
      "| File | Lines |\n|---|---|\n| a.ts | 10 |",
      "```ts\nconst rows = await store.read();\n```",
      "- first item\n- second item",
    ].join("\n\n");
    const preview = () => (
      <MessageSlotRegistriesProvider>
        <AssistantMarkdown content={content} />
      </MessageSlotRegistriesProvider>
    );

    const first = render(preview());
    const firstHtml = first.container.innerHTML;
    first.unmount();
    const second = render(preview());

    expect(parseCount(content)).toBe(1);
    expect(second.container.innerHTML).toBe(firstHtml);
  });

  it("does not keep a message larger than the parsed tree budget, and keeps the smaller ones", () => {
    const small = "A short note about `readRows`.";
    const content = `Long report ${"word ".repeat(110_000)}`;

    render(<MarkdownPreview content={small} incrementalBlocks />).unmount();
    render(<MarkdownPreview content={content} incrementalBlocks />).unmount();
    render(<MarkdownPreview content={content} incrementalBlocks />).unmount();
    render(<MarkdownPreview content={small} incrementalBlocks />);

    expect(parseCount(content)).toBe(2);
    expect(parseCount(small)).toBe(1);
  });

  it("parses again when the remount adds message directive syntax", () => {
    const content =
      'Intro paragraph.\n\n::inline-vis{file="chart.html"}\n\nAfter.';

    const plain = render(
      <MarkdownPreview content={content} incrementalBlocks />,
    );
    expect(plain.queryByTestId("inline-vis")).toBeNull();
    plain.unmount();
    const withDirectives = render(
      <MarkdownPreview
        content={content}
        incrementalBlocks
        messageDirectives={messageDirectives}
      />,
    );

    expect(parseCount(content)).toBe(2);
    expect(
      withDirectives.getByTestId("inline-vis").getAttribute("data-file"),
    ).toBe("chart.html");
  });
});
