// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PluginRowSignalView } from "./PluginRowSignal";

afterEach(cleanup);

describe("PluginRowSignalView", () => {
  it("keeps runtime health icon-only until hover or focus and opens details", async () => {
    const onStatusClick = vi.fn();
    render(
      <PluginRowSignalView
        signal={{
          kind: "status",
          icon: "AlertTriangle",
          label: "Degraded",
          tone: "warning",
          detail: "One background service failed.",
        }}
        onUpdateClick={vi.fn()}
        onStatusClick={onStatusClick}
      />,
    );

    const statusButton = screen.getByRole("button", {
      name: "View details for Degraded: One background service failed.",
    });
    expect(screen.queryByText("Degraded")).toBeNull();

    fireEvent.focus(statusButton);
    expect((await screen.findByRole("tooltip")).textContent).toBe(
      "Degraded: One background service failed.",
    );

    fireEvent.click(statusButton);
    expect(onStatusClick).toHaveBeenCalledOnce();
  });
});
