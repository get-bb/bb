// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ExperimentsSettingsSection,
  GeneralSettingsSection,
  InAppBrowserLinkSettingsControl,
  LocalOpenTargetSettingsSection,
  RootComposeBehaviorSettingsControl,
} from "./SettingsView";

describe("GeneralSettingsSection", () => {
  afterEach(() => {
    cleanup();
  });

  it("groups general preferences in one section", () => {
    render(
      <GeneralSettingsSection
        desktopBrowserAvailable
        faviconColor="default"
        navigateToThreadAfterCreate={false}
        openLinksInAppBrowser
        themePreference="system"
        onFaviconColorChange={vi.fn()}
        onNavigateToThreadAfterCreateChange={vi.fn()}
        onOpenLinksInAppBrowserChange={vi.fn()}
        onThemePreferenceChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "General" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Theme" })).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Favicon color" }),
    ).not.toBeNull();
    expect(
      screen.getByRole("switch", {
        name: "Navigate to threads on creation",
      }),
    ).not.toBeNull();
    expect(
      screen.getByRole("switch", { name: "Open links in the in-app browser" }),
    ).not.toBeNull();
  });
});

describe("LocalOpenTargetSettingsSection", () => {
  afterEach(() => {
    cleanup();
  });

  it("hides file preferences for remote clients", () => {
    const { container } = render(
      <LocalOpenTargetSettingsSection
        directoryTargetId="finder"
        fileTargetId="default-app"
        hasDaemon={false}
        onDirectoryTargetChange={vi.fn()}
        onFileTargetChange={vi.fn()}
        targets={[]}
      />,
    );

    expect(
      screen.queryByRole("heading", { name: "File Preferences" }),
    ).toBeNull();
    expect(container.firstChild).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Directory default" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "File default" })).toBeNull();
    expect(screen.queryByText("Finder")).toBeNull();
    expect(screen.queryByText("Default App")).toBeNull();
  });

  it("shows preference rows when local open targets are available", () => {
    render(
      <LocalOpenTargetSettingsSection
        directoryTargetId="finder"
        fileTargetId="default-app"
        hasDaemon
        onDirectoryTargetChange={vi.fn()}
        onFileTargetChange={vi.fn()}
        targets={[
          {
            capabilities: {
              openDirectory: true,
              openFile: false,
              openFileAtLine: false,
            },
            id: "finder",
            label: "Finder",
          },
          {
            capabilities: {
              openDirectory: true,
              openFile: true,
              openFileAtLine: false,
            },
            id: "default-app",
            label: "Default App",
          },
        ]}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Directory default" }).textContent,
    ).toContain("Finder");
    expect(
      screen.getByRole("button", { name: "File default" }).textContent,
    ).toContain("Default App");
  });
});

