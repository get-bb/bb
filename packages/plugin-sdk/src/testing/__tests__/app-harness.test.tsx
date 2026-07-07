// @vitest-environment jsdom
import { useEffect, useState } from "react";
import { cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type {
  PluginHomepageSectionProps,
  PluginNavPanelProps,
} from "../../app-contract.js";
import {
  installTestPluginRuntime,
  loadPluginApp,
  renderSlot,
} from "../app.js";

// Install before touching @bb/plugin-sdk/app — it binds the runtime global
// at import time (same constraint real plugin app.tsx files have).
installTestPluginRuntime();
const { definePluginApp, useBbNavigate, useComposer, useRealtime, useRpc, useSettings } =
  await import("../../app.js");

afterEach(cleanup);

function Panel({ subPath }: PluginNavPanelProps) {
  const rpc = useRpc();
  const navigate = useBbNavigate();
  const composer = useComposer();
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
        <button
          key={item}
          onClick={() => navigate.toPluginPanel("panel", { subPath: item })}
        >
          {item}
        </button>
      ))}
      <button onClick={() => composer.addQuote("quoted!")}>Quote</button>
      <button
        onClick={() =>
          navigate.toCompose({ initialPrompt: "draft", focusPrompt: true })
        }
      >
        Compose
      </button>
    </div>
  );
}

function Section(_props: PluginHomepageSectionProps) {
  const settings = useSettings();
  return <div>greeting: {String(settings.values?.greeting)}</div>;
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
    builder.slots.homepageSection({
      id: "home",
      title: "Home",
      component: Section,
    });
  }),
);

describe("loadPluginApp", () => {
  it("captures typed registrations and fills the chrome default", () => {
    expect(app.navPanels).toHaveLength(1);
    expect(app.navPanels[0]).toMatchObject({
      id: "panel",
      path: "panel",
      chrome: "page",
    });
    expect(app.homepageSections[0]?.id).toBe("home");
  });

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
});

describe("renderSlot", () => {
  it("wires rpc, realtime, navigate, and composer mocks", async () => {
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

    fireEvent.click(slot.getByText("a.md"));
    expect(slot.navigateCalls).toEqual([
      {
        method: "toPluginPanel",
        path: "panel",
        options: { subPath: "a.md" },
      },
    ]);
    fireEvent.click(slot.getByText("Compose"));
    expect(slot.navigateCalls).toEqual([
      {
        method: "toPluginPanel",
        path: "panel",
        options: { subPath: "a.md" },
      },
      {
        method: "toCompose",
        options: { initialPrompt: "draft", focusPrompt: true },
      },
    ]);

    fireEvent.click(slot.getByText("Quote"));
    expect(slot.composer.quotes).toEqual(["quoted!"]);
  });

  it("provides settings values and rejects rpc methods without handlers", async () => {
    const section = renderSlot(
      app.homepageSections[0]!,
      { projectId: null },
      { settings: { greeting: "hi" } },
    );
    section.getByText("greeting: hi");

    const slot = renderSlot(app.navPanels[0]!, { subPath: "" }, {});
    await slot.findByText(
      'error: no rpc handler for "listItems" — add it to renderSlot options.rpc',
    );
    expect(slot.rpcCalls).toEqual([
      { method: "listItems", input: { subPath: "" } },
    ]);
  });
});
