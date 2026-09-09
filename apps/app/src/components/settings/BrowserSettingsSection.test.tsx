// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { BbDesktopBrowserApi } from "@bb/desktop-contract";
import type { DesktopBrowserImportSource } from "@bb/host-daemon-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserSettingsSectionContent } from "./BrowserSettingsSection";

const sources: DesktopBrowserImportSource[] = [
  {
    id: "chrome",
    name: "Google Chrome",
    profiles: [
      { directory: "Default", name: "Person 1", cookieCount: 3 },
      { directory: "Profile 1", name: "Work", cookieCount: 1 },
    ],
  },
  { id: "brave", name: "Brave", profiles: [], unavailable: "browserRunning" },
  { id: "arc", name: "Arc", profiles: [], unavailable: "notInstalled" },
  {
    id: "safari",
    name: "Safari",
    profiles: [],
    unavailable: "unsupportedPlatform",
  },
];

function makeDesktopBrowser(
  overrides: Partial<BbDesktopBrowserApi> = {},
): BbDesktopBrowserApi {
  const noop = () => undefined;
  return {
    attach: noop,
    detach: noop,
    navigate: noop,
    goBack: noop,
    goForward: noop,
    reload: noop,
    stop: noop,
    setBounds: noop,
    setVisible: noop,
    onState: () => noop,
    onOpenTab: () => noop,
    listImportSources: vi.fn(async () => ({ sources })),
    importCookies: vi.fn(async () => ({
      ok: true as const,
      imported: 2,
      skipped: 1,
      skippedDomains: ["accounts.example.com"],
    })),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe("BrowserSettingsSectionContent", () => {
  it("explains that import is desktop only outside the desktop app", () => {
    render(<BrowserSettingsSectionContent desktopBrowser={null} />);
    expect(
      screen.getByText("Only available in the BB desktop app."),
    ).toBeDefined();
  });

  it("lists importable browsers with readiness and hides unsupported ones", async () => {
    render(
      <BrowserSettingsSectionContent desktopBrowser={makeDesktopBrowser()} />,
    );
    await waitFor(() =>
      expect(screen.getByText("Google Chrome")).toBeDefined(),
    );
    expect(screen.getByText("Ready")).toBeDefined();
    expect(screen.getByText("Quit first")).toBeDefined();
    expect(screen.getByText("Not installed")).toBeDefined();
    expect(screen.queryByText("Safari")).toBeNull();
    const arcRow = screen.getByTestId("browser-import-arc");
    expect(arcRow.querySelector("button")?.hasAttribute("disabled")).toBe(true);
  });

  it("runs an import for the chosen profile and reports the outcome", async () => {
    const desktopBrowser = makeDesktopBrowser();
    render(<BrowserSettingsSectionContent desktopBrowser={desktopBrowser} />);
    await waitFor(() =>
      expect(screen.getByText("Google Chrome")).toBeDefined(),
    );
    fireEvent.click(
      screen.getByTestId("browser-import-chrome").querySelector("button")!,
    );
    expect(screen.getByText("Import from Google Chrome")).toBeDefined();
    fireEvent.click(screen.getByRole("radio", { name: /Work/ }));
    fireEvent.click(screen.getByRole("button", { name: "Import 1 cookie" }));
    await waitFor(() =>
      expect(screen.getByText("Imported 2 cookies")).toBeDefined(),
    );
    expect(desktopBrowser.importCookies).toHaveBeenCalledWith({
      sourceId: "chrome",
      sourceProfileDirectory: "Profile 1",
      profile: { kind: "personal" },
    });
    expect(screen.getByText("accounts.example.com")).toBeDefined();
  });

  it("opens on the quit step for a running browser and rechecks", async () => {
    const listImportSources = vi
      .fn()
      .mockResolvedValueOnce({ sources })
      .mockResolvedValueOnce({
        sources: sources.map((source) =>
          source.id === "brave"
            ? {
                ...source,
                unavailable: undefined,
                profiles: [{ directory: "Default", name: "Default" }],
              }
            : source,
        ),
      });
    render(
      <BrowserSettingsSectionContent
        desktopBrowser={makeDesktopBrowser({ listImportSources })}
      />,
    );
    await waitFor(() => expect(screen.getByText("Brave")).toBeDefined());
    fireEvent.click(
      screen.getByTestId("browser-import-brave").querySelector("button")!,
    );
    expect(screen.getByText("Quit Brave to import")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "I've quit it" }));
    await waitFor(() =>
      expect(screen.getByText("Import from Brave")).toBeDefined(),
    );
  });
});
