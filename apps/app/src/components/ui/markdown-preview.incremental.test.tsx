// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import { ThreadTitleMentionResourcesProvider } from "@/components/thread/ThreadTitleMentions";
import {
  repairStreamingMarkdownTail,
  splitStreamingMarkdown,
} from "@/components/thread/timeline/streaming-markdown-split";
import { BENCH_STREAM_MARKDOWN_FIXTURES } from "@/test/fixtures/bench-stream-markdown/index";
import { RouteNavigationProvider } from "./app-route-anchor";
import { buildMarkdownMessageLinkRouting } from "./markdown-message-link-routing";
import {
  buildMessageDirectiveRegistry,
  MESSAGE_DIRECTIVE_MOUNT_LIMIT,
} from "./markdown-message-directives";
import { MarkdownPreview } from "./markdown-preview";

vi.mock("./markdown-mermaid-loader.js", () => ({
  loadMermaid: () => new Promise(() => {}),
}));

const mentionedThread = makeThreadListEntry({
  id: "thr_mentioned",
  title: "Related thread",
});

let directiveMountCount = 0;

function InlineVis(props: PluginMessageDirectiveProps) {
  useEffect(() => {
    directiveMountCount += 1;
  }, []);
  return (
    <div data-testid="inline-vis" data-file={props.attributes.file ?? ""}>
      {props.source}
    </div>
  );
}

const registry = buildMessageDirectiveRegistry([
  { id: "inline-vis", pluginId: "demo", generation: 1, component: InlineVis },
]);

const messageDirectives = {
  registry,
  message: {
    id: "msg_stream",
    threadId: "thr_stream",
    turnId: "turn_stream",
    projectId: null,
  },
  openWorkspaceFile: null,
  openThreadPanel: null,
};

const linkRouting = buildMarkdownMessageLinkRouting({
  onOpenLocalFileLink: () => true,
  threadId: "thr_stream",
  workspaceRootPath: "/workspace",
});

const threadMentions = { mentions: [], preserveSoftBreaks: false };

interface PreviewArgs {
  className?: string;
  content: string;
  incrementalBlocks: boolean;
}

function Providers({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter>
      <RouteNavigationProvider>
        <ThreadTitleMentionResourcesProvider
          sectionNamesById={new Map()}
          projectNamesById={new Map()}
          threadById={new Map([[mentionedThread.id, mentionedThread]])}
        >
          {children}
        </ThreadTitleMentionResourcesProvider>
      </RouteNavigationProvider>
    </MemoryRouter>
  );
}

function preview({ className, content, incrementalBlocks }: PreviewArgs) {
  return (
    <Providers>
      <MarkdownPreview
        className={className}
        content={content}
        incrementalBlocks={incrementalBlocks}
        linkRouting={linkRouting}
        messageDirectives={messageDirectives}
        threadMentions={threadMentions}
      />
    </Providers>
  );
}

function renderLegacyHtml(className: string | undefined, content: string) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(preview({ className, content, incrementalBlocks: false }));
  });
  const html = container.innerHTML;
  act(() => {
    root.unmount();
  });
  container.remove();
  return html;
}

function createDifferentialPreview(className?: string) {
  const incremental = render(
    preview({ className, content: "", incrementalBlocks: true }),
  );
  const legacy = render(
    preview({ className, content: "", incrementalBlocks: false }),
  );
  return {
    expectMatchesLegacy(content: string, label: string) {
      incremental.rerender(
        preview({ className, content, incrementalBlocks: true }),
      );
      legacy.rerender(
        preview({ className, content, incrementalBlocks: false }),
      );
      expect(
        incremental.container.innerHTML,
        `${label}: ${JSON.stringify(content)}`,
      ).toBe(legacy.container.innerHTML);
    },
  };
}

function chunkSteps(document: string, size: number): string[] {
  const steps: string[] = [];
  for (let end = size; end < document.length; end += size) {
    steps.push(document.slice(0, end));
  }
  steps.push(document);
  return steps;
}

function lineSteps(document: string): string[] {
  const steps: string[] = [];
  let lineStart = 0;
  while (lineStart < document.length) {
    const newline = document.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? document.length : newline + 1;
    const middle = lineStart + Math.floor((lineEnd - lineStart) / 2);
    if (middle > lineStart) {
      steps.push(document.slice(0, middle));
    }
    steps.push(document.slice(0, lineEnd));
    lineStart = lineEnd;
  }
  return steps;
}

async function loadKatex() {
  const view = render(<MarkdownPreview content={"$$\nx\n$$"} />);
  await waitFor(() =>
    expect(view.container.querySelector(".katex-display")).not.toBeNull(),
  );
  view.unmount();
}

