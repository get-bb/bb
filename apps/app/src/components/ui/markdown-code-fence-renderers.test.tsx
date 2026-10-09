// @vitest-environment jsdom

import { useEffect, type ComponentType } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExperimentalCodeFenceRendererProps } from "@get-bb/plugin-sdk";
import { MemoryRouter } from "react-router-dom";
import { RouteNavigationProvider } from "@/components/ui/app-route-anchor";
import { resetAllCrashedPluginSlotsForTest } from "@/components/plugin/PluginSlotMount";
import { ConversationMessageContent } from "@/components/thread/timeline/ConversationMessageContent";
import { ThreadTimelineRows } from "@/components/thread/timeline/ThreadTimelineRows";
import { conversationRow } from "@/test/fixtures/thread-timeline-rows";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
  type PluginCodeFenceRendererSlot,
} from "@/lib/plugin-slots";
import {
  buildCodeFenceRendererRegistry,
  CodeFenceRendererRegistryProvider,
  type CodeFenceRendererRegistry,
} from "./markdown-code-fence-renderers";
import { MarkdownPreview } from "./markdown-preview";

const MESSAGE = {
  id: "msg_1",
  threadId: "thr_1",
  turnId: "turn_1",
  projectId: "proj_1",
} as const;

function UiFence(props: ExperimentalCodeFenceRendererProps) {
  return (
    <div
      data-testid="ui-fence"
      data-code={props.code}
      data-language={props.language}
      data-index={String(props.index)}
      data-complete={String(props.complete)}
      data-message-id={props.message.id}
      data-thread-id={props.message.threadId}
      data-turn-id={props.message.turnId ?? ""}
      data-project-id={props.message.projectId ?? ""}
    />
  );
}

function slot(
  component: ComponentType<ExperimentalCodeFenceRendererProps>,
  overrides: Partial<PluginCodeFenceRendererSlot> = {},
): PluginCodeFenceRendererSlot {
  return {
    id: "generative-ui",
    pluginId: "demo",
    generation: 1,
    languages: ["ui"],
    component,
    ...overrides,
  };
}

function fenceRenderers(registry: CodeFenceRendererRegistry) {
  return { registry, message: MESSAGE, openThreadPanel: null };
}

function renderedFences() {
  return screen.getAllByTestId("ui-fence").map((node) => ({
    code: node.getAttribute("data-code"),
    complete: node.getAttribute("data-complete"),
    index: node.getAttribute("data-index"),
  }));
}

function assistantMessage(
  registry: CodeFenceRendererRegistry,
  text: string,
  streaming = false,
) {
  return (
    <MemoryRouter>
      <RouteNavigationProvider>
        <CodeFenceRendererRegistryProvider registry={registry}>
          <ConversationMessageContent
            role="assistant"
            attachments={null}
            id="msg_a"
            threadId="thr_a"
            turnId="turn_a"
            streaming={streaming}
            showActions={false}
            mobileActionDisplay="inline"
            text={text}
            timestamp={0}
            projectId="proj_a"
          />
        </CodeFenceRendererRegistryProvider>
      </RouteNavigationProvider>
    </MemoryRouter>
  );
}

