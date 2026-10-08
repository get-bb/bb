// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { afterEach, expect, it, vi } from "vitest";
import { MicrophonePreferences } from "./MicrophonePreferences";

const devices = [
  { kind: "audioinput", deviceId: "built-in", label: "MacBook microphone" },
  { kind: "audioinput", deviceId: "display", label: "Display microphone" },
];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

it("selects and tests a microphone directly, then releases it on exit", async () => {
  const stop = vi.fn();
  const getUserMedia = vi.fn().mockResolvedValue({
    getTracks: () => [{ stop }],
    getAudioTracks: () => [{ label: "Display microphone" }],
  });
  const mediaDevices = Object.assign(new EventTarget(), {
    getUserMedia,
    enumerateDevices: vi.fn().mockResolvedValue(devices),
  });
  vi.stubGlobal("navigator", { mediaDevices });
  const { unmount } = render(
    <Provider store={createStore()}>
      <MicrophonePreferences open />
    </Provider>,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Display microphone" }),
  );
  await act(async () => {});
  expect(getUserMedia).toHaveBeenCalledWith({
    audio: { deviceId: { exact: "display" } },
  });
  expect(screen.getByTitle("Display microphone").textContent).toBe(
    "Display microphone",
  );
  expect(window.localStorage.getItem("bb.voiceInput.audioInputDeviceId")).toBe(
    "display",
  );
  unmount();
  expect(stop).toHaveBeenCalled();
});

it("shows missing preferences as fallback information and restores them on reconnect", async () => {
  window.localStorage.setItem("bb.voiceInput.audioInputDeviceId", "display");
  const enumerateDevices = vi.fn().mockResolvedValue([devices[0]]);
  const mediaDevices = Object.assign(new EventTarget(), {
    getUserMedia: vi
      .fn()
      .mockRejectedValue(new DOMException("Denied", "NotAllowedError")),
    enumerateDevices,
  });
  vi.stubGlobal("navigator", { mediaDevices });
  render(
    <Provider store={createStore()}>
      <MicrophonePreferences open />
    </Provider>,
  );
  expect(
    await screen.findByText(/Preferred microphone unavailable/),
  ).toBeTruthy();
  enumerateDevices.mockResolvedValue(devices);
  await act(async () => mediaDevices.dispatchEvent(new Event("devicechange")));
  expect(
    screen
      .getByRole("button", { name: "Display microphone" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  expect(screen.queryByText(/Preferred microphone unavailable/)).toBeNull();
});

it("releases a microphone if its permission request finishes after the drawer closes", async () => {
  let resolveCapture: (stream: object) => void = () => {};
  const getUserMedia = vi.fn(
    () =>
      new Promise((resolve) => {
        resolveCapture = resolve;
      }),
  );
  vi.stubGlobal("navigator", {
    mediaDevices: Object.assign(new EventTarget(), {
      getUserMedia,
      enumerateDevices: vi.fn().mockResolvedValue(devices),
    }),
  });
  const { unmount } = render(
    <Provider store={createStore()}>
      <MicrophonePreferences open />
    </Provider>,
  );
  await act(async () => {});
  unmount();
  const stop = vi.fn();
  await act(async () => resolveCapture({ getTracks: () => [{ stop }] }));
  expect(stop).toHaveBeenCalledOnce();
});
