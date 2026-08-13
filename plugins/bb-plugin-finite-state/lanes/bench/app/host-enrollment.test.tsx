// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, fireEvent } from "@testing-library/react";
import { installTestPluginRuntime, renderSlot } from "@bb/plugin-sdk/testing/app";

beforeAll(() => installTestPluginRuntime());
afterEach(() => cleanup());

describe("HostEnrollment", () => {
  it("shows code, expiry and daemon instructions without claiming enrollment", async () => {
    const { HostEnrollment } = await import("./host-enrollment.js");
    const slot = renderSlot({ component: () => <HostEnrollment hosts={[]} loadingHosts={false} onRefreshHosts={async () => {}} /> }, {}, {
      rpc: { benchHostsJoinCode: () => ({ joinCode: "JOIN123", hostId: "host-1", expiresAt: new Date(Date.now() + 60_000).toISOString() }) },
    });
    fireEvent.click(slot.getByRole("button", { name: "Issue join code" }));
    expect(await slot.findByText("JOIN123")).toBeTruthy();
    expect(slot.getByText(/Run the bb host-daemon/u)).toBeTruthy();
    expect(slot.getByText("Waiting for bb host list")).toBeTruthy();
    expect(slot.queryByText("Listed by bb")).toBeNull();
  });

  it("does not expose an expired code", async () => {
    const { HostEnrollment } = await import("./host-enrollment.js");
    const slot = renderSlot({ component: () => <HostEnrollment hosts={[]} loadingHosts={false} onRefreshHosts={async () => {}} /> }, {}, {
      rpc: { benchHostsJoinCode: () => ({ joinCode: "EXPIRED", hostId: "host-1", expiresAt: new Date(Date.now() - 1_000).toISOString() }) },
    });
    fireEvent.click(slot.getByRole("button", { name: "Issue join code" }));
    expect(await slot.findByText(/expired and is no longer shown/u)).toBeTruthy();
    expect(slot.queryByText("EXPIRED")).toBeNull();
  });
});
