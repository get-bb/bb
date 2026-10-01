// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExperimentKey } from "@bb/domain";
import { ExperimentsSettingsSection } from "./SettingsView";

afterEach(cleanup);

function renderSection(
  onExperimentChange: (key: ExperimentKey, enabled: boolean) => void,
) {
  return render(
    <ExperimentsSettingsSection
      disabled={false}
      experiments={{
        changelogPreview: false,
        legacyJitiPluginLoader: false,
        serverMove: false,
      }}
      onExperimentChange={onExperimentChange}
    />,
  );
}

describe("ExperimentsSettingsSection", () => {
  it("reports changelog preview changes", () => {
    const onChange = vi.fn();
    renderSection(onChange);
    fireEvent.click(screen.getByLabelText("Changelog preview"));
    expect(onChange).toHaveBeenCalledWith("changelogPreview", true);
  });

  it("reports legacy plugin loader changes", () => {
    const onChange = vi.fn();
    renderSection(onChange);
    fireEvent.click(screen.getByLabelText("Legacy plugin loader (JITI)"));
    expect(onChange).toHaveBeenCalledWith("legacyJitiPluginLoader", true);
  });
});
