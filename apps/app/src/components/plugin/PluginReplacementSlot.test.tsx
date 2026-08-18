// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import type { ResolvedReplacement } from "@/lib/plugin-slot-resolvers";
import { resetAllCrashedPluginSlotsForTest } from "./PluginSlotMount";
import { PluginReplacementSlot } from "./PluginReplacementSlot";

interface TestRegistration {
  id: string;
  pluginId: string;
  generation: number;
}

const REGISTRATION: TestRegistration = {
  id: "replacement",
  pluginId: "demo",
  generation: 1,
};

afterEach(() => {
  cleanup();
  resetAllCrashedPluginSlotsForTest();
  vi.restoreAllMocks();
});

describe("PluginReplacementSlot", () => {
  it("renders the owner when no plugin applies", () => {
    render(
      <PluginReplacementSlot<TestRegistration>
        replacement={{ kind: "owner" }}
        original={<div>BB owner</div>}
        slotKind="testReplacement"
      >
        {() => <div>Plugin replacement</div>}
      </PluginReplacementSlot>,
    );

    expect(screen.getByText("BB owner")).toBeDefined();
    expect(screen.queryByText("Plugin replacement")).toBeNull();
  });

  it("lets a plugin delegate to the bound owner without recursing", () => {
    const replacement: ResolvedReplacement<TestRegistration> = {
      kind: "plugin",
      registration: REGISTRATION,
    };
    render(
      <PluginReplacementSlot
        replacement={replacement}
        original={<div>BB owner</div>}
        slotKind="testReplacement"
      >
        {(_registration, Original) => <Original />}
      </PluginReplacementSlot>,
    );

    expect(screen.getAllByText("BB owner")).toHaveLength(1);
  });

  it("restores the bound owner when a replacement crashes", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    function Crash(): never {
      throw new Error("replacement failed");
    }

    render(
      <PluginReplacementSlot
        replacement={{ kind: "plugin", registration: REGISTRATION }}
        original={<div>BB owner</div>}
        slotKind="testReplacement"
      >
        {() => <Crash />}
      </PluginReplacementSlot>,
    );

    expect(screen.getByText("BB owner")).toBeDefined();
    expect(screen.queryByText(/plugin demo crashed/u)).toBeNull();
  });

  it("keeps the owner mounted while live owner props change", () => {
    let mountCount = 0;
    function Owner({ query }: { query: string }) {
      useEffect(() => {
        mountCount += 1;
      }, []);
      return <div>Owner query: {query}</div>;
    }
    const replacement: ResolvedReplacement<TestRegistration> = {
      kind: "plugin",
      registration: REGISTRATION,
    };
    const { rerender } = render(
      <PluginReplacementSlot
        replacement={replacement}
        original={<Owner query="first" />}
        slotKind="testReplacement"
      >
        {(_registration, Original) => <Original />}
      </PluginReplacementSlot>,
    );

    rerender(
      <PluginReplacementSlot
        replacement={replacement}
        original={<Owner query="second" />}
        slotKind="testReplacement"
      >
        {(_registration, Original) => <Original />}
      </PluginReplacementSlot>,
    );

    expect(screen.getByText("Owner query: second")).toBeDefined();
    expect(mountCount).toBe(1);
  });
});
