// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExperimentKey } from "@bb/domain";
import { ExperimentsSettingsSection } from "./SettingsView";

afterEach(cleanup);

function renderSection(
  onExperimentChange: (key: ExperimentKey, enabled: boolean) => void,
  performanceDiagnosticsAvailable = true,
) {
  return render(
    <ExperimentsSettingsSection
      disabled={false}
      performanceDiagnosticsAvailable={performanceDiagnosticsAvailable}
      experiments={{
        changelogPreview: false,
        serverMove: false,
        performanceDiagnostics: false,
        navigationRail: false,
      }}
      onExperimentChange={onExperimentChange}
    />,
  );
}

describe("ExperimentsSettingsSection", () => {
  it("hides performance diagnostics when startup permission is absent", () => {
    renderSection(vi.fn(), false);
    expect(
      screen.queryByLabelText("Server performance diagnostics"),
    ).toBeNull();
    expect(screen.getByLabelText("Changelog preview")).toBeTruthy();
    expect(screen.getByLabelText("Server move")).toBeTruthy();
  });

  it.each([
    ["Changelog preview", "changelogPreview"],
    ["Server performance diagnostics", "performanceDiagnostics"],
    ["Navigation rail", "navigationRail"],
  ])("reports %s changes", (label, key) => {
    const onChange = vi.fn();
    renderSection(onChange);
    fireEvent.click(screen.getByLabelText(label));
    expect(onChange).toHaveBeenCalledWith(key, true);
  });
});
