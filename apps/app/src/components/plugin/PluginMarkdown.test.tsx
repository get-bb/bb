// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ExperimentalCodeFenceRendererProps,
  MarkdownProps,
  PluginMessageDirectiveMessage,
  PluginMessageDirectiveProps,
} from "@get-bb/plugin-sdk";
import { LazyPluginMarkdown } from "@/components/plugin/lazy-plugin-renderers";
import { resetAllCrashedPluginSlotsForTest } from "@/components/plugin/PluginSlotMount";
import { LazyMarkdownHtml } from "@/components/ui/lazy-markdown-html";
import { pluginSdkAppImplementation } from "@/lib/plugin-sdk-app-impl";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";

await Promise.all([LazyMarkdownHtml.preload(), LazyPluginMarkdown.preload()]);

const MESSAGE: PluginMessageDirectiveMessage = {
  id: "thr_bot:41",
  threadId: "thr_bot",
  turnId: "turn_7",
  projectId: "proj_bots",
};

const CONTENT = [
  "The brief is ready.",
  "",
  "```ui",
  'Card("Morning brief", [])',
  "```",
  "",
  '::task{id="ptask_1"}',
].join("\n");

function UiFence(props: ExperimentalCodeFenceRendererProps) {
  return (
    <div
      data-testid="ui-fence"
      data-code={props.code}
      data-status={props.status}
      data-message-id={props.message.id}
      data-thread-id={props.message.threadId}
    />
  );
}

function TaskChip(props: PluginMessageDirectiveProps) {
  return (
    <span
      data-testid="task-chip"
      data-task-id={props.attributes.id ?? ""}
      data-thread-id={props.message.threadId}
      data-turn-id={props.message.turnId ?? ""}
      data-project-id={props.message.projectId ?? ""}
      data-can-open-workspace-file={String(props.openWorkspaceFile !== null)}
    />
  );
}

function renderMarkdown(props: MarkdownProps) {
  const Markdown = pluginSdkAppImplementation.Markdown;
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <Markdown {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  setPluginSlotRegistrations(
    "demo",
    makePluginRegistrationSet({
      codeFenceRenderers: [
        { id: "generative-ui", languages: ["ui"], component: UiFence },
      ],
      messageDirectives: [{ id: "task", component: TaskChip }],
    }),
  );
});

afterEach(() => {
  cleanup();
  resetAllCrashedPluginSlotsForTest();
  resetPluginSlotStoreForTest();
  vi.restoreAllMocks();
});

describe("plugin SDK Markdown with experimental_message", () => {
  it("renders registered code fences and directives as the timeline does", () => {
    const view = renderMarkdown({
      content: CONTENT,
      experimental_message: MESSAGE,
    });

    const fence = screen.getByTestId("ui-fence");
    expect(fence.getAttribute("data-code")).toBe('Card("Morning brief", [])');
    expect(fence.getAttribute("data-status")).toBe("closed");
    expect(fence.getAttribute("data-message-id")).toBe("thr_bot:41");
    expect(fence.getAttribute("data-thread-id")).toBe("thr_bot");
    const chip = screen.getByTestId("task-chip");
    expect(chip.getAttribute("data-task-id")).toBe("ptask_1");
    expect(chip.getAttribute("data-thread-id")).toBe("thr_bot");
    expect(chip.getAttribute("data-turn-id")).toBe("turn_7");
    expect(chip.getAttribute("data-project-id")).toBe("proj_bots");
    expect(chip.getAttribute("data-can-open-workspace-file")).toBe("false");
    expect(view.container.textContent).toContain("The brief is ready.");
    expect(view.container.textContent).not.toContain("::task");
  });

  it("keeps fences as code and directives as source text without a message", () => {
    const view = renderMarkdown({ content: CONTENT });

    expect(screen.queryByTestId("ui-fence")).toBeNull();
    expect(screen.queryByTestId("task-chip")).toBeNull();
    expect(view.container.textContent).toContain('Card("Morning brief", [])');
    expect(view.container.textContent).toContain('::task{id="ptask_1"}');
  });

  it("keeps a code example literal inside a rendered directive", () => {
    const Markdown = pluginSdkAppImplementation.Markdown;
    setPluginSlotRegistrations(
      "examples",
      makePluginRegistrationSet({
        messageDirectives: [
          {
            id: "example",
            component: () => <Markdown content={"```ui\nexample card\n```"} />,
          },
        ],
      }),
    );
    const view = renderMarkdown({
      content: '::example{id="1"}',
      experimental_message: MESSAGE,
    });

    expect(screen.queryByTestId("ui-fence")).toBeNull();
    expect(view.container.querySelector("pre code")?.textContent).toContain(
      "example card",
    );
  });

  it("ignores a message without a thread id", () => {
    renderMarkdown({
      content: CONTENT,
      experimental_message: { ...MESSAGE, threadId: " " },
    });

    expect(screen.queryByTestId("ui-fence")).toBeNull();
    expect(screen.queryByTestId("task-chip")).toBeNull();
  });
});
