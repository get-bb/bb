/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  copyPluginSurfaceAgentReference,
  PLUGIN_GUIDE_PLUGIN_ID,
  pluginSurfaceAgentClipboardContent,
  pluginSurfaceAgentContext,
  pluginSurfaceAgentMention,
  SURFACES_BY_ID,
} from "../src/index";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Plugin Guide agent references", () => {
  it("uses the stable surface id and concise card label", () => {
    const surface = SURFACES_BY_ID.get("composer-actions");
    if (!surface) throw new Error("composer-actions surface missing");

    expect(pluginSurfaceAgentMention(surface)).toEqual({
      provider: "surface",
      id: "composer-actions",
      label: "Inline actions",
    });
  });

  it("resolves only surface identity, SDK symbols, and the authoring guide", () => {
    const context = pluginSurfaceAgentContext("composer-actions");
    expect(context).toContain("Inline actions (composer-actions)");
    expect(context).toContain("PluginComposerApi");
    expect(context).toContain("bb-plugin-authoring skill");
    expect(context?.split("\n")).toHaveLength(3);
    expect(pluginSurfaceAgentContext("missing-surface")).toBeNull();
  });

  it("serializes one surface as bb's existing structured composer pill", () => {
    const surface = SURFACES_BY_ID.get("composer-actions");
    if (!surface) throw new Error("composer-actions surface missing");

    const content = pluginSurfaceAgentClipboardContent(surface);
    const document = new DOMParser().parseFromString(content.html, "text/html");
    const pill = document.querySelector("[data-prompt-mention='true']");

    expect(content.text).toBe("@Inline actions ");
    expect(pill?.textContent).toBe("@Inline actions");
    expect(pill?.getAttribute("data-prompt-mention-serialized-text")).toBe(
      "@Inline actions",
    );
    expect(
      JSON.parse(pill?.getAttribute("data-prompt-mention-resource") ?? ""),
    ).toEqual({
      kind: "plugin",
      pluginId: PLUGIN_GUIDE_PLUGIN_ID,
      icon: null,
      itemId: "surface:composer-actions",
      label: "Inline actions",
    });
  });

  it("keeps multiple copied surfaces distinct and composable", () => {
    const actions = SURFACES_BY_ID.get("composer-actions");
    const panels = SURFACES_BY_ID.get("thread-panel");
    if (!actions || !panels) throw new Error("reference surfaces missing");

    const document = new DOMParser().parseFromString(
      [actions, panels]
        .map((surface) => pluginSurfaceAgentClipboardContent(surface).html)
        .join(""),
      "text/html",
    );
    const resources = [...document.querySelectorAll("[data-prompt-mention]")]
      .map((pill) => pill.getAttribute("data-prompt-mention-resource"))
      .map((value) => JSON.parse(value ?? ""));

    expect(resources.map((resource) => resource.itemId)).toEqual([
      "surface:composer-actions",
      "surface:thread-panel",
    ]);
  });

  it("writes both rich and plain clipboard representations", async () => {
    const surface = SURFACES_BY_ID.get("composer-actions");
    if (!surface) throw new Error("composer-actions surface missing");
    const clipboardWrite = vi.fn().mockResolvedValue(undefined);
    const items: Array<Record<string, Blob>> = [];
    class TestClipboardItem {
      constructor(item: Record<string, Blob>) {
        items.push(item);
      }
    }
    vi.stubGlobal("ClipboardItem", TestClipboardItem);
    vi.stubGlobal("navigator", { clipboard: { write: clipboardWrite } });

    await expect(copyPluginSurfaceAgentReference(surface)).resolves.toBe(true);
    expect(clipboardWrite).toHaveBeenCalledOnce();
    expect(Object.keys(items[0] ?? {}).sort()).toEqual([
      "text/html",
      "text/plain",
    ]);
  });
});
