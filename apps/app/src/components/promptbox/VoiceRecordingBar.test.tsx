// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VoiceRecordingBar } from "./VoiceRecordingBar";

vi.mock("./WaveformVisualizer.js", () => ({
  WaveformVisualizer: () => <div data-testid="waveform" />,
}));
vi.mock("@bb/shared-ui/icon", () => ({
  Icon: ({ name }: { name: string }) => <span data-icon-name={name} />,
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
        submitIcon="CornerDownLeft"
        onConfirm={onConfirm}
        onSend={onSend}
        onCancel={vi.fn()}
      />,
    );
    const cancel = screen.getByRole("button", { name: "Cancel recording" });
    const stop = screen.getByRole("button", { name: "Stop and add to draft" });
    const send = screen.getByRole("button", { name: "Send voice input" });
    expect(screen.getByTestId("waveform")).toBeTruthy();
    expect(
      cancel.compareDocumentPosition(stop) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      stop.compareDocumentPosition(send) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(stop.querySelector('[data-icon-name="Square"]')).toBeTruthy();
    expect(stop.className).toContain("bg-secondary");
    expect(stop.className).toContain("rounded-md");
    expect(
      send.querySelector('[data-icon-name="CornerDownLeft"]'),
    ).toBeTruthy();
    expect(send.className).toContain("bg-foreground");
    expect(send.className).toContain("rounded-md");
    fireEvent.click(stop);
    fireEvent.click(send);
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onSend).toHaveBeenCalledOnce();
  });

  it("disables both completion actions while transcribing but still allows cancellation", () => {
    const onConfirm = vi.fn();
    const onSend = vi.fn();
    const onCancel = vi.fn();
    render(
      <VoiceRecordingBar
        state="transcribing"
        stream={null}
        submitIcon="CornerDownLeft"
        onConfirm={onConfirm}
        onSend={onSend}
        onCancel={onCancel}
      />,
    );

    const confirm = screen.getByRole("button", {
      name: "Transcribing voice input",
    });
    expect(confirm).toHaveProperty("disabled", true);
    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();

    const send = screen.getByRole("button", { name: "Send voice input" });
    expect(send).toHaveProperty("disabled", true);
    expect(confirm.querySelector('[data-icon-name="Spinner"]')).toBeTruthy();
    fireEvent.click(send);
    expect(onSend).not.toHaveBeenCalled();
    const cancel = screen.getByRole("button", { name: "Cancel transcription" });
    fireEvent.click(cancel);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("shows transcription progress on the action that was pressed", () => {
    const props = {
      stream: null,
      submitIcon: "ArrowUp" as const,
      onConfirm: vi.fn(),
      onSend: vi.fn(),
      onCancel: vi.fn(),
    };
    const { rerender } = render(
      <VoiceRecordingBar state="recording" {...props} />,
    );
    const send = screen.getByRole("button", { name: "Send voice input" });
    expect(send.querySelector('[data-icon-name="ArrowUp"]')).toBeTruthy();
    fireEvent.click(send);
    rerender(<VoiceRecordingBar state="transcribing" {...props} />);

    const sending = screen.getByRole("button", {
      name: "Transcribing and sending",
    });
    expect(sending.querySelector('[data-icon-name="Spinner"]')).toBeTruthy();
    expect(sending.className).toContain("disabled:opacity-100");
    const stop = screen.getByRole("button", { name: "Stop and add to draft" });
    expect(stop.querySelector('[data-icon-name="Spinner"]')).toBeNull();
    expect(stop.className).not.toContain("disabled:opacity-100");
  });
});
