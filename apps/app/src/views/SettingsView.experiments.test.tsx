// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExperimentsSettingsSection } from "./SettingsView";

afterEach(cleanup);

function renderSection(overrides?: {
  sideChatPluginEnabled?: boolean;
  onSideChatPluginEnabledChange?: (enabled: boolean) => void;
  onToolsHubEnabledChange?: (enabled: boolean) => void;
}) {
  return render(
    <ExperimentsSettingsSection
      claudeCodeMockCliTrafficEnabled={false}
      disabled={false}
      onClaudeCodeMockCliTrafficEnabledChange={vi.fn()}
      onToolsHubEnabledChange={overrides?.onToolsHubEnabledChange ?? vi.fn()}
      toolsHubEnabled={false}
      onSideChatPluginEnabledChange={
        overrides?.onSideChatPluginEnabledChange ?? vi.fn()
      }
      sideChatPluginEnabled={overrides?.sideChatPluginEnabled ?? false}
    />,
  );
}

describe("ExperimentsSettingsSection", () => {
  it("reports side-chat plugin toggles", () => {
    const onChange = vi.fn();
    renderSection({ onSideChatPluginEnabledChange: onChange });
    const toggle = screen.getByLabelText("Side chat plugin");
    expect(toggle.hasAttribute("disabled")).toBe(false);
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("reports Tools Hub changes", () => {
    const onChange = vi.fn();
    renderSection({ onToolsHubEnabledChange: onChange });
    const toggle = screen.getByLabelText("Tools Hub");
    expect(toggle.hasAttribute("disabled")).toBe(false);
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
