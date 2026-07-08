import { describe, expect, it } from "vitest";
import {
  buildAudioInputConstraints,
  parsePreferredAudioInputDeviceId,
} from "./audio-input-device-preference";

describe("audio input device preference", () => {
  it("parses only non-empty stored device ids", () => {
    expect(parsePreferredAudioInputDeviceId(null, null)).toBeNull();
    expect(parsePreferredAudioInputDeviceId("", null)).toBeNull();
    expect(parsePreferredAudioInputDeviceId("   ", null)).toBeNull();
    expect(parsePreferredAudioInputDeviceId("studio-mic", null)).toBe(
      "studio-mic",
    );
  });

  it("builds default and exact-device getUserMedia constraints", () => {
    expect(buildAudioInputConstraints(null)).toEqual({ audio: true });
    expect(buildAudioInputConstraints("studio-mic")).toEqual({
      audio: { deviceId: { exact: "studio-mic" } },
    });
  });
});
