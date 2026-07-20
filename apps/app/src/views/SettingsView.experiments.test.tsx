// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExperimentsSettingsSection } from "./SettingsView";

afterEach(cleanup);

function renderSection(overrides?: {
  pluginsEnabled?: boolean;
  sideChatPluginEnabled?: boolean;
  onSideChatPluginEnabledChange?: (enabled: boolean) => void;
}) {
  return render(
    <ExperimentsSettingsSection
      claudeCodeMockCliTrafficEnabled={false}
      disabled={false}
      onClaudeCodeMockCliTrafficEnabledChange={vi.fn()}
      onPluginsEnabledChange={vi.fn()}
      pluginsEnabled={overrides?.pluginsEnabled ?? false}
      onSideChatPluginEnabledChange={
        overrides?.onSideChatPluginEnabledChange ?? vi.fn()
      }
      sideChatPluginEnabled={overrides?.sideChatPluginEnabled ?? false}
    />,
  );
}

describe("ExperimentsSettingsSection side-chat plugin toggle", () => {
  it("is hidden while the Plugins experiment is off", () => {
    renderSection({ pluginsEnabled: false });
    expect(screen.queryByLabelText("Side chat plugin")).toBeNull();
  });

  it("appears when the Plugins experiment is on and reports toggles", () => {
    const onChange = vi.fn();
    renderSection({
      pluginsEnabled: true,
      onSideChatPluginEnabledChange: onChange,
    });
    const toggle = screen.getByLabelText("Side chat plugin");
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
