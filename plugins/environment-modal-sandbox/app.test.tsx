// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { ModalLaunchOptions } from "./launch-options.js";

const app = await loadPluginApp(() => import("./app"));
afterEach(cleanup);

it("refreshes pristine settings on reconnect without replacing an edited draft", async () => {
  let options: ModalLaunchOptions = {
    presets: [{ name: "Initial", cpu: 1, memoryMiB: 1024 }],
    images: [{ name: "Image", source: "image-id", imageId: "im-test" }],
  };
  let calls = 0;
  const slot = renderSlot(
    app.settingsSections[0]!,
    {},
    {
      rpc: {
        "launch.options": () => {
          calls += 1;
          return options;
        },
      },
    },
  );
  await waitFor(() => expect(slot.getByDisplayValue("Initial")).toBeTruthy());
  options = {
    ...options,
    presets: [{ ...options.presets[0]!, name: "Remote" }],
  };
  await slot.setRealtimeConnectionState("reconnecting");
  await slot.setRealtimeConnectionState("connected");
  await waitFor(() => expect(slot.getByDisplayValue("Remote")).toBeTruthy());
  fireEvent.change(slot.getByLabelText("Preset 1 name"), {
    target: { value: "My draft" },
  });
  options = {
    ...options,
    presets: [{ ...options.presets[0]!, name: "New remote" }],
  };
  const before = calls;
  await slot.setRealtimeConnectionState("reconnecting");
  await slot.setRealtimeConnectionState("connected");
  await waitFor(() => expect(calls).toBeGreaterThan(before));
  expect(slot.getByDisplayValue("My draft")).toBeTruthy();
  expect(slot.getByRole("button", { name: "Save changes" })).toBeTruthy();
});
