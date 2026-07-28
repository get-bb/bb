// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  CliSkillsSettingsSectionContent,
  summarizeMachineStatuses,
} from "./CliSkillsSettingsSection";

afterEach(() => {
  cleanup();
});

function installButton(): HTMLButtonElement {
  const button = screen.getByRole("button", { name: "Install bb CLI skills" });
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error("Install control is not a button");
  }
  return button;
}

describe("CliSkillsSettingsSectionContent", () => {
  it("offers the picker when a machine is connected", () => {
    render(
      <CliSkillsSettingsSectionContent
        hasConnectedMachine={true}
        onOpenPicker={() => undefined}
        pending={false}
        statusBadge={null}
      />,
    );

    expect(installButton().disabled).toBe(false);
  });

  it("explains why the install is unavailable with no connected machine", () => {
    render(
      <CliSkillsSettingsSectionContent
        hasConnectedMachine={false}
        onOpenPicker={() => undefined}
        pending={false}
        statusBadge={null}
      />,
    );

    expect(installButton().disabled).toBe(true);
    expect(
      screen.getByText(
        "Connect a machine to install them into ~/.agents/skills and ~/.claude/skills.",
      ),
    ).toBeDefined();
  });

  it("blocks reopening the picker while an install is running", () => {
    render(
      <CliSkillsSettingsSectionContent
        hasConnectedMachine={true}
        onOpenPicker={() => undefined}
        pending={true}
        statusBadge="Installed"
      />,
    );

    expect(installButton().disabled).toBe(true);
    expect(installButton().textContent).toBe("Installing…");
  });
});

describe("summarizeMachineStatuses", () => {
  it("reports a single machine plainly", () => {
    expect(summarizeMachineStatuses(["installed"])).toBe("Installed");
    expect(summarizeMachineStatuses(["outdated"])).toBe("Out of date");
    expect(summarizeMachineStatuses(["missing"])).toBe("Not installed");
  });

  it("counts a mixed fleet instead of claiming either extreme", () => {
    expect(summarizeMachineStatuses(["installed", "outdated", "missing"])).toBe(
      "Installed on 1 of 3 machines",
    );
    expect(summarizeMachineStatuses(["installed", "installed"])).toBe(
      "Installed on 2 machines",
    );
  });

  it("ignores machines it could not ask, and shows nothing if that is all of them", () => {
    expect(summarizeMachineStatuses(["installed", "unknown"])).toBe(
      "Installed",
    );
    expect(summarizeMachineStatuses(["unknown", "unknown"])).toBe(null);
    expect(summarizeMachineStatuses([])).toBe(null);
  });
});
