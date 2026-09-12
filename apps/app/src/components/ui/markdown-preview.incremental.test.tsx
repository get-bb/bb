// @vitest-environment jsdom

import { act, cleanup, render, waitFor, within } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import { ThreadTitleMentionResourcesProvider } from "@/components/thread/ThreadTitleMentions";
import { threadQueryKey } from "@/hooks/queries/query-keys";
import { makeThreadResponse } from "@/test/fixtures/thread-responses";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { RouteNavigationProvider } from "./app-route-anchor";
import { buildMarkdownMessageLinkRouting } from "./markdown-message-link-routing";
import {
  buildMessageDirectiveRegistry,
  MESSAGE_DIRECTIVE_MOUNT_LIMIT,
} from "./markdown-message-directives";
import { MarkdownPreview } from "./markdown-preview";

vi.mock("@/lib/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sdk")>();
  return {
    ...actual,
    sdk: {
      ...actual.sdk,
      threads: {
        ...actual.sdk.threads,
        get: vi.fn(() => new Promise(() => {})),
        resolveMentions: vi.fn(() => new Promise(() => {})),
      },
    },
  };
});

vi.mock("./markdown-mermaid-loader.js", () => ({
  loadMermaid: () => new Promise(() => {}),
}));

const LEGS = ["incremental", "legacy"] as const;
type PreviewLeg = (typeof LEGS)[number];

interface DirectiveCounts {
  attributeEffects: number;
  mounts: number;
  renders: number;
}

const counts: Record<PreviewLeg, DirectiveCounts> = {
  incremental: { attributeEffects: 0, mounts: 0, renders: 0 },
  legacy: { attributeEffects: 0, mounts: 0, renders: 0 },
};

function countingDirective(leg: PreviewLeg) {
  return function InlineVis({
    attributes,
    source,
  }: PluginMessageDirectiveProps) {
    counts[leg].renders += 1;
    useEffect(() => {
      counts[leg].mounts += 1;
    }, []);
    useEffect(() => {
      counts[leg].attributeEffects += 1;
    }, [attributes]);
    return (
      <div data-testid="inline-vis" data-file={attributes.file ?? ""}>
        {source}
      </div>
    );
  };
}

function legMessageDirectives(leg: PreviewLeg) {
  return {
    registry: buildMessageDirectiveRegistry([
      {
        id: "inline-vis",
        pluginId: "demo",
        generation: 1,
        component: countingDirective(leg),
      },
    ]),
    message: {
      id: "msg_stream",
      threadId: "thr_stream",
      turnId: "turn_stream",
      projectId: null,
    },
    openWorkspaceFile: null,
    openThreadPanel: null,
  };
}

const messageDirectives = {
  incremental: legMessageDirectives("incremental"),
  legacy: legMessageDirectives("legacy"),
};

const linkRouting = buildMarkdownMessageLinkRouting({
  onOpenLocalFileLink: () => true,
  threadId: "thr_stream",
  workspaceRootPath: "/workspace",
});

const threadMentions = { mentions: [], preserveSoftBreaks: false };
const sectionNamesById = new Map<string, string>();
const projectNamesById = new Map<string, string>();
const mentionedThread = makeThreadListEntry({
  id: "thr_mentioned",
  title: "Related thread",
});
const threadById = new Map([[mentionedThread.id, mentionedThread]]);
const rawThreadId = "thr_dcwivn5n8w";

interface PreviewTreeArgs {
  content: string;
  leg: PreviewLeg;
  wrapper: (props: { children: ReactNode }) => ReactNode;
}

function PreviewTree({ content, leg, wrapper: Wrapper }: PreviewTreeArgs) {
  return (
    <Wrapper>
      <MemoryRouter>
        <RouteNavigationProvider>
          <ThreadTitleMentionResourcesProvider
            sectionNamesById={sectionNamesById}
            projectNamesById={projectNamesById}
            threadById={threadById}
          >
            <MarkdownPreview
              content={content}
              incrementalBlocks={leg === "incremental"}
              linkRouting={linkRouting}
              messageDirectives={messageDirectives[leg]}
              threadMentions={threadMentions}
            />
          </ThreadTitleMentionResourcesProvider>
        </RouteNavigationProvider>
      </MemoryRouter>
    </Wrapper>
  );
}

function mutationSignature(record: MutationRecord): string {
  return [
    record.type,
    record.attributeName ?? "",
    record.target.nodeName,
    record.addedNodes.length,
    record.removedNodes.length,
  ].join(":");
}

