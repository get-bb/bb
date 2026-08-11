// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExperimentsSettingsSection } from "./SettingsView";

afterEach(cleanup);

function renderSection(overrides?: {
  onNewOnboardingEnabledChange?: (enabled: boolean) => void;
  onRewindEnabledChange?: (enabled: boolean) => void;
  onToolsHubEnabledChange?: (enabled: boolean) => void;
}) {
  return render(
    <ExperimentsSettingsSection
      claudeCodeMockCliTrafficEnabled={false}
      disabled={false}
      newOnboardingEnabled={false}
      onClaudeCodeMockCliTrafficEnabledChange={vi.fn()}
      onNewOnboardingEnabledChange={
        overrides?.onNewOnboardingEnabledChange ?? vi.fn()
      }
      onRewindEnabledChange={overrides?.onRewindEnabledChange ?? vi.fn()}
      onToolsHubEnabledChange={overrides?.onToolsHubEnabledChange ?? vi.fn()}
      rewindEnabled={false}
      toolsHubEnabled={false}
    />,
  );
}

describe("ExperimentsSettingsSection", () => {
  it("reports new onboarding changes", () => {
    const onChange = vi.fn();
    renderSection({ onNewOnboardingEnabledChange: onChange });
    fireEvent.click(screen.getByLabelText("New onboarding"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("reports Extensions changes", () => {
    const onChange = vi.fn();
    renderSection({ onToolsHubEnabledChange: onChange });
    const toggle = screen.getByLabelText("Extensions");
    expect(toggle.hasAttribute("disabled")).toBe(false);
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("reports Rewind changes", () => {
    const onChange = vi.fn();
    renderSection({ onRewindEnabledChange: onChange });
    fireEvent.click(screen.getByLabelText("Rewind"));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
