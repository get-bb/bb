// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  keyPluginScopeOnAttribute,
  scopePluginUtilities,
} from "@bb/plugin-build";
import { HOST_OWNED_ATTRIBUTE, markHostOwnedElements } from "./host-ui";

function html(markup: string): HTMLElement {
  const container = document.createElement("div");
  container.innerHTML = markup;
  document.body.append(container);
  return container;
}

function owned(container: HTMLElement): string[] {
  return [...container.querySelectorAll(`[${HOST_OWNED_ATTRIBUTE}]`)].map(
    (element) => element.id,
  );
}

const PLUGIN_ROOT =
  'data-bb-plugin-root="" data-bb-plugin="demo" data-bb-plugin-scope-demo=""';

describe("markHostOwnedElements", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("marks host UI inside a plugin root and hands slot content back to the plugin at any depth", () => {
    const container = html(`
      <div id="root" ${PLUGIN_ROOT}>
        <div id="plugin-before"></div>
        <div id="row" data-bb-host-ui="">
          <span id="row-icon"></span>
          <span id="label" data-bb-plugin-content="">
            <span id="plugin-label"></span>
            <div id="nested-row" data-bb-host-ui="">
              <span id="nested-action" data-bb-plugin-content="">
                <button id="plugin-button"></button>
              </span>
            </div>
          </span>
          <div id="slot-mount" ${PLUGIN_ROOT}>
            <span id="slot-content"></span>
          </div>
        </div>
      </div>`);
    markHostOwnedElements(container);
    expect(owned(container)).toEqual([
      "row",
      "row-icon",
      "label",
      "nested-row",
      "nested-action",
    ]);
  });

  it("leaves host UI outside plugin roots unmarked", () => {
    const container = html(
      `<div id="row" data-bb-host-ui=""><span id="icon"></span></div>`,
    );
    markHostOwnedElements(container);
    expect(owned(container)).toEqual([]);
  });

  it("treats a host portal that is itself a plugin root as host UI", () => {
    const container = html(
      `<div id="menu" data-bb-host-ui="" ${PLUGIN_ROOT}><div id="item"></div></div>`,
    );
    markHostOwnedElements(container);
    expect(owned(container)).toEqual(["menu", "item"]);
  });

  it("marks host elements a later render inserts, but not plugin content", async () => {
    const existing = html(`
      <div ${PLUGIN_ROOT}>
        <div id="row" data-bb-host-ui="">
          <span id="label" data-bb-plugin-content=""></span>
        </div>
      </div>`);
    vi.resetModules();
    const { keepPluginScopeAttributes } =
      await import("./plugin-scope-attributes");
    keepPluginScopeAttributes();
    const hostChild = document.createElement("span");
    hostChild.id = "late-host";
    existing.querySelector("#row")!.append(hostChild);
    const pluginChild = document.createElement("span");
    pluginChild.id = "late-plugin";
    existing.querySelector("#label")!.append(pluginChild);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(owned(existing)).toEqual(["row", "label", "late-host"]);
  });

  it("keeps the plugin's scoped utilities off host-owned elements and on its own", () => {
    const css = keyPluginScopeOnAttribute(
      scopePluginUtilities(
        "@layer utilities{.absolute{position:absolute}}",
        '[data-bb-plugin="demo"], [data-bb-plugin-root]:not([data-bb-plugin])',
      ),
    );
    const selectors = [
      ...css.matchAll(/([^{}]+)\{position:absolute\}/g),
    ].flatMap((match) => match[1]!.split(","));
    expect(selectors).toHaveLength(2);
    const container = html(`
      <div ${PLUGIN_ROOT}>
        <div data-bb-host-ui="">
          <span id="host" class="absolute"></span>
          <span data-bb-plugin-content="">
            <span id="plugin" class="absolute"></span>
          </span>
        </div>
      </div>`);
    markHostOwnedElements(container);
    const matches = (id: string) =>
      selectors.some((selector) =>
        container.querySelector(`#${id}`)!.matches(selector),
      );
    expect(matches("host")).toBe(false);
    expect(matches("plugin")).toBe(true);
  });
});
