/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";

import {
  createPluginSurfaceAgentReference,
  PLUGIN_GUIDE_PLUGIN_ID,
  pluginSurfaceAgentClipboardContent,
  pluginSurfaceAgentContext,
} from "../src/agent-reference";
import { SURFACES_BY_ID } from "../src/surfaces";

describe("Plugin Guide agent references", () => {
  it("derives the complete reference from canonical surface data", () => {
    const surface = SURFACES_BY_ID.get("code-renderers");
    if (!surface) throw new Error("code-renderers surface missing");

    const reference = createPluginSurfaceAgentReference(surface);
    expect(reference).toEqual(createPluginSurfaceAgentReference(surface));
    expect(reference.identity).toEqual({
      provider: "surface",
      id: "code-renderers",
      label: "Code & diff renderers",
    });
    expect(reference.resource).toEqual({
      kind: "plugin",
      pluginId: PLUGIN_GUIDE_PLUGIN_ID,
      icon: null,
      itemId: "surface:code-renderers",
      label: "Code & diff renderers",
    });
    expect(reference.context.split("\n")).toHaveLength(3);
    expect(reference.clipboard.text).toBe(
      "Build a plugin that uses @Code & diff renderers ",
    );
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

    expect(content.text).toBe("Build a plugin that uses @Inline actions ");
    expect(document.body.textContent).toBe(content.text);
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
    expect(document.body.textContent).toBe(
      "Build a plugin that uses @Inline actions " +
        "Build a plugin that uses @Thread side-panel tabs ",
    );
  });

  it("gives every surface a byte-stable, globally distinct pill identity", () => {
    const itemIds = [...SURFACES_BY_ID.values()].map((surface) => {
      const first = createPluginSurfaceAgentReference(surface);
      const second = createPluginSurfaceAgentReference(surface);
      expect(first).toEqual(second);
      expect(first.clipboard.html).not.toContain(surface.summary);
      for (const bullet of surface.bullets) {
        expect(first.clipboard.html).not.toContain(bullet);
      }
      return first.resource.itemId;
    });

    expect(new Set(itemIds).size).toBe(itemIds.length);
  });
});
