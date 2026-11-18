// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { useWidgetVoiceEntry } from "./widget-voice-entry";
import { WidgetVoiceReadyPrompt } from "@/components/promptbox/WidgetVoiceReadyPrompt";

afterEach(cleanup);

function WidgetVoiceEntryProbe({ onStart }: { onStart: () => void }) {
  const location = useLocation();
  const voiceReady = useWidgetVoiceEntry();
  const [dismissed, setDismissed] = useState(false);
  return (
    <>
      <output data-testid="location-search">{location.search}</output>
      {voiceReady && !dismissed ? (
        <WidgetVoiceReadyPrompt
          onDismiss={() => setDismissed(true)}
          onStart={onStart}
          supported
          unsupportedMessage="Voice input is unavailable."
        />
      ) : null}
    </>
  );
}

function renderWidgetVoiceEntry(onStart: () => void) {
  render(
    <MemoryRouter initialEntries={["/threads/thread-1?keep=1&widgetVoice=1"]}>
      <WidgetVoiceEntryProbe onStart={onStart} />
    </MemoryRouter>,
  );
}

it("consumes widgetVoice and opens a ready affordance without starting recording", async () => {
  const start = vi.fn();
  renderWidgetVoiceEntry(start);

  await screen.findByText("Ready to record");
  expect(screen.getByTestId("location-search").textContent).toBe("?keep=1");
  expect(start).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Start voice input" }));
  expect(start).toHaveBeenCalledOnce();
});

it("lets the user dismiss the widget voice ready affordance", async () => {
  renderWidgetVoiceEntry(vi.fn());

  await screen.findByText("Ready to record");
  fireEvent.click(
    screen.getByRole("button", { name: "Dismiss voice input prompt" }),
  );
  expect(screen.queryByText("Ready to record")).toBeNull();
});
