// @vitest-environment jsdom

import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useBbNavigate } from "@/lib/plugin-sdk-hooks";
import { PluginSlotMount } from "./PluginSlotMount";
import { PluginThreadPanelNavigationProvider } from "./plugin-thread-panel-navigation";

afterEach(cleanup);

function NavigationProbe() {
  const navigate = useBbNavigate();
  const [accepted, setAccepted] = useState<boolean | null>(null);
  return (
    <>
      <button
        type="button"
        onClick={() =>
          setAccepted(
            navigate.experimental_openThreadPanel({
              actionId: "details",
              title: "Run details",
              params: { runId: "run_1" },
            }),
          )
        }
      >
        Open details
      </button>
      <span>
        {accepted === null ? "idle" : accepted ? "accepted" : "rejected"}
      </span>
    </>
  );
}

function PluginProbe() {
  return (
    <PluginSlotMount pluginId="workflows" slotKind="test" slotId="navigation">
      <NavigationProbe />
    </PluginSlotMount>
  );
}

describe("plugin thread-panel navigation", () => {
  it("binds generic panel requests to the calling plugin", () => {
    const openThreadPanel = vi.fn(() => true);
    render(
      <MemoryRouter>
        <PluginThreadPanelNavigationProvider openThreadPanel={openThreadPanel}>
          <PluginProbe />
        </PluginThreadPanelNavigationProvider>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open details" }));

    expect(openThreadPanel).toHaveBeenCalledWith({
      pluginId: "workflows",
      actionId: "details",
      title: "Run details",
      params: { runId: "run_1" },
    });
    expect(screen.getByText("accepted")).toBeTruthy();
  });

  it("returns false outside a thread-panel surface", () => {
    render(
      <MemoryRouter>
        <PluginProbe />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open details" }));

    expect(screen.getByText("rejected")).toBeTruthy();
  });
});
