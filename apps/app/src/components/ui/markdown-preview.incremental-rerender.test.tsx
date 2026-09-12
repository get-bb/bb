// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk";
import type { ThreadListEntry } from "@bb/domain";
import { ThreadTitleMentionResourcesProvider } from "@/components/thread/ThreadTitleMentions";
import { threadQueryKey } from "@/hooks/queries/query-keys";
import { makeThreadResponse } from "@/test/fixtures/thread-responses";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { RouteNavigationProvider } from "./app-route-anchor";
import { buildMarkdownMessageLinkRouting } from "./markdown-message-link-routing";
import { buildMessageDirectiveRegistry } from "./markdown-message-directives";
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

type PreviewLeg = "incremental" | "legacy";

interface LegCounts {
  attributeEffects: number;
  renders: number;
}

const counts: Record<PreviewLeg, LegCounts> = {
  incremental: { attributeEffects: 0, renders: 0 },
  legacy: { attributeEffects: 0, renders: 0 },
};

function countingDirective(leg: PreviewLeg) {
  return function CountingDirective(props: PluginMessageDirectiveProps) {
    counts[leg].renders += 1;
    const { attributes } = props;
    useEffect(() => {
      counts[leg].attributeEffects += 1;
    }, [attributes]);
    return <div data-testid="directive">{attributes.file}</div>;
  };
}

const registries = {
  incremental: buildMessageDirectiveRegistry([
    {
      id: "inline-vis",
      pluginId: "demo",
      generation: 1,
      component: countingDirective("incremental"),
    },
  ]),
  legacy: buildMessageDirectiveRegistry([
    {
      id: "inline-vis",
      pluginId: "demo",
      generation: 1,
      component: countingDirective("legacy"),
    },
  ]),
};

const message = {
  id: "msg_stream",
  threadId: "thr_stream",
  turnId: "turn_stream",
  projectId: null,
};

const messageDirectives = {
  incremental: {
    registry: registries.incremental,
    message,
    openWorkspaceFile: null,
    openThreadPanel: null,
  },
  legacy: {
    registry: registries.legacy,
    message,
    openWorkspaceFile: null,
    openThreadPanel: null,
  },
};

const linkRouting = buildMarkdownMessageLinkRouting({
  onOpenLocalFileLink: () => true,
  threadId: "thr_stream",
  workspaceRootPath: "/workspace",
});

const threadMentions = { mentions: [], preserveSoftBreaks: false };
const sectionNamesById = new Map<string, string>();
const projectNamesById = new Map<string, string>();
const threadById = new Map<string, ThreadListEntry>();
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

function createDifferentialLegs(initialContent: string) {
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
  for (const leg of ["incremental", "legacy"] as const) {
    observers[leg].observe(views[leg].container, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
  }
  return {
    queryClient,
    update(content: string) {
      for (const leg of ["incremental", "legacy"] as const) {
        views[leg].rerender(
          <PreviewTree content={content} leg={leg} wrapper={wrapper} />,
        );
      }
      return {
        incrementalHtml: views.incremental.container.innerHTML,
        incrementalMutations: observers.incremental
          .takeRecords()
          .map(mutationSignature),
        incrementalText: views.incremental.container.textContent ?? "",
        legacyHtml: views.legacy.container.innerHTML,
        legacyMutations: observers.legacy.takeRecords().map(mutationSignature),
      };
    },
    disconnect() {
      observers.incremental.disconnect();
      observers.legacy.disconnect();
    },
  };
}

beforeEach(() => {
  for (const leg of ["incremental", "legacy"] as const) {
    counts[leg].attributeEffects = 0;
    counts[leg].renders = 0;
  }
});

afterEach(() => {
  cleanup();
});

describe("MarkdownPreview incremental re-render schedule", () => {
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

    const advanced = legs.update(`${first}Second paragraph.\n\n`);
    expect(advanced.incrementalHtml).toBe(advanced.legacyHtml);
    expect(advanced.incrementalText).toContain(
      "Continue in Rebuild comments when ready.",
    );

    const completed = legs.update(`${first}Second paragraph.\n\nThird.`);
    expect(completed.incrementalHtml).toBe(completed.legacyHtml);
    legs.disconnect();
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
      const rendered = legs.update(step);
      expect(rendered.incrementalHtml).toBe(rendered.legacyHtml);
      expect(counts.incremental).toEqual(counts.legacy);
    }
    expect(counts.legacy.attributeEffects).toBe(steps.length + 1);
    legs.disconnect();
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
    const legs = createDifferentialLegs(blocks[0] ?? "");
    let body = blocks[0] ?? "";
    for (const block of blocks.slice(1)) {
      body += block;
      const rendered = legs.update(body);
      expect(rendered.incrementalHtml, body).toBe(rendered.legacyHtml);
      expect(rendered.incrementalMutations, body).toEqual(
        rendered.legacyMutations,
      );
    }
    legs.disconnect();
  });
});
