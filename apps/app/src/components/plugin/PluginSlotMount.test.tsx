// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PluginSlotMount,
  resetAllCrashedPluginSlotsForTest,
  resetCrashedPluginSlots,
} from "./PluginSlotMount";

function Bomb(): never {
  throw new Error("kaboom");
}

function Healthy() {
  return <div>healthy slot</div>;
}

describe("PluginSlotMount", () => {
  beforeEach(() => {
    resetAllCrashedPluginSlotsForTest();
    // React logs boundary-caught errors; keep test output quiet.
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("collapses a throwing slot to a crash chip and keeps siblings alive", () => {
    render(
      <>
        <PluginSlotMount pluginId="broken" slotKind="homepageSection" slotId="a">
          <Bomb />
        </PluginSlotMount>
        <PluginSlotMount pluginId="fine" slotKind="homepageSection" slotId="b">
          <Healthy />
        </PluginSlotMount>
      </>,
    );

    expect(screen.getByText("plugin broken crashed")).toBeDefined();
    expect(screen.getByText("healthy slot")).toBeDefined();
  });

  it("keeps a crashed slot instance disabled for the session across remounts", () => {
    const first = render(
      <PluginSlotMount pluginId="broken" slotKind="navPanel" slotId="board">
        <Bomb />
      </PluginSlotMount>,
    );
    first.unmount();

    // Fresh mount of the same instance: the healthy child never renders
    // because the instance is session-disabled.
    const childRender = vi.fn(() => <div>should not render</div>);
    function Child() {
      return childRender();
    }
    render(
      <PluginSlotMount pluginId="broken" slotKind="navPanel" slotId="board">
        <Child />
      </PluginSlotMount>,
    );
    expect(screen.getByText("plugin broken crashed")).toBeDefined();
    expect(childRender).not.toHaveBeenCalled();
  });

  it("re-enables a plugin's slots after resetCrashedPluginSlots (reload path)", () => {
    const first = render(
      <PluginSlotMount pluginId="broken" slotKind="navPanel" slotId="board">
        <Bomb />
      </PluginSlotMount>,
    );
    first.unmount();
    resetCrashedPluginSlots("broken");

    render(
      <PluginSlotMount pluginId="broken" slotKind="navPanel" slotId="board">
        <Healthy />
      </PluginSlotMount>,
    );
    expect(screen.getByText("healthy slot")).toBeDefined();
  });
});
