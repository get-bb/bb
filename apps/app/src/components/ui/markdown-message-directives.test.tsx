// @vitest-environment jsdom

import { useEffect } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk";
import { useBbNavigate } from "@/lib/plugin-sdk-hooks";
import { MarkdownPreview } from "./markdown-preview";
import {
  buildMessageDirectiveRegistry,
  MESSAGE_DIRECTIVE_MOUNT_LIMIT,
  MessageDirectiveRegistryProvider,
} from "./markdown-message-directives";
import {
  resetAllCrashedPluginSlotsForTest,
  resetCrashedPluginSlots,
} from "@/components/plugin/PluginSlotMount";
import type { PluginMessageDirectiveSlot } from "@/lib/plugin-slots";
import { ConversationMessageContent } from "@/components/thread/timeline/ConversationMessageContent";
import { MemoryRouter } from "react-router-dom";
import { RouteNavigationProvider } from "@/components/ui/app-route-anchor";
import { ThreadTimelineRows } from "@/components/thread/timeline/ThreadTimelineRows";
import {
  conversationRow,
  delegationRow,
} from "@/test/fixtures/thread-timeline-rows";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
  type PluginRegistrationSet,
} from "@/lib/plugin-slots";

function InlineVis(props: PluginMessageDirectiveProps) {
  return (
    <div
      data-testid="inline-vis"
      data-file={props.attributes.file ?? ""}
      data-source={props.source}
      data-message-id={props.message.id}
      data-thread-id={props.message.threadId}
      data-turn-id={props.message.turnId ?? ""}
      data-project-id={props.message.projectId ?? ""}
      data-can-open-workspace-file={String(props.openWorkspaceFile !== null)}
    >
      vis:{props.attributes.file}
    </div>
  );
}

function CrashVis(_props: PluginMessageDirectiveProps): never {
  throw new Error("directive boom");
}

function WorkspaceFileVis(props: PluginMessageDirectiveProps) {
  if (props.openWorkspaceFile === null) {
    return <span>workspace opener unavailable</span>;
  }
  return (
    <button
      type="button"
      onClick={() => props.openWorkspaceFile?.(props.attributes.file ?? "")}
    >
      Open workspace file
    </button>
  );
}

function ThreadPanelVis(_props: PluginMessageDirectiveProps) {
  const navigate = useBbNavigate();
  return (
    <button
      type="button"
      onClick={() =>
        navigate.openThreadPanel({
          actionId: "document",
          title: "Plan",
          params: { path: "plan.md" },
        })
      }
    >
      Open thread panel
    </button>
  );
}

function slot(
  overrides: Partial<PluginMessageDirectiveSlot> &
    Pick<PluginMessageDirectiveSlot, "id" | "pluginId" | "component">,
): PluginMessageDirectiveSlot {
  return {
    generation: 1,
    ...overrides,
  };
}

function emptyRegistrationSet(
  overrides: Partial<PluginRegistrationSet> = {},
): PluginRegistrationSet {
  return {
    homepageSections: [],
    settingsSections: [],
    navPanels: [],
    threadPanelActions: [],
    pendingInteractions: [],
    sidebarFooterActions: [],
    fileOpeners: [],
    messageDirectives: [],
    ...overrides,
  };
}

const MESSAGE = {
  id: "msg_1",
  threadId: "thr_1",
  turnId: "turn_1",
  projectId: "proj_1",
} as const;

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

