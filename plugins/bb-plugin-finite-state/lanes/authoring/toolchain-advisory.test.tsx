// @vitest-environment jsdom

import {
  installTestPluginRuntime,
  loadPluginApp,
  renderSlot,
} from "@bb/plugin-sdk/testing/app";
import { cleanup, fireEvent } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

beforeAll(() => installTestPluginRuntime());
afterEach(() => cleanup());

describe("authoring toolchain advisory", () => {
  it("renders unavailable helpers as lane-scoped setup guidance", async () => {
    const app = await loadPluginApp(() => import("../../app.js"));
    const panel = app.navPanels.find((candidate) => candidate.id === "firmware-authoring");
    if (!panel) throw new Error("firmware authoring panel not registered");
    const slot = renderSlot(panel, { subPath: "" }, {
      rpc: {
        authoringToolchainStatus: () => ({
          state: "unavailable" as const,
          configured: false,
          found: [],
          missing: [
            { id: "arm-none-eabi-gcc", unlocks: "build" as const },
            { id: "ninja", unlocks: "build" as const },
            { id: "openocd", unlocks: "flash" as const },
            { id: "west", unlocks: "zephyr-workspace" as const },
          ],
          message: "Firmware helpers are unavailable on this host: build missing arm-none-eabi-gcc, ninja; flash missing openocd; zephyr-workspace missing west.",
          checkedAt: "2026-08-13T20:00:00.000Z",
        }),
      },
    });

    expect(await slot.findByText("Firmware helpers unavailable")).toBeTruthy();
    expect(slot.getByText(/build missing arm-none-eabi-gcc, ninja/u)).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Review helper install" }));
    expect(slot.getByText("Manual host prerequisites")).toBeTruthy();
    expect(slot.getByText("flash · openocd")).toBeTruthy();
    expect(slot.getByText(/does not install or modify host toolchains/u)).toBeTruthy();
    slot.lifecycle.unmount();
  });
});
