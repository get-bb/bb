// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { experimental_PluginComposerStatusProps } from "@bb/plugin-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
  type PluginRegistrationSet,
} from "@/lib/plugin-slots";
import { resetAllCrashedPluginSlotsForTest } from "./PluginSlotMount";
import { PluginComposerStatuses } from "./PluginComposerStatuses";

function registrationSet(
  id: string,
  component: (props: experimental_PluginComposerStatusProps) => React.ReactNode,
): PluginRegistrationSet {
  return {
    homepageSections: [],
    settingsSections: [],
    navPanels: [],
    threadPanelActions: [],
    composerAccessories: [],
    experimental_composerStatuses: [{ id, component }],
    pendingInteractions: [],
    sidebarFooterActions: [],
    fileOpeners: [],
    messageDirectives: [],
  };
}

describe("PluginComposerStatuses", () => {
  beforeEach(() => {
    resetPluginSlotStoreForTest();
    resetAllCrashedPluginSlotsForTest();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("mounts statuses in deterministic plugin order with composer scope", () => {
    function Status({
      projectId,
      threadId,
    }: experimental_PluginComposerStatusProps) {
      return <div>{`${projectId}:${threadId}`}</div>;
    }
    setPluginSlotRegistrations("zeta", registrationSet("run", Status));
    setPluginSlotRegistrations("alpha", registrationSet("run", Status));

    render(<PluginComposerStatuses projectId="proj_1" threadId="thr_1" />);

    expect(screen.getAllByText("proj_1:thr_1")).toHaveLength(2);
    expect(
      Array.from(document.querySelectorAll("[data-bb-plugin]")).map((node) =>
        node.getAttribute("data-bb-plugin"),
      ),
    ).toEqual(["alpha", "zeta"]);
  });

  it("contains one crashing status without hiding another plugin", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    function Broken(): React.ReactNode {
      throw new Error("broken status");
    }
    function Healthy(): React.ReactNode {
      return <div>Healthy workflow</div>;
    }
    setPluginSlotRegistrations("alpha", registrationSet("run", Broken));
    setPluginSlotRegistrations("beta", registrationSet("run", Healthy));

    render(<PluginComposerStatuses projectId="proj_1" threadId="thr_1" />);

    expect(screen.getByText("plugin alpha crashed")).toBeDefined();
    expect(screen.getByText("Healthy workflow")).toBeDefined();
  });
});