describe("MarkdownPreview message directives", () => {
  it("mounts a recognized leaf directive with attributes, source, and message", () => {
    const registry = buildMessageDirectiveRegistry([
      slot({ id: "inline-vis", pluginId: "demo", component: InlineVis }),
    ]);
    render(
      <MarkdownPreview
        content={'Intro\n\n::inline-vis{file="demo.html"}\n\nOutro'}
        messageDirectives={{
          registry,
          message: MESSAGE,
          openWorkspaceFile: null,
        }}
      />,
    );

    const mount = screen.getByTestId("inline-vis");
    expect(mount.getAttribute("data-file")).toBe("demo.html");
    expect(mount.getAttribute("data-source")).toBe(
      '::inline-vis{file="demo.html"}',
    );
    expect(mount.getAttribute("data-message-id")).toBe("msg_1");
    expect(mount.getAttribute("data-thread-id")).toBe("thr_1");
    expect(mount.getAttribute("data-turn-id")).toBe("turn_1");
    expect(mount.getAttribute("data-project-id")).toBe("proj_1");
    expect(screen.getByText("Intro")).toBeTruthy();
    expect(screen.getByText("Outro")).toBeTruthy();
  });

  it("keeps directives in fenced code and inline code literal", () => {
    const registry = buildMessageDirectiveRegistry([
      slot({ id: "inline-vis", pluginId: "demo", component: InlineVis }),
    ]);
    render(
      <MarkdownPreview
        content={[
          'Inline `::inline-vis{file="x.html"}` stays code.',
          "",
          "```",
          '::inline-vis{file="y.html"}',
          "```",
        ].join("\n")}
        messageDirectives={{
          registry,
          message: MESSAGE,
          openWorkspaceFile: null,
        }}
      />,
    );

    expect(screen.queryByTestId("inline-vis")).toBeNull();
    expect(screen.getByText('::inline-vis{file="x.html"}')).toBeTruthy();
    expect(screen.getByText('::inline-vis{file="y.html"}')).toBeTruthy();
  });

  it("renders unknown and incomplete directives as exact source text", () => {
    const registry = buildMessageDirectiveRegistry([
      slot({ id: "inline-vis", pluginId: "demo", component: InlineVis }),
    ]);
    render(
      <MarkdownPreview
        content={[
          '::not-registered{a="1"}',
          "",
          '::inline-vis{file="still-streaming',
        ].join("\n")}
        messageDirectives={{
          registry,
          message: MESSAGE,
          openWorkspaceFile: null,
        }}
      />,
    );

    expect(screen.queryByTestId("inline-vis")).toBeNull();
    expect(screen.getByText('::not-registered{a="1"}')).toBeTruthy();
    expect(screen.getByText('::inline-vis{file="still-streaming')).toBeTruthy();
  });

  it("renders incidental prose colons literally without dropping text", () => {
    // Regression: `remark-directive` parses `13:30`, `a:b`, and `:D` as text
    // directives. Before the fix these fell through to mdast-util-to-hast as
    // empty block `<div>`s, which split the paragraph and deleted the colon
    // text — e.g. "next run 13:30." rendered as "next run 13" + a stray line
    // break + ". ...".
    const registry = buildMessageDirectiveRegistry([
      slot({ id: "inline-vis", pluginId: "demo", component: InlineVis }),
    ]);
    const sentence =
      "Watchdog runs every 30 min UTC, next run 13:30. It checks a:b and :D too.";
    const { container } = render(
      <MarkdownPreview
        content={sentence}
        messageDirectives={{
          registry,
          message: MESSAGE,
          openWorkspaceFile: null,
        }}
      />,
    );

    const paragraphs = container.querySelectorAll("p");
    expect(paragraphs).toHaveLength(1);
    // Exact text preserved: no dropped `:30` / `:b` / `:D`.
    expect(paragraphs[0]?.textContent).toBe(sentence);
    // No block element was injected mid-paragraph to break the line.
    expect(paragraphs[0]?.querySelector("div")).toBeNull();
    expect(screen.queryByTestId("inline-vis")).toBeNull();
  });

  it("keeps clock times intact and leaves the prose as a single text node", () => {
    // The originally reported symptom: "Meeting at 9:30 and 10:45 today."
    // rendered as "Meeting at 9 and 10 today." — both `:30` and `:45` parsed as
    // text directives and were dropped by the empty-`<div>` fallback.
    const registry = buildMessageDirectiveRegistry([
      slot({ id: "inline-vis", pluginId: "demo", component: InlineVis }),
    ]);
    const sentence = "Meeting at 9:30 and 10:45 today.";
    const { container } = render(
      <MarkdownPreview
        content={sentence}
        messageDirectives={{
          registry,
          message: MESSAGE,
          openWorkspaceFile: null,
        }}
      />,
    );

    const paragraph = container.querySelector("p");
    expect(paragraph?.textContent).toBe(sentence);
    // Rewritten directives merge into their neighbours, so the paragraph is
    // indistinguishable from prose that never parsed as a directive.
    expect(paragraph?.childNodes).toHaveLength(1);
    expect(paragraph?.childNodes[0]?.nodeType).toBe(Node.TEXT_NODE);
  });

  it("leaves container directives on the default rendering path", () => {
    // `:::` at the start of a line is not incidental prose, so containers are
    // not rewritten: their content still renders, and a registered leaf
    // directive nested inside one still mounts.
    const registry = buildMessageDirectiveRegistry([
      slot({ id: "inline-vis", pluginId: "demo", component: InlineVis }),
    ]);
    render(
      <MarkdownPreview
        content={
          ':::note\nhello **world**\n\n::inline-vis{file="demo.html"}\n:::'
        }
        messageDirectives={{
          registry,
          message: MESSAGE,
          openWorkspaceFile: null,
        }}
      />,
    );

    expect(screen.getByText("world").tagName).toBe("STRONG");
    expect(screen.getByTestId("inline-vis").getAttribute("data-file")).toBe(
      "demo.html",
    );
  });

  it("falls back to original directive text when the plugin component crashes", () => {
    const registry = buildMessageDirectiveRegistry([
      slot({ id: "inline-vis", pluginId: "demo", component: CrashVis }),
    ]);
    render(
      <MarkdownPreview
        content={'::inline-vis{file="boom.html"}'}
        messageDirectives={{
          registry,
          message: MESSAGE,
          openWorkspaceFile: null,
        }}
      />,
    );

    expect(screen.getByText('::inline-vis{file="boom.html"}')).toBeTruthy();
    expect(screen.queryByText(/plugin demo crashed/i)).toBeNull();
    resetCrashedPluginSlots("demo");
  });

  it("does not activate directives without the messageDirectives prop", () => {
    render(<MarkdownPreview content={'::inline-vis{file="demo.html"}'} />);
    expect(screen.queryByTestId("inline-vis")).toBeNull();
    expect(screen.getByText(/::inline-vis/)).toBeTruthy();
  });

  it("normalizes omitted projectId to null on the message prop", () => {
    const registry = buildMessageDirectiveRegistry([
      slot({ id: "inline-vis", pluginId: "demo", component: InlineVis }),
    ]);
    render(
      <MarkdownPreview
        content={'::inline-vis{file="demo.html"}'}
        messageDirectives={{
          registry,
          message: {
            id: "msg_2",
            threadId: "thr_2",
            turnId: null,
            projectId: null,
          },
          openWorkspaceFile: null,
        }}
      />,
    );
    expect(
      screen.getByTestId("inline-vis").getAttribute("data-project-id"),
    ).toBe("");
    expect(screen.getByTestId("inline-vis").getAttribute("data-turn-id")).toBe(
      "",
    );
  });

  it("caps mounts at the per-message limit", () => {
    const lines: string[] = [];
    for (let i = 0; i < MESSAGE_DIRECTIVE_MOUNT_LIMIT + 2; i += 1) {
      lines.push(`::inline-vis{file="f${i}.html"}`, "");
    }
    const registry = buildMessageDirectiveRegistry([
      slot({ id: "inline-vis", pluginId: "demo", component: InlineVis }),
    ]);
    render(
      <MarkdownPreview
        content={lines.join("\n")}
        messageDirectives={{
          registry,
          message: MESSAGE,
          openWorkspaceFile: null,
        }}
      />,
    );
    expect(screen.getAllByTestId("inline-vis")).toHaveLength(
      MESSAGE_DIRECTIVE_MOUNT_LIMIT,
    );
    expect(
      screen.getByText(
        `::inline-vis{file="f${MESSAGE_DIRECTIVE_MOUNT_LIMIT}.html"}`,
      ),
    ).toBeTruthy();
  });

  it("keeps a completed directive mounted while later assistant text streams", () => {
    let mountCount = 0;
    function StatefulVis(props: PluginMessageDirectiveProps) {
      useEffect(() => {
        mountCount += 1;
      }, []);
      return <div data-testid="stateful-vis">{props.attributes.file}</div>;
    }

    const registry = buildMessageDirectiveRegistry([
      slot({ id: "inline-vis", pluginId: "demo", component: StatefulVis }),
    ]);
    const messageDirectives = {
      registry,
      message: MESSAGE,
      openWorkspaceFile: null,
    };
    const view = render(
      <MarkdownPreview
        content={'::inline-vis{file="demo.html"}'}
        messageDirectives={messageDirectives}
      />,
    );

    expect(screen.getByTestId("stateful-vis")).toBeTruthy();
    expect(mountCount).toBe(1);

    view.rerender(
      <MarkdownPreview
        content={'::inline-vis{file="demo.html"}\n\nLater streamed prose.'}
        messageDirectives={messageDirectives}
      />,
    );

    expect(screen.getByTestId("stateful-vis")).toBeTruthy();
    expect(screen.getByText("Later streamed prose.")).toBeTruthy();
    expect(mountCount).toBe(1);
  });
});