const CURATED_DOCUMENTS: ReadonlyArray<readonly [string, string]> = [
  [
    "lists",
    "- a\nlazy\n\n- b\n\n\n- c\n\n  continued\n\n1. Step\n\n   ```bash\n   run\n\n   more\n   ```\n\n2. Next\n\nAfter.",
  ],
  [
    "code and html flow",
    "Intro.\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n\n<pre>\nline\n\nmore\n</pre>\n\n<!-- note\n\nstill -->\n\n    indented\n\n> - quoted\n\nDone.",
  ],
  [
    "math, mermaid, and tables",
    "Before the formula.\n\n$$T_{a}\n\\approx73$$\n\n## After\n\n```mermaid\ngraph TD\nA-->B\n```\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nRun `echo $$` now.\n\n$$\n\nAfter the stray line.",
  ],
  [
    "directives, mentions, and links",
    'Intro.\n\n::inline-vis{file="a.html"}\n\n> quoted **bold**\n\nSee thr_mentioned and @thread:thr_mentioned.\n\n[My file](</workspace/My File.ts:12>) and ![img](/workspace/a.png)\n\n:::note\nbox\n\n::inline-vis{file="b.html"}\n:::\n\nTail.',
  ],
  [
    "frontmatter and late references",
    "---\ntitle: Plan\nowner: me\n---\n\nUse [the docs] and a note[^1].\n\nMiddle.\n\n[the docs]: https://example.com\n\n[^1]: The note.\n\nAfter.",
  ],
];

beforeEach(() => {
  directiveMountCount = 0;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("MarkdownPreview incremental blocks", () => {
  it.each(CURATED_DOCUMENTS)(
    "renders the same DOM as a single document at every line step: %s",
    async (label, document) => {
      await loadKatex();
      const differential = createDifferentialPreview();
      for (const step of lineSteps(document)) {
        differential.expectMatchesLegacy(step, label);
      }
    },
    60_000,
  );

  it.each(BENCH_STREAM_MARKDOWN_FIXTURES)(
    "renders the same settled and live DOM as single documents while the $name fixture streams",
    async ({ name, text }) => {
      await loadKatex();
      const settled = createDifferentialPreview("settled");
      const live = createDifferentialPreview("live");
      for (const step of chunkSteps(text, 150)) {
        const split = splitStreamingMarkdown(step);
        const liveMarkdown = repairStreamingMarkdownTail(split?.tail ?? step);
        settled.expectMatchesLegacy(split?.settled ?? liveMarkdown, name);
        live.expectMatchesLegacy(split === null ? "" : liveMarkdown, name);
      }
      settled.expectMatchesLegacy(text, name);
    },
    180_000,
  );

  it("keeps settled code and directive DOM connected across advances and a late definition", () => {
    const initial =
      'Intro.\n\n```ts\nconst a = 1;\n```\n\n::inline-vis{file="a.html"}\n\nUse [docs].\n\n';
    const view = render(preview({ content: initial, incrementalBlocks: true }));
    const line = view.container.querySelector("pre code span.sh__line");
    const directive = screen.getByTestId("inline-vis");
    if (line === null) {
      throw new Error("Expected a highlighted settled code block");
    }
    expect(directiveMountCount).toBe(1);

    const advanced = `${initial}More.\n\n`;
    view.rerender(preview({ content: advanced, incrementalBlocks: true }));
    expect(line.isConnected).toBe(true);
    expect(directive.isConnected).toBe(true);

    const defined = `${advanced}[docs]: https://example.com\n\n`;
    view.rerender(preview({ content: defined, incrementalBlocks: true }));
    expect(
      screen.getByRole("link", { name: "docs" }).getAttribute("href"),
    ).toBe("https://example.com");
    expect(line.isConnected).toBe(true);
    expect(directive.isConnected).toBe(true);
    expect(directiveMountCount).toBe(1);
    expect(view.container.innerHTML).toBe(renderLegacyHtml(undefined, defined));
  });

  it("mounts the first 32 of 34 directives in document order like a single document", () => {
    const content = Array.from(
      { length: MESSAGE_DIRECTIVE_MOUNT_LIMIT + 2 },
      (_, index) =>
        `Paragraph ${index}.\n\n::inline-vis{file="f${index}.html"}`,
    ).join("\n\n");
    render(preview({ content, incrementalBlocks: false }));
    const legacyFiles = screen
      .getAllByTestId("inline-vis")
      .map((node) => node.getAttribute("data-file"));
    cleanup();
    const differential = createDifferentialPreview();
    differential.expectMatchesLegacy(content, "directive cap");
    cleanup();
    render(preview({ content, incrementalBlocks: true }));
    const files = screen
      .getAllByTestId("inline-vis")
      .map((node) => node.getAttribute("data-file"));
    expect(files).toEqual(
      Array.from(
        { length: MESSAGE_DIRECTIVE_MOUNT_LIMIT },
        (_, index) => `f${index}.html`,
      ),
    );
    expect(files).toEqual(legacyFiles);
    expect(screen.getByText('::inline-vis{file="f33.html"}').tagName).toBe("P");
  });
});
