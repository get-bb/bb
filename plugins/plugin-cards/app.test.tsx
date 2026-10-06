// @vitest-environment jsdom
import { cleanup, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginCard } from "./server";

let app: Awaited<ReturnType<typeof loadPluginApp>>;

beforeEach(async () => {
  app = await loadPluginApp(() => import("./app"));
});

afterEach(cleanup);

const message = {
  id: "msg_1",
  threadId: "thr_1",
  turnId: "turn_1",
  projectId: "proj_1",
};

function card(overrides: Partial<PluginCard> = {}): PluginCard {
  return {
    pluginId: "browser-automation",
    displayName: "Browser Automation",
    description: "Drive a real browser from any agent.",
    icon: "Globe",
    iconUrl: null,
    iconTinted: false,
    author: { name: "BB Official", github: null, official: true },
    installed: true,
    included: false,
    compatible: true,
    incompatibleReason: null,
    installBadge: null,
    ...overrides,
  };
}

function renderCard(
  attributes: Record<string, string>,
  getPluginCard: (input: unknown) => unknown,
) {
  return renderSlot(
    app.messageDirectives[0]!,
    {
      attributes,
      source: `::plugin-card{id="${attributes.id ?? ""}"}`,
      message,
      openWorkspaceFile: null,
    },
    { rpc: { getPluginCard }, openPluginDetail: () => true },
  );
}

describe("plugin-card directive", () => {
  it("registers the plugin-card directive", () => {
    expect(app.messageDirectives.map((directive) => directive.id)).toEqual([
      "plugin-card",
    ]);
  });

  it("loads the store card, then opens the plugin's detail page from it", async () => {
    const slot = renderCard({ id: "browser-automation" }, (input) => {
      expect(input).toEqual({ pluginId: "browser-automation" });
      return { kind: "found", card: card() };
    });
    expect(
      slot.getByRole("status", { name: "Loading plugin browser-automation" }),
    ).toBeTruthy();

    const open = await slot.findByRole("button", {
      name: "Open Browser Automation details",
    });
    expect(slot.getByText("Drive a real browser from any agent.")).toBeTruthy();
    expect(slot.getByText("BB Official")).toBeTruthy();
    expect(
      slot
        .getByRole("button", { name: "Browser Automation installed" })
        .getAttribute("aria-disabled"),
    ).toBe("true");

    fireEvent.click(open);
    expect(slot.navigateCalls).toEqual([
      {
        method: "experimental_openPluginDetail",
        pluginId: "browser-automation",
      },
    ]);
  });

  it("opens the detail page instead of installing from the install icon", async () => {
    const slot = renderCard({ id: "future-tool" }, () => ({
      kind: "found",
      card: card({
        pluginId: "future-tool",
        displayName: "Future tool",
        author: { name: "Ada", github: "ada", official: false },
        installed: false,
        installBadge: { kind: "count", installs: 1234 },
      }),
    }));
    const install = await slot.findByRole("button", {
      name: "Install Future tool — 1,234 installs",
    });
    expect(slot.getByText("Ada")).toBeTruthy();

    fireEvent.click(install);
    expect(slot.navigateCalls).toEqual([
      { method: "experimental_openPluginDetail", pluginId: "future-tool" },
    ]);
    expect(slot.sdkCalls).toEqual([]);
  });

  it.each([
    [
      "an incompatible plugin",
      card({
        installed: false,
        compatible: false,
        incompatibleReason: "requires bb 9.0.0",
      }),
      "Install Browser Automation",
    ],
    [
      "a plugin included with bb",
      card({ included: true, installBadge: { kind: "builtin" } }),
      "Browser Automation installed — Built in",
    ],
  ])("keeps the control inert for %s", async (_name, pluginCard, label) => {
    const slot = renderCard({ id: pluginCard.pluginId }, () => ({
      kind: "found",
      card: pluginCard,
    }));
    const control = await slot.findByRole("button", { name: label });
    expect(control.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(control);
    expect(slot.navigateCalls).toEqual([]);
  });

  it.each<Record<string, string>>([{}, { id: "" }, { id: "Not An Id" }])(
    "explains a missing or malformed id %j without calling rpc",
    async (attributes) => {
      const slot = renderCard(attributes, () => {
        throw new Error("rpc must not be called");
      });
      expect((await slot.findByRole("alert")).textContent).toContain(
        "needs a plugin id",
      );
      expect(slot.rpcCalls).toEqual([]);
      expect(slot.queryByRole("button")).toBeNull();
    },
  );

  it("shows an unknown id as not found without an action", async () => {
    const slot = renderCard({ id: "nope" }, () => ({
      kind: "not-found",
      pluginId: "nope",
    }));
    expect((await slot.findByRole("alert")).textContent).toContain(
      "No installed or store-listed plugin has the id nope",
    );
    expect(slot.queryByRole("button")).toBeNull();
  });

  it("shows a load failure without an action", async () => {
    const slot = renderCard({ id: "browser-automation" }, () => {
      throw new Error("Connection lost");
    });
    expect((await slot.findByRole("alert")).textContent).toContain(
      "Couldn't load plugin browser-automation: Connection lost",
    );
    expect(slot.queryByRole("button")).toBeNull();
  });
});
