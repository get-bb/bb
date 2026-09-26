// @vitest-environment jsdom
import { cleanup, fireEvent } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { UsageMachine } from "./usage-schema.js";

const key = "bb.provider-usage.selected-machine.v1";
const machines: UsageMachine[] = [
  "source:pool-a",
  "source:pool-b",
  "device-a",
  "device-b",
].map((id) => ({
  id,
  displayName: id,
  status: "connected",
  error: null,
  providers: ["first", "second"].map((providerId) => ({
    id: providerId,
    providerId,
    displayName: providerId,
    accountLabel: null,
    logoUrl: null,
    icon: null,
    strings: { iconTint: null },
    signInHint: "Sign in",
    expiredHint: "Sign in again",
    usage: {
      status: "ok",
      accountEmail: `${id}@example.invalid`,
      planLabel: null,
      windows: [],
    },
  })),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

async function mount(available = machines) {
  await loadPluginApp(() => import("./app"));
  const { ProviderUsageStatusContent } = await import("./app");
  const props = {
    dismiss: vi.fn(),
    machineSelectionStorageKey: key,
    snapshot: {
      data: { machines: available },
      error: null,
      isRefreshing: false,
    },
    threadMachineId: "device-b",
    refreshEnabled: false,
  };
  const slot = renderSlot({ component: ProviderUsageStatusContent }, props);
  return { slot, props, Component: ProviderUsageStatusContent };
}

it.each(["device-a", "device-b", "source:pool-a", "source:pool-b"])(
  "restores the explicit %s selection after a fresh module load",
  async (id) => {
    localStorage.setItem(key, id);
    vi.resetModules();
    const { slot } = await mount();
    expect(
      slot.getByRole("button", { name: `Usage machine: ${id}` }),
    ).toBeTruthy();
  },
);

it("persists explicit keyboard selection and retains independent provider tabs while data updates", async () => {
  vi.resetModules();
  const { slot, props, Component } = await mount();
  const select = (current: string, next: string) => {
    fireEvent.pointerDown(
      slot.getByRole("button", { name: `Usage machine: ${current}` }),
      { button: 0 },
    );
    fireEvent.keyDown(slot.getByRole("menuitemradio", { name: next }), {
      key: "Enter",
    });
  };
  select("source:pool-a", "device-a");
  expect(localStorage.getItem(key)).toBe("device-a");
  fireEvent.keyDown(slot.getByRole("tab", { name: "first" }), { key: "End" });
  expect(
    slot.getByRole("tab", { name: "second" }).getAttribute("aria-selected"),
  ).toBe("true");
  select("device-a", "source:pool-b");
  expect(localStorage.getItem(key)).toBe("source:pool-b");
  expect(
    slot.getByRole("tab", { name: "first" }).getAttribute("aria-selected"),
  ).toBe("true");
  select("source:pool-b", "device-a");
  expect(
    slot.getByRole("tab", { name: "second" }).getAttribute("aria-selected"),
  ).toBe("true");
  slot.rerender(
    <Component
      {...props}
      snapshot={{
        ...props.snapshot,
        data: { machines: [...machines].reverse() },
      }}
    />,
  );
  expect(
    slot.getByRole("button", { name: "Usage machine: device-a" }),
  ).toBeTruthy();
  slot.unmount();
  vi.resetModules();
  const reopened = await mount();
  expect(
    reopened.slot.getByRole("button", { name: "Usage machine: device-a" }),
  ).toBeTruthy();
});

it("falls back without replacing the explicit preference when a target disappears or data is loading", async () => {
  localStorage.setItem(key, "device-a");
  vi.resetModules();
  const { slot, props, Component } = await mount([]);
  expect(localStorage.getItem(key)).toBe("device-a");
  slot.rerender(
    <Component
      {...props}
      snapshot={{
        ...props.snapshot,
        data: { machines: machines.filter((m) => m.id !== "device-a") },
      }}
    />,
  );
  expect(
    slot.getByRole("button", { name: "Usage machine: source:pool-a" }),
  ).toBeTruthy();
  expect(localStorage.getItem(key)).toBe("device-a");
  slot.rerender(
    <Component
      {...props}
      snapshot={{ ...props.snapshot, data: { machines } }}
    />,
  );
  expect(
    slot.getByRole("button", { name: "Usage machine: device-a" }),
  ).toBeTruthy();
});

it("retains close/reopen selection when browser storage is unavailable", async () => {
  vi.resetModules();
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  const { slot } = await mount();
  fireEvent.pointerDown(
    slot.getByRole("button", { name: "Usage machine: source:pool-a" }),
    { button: 0 },
  );
  fireEvent.click(slot.getByRole("menuitemradio", { name: "device-b" }));
  expect(
    slot.getByRole("button", { name: "Usage machine: device-b" }),
  ).toBeTruthy();
  slot.unmount();
  const reopened = await mount();
  expect(
    reopened.slot.getByRole("button", { name: "Usage machine: device-b" }),
  ).toBeTruthy();
});

it("retains the new selection on reopen when a storage write fails", async () => {
  localStorage.setItem(key, "source:pool-b");
  vi.resetModules();
  const { slot } = await mount();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("quota");
  });
  fireEvent.pointerDown(
    slot.getByRole("button", { name: "Usage machine: source:pool-b" }),
    { button: 0 },
  );
  fireEvent.click(slot.getByRole("menuitemradio", { name: "device-b" }));
  slot.unmount();
  const reopened = await mount();
  expect(
    reopened.slot.getByRole("button", { name: "Usage machine: device-b" }),
  ).toBeTruthy();
});
