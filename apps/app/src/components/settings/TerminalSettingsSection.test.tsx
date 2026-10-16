// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { defaultAppSettings } from "@bb/domain";
import { TerminalSettingsSection } from "./TerminalSettingsSection";

const testState = vi.hoisted(() => ({ mutate: vi.fn(), available: true }));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data: testState.available
      ? { generalSettings: defaultAppSettings }
      : undefined,
  }),
}));
vi.mock("@/hooks/mutations/settings-mutations", () => ({
  useUpdateGeneralSettings: () => ({ mutate: testState.mutate }),
}));

afterEach(() => {
  cleanup();
  testState.mutate.mockClear();
  testState.available = true;
});

it("enables predictive echo via the general settings update and disables the switch until settings load", () => {
  testState.available = false;
  const view = render(<TerminalSettingsSection />);
  const control = screen.getByRole("switch", { name: "Predictive local echo" });
  expect(control.hasAttribute("disabled")).toBe(true);
  testState.available = true;
  view.rerender(<TerminalSettingsSection />);
  fireEvent.click(control);
  expect(testState.mutate).toHaveBeenCalledWith({
    terminalPredictiveEcho: true,
  });
});
