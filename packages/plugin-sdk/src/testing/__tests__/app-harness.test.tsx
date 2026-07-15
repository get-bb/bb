// @vitest-environment jsdom
import { useEffect, useState } from "react";
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type {
  PluginMessageDirectiveProps,
  PluginNavPanelProps,
} from "../../app-contract.js";
import { installTestPluginRuntime, loadPluginApp, renderSlot } from "../app.js";
import { defineRpcContract } from "../../rpc-contract.js";

// Install before touching @bb/plugin-sdk/app — it binds the runtime global
// at import time (same constraint real plugin app.tsx files have).
installTestPluginRuntime();
const { definePluginApp, useRealtime, useRpc } = await import("../../app.js");

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

    // A realtime push re-fetches and renders the new listing.
    listing = ["a.md", "b.md"];
    await slot.emitRealtime("items-changed", null);
    await slot.findByText("b.md");
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
});
