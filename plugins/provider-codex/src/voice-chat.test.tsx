// @vitest-environment jsdom

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, expect, it, vi } from "vitest";
import { CodexVoiceAction } from "./voice-chat.js";
import type { VoiceRequest } from "./voice-client.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("connects from the Codex composer, mutes the microphone, and ends only voice", async () => {
  const track = { enabled: true, onended: null, stop: vi.fn() };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const peer = {
    connectionState: "connected",
    onconnectionstatechange: null as (() => void) | null,
    ontrack: null,
    addTrack: vi.fn(),
    createDataChannel: vi.fn(() => ({
      readyState: "open",
      onopen: null,
      send: vi.fn(),
      close: vi.fn(),
    })),
    createOffer: async () => ({ type: "offer", sdp: "offer" }),
    setLocalDescription: async () => {},
    localDescription: { sdp: "offer" },
    setRemoteDescription: async () => {
      peer.onconnectionstatechange?.();
    },
    close: vi.fn(),
  };
  vi.stubGlobal("navigator", {
    mediaDevices: { getUserMedia: async () => stream },
  });
  vi.stubGlobal(
    "RTCPeerConnection",
    class {
      constructor() {
        return peer;
      }
    },
  );
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  const voice = vi.fn(async ({ command }: { command: VoiceRequest }) => ({
    sdp: command.action === "start" ? "answer" : null,
  }));
  renderSlot(
    { component: CodexVoiceAction },
    {},
    {
      composer: {
        scope: { kind: "thread", threadId: "thr_voice" },
        selection: { providerId: "codex" },
      },
      sdk: { threads: { voice } },
    },
  );
  fireEvent.click(screen.getByRole("button", { name: "Start voice chat" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Mute" }).hasAttribute("disabled"),
    ).toBe(false),
  );
  expect(voice).toHaveBeenCalledWith({
    threadId: "thr_voice",
    command: { action: "start", sessionId: expect.any(String), sdp: "offer" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Mute" }));
  expect(track.enabled).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "End voice" }));
  expect(track.stop).toHaveBeenCalledOnce();
  expect(peer.close).toHaveBeenCalledOnce();
  expect(voice).toHaveBeenLastCalledWith({
    threadId: "thr_voice",
    command: { action: "stop", sessionId: expect.any(String) },
  });
  expect(
    screen.getByRole("button", { name: "Start voice chat" }),
  ).not.toBeNull();
});

it("keeps native Codex voice controls out of other provider threads", () => {
  renderSlot(
    { component: CodexVoiceAction },
    {},
    {
      composer: {
        scope: { kind: "thread", threadId: "thr_other" },
        selection: { providerId: "claude-code" },
      },
    },
  );
  expect(screen.queryByRole("button", { name: "Start voice chat" })).toBeNull();
});
