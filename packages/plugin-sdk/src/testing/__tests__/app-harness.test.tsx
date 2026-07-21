// @vitest-environment jsdom
import { useEffect, useState } from "react";
import { cleanup, fireEvent, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type {
  PluginComposerApi,
  PluginComposerScope,
  PluginMessageDirectiveProps,
  PluginNavPanelProps,
} from "../../app-contract.js";
import { installTestPluginRuntime, loadPluginApp, renderSlot } from "../app.js";
import { defineRpcContract } from "../../rpc-contract.js";

// Install before touching @bb/plugin-sdk/app — it binds the runtime global
// at import time (same constraint real plugin app.tsx files have).
installTestPluginRuntime();
const {
  definePluginApp,
  experimental_ThreadChat: ThreadChat,
  useComposer,
  useComposerView,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
} = await import("../../app.js");

const typedRpcContract = defineRpcContract({
  getItem: {
    input: z.object({ id: z.string() }),
    output: z.object({ title: z.string() }),
  },
});

function TypedRpcPanel() {
  const rpc = useRpc<typeof typedRpcContract>();
  const [title, setTitle] = useState("Loading typed RPC…");
  useEffect(() => {
    void rpc.call("getItem", { id: "item-1" }).then((result) => {
      const exactTitle: string = result.title;
      setTitle(exactTitle);
    });
  }, [rpc]);
  return <div>{title}</div>;
}

afterEach(cleanup);

function Panel({ subPath }: PluginNavPanelProps) {
  const rpc = useRpc();
  const [items, setItems] = useState<string[] | null>(null);
  const refresh = () => {
    void rpc
      .call("listItems", { subPath })
      .then((result) => setItems(result as string[]))
      .catch((error: unknown) =>
        setItems([
          `error: ${error instanceof Error ? error.message : String(error)}`,
        ]),
      );
  };
  useEffect(refresh, []);
  useRealtime("items-changed", refresh);
  if (items === null) return <div>Loading…</div>;
  return (
    <div>
      {items.map((item) => (
        <div key={item}>{item}</div>
      ))}
    </div>
  );
}

function RealtimeConnectionProbe() {
  const state = useRealtimeConnectionState();
  return <div>Realtime: {state}</div>;
}

let capturedComposerVisualSetters: Pick<
  PluginComposerApi,
  "setTextEffect" | "setInputLock" | "setThreadRowStatus"
> | null = null;

function InlineVis({
  attributes,
  source,
  message,
  openThreadPanel,
}: PluginMessageDirectiveProps) {
  return (
    <div>
      <span data-testid="file">{attributes.file ?? ""}</span>
      <span data-testid="source">{source}</span>
      <span data-testid="thread">{message.threadId}</span>
      <span data-testid="thread-panel">
        {openThreadPanel === null ? "unavailable" : "available"}
      </span>
    </div>
  );
}

function ComposerProbe() {
  const composer = useComposer();
  const view = useComposerView();
  capturedComposerVisualSetters = {
    setTextEffect: composer.setTextEffect,
    setInputLock: composer.setInputLock,
    setThreadRowStatus: composer.setThreadRowStatus,
  };
  return (
    <div>
      <span data-testid="composer-scope">{composer.scope.kind}</span>
      <span data-testid="composer-scope-details">
        {JSON.stringify(composer.scope)}
      </span>
      <span data-testid="composer-text">{composer.text}</span>
      <span data-testid="composer-view-text">{view.draft.text}</span>
      <button type="button" onClick={() => composer.setText("replacement")}>
        replace
      </button>
      <button
        type="button"
        onClick={() => composer.updateText((current) => `${current}!`)}
      >
        update
      </button>
      <button type="button" onClick={() => composer.clear()}>
        clear
      </button>
      <button
        type="button"
        onClick={() =>
          composer.setThreadRowStatus({
            icon: "AiContentGenerator01",
            label: "Plugin improving draft",
          })
        }
      >
        set row status
      </button>
      <button type="button" onClick={() => composer.setThreadRowStatus(null)}>
        clear row status
      </button>
      <button type="button" onClick={() => composer.addQuote("picked text")}>
        quote
      </button>
      <button
        type="button"
        onClick={() =>
          composer.insertMention({
            provider: "notes",
            id: "ideas",
            label: "Ideas",
          })
        }
      >
        mention
      </button>
      <button type="button" onClick={() => composer.focus()}>
        focus
      </button>
    </div>
  );
}

const messageActionRuns: unknown[] = [];

function ThreadChatPage({ subPath }: PluginNavPanelProps) {
  return (
    <ThreadChat
      threadId={subPath || "thr_default"}
      variant="compact"
      layout="document"
      focusRequest={2}
      className="demo-chat"
      leadingContent={<div>Replying to something earlier</div>}
      messageActions={[
        {
          id: "send-to-main",
          title: "Send to main thread",
          icon: "ArrowTurnBackward",
          roles: ["assistant"],
          run: (message) => {
            messageActionRuns.push(message);
          },
        },
      ]}
    />
  );
}

const app = await loadPluginApp(
  definePluginApp((builder) => {
    builder.slots.navPanel({
      id: "panel",
      title: "Panel",
      icon: "FileText",
      path: "panel",
      component: Panel,
    });
    builder.slots.navPanel({
      id: "chat",
      title: "Chat",
      icon: "MessageSquarePlus",
      path: "chat",
      component: ThreadChatPage,
    });
    builder.slots.experimental_messageAction({
      id: "summarize",
      title: "Summarize",
      icon: "Zap",
      run(context) {
        messageActionRuns.push(context);
      },
    });
    builder.slots.messageDirective({
      id: "inline-vis",
      component: InlineVis,
    });
    builder.slots.homepageSection({
      id: "realtime-connection",
      title: "Realtime connection",
      component: RealtimeConnectionProbe,
    });
    builder.composer.customize({
      id: "improve-prompt",
      scopes: ["thread", "new-thread"],
      actions: [{ id: "improve", component: ComposerProbe }],
    });
  }),
);

describe("loadPluginApp", () => {
  it("rejects registrations the host would reject, with the host's message", async () => {
    await expect(
      loadPluginApp(
        definePluginApp((builder) => {
          builder.slots.navPanel({
            id: "bad id!",
            title: "x",
            icon: "x",
            path: "p",
            component: Panel,
          });
        }),
      ),
    ).rejects.toThrow('slots.navPanel: "id" must match');
    await expect(loadPluginApp({ default: { nope: true } })).rejects.toThrow(
      "not definePluginApp(...)",
    );
  });

  it("captures messageDirective registrations", () => {
    expect(app.messageDirectives).toEqual([
      { id: "inline-vis", component: InlineVis },
    ]);
  });

  it("captures composer customizations", () => {
    expect(app.composerCustomizations).toEqual([
      {
        id: "improve-prompt",
        scopes: ["thread", "new-thread"],
        actions: [{ id: "improve", component: ComposerProbe }],
      },
    ]);
  });

  it("mirrors host isolation for malformed composer regions and duplicate entries", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const malformed = await loadPluginApp(
      definePluginApp((builder) => {
        builder.composer.customize({
          id: "nested",
          actions: {} as never,
          banners: [
            { id: "banner", component: ComposerProbe },
            { id: "banner", component: ComposerProbe },
          ],
          plusMenu: [
            { id: "bad", label: "", run: () => {} },
            { id: "good", label: "Good", run: () => {} },
          ],
        });
      }),
    );

    expect(malformed.composerCustomizations).toEqual([
      {
        id: "nested",
        banners: [{ id: "banner", component: ComposerProbe }],
        plusMenu: [{ id: "good", label: "Good", run: expect.any(Function) }],
      },
    ]);
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("actions: must be an array"),
    );
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining('duplicate id "banner"'),
    );
  });

  it("does not reserve nested ids for malformed composer contributions", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    warning.mockClear();
    const captured = await loadPluginApp(
      definePluginApp((builder) => {
        builder.composer.customize({
          id: "reused-after-malformed",
          actions: [
            { id: "same-action", component: null as never },
            { id: "same-action", component: ComposerProbe },
          ],
          banners: [
            {
              id: "same-banner",
              chrome: "dialog" as never,
              component: ComposerProbe,
            },
            { id: "same-banner", component: ComposerProbe },
          ],
          plusMenu: [
            { id: "same-menu", label: "", run: () => {} },
            { id: "same-menu", label: "Valid menu", run: () => {} },
          ],
          richText: {
            effects: [
              { id: "same-effect", className: "", match: () => [] },
              {
                id: "same-effect",
                className: "valid-effect",
                match: () => [],
              },
            ],
          },
        });
      }),
    );

    const [customization] = captured.composerCustomizations;
    expect(customization?.actions?.map(({ id }) => id)).toEqual([
      "same-action",
    ]);
    expect(customization?.banners?.map(({ id }) => id)).toEqual([
      "same-banner",
    ]);
    expect(customization?.plusMenu?.map(({ id }) => id)).toEqual(["same-menu"]);
    expect(customization?.richText?.effects?.map(({ id }) => id)).toEqual([
      "same-effect",
    ]);
    expect(warning).toHaveBeenCalledTimes(4);
    expect(
      warning.mock.calls.some(([reason]) =>
        String(reason).includes("duplicate id"),
      ),
    ).toBe(false);
  });

  it("rejects invalid and duplicate messageDirective ids like the host", async () => {
    await expect(
      loadPluginApp(
        definePluginApp((builder) => {
          builder.slots.messageDirective({
            id: "Inline_Vis",
            component: InlineVis,
          });
        }),
      ),
    ).rejects.toThrow('slots.messageDirective: "id" must match');
    await expect(
      loadPluginApp(
        definePluginApp((builder) => {
          builder.slots.messageDirective({
            id: "inline-vis",
            component: InlineVis,
          });
          builder.slots.messageDirective({
            id: "inline-vis",
            component: InlineVis,
          });
        }),
      ),
    ).rejects.toThrow('slots.messageDirective: duplicate id "inline-vis"');
  });

  it("captures messageAction registrations and validates them like the host", async () => {
    expect(app.messageActions).toHaveLength(1);
    expect(app.messageActions[0]).toMatchObject({
      id: "summarize",
      title: "Summarize",
      icon: "Zap",
    });
    await expect(
      loadPluginApp(
        definePluginApp((builder) => {
          builder.slots.experimental_messageAction({
            id: "no-run",
            title: "No run",
            // @ts-expect-error deliberately invalid: run is required
            run: undefined,
          });
        }),
      ),
    ).rejects.toThrow('slots.experimental_messageAction: "run" must be a function');
    await expect(
      loadPluginApp(
        definePluginApp((builder) => {
          builder.slots.experimental_messageAction({
            id: "dup",
            title: "One",
            run: () => {},
          });
          builder.slots.experimental_messageAction({
            id: "dup",
            title: "Two",
            run: () => {},
          });
        }),
      ),
    ).rejects.toThrow('slots.experimental_messageAction: duplicate id "dup"');
  });

  it("invokes a captured messageAction run with a plugin-authored context", () => {
    const openPanel = (options: { actionId: string }) =>
      options.actionId === "panel";
    app.messageActions[0]!.run({
      threadId: "thr_main",
      message: {
        id: "msg_1",
        threadId: "thr_main",
        role: "assistant",
        text: "An answer.",
        sourceSeqEnd: 12,
      },
      selectedText: "answer",
      openPanel,
    });
    expect(messageActionRuns).toHaveLength(1);
    expect(messageActionRuns[0]).toMatchObject({
      threadId: "thr_main",
      selectedText: "answer",
    });
  });

  it("renders the ThreadChat stub with recorded props inside a slot", () => {
    const chatPanel = app.navPanels.find((panel) => panel.id === "chat")!;
    const slot = renderSlot(chatPanel, { subPath: "thr_42" });
    const stub = slot.getByTestId("bb-thread-chat");
    expect(stub.getAttribute("data-thread-id")).toBe("thr_42");
    expect(stub.getAttribute("data-variant")).toBe("compact");
    expect(stub.getAttribute("data-layout")).toBe("document");
    expect(stub.getAttribute("data-focus-request")).toBe("2");
    expect(stub.getAttribute("data-message-actions")).toBe("send-to-main");
    expect(stub.className).toBe("demo-chat");
  });

  it("renders leadingContent and drives messageActions through the stub", () => {
    messageActionRuns.length = 0;
    const chatPanel = app.navPanels.find((panel) => panel.id === "chat")!;
    const slot = renderSlot(chatPanel, { subPath: "thr_42" });
    expect(
      slot.getByTestId("bb-thread-chat-leading-content").textContent,
    ).toContain("Replying to something earlier");

    const action = slot.getByTestId("bb-thread-chat-action-send-to-main");
    expect(action.getAttribute("data-roles")).toBe("assistant");
    fireEvent.click(action);
    expect(messageActionRuns).toEqual([
      {
        id: "test-message",
        threadId: "thr_42",
        role: "assistant",
        text: "test message text",
        sourceSeqEnd: 1,
      },
    ]);
  });
});

