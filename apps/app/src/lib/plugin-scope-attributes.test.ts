// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

async function freshKeepPluginScopeAttributes(): Promise<() => void> {
  vi.resetModules();
  const module = await import("./plugin-scope-attributes");
  return module.keepPluginScopeAttributes;
}

function settleMutations(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function scopeAttributes(element: Element): string[] {
  return element
    .getAttributeNames()
    .filter((name) => name.startsWith("data-bb-plugin-scope-"));
}

describe("keepPluginScopeAttributes", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("gives every element a plugin labels the old way its scope attribute", async () => {
    const existing = document.createElement("div");
    existing.setAttribute("data-bb-plugin", "early");
    document.body.append(existing);

    const keepPluginScopeAttributes = await freshKeepPluginScopeAttributes();
    keepPluginScopeAttributes();
    expect(scopeAttributes(existing)).toEqual(["data-bb-plugin-scope-early"]);

    const slot = document.createElement("div");
    slot.dataset.bbPluginRoot = "";
    slot.dataset.bbPlugin = "gone-fishing";
    const nested = document.createElement("section");
    nested.setAttribute("data-bb-plugin", "nested");
    slot.append(nested);
    document.body.append(slot);
    const later = document.createElement("div");
    document.body.append(later);
    await settleMutations();
    later.dataset.bbPlugin = "later";
    await settleMutations();

    expect(scopeAttributes(slot)).toEqual([
      "data-bb-plugin-scope-gone-fishing",
    ]);
    expect(scopeAttributes(nested)).toEqual(["data-bb-plugin-scope-nested"]);
    expect(scopeAttributes(later)).toEqual(["data-bb-plugin-scope-later"]);
  });

  it("moves the scope attribute when an element changes plugin and skips invalid ids", async () => {
    const keepPluginScopeAttributes = await freshKeepPluginScopeAttributes();
    keepPluginScopeAttributes();
    const element = document.createElement("div");
    element.setAttribute("data-bb-plugin", "first");
    const invalid = document.createElement("div");
    invalid.setAttribute("data-bb-plugin", "Not A Plugin");
    document.body.append(element, invalid);
    await settleMutations();

    element.setAttribute("data-bb-plugin", "second");
    await settleMutations();

    expect(scopeAttributes(element)).toEqual(["data-bb-plugin-scope-second"]);
    expect(scopeAttributes(invalid)).toEqual([]);
  });
});
