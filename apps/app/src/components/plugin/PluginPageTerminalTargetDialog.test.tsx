// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PluginPageTerminalTargetDialog } from "./PluginPageTerminalTargetDialog";

vi.mock("@/hooks/queries/host-queries", () => ({
  useHosts: () => ({
    data: [
      { id: "host-online", name: "Studio", status: "connected" },
      { id: "host-offline", name: "Laptop", status: "disconnected" },
    ],
    isLoading: false,
  }),
}));

afterEach(cleanup);

it("returns an explicit host-path target and disables offline machines", () => {
  const onSelect = vi.fn();
  render(
    <PluginPageTerminalTargetDialog
      open
      pending={false}
      onOpenChange={() => undefined}
      onSelect={onSelect}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: /Studio/ }));
  expect(onSelect).toHaveBeenCalledWith({
    kind: "host_path",
    hostId: "host-online",
    cwd: null,
  });
  expect(
    screen.getByRole("button", { name: /Laptop/ }).hasAttribute("disabled"),
  ).toBe(true);
});
