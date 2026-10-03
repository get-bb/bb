import { describe, expect, it, vi } from "vitest";
import {
  buildAudioInputConstraints,
  parsePreferredAudioInputDeviceId,
  requestAudioInputStream,
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

describe("requestAudioInputStream", () => {
  const stream = { id: "recording" };

  it("uses the preferred device without retrying when it is available", async () => {
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    await expect(
      requestAudioInputStream(
        { getUserMedia, enumerateDevices: vi.fn().mockResolvedValue([]) },
        "headphones",
      ),
    ).resolves.toBe(stream);
    expect(getUserMedia.mock.calls).toEqual([
      [{ audio: { deviceId: { exact: "headphones" } } }],
    ]);
  });

  it.each([
    "OverconstrainedError",
    "NotFoundError",
    "DevicesNotFoundError",
    "NotReadableError",
  ])("falls back after %s", async (name) => {
    const getUserMedia = vi
      .fn()
      .mockRejectedValueOnce(new DOMException("Missing device", name))
      .mockResolvedValueOnce(stream);
    await expect(
      requestAudioInputStream(
        { getUserMedia, enumerateDevices: vi.fn().mockResolvedValue([]) },
        "headphones",
      ),
    ).resolves.toBe(stream);
    expect(getUserMedia.mock.calls).toEqual([
      [{ audio: { deviceId: { exact: "headphones" } } }],
      [{ audio: true }],
    ]);
  });

  it.each(["NotAllowedError", "SecurityError", "AbortError"])(
    "does not retry %s",
    async (name) => {
      const error = new DOMException("Capture failed", name);
      const getUserMedia = vi.fn().mockRejectedValue(error);
      await expect(
        requestAudioInputStream(
          { getUserMedia, enumerateDevices: vi.fn().mockResolvedValue([]) },
          "headphones",
        ),
      ).rejects.toBe(error);
      expect(getUserMedia).toHaveBeenCalledTimes(1);
    },
  );

  it("preserves a fallback failure when no microphone is available", async () => {
    const error = new DOMException("No microphones", "NotFoundError");
    const getUserMedia = vi
      .fn()
      .mockRejectedValueOnce(
        new DOMException("Disconnected", "OverconstrainedError"),
      )
      .mockRejectedValueOnce(error);
    await expect(
      requestAudioInputStream(
        { getUserMedia, enumerateDevices: vi.fn().mockResolvedValue([]) },
        "headphones",
      ),
    ).rejects.toBe(error);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });

  it("does not retry an unavailable system default", async () => {
    const error = new DOMException("No microphones", "NotFoundError");
    const getUserMedia = vi.fn().mockRejectedValue(error);
    await expect(
      requestAudioInputStream(
        { getUserMedia, enumerateDevices: vi.fn().mockResolvedValue([]) },
        null,
      ),
    ).rejects.toBe(error);
    expect(getUserMedia.mock.calls).toEqual([[{ audio: true }]]);
  });
});

it("tries another input when both the preferred and system-default microphones cannot start", async () => {
  const stream = { id: "working-external" };
  const getUserMedia = vi
    .fn()
    .mockRejectedValueOnce(new DOMException("Busy", "NotReadableError"))
    .mockRejectedValueOnce(new DOMException("Unavailable", "NotReadableError"))
    .mockResolvedValueOnce(stream);
  const enumerateDevices = vi.fn().mockResolvedValue([
    { kind: "audioinput", deviceId: "built-in" },
    { kind: "audioinput", deviceId: "default" },
    { kind: "audioinput", deviceId: "external" },
  ]);
  await expect(
    requestAudioInputStream({ getUserMedia, enumerateDevices }, "built-in"),
  ).resolves.toBe(stream);
  expect(getUserMedia.mock.calls).toEqual([
    [{ audio: { deviceId: { exact: "built-in" } } }],
    [{ audio: true }],
    [{ audio: { deviceId: { exact: "external" } } }],
  ]);
});