describe("ConversationMessageContent assistant directives", () => {
  it("activates directives for assistant messages when registry context is set", () => {
    const registry = buildMessageDirectiveRegistry([
      slot({ id: "inline-vis", pluginId: "demo", component: InlineVis }),
    ]);
    render(
      <MemoryRouter>
        <RouteNavigationProvider>
          <MessageDirectiveRegistryProvider registry={registry}>
            <ConversationMessageContent
              role="assistant"
              attachments={null}
              id="msg_a"
              threadId="thr_a"
              turnId="turn_a"
              sourceSeqStart={1}
              sourceSeqEnd={1}
              showActions={false}
              text={'::inline-vis{file="a.html"}'}
              turnRequest={null}
              projectId="proj_a"
            />
          </MessageDirectiveRegistryProvider>
        </RouteNavigationProvider>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("inline-vis").getAttribute("data-file")).toBe(
      "a.html",
    );
    expect(
      screen.getByTestId("inline-vis").getAttribute("data-project-id"),
    ).toBe("proj_a");
    expect(
      screen
        .getByTestId("inline-vis")
        .getAttribute("data-can-open-workspace-file"),
    ).toBe("false");
  });

  it("opens a contained directive file through the timeline sidebar handler", () => {
    const onOpenLocalFileLink = vi.fn(() => true);
    const registry = buildMessageDirectiveRegistry([
      slot({
        id: "inline-vis",
        pluginId: "demo",
        component: WorkspaceFileVis,
      }),
    ]);
    render(
      <MemoryRouter>
        <RouteNavigationProvider>
          <MessageDirectiveRegistryProvider registry={registry}>
            <ConversationMessageContent
              role="assistant"
              attachments={null}
              id="msg_a"
              threadId="thr_a"
              turnId="turn_a"
              sourceSeqStart={1}
              sourceSeqEnd={1}
              showActions={false}
              text={'::inline-vis{file="charts/demo.html"}'}
              turnRequest={null}
              projectId="proj_a"
              workspaceRootPath="/workspace/project"
              onOpenLocalFileLink={onOpenLocalFileLink}
            />
          </MessageDirectiveRegistryProvider>
        </RouteNavigationProvider>
      </MemoryRouter>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Open workspace file" }),
    );
    expect(onOpenLocalFileLink).toHaveBeenCalledWith({
      lineRange: null,
      path: "/workspace/project/charts/demo.html",
    });
  });

  it("scopes directive thread-panel actions to the registering plugin", () => {
    const onOpenPluginPanel = vi.fn(() => true);
    const registry = buildMessageDirectiveRegistry([
      slot({
        id: "inline-vis",
        pluginId: "demo",
        component: ThreadPanelVis,
      }),
    ]);
    render(
      <MemoryRouter>
        <RouteNavigationProvider>
          <MessageDirectiveRegistryProvider registry={registry}>
            <ConversationMessageContent
              role="assistant"
              attachments={null}
              id="msg_a"
              threadId="thr_a"
              turnId="turn_a"
              sourceSeqStart={1}
              sourceSeqEnd={1}
              showActions={false}
              text={'::inline-vis{file="plan.md"}'}
              turnRequest={null}
              projectId="proj_a"
              onOpenPluginPanel={onOpenPluginPanel}
            />
          </MessageDirectiveRegistryProvider>
        </RouteNavigationProvider>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open thread panel" }));
    expect(onOpenPluginPanel).toHaveBeenCalledWith({
      pluginId: "demo",
      actionId: "document",
      title: "Plan",
      params: { path: "plan.md" },
    });
  });

  it("rejects directive workspace paths that escape the worktree", () => {
    const onOpenLocalFileLink = vi.fn(() => true);
    const registry = buildMessageDirectiveRegistry([
      slot({
        id: "inline-vis",
        pluginId: "demo",
        component: WorkspaceFileVis,
      }),
    ]);
    render(
      <MemoryRouter>
        <RouteNavigationProvider>
          <MessageDirectiveRegistryProvider registry={registry}>
            <ConversationMessageContent
              role="assistant"
              attachments={null}
              id="msg_a"
              threadId="thr_a"
              turnId="turn_a"
              sourceSeqStart={1}
              sourceSeqEnd={1}
              showActions={false}
              text={'::inline-vis{file="../secret.html"}'}
              turnRequest={null}
              workspaceRootPath="/workspace/project"
              onOpenLocalFileLink={onOpenLocalFileLink}
            />
          </MessageDirectiveRegistryProvider>
        </RouteNavigationProvider>
      </MemoryRouter>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Open workspace file" }),
    );
    expect(onOpenLocalFileLink).not.toHaveBeenCalled();
  });

  it("does not activate directives on user messages even with registry context", () => {
    const registry = buildMessageDirectiveRegistry([
      slot({ id: "inline-vis", pluginId: "demo", component: InlineVis }),
    ]);
    render(
      <MemoryRouter>
        <RouteNavigationProvider>
          <MessageDirectiveRegistryProvider registry={registry}>
            <ConversationMessageContent
              role="user"
              attachments={null}
              originKind={null}
              initiator="user"
              mentions={[]}
              senderThreadId={null}
              senderThreadTitle={null}
              senderIsPluginSideChat={false}
              systemMessageKind="unlabeled"
              systemMessageSubject={null}
              text={'::inline-vis{file="user.html"}'}
              turnRequest={{ kind: "message", status: "accepted" }}
              projectId="proj_a"
            />
          </MessageDirectiveRegistryProvider>
        </RouteNavigationProvider>
      </MemoryRouter>,
    );
    expect(screen.queryByTestId("inline-vis")).toBeNull();
    expect(screen.getByText(/::inline-vis/)).toBeTruthy();
  });
});

describe("ThreadTimelineRows message directive subscription", () => {
  it("mounts directives in assistant and delegation output from the slot store", () => {
    setPluginSlotRegistrations(
      "demo",
      emptyRegistrationSet({
        messageDirectives: [{ id: "inline-vis", component: InlineVis }],
      }),
    );

    render(
      <MemoryRouter>
        <ThreadTimelineRows
          initialExpanded={new Set(["del_1"])}
          threadId="thr_main"
          projectId="proj_main"
          timelineRows={[
            conversationRow({
              id: "asst_1",
              role: "assistant",
              text: '::inline-vis{file="top.html"}',
              threadId: "thr_main",
              turnId: "turn_top",
            }),
            delegationRow({
              id: "del_1",
              status: "pending",
              durationMs: null,
              output: '::inline-vis{file="nested.html"}',
              threadId: "thr_main",
              turnId: "turn_del",
              childRows: [],
            }),
          ]}
          threadRuntimeDisplayStatus="active"
          workspaceRootPath={undefined}
        />
      </MemoryRouter>,
    );

    const mounts = screen.getAllByTestId("inline-vis");
    expect(mounts).toHaveLength(2);
    const files = mounts.map((node) => node.getAttribute("data-file")).sort();
    expect(files).toEqual(["nested.html", "top.html"]);
    expect(mounts[0]?.getAttribute("data-project-id")).toBe("proj_main");
  });

  it("renders colliding cross-plugin directives as literal text", () => {
    setPluginSlotRegistrations(
      "alpha",
      emptyRegistrationSet({
        messageDirectives: [{ id: "inline-vis", component: InlineVis }],
      }),
    );
    setPluginSlotRegistrations(
      "zeta",
      emptyRegistrationSet({
        messageDirectives: [{ id: "inline-vis", component: InlineVis }],
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
              text: '::inline-vis{file="collide.html"}',
              threadId: "thr_main",
            }),
          ]}
          threadRuntimeDisplayStatus="idle"
          workspaceRootPath={undefined}
        />
      </MemoryRouter>,
    );

    expect(screen.queryByTestId("inline-vis")).toBeNull();
    expect(screen.getByText('::inline-vis{file="collide.html"}')).toBeTruthy();
    expect(console.warn as Mock).toHaveBeenCalled();
  });
});
