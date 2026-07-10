// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderSettingsSection } from "./SettingsView";

afterEach(cleanup);

describe("ProvidersSettingsSection", () => {
  it.each([
    ["codex" as const, "Codex", "Codex memory"],
    ["claude-code" as const, "Claude Code", "Claude Code memory"],
  ])("renders a separate %s provider page", (providerId, title, label) => {
    const onMemoryEnabledChange = vi.fn();
    const view = render(
      <ProviderSettingsSection
        providerId={providerId}
        memoryEnabled={false}
        disabled={false}
        onMemoryEnabledChange={onMemoryEnabledChange}
      />,
    );

    expect(screen.getByText(title)).toBeTruthy();
    expect(
      screen.getByRole("switch", { name: label }).getAttribute("data-state"),
    ).toBe("unchecked");
    fireEvent.click(screen.getByRole("switch", { name: label }));

    expect(onMemoryEnabledChange).toHaveBeenCalledWith(true);
    view.unmount();
  });
});
