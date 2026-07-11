// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Host } from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MachinePickerUI } from "./MachinePicker";

const HOUR_MS = 60 * 60 * 1000;

const thisMachine: Host = {
  id: "host_local",
  name: "MacBook Pro",
  type: "persistent",
  status: "connected",
  lastSeenAt: null,
  lastRejectedProtocolVersion: null,
  createdAt: 0,
  updatedAt: 0,
};
const studio: Host = {
  ...thisMachine,
  id: "host_studio",
  name: "Mac Studio",
};
const devVm: Host = {
  ...thisMachine,
  id: "host_vm",
  name: "dev-vm",
  status: "disconnected",
  lastSeenAt: Date.now() - 2 * HOUR_MS,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderMachineMenu(overrides?: {
  selectedHostId?: string | null;
  onChange?: (hostId: string) => void;
}) {
  render(
    <MachinePickerUI
      hosts={[thisMachine, studio, devVm]}
      localDaemonHostId={thisMachine.id}
      primaryHostId={thisMachine.id}
      selectedHostId={overrides?.selectedHostId ?? thisMachine.id}
      onChange={overrides?.onChange ?? vi.fn()}
      modal={false}
    />,
  );
  fireEvent.pointerDown(screen.getByRole("button", { name: "Machine" }), {
    button: 0,
  });
}

describe("MachinePickerUI", () => {
  it("names the selected machine in the trigger and badges this machine in the menu", () => {
    renderMachineMenu({ selectedHostId: studio.id });

    expect(
      screen.getByRole("button", { name: "Machine" }).textContent,
    ).toContain("Mac Studio");
    expect(screen.getByText("this machine")).toBeTruthy();
  });

  it("emits the picked machine's host id", () => {
    const onChange = vi.fn();
    renderMachineMenu({ onChange });

    fireEvent.click(screen.getByRole("menuitem", { name: /Mac Studio/u }));
    expect(onChange).toHaveBeenCalledWith(studio.id);
  });

  it("disables an offline machine and shows when it was last seen", () => {
    renderMachineMenu();

    const offlineItem = screen.getByRole("menuitem", { name: /dev-vm/u });
    expect(offlineItem.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText(/last seen 2h ago/u)).toBeTruthy();
  });

  it("falls back to the primary host when the selected host is unknown", () => {
    renderMachineMenu({ selectedHostId: "host_gone" });

    expect(
      screen.getByRole("button", { name: "Machine" }).textContent,
    ).toContain("MacBook Pro");
  });
});
