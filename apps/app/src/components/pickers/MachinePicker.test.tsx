// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Host } from "@bb/domain";
import { makeHost } from "@bb/test-helpers/domain-fixtures";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MachinePickerUI } from "./MachinePicker";
import type { MachineProviderPresentation } from "@/components/plugin/MachineProviderIcon";

const HOUR_MS = 60 * 60 * 1000;

const thisMachine = makeHost({
  id: "host_local",
  name: "MacBook Pro",
});
const studio = makeHost({
  ...thisMachine,
  id: "host_studio",
  name: "Mac Studio",
});
const devVm = makeHost({
  ...thisMachine,
  id: "host_vm",
  name: "dev-vm",
  status: "disconnected",
  lastSeenAt: Date.now() - 2 * HOUR_MS,
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderMachineMenu(overrides?: {
  hosts?: readonly Host[];
  selectedHostId?: string | null;
  onChange?: (hostId: string) => void;
  machineProviders?: readonly MachineProviderPresentation[];
}) {
  render(
    <MachinePickerUI
      hosts={overrides?.hosts ?? [thisMachine, studio, devVm]}
      localDaemonHostId={thisMachine.id}
      primaryHostId={thisMachine.id}
      selectedHostId={overrides?.selectedHostId ?? thisMachine.id}
      onChange={overrides?.onChange ?? vi.fn()}
      modal={false}
      machineProviders={overrides?.machineProviders}
    />,
  );
  fireEvent.pointerDown(screen.getByRole("button", { name: "Machine" }), {
    button: 0,
  });
}

describe("MachinePickerUI", () => {
  it("keeps a long machine menu inside a short viewport and scrolls it", () => {
    renderMachineMenu({
      hosts: Array.from({ length: 20 }, (_, index) => ({
        ...thisMachine,
        id: `host_${index}`,
        name: `Machine ${index}`,
      })),
    });

    const menu = screen.getByRole("menu");
    expect(menu.className).toContain(
      "max-h-[min(var(--radix-dropdown-menu-content-available-height),calc(100dvh-0.5rem))]",
    );
    expect(menu.className).toContain("overflow-auto");
    expect(menu.className).toContain("overflow-x-hidden");
    expect(menu.className).not.toContain("overflow-hidden");
    expect(menu.className).toContain("overscroll-contain");
  });

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

  it("includes provider-made hosts in machine pickers", () => {
    const modalHost = makeHost({
      id: "host_modal",
      name: "Modal sandbox 3f9a",
      type: "ephemeral",
      machineProviderId: "modal-sandbox",
    });
    renderMachineMenu({
      hosts: [thisMachine, studio, modalHost],
      selectedHostId: modalHost.id,
      machineProviders: [
        {
          id: "modal-sandbox",
          displayName: "Modal Sandbox",
          icon: "Cloud",
          logoUrl: null,
        },
      ],
    });

    expect(screen.getAllByText("Modal sandbox 3f9a")).toHaveLength(2);
    const trigger = screen.getByRole("button", { name: "Machine" });
    expect(trigger.querySelector('[data-icon="Cloud"]')).not.toBeNull();
    expect(trigger.querySelector('[data-icon="Laptop"]')).toBeNull();
    expect(screen.queryByText("Modal Sandbox")).toBeNull();
  });
});
