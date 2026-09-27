// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VoiceRecordingBar } from "./VoiceRecordingBar";

vi.mock("./WaveformVisualizer.js", () => ({
  WaveformVisualizer: () => <div data-testid="waveform" />,
}));

afterEach(cleanup);

describe("VoiceRecordingBar", () => {
  it("offers separate add-to-draft and send actions", () => {
    const onConfirm = vi.fn();
    const onSend = vi.fn();
    render(
      <VoiceRecordingBar
        state="recording"
        stream={null}
        onConfirm={onConfirm}
        onSend={onSend}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Stop and add to draft" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Send voice input" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onSend).toHaveBeenCalledOnce();
  });

  it("disables confirm while transcribing", () => {
    const onConfirm = vi.fn();
    render(
      <VoiceRecordingBar
        state="transcribing"
        stream={null}
        onConfirm={onConfirm}
        onSend={vi.fn()}
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
