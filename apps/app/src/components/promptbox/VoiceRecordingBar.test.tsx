// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as waveformVisualizerModule from "./WaveformVisualizer.js";
import { VoiceRecordingBar } from "./VoiceRecordingBar";

vi.spyOn(waveformVisualizerModule, "WaveformVisualizer").mockImplementation(
  () => <div data-testid="waveform" />,
);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("VoiceRecordingBar", () => {
  it("disables confirm while transcribing", () => {
    const onConfirm = vi.fn();
    render(
      <VoiceRecordingBar
        state="transcribing"
        stream={null}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    const confirm = screen.getByRole("button", {
      name: "Transcribing voice input",
    });
    expect(confirm).toHaveProperty("disabled", true);
    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();

    expect(
      screen.getByRole("button", { name: "Cancel transcription" }),
    ).toBeTruthy();
  });
});
