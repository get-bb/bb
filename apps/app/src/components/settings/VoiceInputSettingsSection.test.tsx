// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { afterEach, describe, expect, it } from "vitest";
import { VoiceInputSettingsSectionContent } from "./VoiceInputSettingsSection";

const devices = [
  { deviceId: "macbook-mic", label: "MacBook Pro Microphone" },
  { deviceId: "studio-mic", label: "Studio Display Microphone" },
];

afterEach(() => {
  cleanup();
});

describe("VoiceInputSettingsSectionContent", () => {
  it("keeps the refresh action inline with the heading on mobile", () => {
    render(
      <TooltipProvider>
        <VoiceInputSettingsSectionContent
          devices={devices}
          errorMessage={null}
          isLoading={false}
          isSupported={true}
          onDeviceChange={() => undefined}
          onRefresh={() => undefined}
          preferredDeviceId={null}
        />
      </TooltipProvider>,
    );

    const refreshAction = screen.getByRole("button", {
      name: "Load microphones",
    });
    const sectionHeader = refreshAction.parentElement?.parentElement;
    expect(sectionHeader?.classList.contains("flex-row")).toBe(true);
    expect(sectionHeader?.classList.contains("flex-col")).toBe(false);
  });

  it("falls back when the preferred microphone disconnects and restores it on reconnect", () => {
    const content = (availableDevices: typeof devices) => (
      <TooltipProvider>
        <VoiceInputSettingsSectionContent
          devices={availableDevices}
          errorMessage={null}
          isLoading={false}
          isSupported={true}
          onDeviceChange={() => undefined}
          onRefresh={() => undefined}
          preferredDeviceId="studio-mic"
        />
      </TooltipProvider>
    );
    const { rerender } = render(content(devices));
    expect(screen.getByRole("button", { name: "Microphone" }).textContent).toBe(
      "Studio Display Microphone",
    );

    rerender(
      content(devices.filter((device) => device.deviceId !== "studio-mic")),
    );
    expect(screen.getByRole("button", { name: "Microphone" }).textContent).toBe(
      "System default",
    );
    expect(
      screen.getByText(
        "Preferred microphone is disconnected. Using the system default until it reconnects.",
      ),
    ).toBeDefined();

    rerender(content([]));
    expect(
      screen.getByText("Click Load microphones to check microphone access."),
    ).toBeDefined();

    rerender(content(devices));
    expect(screen.getByRole("button", { name: "Microphone" }).textContent).toBe(
      "Studio Display Microphone",
    );
  });

  it.each([
    [null, "Click Load microphones to check microphone access."],
    ["Microphone permission denied", "Microphone permission denied"],
    ["No microphones found", "No microphones found"],
  ])(
    "distinguishes an empty list from an access error: %s",
    (errorMessage, message) => {
      render(
        <TooltipProvider>
          <VoiceInputSettingsSectionContent
            devices={[]}
            errorMessage={errorMessage}
            isLoading={false}
            isSupported={true}
            onDeviceChange={() => undefined}
            onRefresh={() => undefined}
            preferredDeviceId={null}
          />
        </TooltipProvider>,
      );
      expect(screen.getByText(message)).toBeDefined();
    },
  );
});