afterEach(() => {
  cleanup();
  resetAllCrashedPluginSlotsForTest();
  resetPluginSlotStoreForTest();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("code fence renderers in assistant messages", () => {
  it("renders claimed fences with code, language, per-language index, completion, and message", () => {
    const registry = buildCodeFenceRendererRegistry([slot(UiFence)]);
    const view = render(
      assistantMessage(
        registry,
        [
          "Intro",
          "",
          "```ui",
          "{ first }",
          "```",
          "",
          "```ts",
          "const between = 1;",
          "```",
          "",
          "```UI extra-meta",
          "{ second }",
          "```",
        ].join("\n"),
      ),
    );

    expect(renderedFences()).toEqual([
      { code: "{ first }", complete: "true", index: "0" },
      { code: "{ second }", complete: "true", index: "1" },
    ]);
    const first = screen.getAllByTestId("ui-fence")[0]!;
    expect(first.getAttribute("data-language")).toBe("ui");
    expect(first.getAttribute("data-message-id")).toBe("msg_a");
    expect(first.getAttribute("data-thread-id")).toBe("thr_a");
    expect(first.getAttribute("data-turn-id")).toBe("turn_a");
    expect(first.getAttribute("data-project-id")).toBe("proj_a");
    expect(view.container.textContent).toContain("const between = 1;");
    expect(view.container.textContent).not.toContain("{ first }");
  });

  it("renders the same fence as BB's code block in a user message", () => {
    const registry = buildCodeFenceRendererRegistry([slot(UiFence)]);
    const view = render(
      <MemoryRouter>
        <RouteNavigationProvider>
          <CodeFenceRendererRegistryProvider registry={registry}>
            <ConversationMessageContent
              role="user"
              attachments={null}
              initiator="user"
              mentions={[]}
              senderThreadId={null}
              senderThreadTitle={null}
              senderIsPluginSideChat={false}
              systemMessageKind="unlabeled"
              systemMessageSubject={null}
              text={"```ui\n{ user }\n```"}
              timestamp={0}
              turnRequest={{
                isGrouped: false,
                kind: "message",
                status: "accepted",
              }}
              projectId="proj_a"
            />
          </CodeFenceRendererRegistryProvider>
        </RouteNavigationProvider>
      </MemoryRouter>,
    );

    expect(screen.queryByTestId("ui-fence")).toBeNull();
    expect(view.container.textContent).toContain("{ user }");
  });

  it("keeps fence indexes message-wide across the streaming settled and tail split", () => {
    const registry = buildCodeFenceRendererRegistry([slot(UiFence)]);
    render(
      assistantMessage(
        registry,
        [
          "```ui",
          "{ settled }",
          "```",
          "",
          "Between.",
          "",
          "```ui",
          "{ tail",
        ].join("\n"),
        true,
      ),
    );

    expect(renderedFences()).toEqual([
      { code: "{ settled }", complete: "true", index: "0" },
      { code: "{ tail", complete: "false", index: "1" },
    ]);
  });

  it("mounts claimed fences in assistant rows from the slot store and lets the first plugin win a collision", () => {
    function ZetaFence() {
      return <div data-testid="zeta-fence" />;
    }
    setPluginSlotRegistrations(
      "zeta",
      makePluginRegistrationSet({
        codeFenceRenderers: [
          { id: "zeta-ui", languages: ["ui"], component: ZetaFence },
        ],
      }),
    );
    setPluginSlotRegistrations(
      "alpha",
      makePluginRegistrationSet({
        codeFenceRenderers: [
          { id: "alpha-ui", languages: ["ui"], component: UiFence },
        ],
      }),
    );

    render(
      <MemoryRouter>
        <ThreadTimelineRows
          threadId="thr_main"
          projectId="proj_main"
          timelineRows={[
            conversationRow({
              id: "asst_1",
              role: "assistant",
              text: "```ui\n{ row }\n```",
              threadId: "thr_main",
              turnId: "turn_top",
            }),
          ]}
          threadRuntimeDisplayStatus="active"
          workspaceRootPath={undefined}
        />
      </MemoryRouter>,
    );

    expect(screen.queryByTestId("zeta-fence")).toBeNull();
    expect(screen.getByTestId("ui-fence").getAttribute("data-code")).toBe(
      "{ row }",
    );
    expect(console.warn).toHaveBeenCalledWith(
      '[plugin] code fence language "ui" claimed by multiple plugins (alpha, zeta); rendering with alpha',
    );
  });
});

describe("MarkdownPreview code fence renderers", () => {
  it("reports an unclosed fence as incomplete and keeps the same mount when it closes", () => {
    let mounts = 0;
    function StatefulFence(props: ExperimentalCodeFenceRendererProps) {
      useEffect(() => {
        mounts += 1;
      }, []);
      return <UiFence {...props} />;
    }
    const renderers = fenceRenderers(
      buildCodeFenceRendererRegistry([slot(StatefulFence)]),
    );
    const view = render(
      <MarkdownPreview
        content={"Intro\n\n```ui\n{ partial"}
        incrementalBlocks
        codeFenceRenderers={renderers}
      />,
    );
    expect(renderedFences()).toEqual([
      { code: "{ partial", complete: "false", index: "0" },
    ]);

    view.rerender(
      <MarkdownPreview
        content={"Intro\n\n```ui\n{ partial }\n```"}
        incrementalBlocks
        codeFenceRenderers={renderers}
      />,
    );
    expect(renderedFences()).toEqual([
      { code: "{ partial }", complete: "true", index: "0" },
    ]);

    view.rerender(
      <MarkdownPreview
        content={"Intro\n\n```ui\n{ partial }\n```\n\nLater prose."}
        incrementalBlocks
        codeFenceRenderers={renderers}
      />,
    );
    expect(screen.getByText("Later prose.")).toBeTruthy();
    expect(mounts).toBe(1);
  });

  it.each([
    ["an empty closed fence", "```ui\n```", "true"],
    ["a closed fence with a blank body", "```ui\n\n```", "true"],
    ["a longer closing fence", "```ui\na\n`````", "true"],
    ["a shorter closing run", "````ui\na\n```", "false"],
    ["an over-indented closing run", "```ui\na\n    ```", "false"],
    ["a trailing newline without a closing fence", "```ui\na\n", "false"],
    [
      "a closed fence in a nested list",
      "- x\n\n  - y\n\n    ```ui\n    a\n    ```",
      "true",
    ],
    [
      "an open fence in a nested list",
      "- x\n\n  - y\n\n    ```ui\n    a\n",
      "false",
    ],
    ["a closed fence in a blockquote", "> ```ui\n> a\n> ```", "true"],
    ["an open fence in a blockquote", "> ```ui\n> a\n\nafter", "false"],
    ["a closed tilde fence", "~~~ui\na\n~~~", "true"],
  ])(
    "derives completion from the source for %s",
    (_label, content, complete) => {
      render(
        <MarkdownPreview
          content={content}
          codeFenceRenderers={fenceRenderers(
            buildCodeFenceRendererRegistry([slot(UiFence)]),
          )}
        />,
      );
      expect(screen.getByTestId("ui-fence").getAttribute("data-complete")).toBe(
        complete,
      );
    },
  );

  it("renders BB's original code block through Original", () => {
    function DelegatingFence({ Original }: ExperimentalCodeFenceRendererProps) {
      return (
        <section data-testid="delegating-fence">
          <Original />
        </section>
      );
    }
    render(
      <MarkdownPreview
        content={"```ui\n{ delegated }\n```"}
        codeFenceRenderers={fenceRenderers(
          buildCodeFenceRendererRegistry([slot(DelegatingFence)]),
        )}
      />,
    );
    const wrapper = screen.getByTestId("delegating-fence");
    expect(wrapper.textContent).toContain("{ delegated }");
    expect(
      wrapper.querySelector('button[aria-label="Wrap long lines"]'),
    ).not.toBeNull();
  });

  it("falls back to BB's code block when the renderer crashes", () => {
    function CrashingFence(): never {
      throw new Error("fence boom");
    }
    const view = render(
      <MarkdownPreview
        content={"```ui\n{ crash }\n```"}
        codeFenceRenderers={fenceRenderers(
          buildCodeFenceRendererRegistry([slot(CrashingFence)]),
        )}
      />,
    );
    expect(view.container.textContent).toContain("{ crash }");
    expect(
      view.container.querySelector('button[aria-label="Wrap long lines"]'),
    ).not.toBeNull();
    expect(view.container.textContent).not.toContain("crashed");
  });

  it("leaves fences on BB's code block without the codeFenceRenderers prop", () => {
    const view = render(<MarkdownPreview content={"```ui\n{ plain }\n```"} />);
    expect(screen.queryByTestId("ui-fence")).toBeNull();
    expect(view.container.textContent).toContain("{ plain }");
  });
});

describe("buildCodeFenceRendererRegistry", () => {
  it("keeps the first claimant per language and warns about the collision", () => {
    const warn = vi.fn();
    const alpha = slot(UiFence, {
      pluginId: "alpha",
      languages: ["ui", "app"],
    });
    const zeta = slot(UiFence, { pluginId: "zeta", languages: ["ui"] });
    const registry = buildCodeFenceRendererRegistry([alpha, zeta], { warn });

    expect(registry.get("ui")).toBe(alpha);
    expect(registry.get("app")).toBe(alpha);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      '[plugin] code fence language "ui" claimed by multiple plugins (alpha, zeta); rendering with alpha',
    );
  });
});