describe("InAppBrowserLinkSettingsControl", () => {
  afterEach(() => {
    cleanup();
  });

  it("reflects the enabled preference and toggles it off", () => {
    const onEnabledChange = vi.fn();
    render(
      <InAppBrowserLinkSettingsControl
        enabled
        onEnabledChange={onEnabledChange}
      />,
    );

    const toggle = screen.getByRole("switch", {
      name: "Open links in the in-app browser",
    });
    expect(toggle.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(toggle);
    expect(onEnabledChange).toHaveBeenCalledWith(false);
  });

  it("reflects the disabled preference and toggles it on", () => {
    const onEnabledChange = vi.fn();
    render(
      <InAppBrowserLinkSettingsControl
        enabled={false}
        onEnabledChange={onEnabledChange}
      />,
    );

    const toggle = screen.getByRole("switch", {
      name: "Open links in the in-app browser",
    });
    expect(toggle.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(toggle);
    expect(onEnabledChange).toHaveBeenCalledWith(true);
  });
});

describe("RootComposeBehaviorSettingsControl", () => {
  afterEach(() => {
    cleanup();
  });

  it("reflects the enabled preference and toggles it off", () => {
    const onNavigateToThreadAfterCreateChange = vi.fn();
    render(
      <RootComposeBehaviorSettingsControl
        navigateToThreadAfterCreate
        onNavigateToThreadAfterCreateChange={
          onNavigateToThreadAfterCreateChange
        }
      />,
    );

    const toggle = screen.getByRole("switch", {
      name: "Navigate to threads on creation",
    });
    expect(toggle.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(toggle);
    expect(onNavigateToThreadAfterCreateChange).toHaveBeenCalledWith(false);
  });
});

describe("ExperimentsSettingsSection", () => {
  afterEach(() => {
    cleanup();
  });

  it("reflects the enabled workflows experiment and toggles it off", () => {
    const onWorkflowsEnabledChange = vi.fn();
    render(
      <ExperimentsSettingsSection
        claudeCodeMockCliTrafficEnabled={false}
        disabled={false}
        onClaudeCodeMockCliTrafficEnabledChange={vi.fn()}
        onWorkflowsEnabledChange={onWorkflowsEnabledChange}
        workflowsEnabled
      />,
    );

    const toggle = screen.getByRole("switch", { name: "Workflows" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(toggle);
    expect(onWorkflowsEnabledChange).toHaveBeenCalledWith(false);
  });

  it("reflects the disabled workflows experiment and toggles it on", () => {
    const onWorkflowsEnabledChange = vi.fn();
    render(
      <ExperimentsSettingsSection
        claudeCodeMockCliTrafficEnabled={false}
        disabled={false}
        onClaudeCodeMockCliTrafficEnabledChange={vi.fn()}
        onWorkflowsEnabledChange={onWorkflowsEnabledChange}
        workflowsEnabled={false}
      />,
    );

    const toggle = screen.getByRole("switch", { name: "Workflows" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(toggle);
    expect(onWorkflowsEnabledChange).toHaveBeenCalledWith(true);
  });

  it("reflects the mock CLI traffic experiment and toggles it on", () => {
    const onClaudeCodeMockCliTrafficEnabledChange = vi.fn();
    render(
      <ExperimentsSettingsSection
        claudeCodeMockCliTrafficEnabled={false}
        disabled={false}
        onClaudeCodeMockCliTrafficEnabledChange={
          onClaudeCodeMockCliTrafficEnabledChange
        }
        onWorkflowsEnabledChange={vi.fn()}
        workflowsEnabled={false}
      />,
    );

    const toggle = screen.getByRole("switch", { name: "Mock CLI Traffic" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(toggle);
    expect(onClaudeCodeMockCliTrafficEnabledChange).toHaveBeenCalledWith(true);
  });

  it("blocks toggling while the config has not loaded or a write is pending", () => {
    const onClaudeCodeMockCliTrafficEnabledChange = vi.fn();
    const onWorkflowsEnabledChange = vi.fn();
    render(
      <ExperimentsSettingsSection
        claudeCodeMockCliTrafficEnabled={false}
        disabled
        onClaudeCodeMockCliTrafficEnabledChange={
          onClaudeCodeMockCliTrafficEnabledChange
        }
        onWorkflowsEnabledChange={onWorkflowsEnabledChange}
        workflowsEnabled={false}
      />,
    );

    const workflowsToggle = screen.getByRole("switch", { name: "Workflows" });
    const mockCliTrafficToggle = screen.getByRole("switch", {
      name: "Mock CLI Traffic",
    });
    expect(workflowsToggle).toHaveProperty("disabled", true);
    expect(mockCliTrafficToggle).toHaveProperty("disabled", true);

    fireEvent.click(workflowsToggle);
    fireEvent.click(mockCliTrafficToggle);
    expect(onWorkflowsEnabledChange).not.toHaveBeenCalled();
    expect(onClaudeCodeMockCliTrafficEnabledChange).not.toHaveBeenCalled();
  });
});
