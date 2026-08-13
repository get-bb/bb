// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExperimentsSettingsSection } from "./SettingsView";

afterEach(cleanup);

function renderSection(overrides?: {
  onNewOnboardingEnabledChange?: (enabled: boolean) => void;
}) {
  return render(
    <ExperimentsSettingsSection
      claudeCodeMockCliTrafficEnabled={false}
      disabled={false}
      editMessagesEnabled={false}
      newOnboardingEnabled={false}
      onClaudeCodeMockCliTrafficEnabledChange={vi.fn()}
      onEditMessagesEnabledChange={vi.fn()}
      onNewOnboardingEnabledChange={
        overrides?.onNewOnboardingEnabledChange ?? vi.fn()
      }
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
});