function createDifferentialLegs(initialContent = "") {
  const { queryClient, wrapper } = createQueryClientTestHarness();
  const views = {
    incremental: render(
      <PreviewTree
        content={initialContent}
        leg="incremental"
        wrapper={wrapper}
      />,
    ),
    legacy: render(
      <PreviewTree content={initialContent} leg="legacy" wrapper={wrapper} />,
    ),
  };
  const observers = {
    incremental: new MutationObserver(() => {}),
    legacy: new MutationObserver(() => {}),
  };
  for (const leg of LEGS) {
    observers[leg].observe(views[leg].container, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
  }
  return {
    incremental: views.incremental.container,
    queryClient,
    update(content: string) {
      for (const leg of LEGS) {
        views[leg].rerender(
          <PreviewTree content={content} leg={leg} wrapper={wrapper} />,
        );
      }
      expect(
        views.incremental.container.innerHTML,
        JSON.stringify(content),
      ).toBe(views.legacy.container.innerHTML);
      return {
        incrementalMutations: observers.incremental
          .takeRecords()
          .map(mutationSignature),
        legacyMutations: observers.legacy.takeRecords().map(mutationSignature),
      };
    },
  };
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

beforeAll(async () => {
  const view = render(<MarkdownPreview content={"$$\nx\n$$"} />);
  await waitFor(() =>
    expect(view.container.querySelector(".katex-display")).not.toBeNull(),
  );
  view.unmount();
});

beforeEach(() => {
  for (const leg of LEGS) {
    counts[leg] = { attributeEffects: 0, mounts: 0, renders: 0 };
  }
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("MarkdownPreview incremental blocks", () => {
  it.each(CURATED_DOCUMENTS)(
    "renders the same DOM as a single document at every line step: %s",
    (_label, document) => {
      const legs = createDifferentialLegs();
      for (const step of lineSteps(document)) {
        legs.update(step);
      }
    },
    60_000,
  );

  it("keeps settled code and directive DOM connected across advances and a late definition", () => {
    const initial =
      'Intro.\n\n```ts\nconst a = 1;\n```\n\n::inline-vis{file="a.html"}\n\nUse [docs].\n\n';
    const legs = createDifferentialLegs(initial);
    const line = legs.incremental.querySelector("pre code span.sh__line");
    const directive = within(legs.incremental).getByTestId("inline-vis");
    if (line === null) {
      throw new Error("Expected a highlighted settled code block");
    }

    const advanced = `${initial}More.\n\n`;
    legs.update(advanced);
    expect(line.isConnected).toBe(true);
    expect(directive.isConnected).toBe(true);

    legs.update(`${advanced}[docs]: https://example.com\n\n`);
    expect(
      within(legs.incremental)
        .getByRole("link", { name: "docs" })
        .getAttribute("href"),
    ).toBe("https://example.com");
    expect(line.isConnected).toBe(true);
    expect(directive.isConnected).toBe(true);
    expect(counts.incremental.mounts).toBe(1);
  });

  it("mounts the first 32 of 34 directives across pieces like a single document", () => {
    const content = Array.from(
      { length: MESSAGE_DIRECTIVE_MOUNT_LIMIT + 2 },
      (_, index) =>
        `Paragraph ${index}.\n\n::inline-vis{file="f${index}.html"}`,
    ).join("\n\n");
    const legs = createDifferentialLegs();

    legs.update(content);

    const incremental = within(legs.incremental);
    expect(incremental.getAllByTestId("inline-vis")).toHaveLength(
      MESSAGE_DIRECTIVE_MOUNT_LIMIT,
    );
    expect(incremental.getByText('::inline-vis{file="f33.html"}').tagName).toBe(
      "P",
    );
  });

  it("re-reads cached raw thread titles in settled pieces on every new body like a single document", async () => {
    const first = `Continue in ${rawThreadId} when ready.\n\nSee [${rawThreadId}](https://example.com/x) here.\n\n`;
    const legs = createDifferentialLegs(first);
    await act(async () => {
      legs.queryClient.setQueryData(
        threadQueryKey(rawThreadId),
        makeThreadResponse({
          id: rawThreadId,
          title: "Rebuild comments",
          titleFallback: "Rebuild comments",
        }),
      );
    });

    legs.update(`${first}Second paragraph.\n\n`);
    expect(legs.incremental.textContent).toContain(
      "Continue in Rebuild comments when ready.",
    );
    legs.update(`${first}Second paragraph.\n\nThird.`);
  });

  it("re-renders plugin directives with fresh attributes on every new body like a single document", () => {
    const first = 'Intro.\n\n::inline-vis{file="a.html"}\n\n';
    const legs = createDifferentialLegs(first);
    const steps = [
      `${first}Second paragraph.\n\n`,
      `${first}Second paragraph.\n\nThird paragraph.\n\n`,
      `${first}Second paragraph.\n\nThird paragraph.\n\nFourth.`,
    ];
    for (const step of steps) {
      legs.update(step);
      expect(counts.incremental).toEqual(counts.legacy);
    }
    expect(counts.legacy.attributeEffects).toBe(steps.length + 1);
  });

  it("commits the same DOM mutations as a single document while settled content grows", () => {
    const blocks = [
      "# Plan\n\n",
      "See [the docs](https://example.com/docs) and [a file](</workspace/src/a.ts:12>).\n\n",
      "```ts\nconst a = 1;\n```\n\n",
      "| a | b |\n| - | - |\n| 1 | 2 |\n\n",
      '::inline-vis{file="a.html"}\n\n',
      "- one\n- two with `code`\n\n",
      `> Quoted ${rawThreadId} and @thread:thr_mentioned.\n\n`,
      "1. First\n2. Second\n\n",
      "Closing paragraph with **bold** and ![img](/workspace/a.png).",
    ];
    let body = blocks[0] ?? "";
    const legs = createDifferentialLegs(body);
    for (const block of blocks.slice(1)) {
      body += block;
      const { incrementalMutations, legacyMutations } = legs.update(body);
      expect(incrementalMutations, body).toEqual(legacyMutations);
    }
  });
});
