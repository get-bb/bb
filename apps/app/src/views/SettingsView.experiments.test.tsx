// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExperimentsSettingsSection } from "./SettingsView";

afterEach(cleanup);

function renderSection(overrides?: {
  onToolsHubEnabledChange?: (enabled: boolean) => void;
}) {
  return render(
    <ExperimentsSettingsSection
      claudeCodeMockCliTrafficEnabled={false}
      disabled={false}
      onClaudeCodeMockCliTrafficEnabledChange={vi.fn()}
      onToolsHubEnabledChange={overrides?.onToolsHubEnabledChange ?? vi.fn()}
      toolsHubEnabled={false}
    />,
  );
}

describe("ExperimentsSettingsSection", () => {
  it("reports Extensions changes", () => {
    const onChange = vi.fn();
    renderSection({ onToolsHubEnabledChange: onChange });
    const toggle = screen.getByLabelText("Extensions");
    expect(toggle.hasAttribute("disabled")).toBe(false);
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
