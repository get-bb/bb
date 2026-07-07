// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VoiceRecordingBar } from "./VoiceRecordingBar";

vi.mock("./WaveformVisualizer.js", () => ({
  WaveformVisualizer: () => <div data-testid="waveform" />,
}));

afterEach(cleanup);

describe("VoiceRecordingBar", () => {
  it("calls confirm and cancel while recording", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <VoiceRecordingBar
        state="recording"
        stream={null}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Stop and transcribe recording" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel recording" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

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
