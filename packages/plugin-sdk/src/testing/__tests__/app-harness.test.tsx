// @vitest-environment jsdom
import { useEffect, useState } from "react";
import { cleanup, fireEvent, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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
  useComposer,
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
  "setTextEffect" | "setThreadRowStatus"
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
  capturedComposerVisualSetters = {
    setTextEffect: composer.setTextEffect,
    setThreadRowStatus: composer.setThreadRowStatus,
  };
  return (
    <div>
      <span data-testid="composer-scope">{composer.scope.kind}</span>
      <span data-testid="composer-scope-details">
        {JSON.stringify(composer.scope)}
      </span>
      <span data-testid="composer-text">{composer.text}</span>
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
            label: "Prompt Shaper improving prompt",
            effect: "shimmer",
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

const app = await loadPluginApp(
  definePluginApp((builder) => {
    builder.slots.navPanel({
      id: "panel",
      title: "Panel",
      icon: "FileText",
      path: "panel",
      component: Panel,
    });
    builder.slots.messageDirective({
      id: "inline-vis",
      component: InlineVis,
    });
    builder.slots.composerAccessory({
      id: "composer",
      component: ComposerProbe,
    });
    builder.slots.homepageSection({
      id: "realtime-connection",
      title: "Realtime connection",
      component: RealtimeConnectionProbe,
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
      app.composerAccessories[0]!,
      { projectId: "proj_1", threadId: "thr_1" },
      {
        context: { projectId: "proj_1", threadId: "thr_1" },
        composer: { text: "seed" },
      },
    );
    const newThreadSlot = renderSlot(
      app.composerAccessories[0]!,
      { projectId: "proj_1", threadId: null },
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
      app.composerAccessories[0]!,
      { projectId: "proj_1", threadId: "thr_parent" },
      { composer: { text: "side-chat draft", scope: sideChatScope } },
    );

    expect(
      JSON.parse(
        slot.getByTestId("composer-scope-details").textContent ?? "{}",
      ),
    ).toEqual(sideChatScope);
    fireEvent.click(slot.getByText("set row status"));
    expect(slot.composer.threadRowStatus?.label).toBe(
      "Prompt Shaper improving prompt",
    );
  });

  it("keeps quote, mention, and focus behavior while updating harness text", () => {
    const slot = renderSlot(
      app.composerAccessories[0]!,
      { projectId: null, threadId: null },
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
      app.composerAccessories[0]!,
      { projectId: "proj_1", threadId: "thr_1" },
      { context: { projectId: "proj_1", threadId: "thr_1" } },
    );

    fireEvent.click(slot.getByText("set row status"));
    expect(slot.composer.threadRowStatus).toEqual({
      icon: "AiContentGenerator01",
      label: "Prompt Shaper improving prompt",
      effect: "shimmer",
    });

    fireEvent.click(slot.getByText("clear row status"));
    expect(slot.composer.threadRowStatus).toBeNull();
    expect(slot.composer.threadRowStatusCalls).toHaveLength(2);
  });

  it("ignores thread-row status changes outside a thread composer", () => {
    const slot = renderSlot(
      app.composerAccessories[0]!,
      { projectId: "proj_1", threadId: null },
      { context: { projectId: "proj_1", threadId: null } },
    );

    fireEvent.click(slot.getByText("set row status"));
    expect(slot.composer.threadRowStatus).toBeNull();
    expect(slot.composer.threadRowStatusCalls).toEqual([]);
  });

  it("invalidates visual-state setters through both unmount controls", () => {
    for (const control of ["top-level", "lifecycle"] as const) {
      const slot = renderSlot(
        app.composerAccessories[0]!,
        { projectId: "proj_1", threadId: "thr_1" },
        { context: { projectId: "proj_1", threadId: "thr_1" } },
      );
      const setters = capturedComposerVisualSetters;
      if (setters === null)
        throw new Error("composer setters were not captured");

      setters.setTextEffect("shimmer");
      setters.setThreadRowStatus({
        icon: "AiContentGenerator01",
        label: "Prompt Shaper improving prompt",
        effect: "shimmer",
        tone: "success",
      });
      expect(slot.composer.textEffect).toBe("shimmer");
      expect(slot.composer.threadRowStatus?.tone).toBe("success");

      if (control === "top-level") slot.unmount();
      else slot.lifecycle.unmount();
      expect(slot.composer.textEffect).toBeNull();
      expect(slot.composer.threadRowStatus).toBeNull();

      setters.setTextEffect("shimmer");
      setters.setThreadRowStatus({
        icon: "AiContentGenerator01",
        label: "late status",
        effect: "shimmer",
      });
      expect(slot.composer.textEffect).toBeNull();
      expect(slot.composer.threadRowStatus).toBeNull();
      expect(slot.composer.textEffectCalls).toEqual(["shimmer"]);
      expect(slot.composer.threadRowStatusCalls).toHaveLength(1);
    }
  });
});