describe("typed rpc test runtime", () => {
  it("preserves contract method, input, and result types while recording calls", async () => {
    const slot = renderSlot<PluginNavPanelProps, typeof typedRpcContract>(
      { component: TypedRpcPanel },
      { subPath: "" },
      {
        rpc: {
          getItem(input) {
            return { title: `Item ${input.id}` };
          },
        },
      },
    );
    await slot.findByText("Item item-1");
    expect(slot.rpcCalls).toEqual([
      { method: "getItem", input: { id: "item-1" } },
    ]);
  });
});

describe("renderSlot", () => {
  it("drives the shared realtime connection lifecycle", async () => {
    const slot = renderSlot(
      app.homepageSections[0]!,
      { projectId: null },
      { realtimeConnectionState: "connecting" },
    );
    await slot.findByText("Realtime: connecting");

    await slot.behavior.setRealtimeConnectionState("connected");
    await slot.findByText("Realtime: connected");

    await slot.behavior.setRealtimeConnectionState("reconnecting");
    await slot.findByText("Realtime: reconnecting");
  });

  it("refreshes rendered RPC data after a realtime event", async () => {
    let listing = ["a.md"];
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "" },
      { rpc: { listItems: () => listing } },
    );
    await slot.findByText("a.md");
    expect(slot.rpcCalls).toEqual([
      { method: "listItems", input: { subPath: "" } },
    ]);
    expect(slot.inspection.rpcCalls).toBe(slot.rpcCalls);
    expect(slot.behavior.emitRealtime).toBe(slot.emitRealtime);

    // A realtime push re-fetches and renders the new listing.
    listing = ["a.md", "b.md"];
    await slot.behavior.emitRealtime("items-changed", null);
    await slot.findByText("b.md");
    slot.lifecycle.unmount();
    expect(slot.queryByText("b.md")).toBeNull();
  });

  it("reports RPC methods without handlers", async () => {
    const slot = renderSlot(app.navPanels[0]!, { subPath: "" }, {});
    await slot.findByText(
      'error: no rpc handler for "listItems" — add it to renderSlot options.rpc',
    );
    expect(slot.rpcCalls).toEqual([
      { method: "listItems", input: { subPath: "" } },
    ]);
  });

  it("renders a messageDirective with attributes, source, and message", async () => {
    const slot = renderSlot(app.messageDirectives[0]!, {
      attributes: { file: "demo.html" },
      source: '::inline-vis{file="demo.html"}',
      message: {
        id: "msg_1",
        threadId: "thr_1",
        turnId: "turn_1",
        projectId: "proj_1",
      },
      openWorkspaceFile: null,
      openThreadPanel: null,
    });
    expect(slot.getByTestId("file").textContent).toBe("demo.html");
    expect(slot.getByTestId("source").textContent).toBe(
      '::inline-vis{file="demo.html"}',
    );
    expect(slot.getByTestId("thread").textContent).toBe("thr_1");
    expect(slot.getByTestId("thread-panel").textContent).toBe("unavailable");
  });

  it("reads, replaces, functionally updates, and clears isolated composer text", () => {
    const threadSlot = renderSlot(
      app.composerCustomizations[0]!.actions![0]!,
      {},
      {
        context: { projectId: "proj_1", threadId: "thr_1" },
        composer: { text: "seed" },
      },
    );
    const newThreadSlot = renderSlot(
      app.composerCustomizations[0]!.actions![0]!,
      {},
      {
        context: { projectId: "proj_1", threadId: null },
        composer: { text: "new-thread seed" },
      },
    );
    const thread = within(threadSlot.container);
    const newThread = within(newThreadSlot.container);

    expect(thread.getByTestId("composer-scope").textContent).toBe("thread");
    expect(thread.getByTestId("composer-text").textContent).toBe("seed");
    fireEvent.click(thread.getByText("replace"));
    fireEvent.click(thread.getByText("update"));
    fireEvent.click(thread.getByText("update"));
    expect(threadSlot.composer.text).toBe("replacement!!");
    expect(thread.getByTestId("composer-text").textContent).toBe(
      "replacement!!",
    );
    expect(newThreadSlot.composer.text).toBe("new-thread seed");

    fireEvent.click(thread.getByText("clear"));
    expect(threadSlot.composer.text).toBe("");
    expect(newThreadSlot.composer.text).toBe("new-thread seed");
    expect(newThread.getByTestId("composer-scope").textContent).toBe(
      "new-thread",
    );
  });

  it("exposes an explicit side-chat composer scope", () => {
    const sideChatScope = {
      kind: "side-chat",
      projectId: "proj_1",
      parentThreadId: "thr_parent",
      tabId: "side-chat:one",
      childThreadId: null,
    } satisfies PluginComposerScope;
    const slot = renderSlot(
      app.composerCustomizations[0]!.actions![0]!,
      {},
      { composer: { text: "side-chat draft", scope: sideChatScope } },
    );

    expect(
      JSON.parse(
        slot.getByTestId("composer-scope-details").textContent ?? "{}",
      ),
    ).toEqual(sideChatScope);
    fireEvent.click(slot.getByText("set row status"));
    expect(slot.composer.threadRowStatus?.label).toBe("Plugin improving draft");
  });

  it("keeps quote, mention, and focus behavior while updating harness text", () => {
    const slot = renderSlot(
      app.composerCustomizations[0]!.actions![0]!,
      {},
      { composer: { text: "draft" } },
    );

    fireEvent.click(slot.getByText("quote"));
    fireEvent.click(slot.getByText("mention"));
    fireEvent.click(slot.getByText("focus"));

    expect(slot.composer.text).toBe("draft\n> picked text\nIdeas ");
    expect(slot.composer.quotes).toEqual(["picked text"]);
    expect(slot.composer.mentions).toEqual([
      { provider: "notes", id: "ideas", label: "Ideas" },
    ]);
    expect(slot.composer.focusCount).toBe(3);
  });

  it("records composer thread-row status changes", () => {
    const slot = renderSlot(
      app.composerCustomizations[0]!.actions![0]!,
      {},
      { context: { projectId: "proj_1", threadId: "thr_1" } },
    );

    fireEvent.click(slot.getByText("set row status"));
    expect(slot.composer.threadRowStatus).toEqual({
      icon: "AiContentGenerator01",
      label: "Plugin improving draft",
    });

    fireEvent.click(slot.getByText("clear row status"));
    expect(slot.composer.threadRowStatus).toBeNull();
    expect(slot.composer.threadRowStatusCalls).toHaveLength(2);
  });

  it("ignores thread-row status changes outside a thread composer", () => {
    const slot = renderSlot(
      app.composerCustomizations[0]!.actions![0]!,
      {},
      { context: { projectId: "proj_1", threadId: null } },
    );

    fireEvent.click(slot.getByText("set row status"));
    expect(slot.composer.threadRowStatus).toBeNull();
    expect(slot.composer.threadRowStatusCalls).toEqual([]);
  });

  it("invalidates visual-state setters through both unmount controls", () => {
    for (const control of ["top-level", "lifecycle"] as const) {
      const slot = renderSlot(
        app.composerCustomizations[0]!.actions![0]!,
        {},
        { context: { projectId: "proj_1", threadId: "thr_1" } },
      );
      const setters = capturedComposerVisualSetters;
      if (setters === null)
        throw new Error("composer setters were not captured");

      setters.setTextEffect({ className: "improve-shimmer" });
      setters.setInputLock(true);
      setters.setThreadRowStatus({
        icon: "AiContentGenerator01",
        label: "Plugin improving draft",
        tone: "success",
      });
      expect(slot.composer.textEffect).toEqual({
        className: "improve-shimmer",
      });
      expect(slot.composer.inputLocked).toBe(true);
      expect(slot.composer.threadRowStatus?.tone).toBe("success");

      if (control === "top-level") slot.unmount();
      else slot.lifecycle.unmount();
      expect(slot.composer.textEffect).toBeNull();
      expect(slot.composer.inputLocked).toBe(false);
      expect(slot.composer.threadRowStatus).toBeNull();

      setters.setTextEffect({ className: "late-effect" });
      setters.setInputLock(true);
      setters.setThreadRowStatus({
        icon: "AiContentGenerator01",
        label: "late status",
      });
      expect(slot.composer.textEffect).toBeNull();
      expect(slot.composer.threadRowStatus).toBeNull();
      expect(slot.composer.textEffectCalls).toEqual([
        { className: "improve-shimmer" },
      ]);
      expect(slot.composer.inputLockCalls).toEqual([true]);
      expect(slot.composer.threadRowStatusCalls).toHaveLength(1);
    }
  });

  it("invalidates visual-state setters when Testing Library cleans up the root", () => {
    const slot = renderSlot(
      app.composerCustomizations[0]!.actions![0]!,
      {},
      { context: { projectId: "proj_1", threadId: "thr_1" } },
    );
    const setters = capturedComposerVisualSetters;
    if (setters === null) throw new Error("composer setters were not captured");

    setters.setTextEffect({ className: "cleanup-effect" });
    setters.setThreadRowStatus({
      icon: "AiContentGenerator01",
      label: "Plugin improving draft",
    });
    cleanup();

    expect(slot.composer.textEffect).toBeNull();
    expect(slot.composer.threadRowStatus).toBeNull();

    setters.setTextEffect({ className: "late-effect" });
    setters.setThreadRowStatus({
      icon: "AiContentGenerator01",
      label: "late status",
    });
    expect(slot.composer.textEffect).toBeNull();
    expect(slot.composer.threadRowStatus).toBeNull();
    expect(slot.composer.textEffectCalls).toEqual([
      { className: "cleanup-effect" },
    ]);
    expect(slot.composer.threadRowStatusCalls).toHaveLength(1);
  });
});
