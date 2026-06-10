// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppSourcesSection } from "@/components/settings/AppSourcesSection";
import { installFetchRoutes, jsonResponse } from "@/test/http-test-utils";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  GeneralSettingsSection,
  InAppBrowserLinkSettingsControl,
  LocalOpenTargetSettingsSection,
  RootComposeBehaviorSettingsControl,
} from "./AppSettingsView";

describe("AppSourcesSection", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("keeps the app sources settings section title", async () => {
    installFetchRoutes([
      {
        pathname: "/api/v1/app-sources",
        handler: () => jsonResponse([]),
      },
    ]);
    const { wrapper } = createQueryClientTestHarness();

    render(<AppSourcesSection />, { wrapper });

    expect(screen.getByRole("heading", { name: "App sources" })).not.toBeNull();
    await screen.findByText(
      "No app sources. Add a git repo of apps to install them.",
    );
  });
});

describe("GeneralSettingsSection", () => {
  afterEach(() => {
    cleanup();
  });

  it("groups general preferences in one section", () => {
    render(
      <GeneralSettingsSection
        desktopBrowserAvailable
        navigateToThreadAfterCreate={false}
        openLinksInAppBrowser
        themePreference="system"
        onNavigateToThreadAfterCreateChange={vi.fn()}
        onOpenLinksInAppBrowserChange={vi.fn()}
        onThemePreferenceChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "General" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Theme" })).not.toBeNull();
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

  it("shows readable daemon-unavailable copy inside the picker menu while preserving saved values", async () => {
    render(
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
      screen.getByRole("heading", { name: "File Preferences" }),
    ).not.toBeNull();
    const directoryPicker = screen.getByRole("button", {
      name: "Directory default",
    });

    expect(directoryPicker.textContent).toContain("Finder");
    expect(
      screen.queryByText(
        "This default can be changed when the local host daemon is available.",
      ),
    ).toBeNull();

    fireEvent.pointerDown(directoryPicker, {
      button: 0,
      ctrlKey: false,
    });

    const message = await screen.findByText(
      "This default can be changed when the local host daemon is available.",
    );
    expect(message.getAttribute("role")).toBe("note");
    expect(message.className).toContain("text-foreground");
    expect(message.getAttribute("data-disabled")).toBeNull();
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
