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
const manyHosts = [
  thisMachine,
  studio,
  devVm,
  makeHost({ ...thisMachine, id: "host_build", name: "Build server" }),
  makeHost({ ...thisMachine, id: "host_office", name: "Office Mac Studio" }),
  makeHost({ ...thisMachine, id: "host_travel", name: "Travel laptop" }),
] as const;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderMachineMenu(overrides?: {
  hosts?: readonly Host[];
  selectedHostId?: string | null;
  onChange?: (hostId: string) => void;
  machineProviders?: readonly MachineProviderPresentation[];
  multiMachinePickerEnabled?: boolean;
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
      multiMachinePickerEnabled={overrides?.multiMachinePickerEnabled ?? true}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Machine" }));
}

describe("MachinePickerUI", () => {
  it("shows search only when there are more than five machines", () => {
    const result = render(
      <MachinePickerUI
        hosts={manyHosts.slice(0, 5)}
        localDaemonHostId={thisMachine.id}
        primaryHostId={thisMachine.id}
        selectedHostId={thisMachine.id}
        onChange={vi.fn()}
        modal={false}
        multiMachinePickerEnabled
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Machine" }));

    expect(
      screen.queryByRole("combobox", { name: "Search machines" }),
    ).toBeNull();

    result.rerender(
      <MachinePickerUI
        hosts={manyHosts}
        localDaemonHostId={thisMachine.id}
        primaryHostId={thisMachine.id}
        selectedHostId={thisMachine.id}
        onChange={vi.fn()}
        modal={false}
        multiMachinePickerEnabled
      />,
    );

    expect(
      screen.getByRole("combobox", { name: "Search machines" }),
    ).toBeTruthy();
  });

  it("hides search when the experiment is off", () => {
    renderMachineMenu({
      hosts: manyHosts,
      multiMachinePickerEnabled: false,
    });

    expect(
      screen.queryByRole("combobox", { name: "Search machines" }),
    ).toBeNull();
    expect(screen.getAllByRole("option")).toHaveLength(manyHosts.length);
  });

  it("fuzzy-searches machine names and host ids, then resets after selection", () => {
    const onChange = vi.fn();
    renderMachineMenu({ hosts: manyHosts, onChange });
    const search = screen.getByRole("combobox", { name: "Search machines" });

    fireEvent.change(search, { target: { value: "OMS" } });
    expect(screen.queryByRole("option", { name: /^Mac Studio$/u })).toBeNull();
    expect(
      screen.getByRole("option", { name: /Office Mac Studio/u }),
    ).toBeTruthy();

    fireEvent.change(search, { target: { value: "host_travel" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("host_travel");

    fireEvent.click(screen.getByRole("button", { name: "Machine" }));
    expect(
      screen.getByRole<HTMLInputElement>("combobox", {
        name: "Search machines",
      }).value,
    ).toBe("");
  });

  it("shows an empty result and returns the results viewport to the top", () => {
    renderMachineMenu({
      hosts: Array.from({ length: 20 }, (_, index) => ({
        ...thisMachine,
        id: `host_${index}`,
        name: `Machine ${index}`,
      })),
    });

    const dialog = screen.getByRole("dialog", { name: "Machine" });
    expect(dialog.className).toContain(
      "max-h-[min(var(--radix-popover-content-available-height),calc(100dvh-0.5rem))]",
    );
    expect(dialog.className).toContain("overflow-hidden");

    const list = document.querySelector<HTMLElement>("[cmdk-list]");
    expect(list).not.toBeNull();
    expect(list?.className).toContain("overflow-y-auto");
    expect(list?.className).toContain("overscroll-contain");

    if (list === null) return;
    list.scrollTop = 120;
    fireEvent.change(
      screen.getByRole("combobox", { name: "Search machines" }),
      { target: { value: "missing" } },
    );
    expect(list.scrollTop).toBe(0);
    expect(screen.getByText("No machines found")).toBeTruthy();
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

    fireEvent.click(screen.getByRole("option", { name: /Mac Studio/u }));
    expect(onChange).toHaveBeenCalledWith(studio.id);
  });

  it("disables an offline machine and shows when it was last seen", () => {
    renderMachineMenu();

    const offlineItem = screen.getByRole("option", { name: /dev-vm/u });
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
