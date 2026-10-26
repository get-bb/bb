// @vitest-environment jsdom

import { useEffect, useState, type ComponentType } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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
  CodeFenceRendererHost,
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
      data-status={props.status}
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

function renderedFences() {
  return screen.getAllByTestId("ui-fence").map((node) => ({
    code: node.getAttribute("data-code"),
    status: node.getAttribute("data-status"),
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

function hostedMarkdown(
  registry: CodeFenceRendererRegistry,
  content: string,
  streaming = false,
) {
  return (
    <CodeFenceRendererHost
      registry={registry}
      message={MESSAGE}
      openThreadPanel={null}
      streaming={streaming}
    >
      <MarkdownPreview content={content} />
    </CodeFenceRendererHost>
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
  it("renders claimed fences with code, language, per-language index, status, and message", () => {
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
      { code: "{ first }", status: "closed", index: "0" },
      { code: "{ second }", status: "closed", index: "1" },
    ]);
    const first = screen.getAllByTestId("ui-fence")[0];
    expect(first?.getAttribute("data-language")).toBe("ui");
    expect(first?.getAttribute("data-message-id")).toBe("msg_a");
    expect(first?.getAttribute("data-thread-id")).toBe("thr_a");
    expect(first?.getAttribute("data-turn-id")).toBe("turn_a");
    expect(first?.getAttribute("data-project-id")).toBe("proj_a");
    expect(view.container.textContent).toContain("const between = 1;");
    expect(
      view.container.querySelectorAll('button[aria-label="Wrap lines"]'),
    ).toHaveLength(1);
  });

  it("renders claimed fences in document order between the surrounding prose", () => {
    const registry = buildCodeFenceRendererRegistry([slot(UiFence)]);
    const view = render(
      assistantMessage(registry, "Before\n\n```ui\n{ a }\n```\n\nAfter"),
    );
    const fence = screen.getByTestId("ui-fence");
    const before = screen.getByText("Before");
    const after = screen.getByText("After");
    expect(view.container.contains(fence)).toBe(true);
    expect(
      before.compareDocumentPosition(fence) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      fence.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("keeps BB's code block in user messages", () => {
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
              text={"```ui\n{ mine }\n```"}
              timestamp={0}
              threadId="thr_a"
              turnRequest={{
                isGrouped: false,
                kind: "message",
                status: "accepted",
              }}
            />
          </CodeFenceRendererRegistryProvider>
        </RouteNavigationProvider>
      </MemoryRouter>,
    );
    expect(screen.queryByTestId("ui-fence")).toBeNull();
    expect(view.container.textContent).toContain("{ mine }");
  });

  it("keeps one component instance and its state from the first streamed line until the reply has finished", () => {
    let mounts = 0;
    function StatefulFence(props: ExperimentalCodeFenceRendererProps) {
      const [clicks, setClicks] = useState(0);
      useEffect(() => {
        mounts += 1;
      }, []);
      return (
        <button
          type="button"
          data-testid="stateful-fence"
          data-code={props.code}
          data-status={props.status}
          data-index={String(props.index)}
          onClick={() => setClicks((value) => value + 1)}
        >
          clicks {clicks}
        </button>
      );
    }
    const registry = buildCodeFenceRendererRegistry([slot(StatefulFence)]);
    const steps: ReadonlyArray<readonly [string, string, string]> = [
      ["Intro\n\n```ui\n{ par", "{ par", "streaming"],
      ["Intro\n\n```ui\n{ partial }\n", "{ partial }", "streaming"],
      ["Intro\n\n```ui\n{ partial }\n```\n", "{ partial }", "closed"],
      [
        "Intro\n\n```ui\n{ partial }\n```\n\nLater prose.\n\nMore pro",
        "{ partial }",
        "closed",
      ],
    ];
    const view = render(assistantMessage(registry, steps[0]![0], true));
    fireEvent.click(screen.getByTestId("stateful-fence"));
    for (const [text, code, status] of steps) {
      view.rerender(assistantMessage(registry, text, true));
      const fence = screen.getByTestId("stateful-fence");
      expect(fence.getAttribute("data-code")).toBe(code);
      expect(fence.getAttribute("data-status")).toBe(status);
      expect(fence.getAttribute("data-index")).toBe("0");
      expect(fence.textContent).toBe("clicks 1");
    }
    expect(
      view.container.querySelectorAll("[data-markdown-preview]"),
    ).toHaveLength(2);
    expect(
      view.container
        .querySelectorAll("[data-markdown-preview]")[0]
        ?.contains(screen.getByTestId("stateful-fence")),
    ).toBe(true);

    view.rerender(
      assistantMessage(
        registry,
        "Intro\n\n```ui\n{ partial }\n```\n\nLater prose.\n\nMore prose.",
        false,
      ),
    );
    const settled = screen.getByTestId("stateful-fence");
    expect(settled.textContent).toBe("clicks 1");
    expect(settled.getAttribute("data-status")).toBe("closed");
    expect(screen.getByText("More prose.")).toBeTruthy();
    expect(mounts).toBe(1);
  });

  it("numbers fences across the settled and streaming regions of one reply", () => {
    const registry = buildCodeFenceRendererRegistry([slot(UiFence)]);
    const view = render(
      assistantMessage(
        registry,
        "```ui\n{ settled }\n```\n\nMiddle prose.\n\n```ui\n{ tail",
        true,
      ),
    );
    expect(
      view.container.querySelectorAll("[data-markdown-preview]"),
    ).toHaveLength(2);
    expect(renderedFences()).toEqual([
      { code: "{ settled }", status: "closed", index: "0" },
      { code: "{ tail", status: "streaming", index: "1" },
    ]);
  });

  it("reports a fence the reply never closed as unclosed once streaming stops", () => {
    const registry = buildCodeFenceRendererRegistry([slot(UiFence)]);
    const view = render(assistantMessage(registry, "```ui\n{ cut", true));
    expect(renderedFences()).toEqual([
      { code: "{ cut", status: "streaming", index: "0" },
    ]);
    view.rerender(assistantMessage(registry, "```ui\n{ cut", false));
    expect(renderedFences()).toEqual([
      { code: "{ cut", status: "unclosed", index: "0" },
    ]);
  });

  it("removes a fence's component when the fence leaves the message", async () => {
    const registry = buildCodeFenceRendererRegistry([slot(UiFence)]);
    const view = render(assistantMessage(registry, "```ui\n{ gone }\n```"));
    expect(screen.getAllByTestId("ui-fence")).toHaveLength(1);
    view.rerender(assistantMessage(registry, "Plain prose only."));
    await waitFor(() => {
      expect(screen.queryByTestId("ui-fence")).toBeNull();
      expect(
        view.container.querySelector("[data-code-fence-parking]"),
      ).toBeNull();
    });
  });

  it("keeps claimed fences through the sanitized HTML pipeline", () => {
    const registry = buildCodeFenceRendererRegistry([slot(UiFence)]);
    render(
      assistantMessage(
        registry,
        "<details><summary>More</summary>hidden</details>\n\n```ui\n<div>page</div>\n```",
      ),
    );
    return screen.findByTestId("ui-fence").then((fence) => {
      expect(fence.getAttribute("data-code")).toBe("<div>page</div>");
      expect(fence.getAttribute("data-status")).toBe("closed");
    });
  });

  it("isolates a crash to one fence and tries that fence again when its code changes", () => {
    function FragileFence(props: ExperimentalCodeFenceRendererProps) {
      if (props.code.includes("{ bad")) {
        throw new Error("fence boom");
      }
      return <UiFence {...props} />;
    }
    const registry = buildCodeFenceRendererRegistry([slot(FragileFence)]);
    const view = render(
      assistantMessage(registry, "```ui\n{ good }\n```\n\n```ui\n{ bad", true),
    );
    expect(renderedFences()).toEqual([
      { code: "{ good }", status: "closed", index: "0" },
    ]);
    expect(view.container.textContent).toContain("{ bad");
    expect(view.container.textContent).not.toContain("crashed");
    expect(
      view.container.querySelectorAll('button[aria-label="Wrap lines"]'),
    ).toHaveLength(1);

    view.rerender(
      assistantMessage(
        registry,
        "```ui\n{ good }\n```\n\n```ui\n{ fixed }\n```",
        true,
      ),
    );
    expect(renderedFences()).toEqual([
      { code: "{ good }", status: "closed", index: "0" },
      { code: "{ fixed }", status: "closed", index: "1" },
    ]);
    expect(
      view.container.querySelectorAll('button[aria-label="Wrap lines"]'),
    ).toHaveLength(0);
  });

  it("renders BB's code block for a language two plugins claim, from the slot store", () => {
    function ZetaFence() {
      return <div data-testid="zeta-fence" />;
    }
    setPluginSlotRegistrations(
      "zeta",
      makePluginRegistrationSet({
        codeFenceRenderers: [
          { id: "zeta-ui", languages: ["ui", "app"], component: ZetaFence },
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

    const view = render(
      <MemoryRouter>
        <ThreadTimelineRows
          threadId="thr_main"
          projectId="proj_main"
          timelineRows={[
            conversationRow({
              id: "asst_1",
              role: "assistant",
              text: "```ui\n{ contested }\n```\n\n```app\n{ sole }\n```",
              threadId: "thr_main",
              turnId: "turn_top",
            }),
          ]}
          threadRuntimeDisplayStatus="active"
          workspaceRootPath={undefined}
        />
      </MemoryRouter>,
    );

    expect(screen.queryByTestId("ui-fence")).toBeNull();
    expect(screen.getAllByTestId("zeta-fence")).toHaveLength(1);
    expect(view.container.textContent).toContain("{ contested }");
    expect(console.warn).toHaveBeenCalledWith(
      '[plugin] code fence language "ui" claimed by multiple plugins (alpha, zeta); rendering BB\'s code block',
    );
  });
});

describe("MarkdownPreview inside a code fence host", () => {
  it.each([
    ["an empty closed fence", "```ui\n```", "closed"],
    ["a closed fence with a blank body", "```ui\n\n```", "closed"],
    ["a longer closing fence", "```ui\na\n`````", "closed"],
    ["a shorter closing run", "````ui\na\n```", "unclosed"],
    ["an over-indented closing run", "```ui\na\n    ```", "unclosed"],
    ["a trailing newline without a closing fence", "```ui\na\n", "unclosed"],
    [
      "a closed fence in a nested list",
      "- x\n\n  - y\n\n    ```ui\n    a\n    ```",
      "closed",
    ],
    [
      "an open fence in a nested list",
      "- x\n\n  - y\n\n    ```ui\n    a\n",
      "unclosed",
    ],
    ["a closed fence in a blockquote", "> ```ui\n> a\n> ```", "closed"],
    ["an open fence in a blockquote", "> ```ui\n> a\n\nafter", "unclosed"],
    ["a closed tilde fence", "~~~ui\na\n~~~", "closed"],
  ])("derives the status from the source for %s", (_label, content, status) => {
    render(
      hostedMarkdown(buildCodeFenceRendererRegistry([slot(UiFence)]), content),
    );
    expect(screen.getByTestId("ui-fence").getAttribute("data-status")).toBe(
      status,
    );
  });

  it("renders BB's original code block through Original", () => {
    function DelegatingFence({ Original }: ExperimentalCodeFenceRendererProps) {
      return (
        <section data-testid="delegating-fence">
          <Original />
        </section>
      );
    }
    render(
      hostedMarkdown(
        buildCodeFenceRendererRegistry([slot(DelegatingFence)]),
        "```ui\n{ delegated }\n```",
      ),
    );
    const wrapper = screen.getByTestId("delegating-fence");
    expect(wrapper.textContent).toContain("{ delegated }");
    expect(
      wrapper.querySelector('button[aria-label="Wrap lines"]'),
    ).not.toBeNull();
  });

  it("leaves fences on BB's code block outside a host", () => {
    const view = render(<MarkdownPreview content={"```ui\n{ plain }\n```"} />);
    expect(screen.queryByTestId("ui-fence")).toBeNull();
    expect(view.container.textContent).toContain("{ plain }");
  });
});

describe("buildCodeFenceRendererRegistry", () => {
  it("drops a language two plugins claim, keeps the rest, and warns once", () => {
    const warn = vi.fn();
    const alpha = slot(UiFence, {
      pluginId: "alpha",
      languages: ["ui", "app"],
    });
    const zeta = slot(UiFence, { pluginId: "zeta", languages: ["ui"] });
    const registry = buildCodeFenceRendererRegistry([zeta, alpha], { warn });

    expect(registry.has("ui")).toBe(false);
    expect(registry.get("app")).toBe(alpha);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      '[plugin] code fence language "ui" claimed by multiple plugins (alpha, zeta); rendering BB\'s code block',
    );
  });
});
