import { describe, expect, it } from "vitest";
import { audioInputDeviceOptions } from "./useAudioInputDevices";

function mediaDevice(
  device: Pick<MediaDeviceInfo, "deviceId" | "kind" | "label">,
): Pick<MediaDeviceInfo, "deviceId" | "kind" | "label"> {
  return device;
}

describe("audioInputDeviceOptions", () => {
  it("keeps unique concrete audio inputs and assigns fallback labels", () => {
    expect(
      audioInputDeviceOptions([
        mediaDevice({ deviceId: "default", kind: "audioinput", label: "" }),
        mediaDevice({ deviceId: "", kind: "audioinput", label: "" }),
        mediaDevice({
          deviceId: "camera",
          kind: "videoinput",
          label: "FaceTime Camera",
        }),
        mediaDevice({
          deviceId: "macbook-mic",
          kind: "audioinput",
          label: "MacBook Pro Microphone",
        }),
        mediaDevice({
          deviceId: "studio-mic",
          kind: "audioinput",
          label: "",
        }),
        mediaDevice({
          deviceId: "studio-mic",
          kind: "audioinput",
          label: "Studio Display Microphone",
        }),
      ]),
    ).toEqual([
      { deviceId: "macbook-mic", label: "MacBook Pro Microphone" },
      { deviceId: "studio-mic", label: "Microphone 2" },
    ]);
  });
});
