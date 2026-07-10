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
    expect(
      screen.getByText("Selected microphone is unavailable."),
    ).toBeDefined();
  });
});
