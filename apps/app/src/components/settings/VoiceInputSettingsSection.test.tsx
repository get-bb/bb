// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VoiceInputSettingsSectionContent } from "./VoiceInputSettingsSection";

const devices = [
  { deviceId: "macbook-mic", label: "MacBook Pro Microphone" },
  { deviceId: "studio-mic", label: "Studio Display Microphone" },
];

afterEach(() => {
  cleanup();
});

describe("VoiceInputSettingsSectionContent", () => {
  it("selects a microphone and clears back to system default", async () => {
    const onDeviceChange = vi.fn();
    const onRefresh = vi.fn();

    const { rerender } = render(
      <TooltipProvider>
        <VoiceInputSettingsSectionContent
          devices={devices}
          errorMessage={null}
          isLoading={false}
          isSupported={true}
          onDeviceChange={onDeviceChange}
          onRefresh={onRefresh}
          preferredDeviceId={null}
        />
      </TooltipProvider>,
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: "Microphone" }), {
      button: 0,
    });
    expect(onRefresh).toHaveBeenCalledWith(false);
    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: /Studio Display Microphone/u,
      }),
    );
    expect(onDeviceChange).toHaveBeenLastCalledWith("studio-mic");

    rerender(
      <TooltipProvider>
        <VoiceInputSettingsSectionContent
          devices={devices}
          errorMessage={null}
          isLoading={false}
          isSupported={true}
          onDeviceChange={onDeviceChange}
          onRefresh={onRefresh}
          preferredDeviceId="studio-mic"
        />
      </TooltipProvider>,
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: "Microphone" }), {
      button: 0,
    });
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /System default/u }),
    );
    expect(onDeviceChange).toHaveBeenLastCalledWith(null);
  });

  it("keeps a stale selected microphone visible as unavailable", () => {
    render(
      <TooltipProvider>
        <VoiceInputSettingsSectionContent
          devices={devices}
          errorMessage={null}
          isLoading={false}
          isSupported={true}
          onDeviceChange={() => undefined}
          onRefresh={() => undefined}
          preferredDeviceId="missing-mic"
        />
      </TooltipProvider>,
    );

    expect(screen.getByText("Unavailable microphone")).toBeDefined();
    expect(screen.getByText("Selected microphone is unavailable.")).toBeDefined();
  });
});
