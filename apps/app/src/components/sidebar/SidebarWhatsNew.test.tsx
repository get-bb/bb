// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SystemVersionResponse } from "@bb/server-contract";
import { HashNavigationScroll } from "@/App";
import { WhatsNewSection } from "@/components/settings/WhatsNewSection";
import { SidebarProvider } from "@/components/ui/sidebar.js";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { SidebarWhatsNew } from "./SidebarWhatsNew";

const fixtures = vi.hoisted(() => ({
  changelog: `# Changelog

## 0.5.0

Five is ready.

### Highlights

- Five's highlight.

## 0.4.0

Four is ready.

### Highlights

- Four's highlight.
`,
}));

const versionMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/sdk", () => ({
  sdk: { system: { version: versionMock } },
}));

vi.mock("@/components/settings/changelog-preview", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/components/settings/changelog-preview")
    >();
  const { parseChangelog } = await import("@bb/domain/changelog");
  return {
    ...actual,
    CHANGELOG_ENTRIES: parseChangelog(fixtures.changelog),
    RELEASE_META: {
      "0.5.0": {
        date: "October 2, 2026",
        headline: "Five headline",
        visual: "native-windows",
      },
      "0.4.0": { date: "September 20, 2026", headline: "Four headline" },
    },
  };
});

const SEEN_KEY = "bb.settings.updates.whats-new-seen-version";
const PREVIOUS_KEY = "bb.settings.updates.whats-new-previous-version";

function version(currentVersion: string): SystemVersionResponse {
  return {
    currentCommit: null,
    installKind: "npm",
    currentVersion,
    latestVersion: currentVersion,
    source: "npm",
    updateAvailable: false,
    isDevelopment: false,
    upgradeCommand: "npx bb-app@latest",
  };
}

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="location">{`${location.pathname}${location.hash}`}</output>
  );
}

function SettingsSectionToggle() {
  const [shown, setShown] = useState(false);
  return shown ? (
    <WhatsNewSection installedVersion="0.5.0" availableVersion={null} />
  ) : (
    <button type="button" onClick={() => setShown(true)}>
      Show settings
    </button>
  );
}

function UpdatesRouteProbe() {
  const location = useLocation();
  if (location.pathname !== "/settings/updates") {
    return null;
  }
  return (
    <>
      <section aria-label="bb" data-updates-domain="bb" />
      <WhatsNewSection installedVersion="0.5.0" availableVersion={null} />
    </>
  );
}

function renderWidget({
  open = true,
  extra,
}: { open?: boolean; extra?: ReactNode } = {}) {
  const { wrapper: Wrapper } = createQueryClientTestHarness();
  return render(
    <Wrapper>
      <MemoryRouter initialEntries={["/"]}>
        <SidebarProvider defaultOpen={open}>
          <SidebarWhatsNew />
          {extra}
          <LocationProbe />
        </SidebarProvider>
      </MemoryRouter>
    </Wrapper>,
  );
}

const widget = () => screen.queryByTestId("sidebar-whats-new");

beforeEach(() => {
  versionMock.mockResolvedValue(version("0.5.0"));
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new Error("Changelog unavailable offline")),
  );
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("SidebarWhatsNew", () => {
  it("treats a brand-new client's installed release as seen", async () => {
    renderWidget();

    await waitFor(() =>
      expect(window.localStorage.getItem(SEEN_KEY)).toBe("0.5.0"),
    );
    await act(async () => {});
    expect(widget()).toBeNull();
    expect(window.localStorage.getItem(PREVIOUS_KEY)).toBeNull();
  });

  it("announces the first update after a brand-new client's baseline", async () => {
    versionMock.mockResolvedValue(version("0.4.0"));
    renderWidget();
    await waitFor(() =>
      expect(window.localStorage.getItem(SEEN_KEY)).toBe("0.4.0"),
    );
    await act(async () => {});
    expect(widget()).toBeNull();
    cleanup();

    versionMock.mockResolvedValue(version("0.5.0"));
    renderWidget();

    const card = await screen.findByTestId("sidebar-whats-new");
    expect(card.textContent).toContain("What’s new · v0.5.0");
    fireEvent.click(
      screen.getByRole("button", { name: "Dismiss what's new in bb 0.5.0" }),
    );
    expect(window.localStorage.getItem(SEEN_KEY)).toBe("0.5.0");
    expect(window.localStorage.getItem(PREVIOUS_KEY)).toBe("0.4.0");
  });

  it("announces the installed release to a client that saw an older one", async () => {
    window.localStorage.setItem(SEEN_KEY, "0.4.0");
    renderWidget();

    const card = await screen.findByTestId("sidebar-whats-new");
    expect(card.textContent).toContain("What’s new · v0.5.0");
    expect(card.textContent).toContain("Five headline");
    expect(
      card
        .querySelector('[data-release-visual="native-windows"]')
        ?.getAttribute("aria-hidden"),
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: "See what's new in bb 0.5.0" }),
    ).toBeDefined();
    expect(
      screen.getByRole("region", { name: "What’s new · v0.5.0" }),
    ).toBeDefined();
  });

  it("stays hidden once the installed release has been seen", async () => {
    window.localStorage.setItem(SEEN_KEY, "0.5.0");
    renderWidget();

    await waitFor(() => expect(versionMock).toHaveBeenCalled());
    await act(async () => {});
    expect(widget()).toBeNull();
  });

  it("dismisses for this release and keeps the skipped-release history", async () => {
    window.localStorage.setItem(SEEN_KEY, "0.4.0");
    renderWidget();

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Dismiss what's new in bb 0.5.0",
      }),
    );

    expect(widget()).toBeNull();
    expect(window.localStorage.getItem(SEEN_KEY)).toBe("0.5.0");
    expect(window.localStorage.getItem(PREVIOUS_KEY)).toBe("0.4.0");
    expect(screen.getByTestId("location").textContent).toBe("/");
  });

  it("opens What's new in Settings → Updates and marks the release seen", async () => {
    window.localStorage.setItem(SEEN_KEY, "0.4.0");
    renderWidget();

    fireEvent.click(
      await screen.findByRole("button", {
        name: "See what's new in bb 0.5.0",
      }),
    );

    expect(screen.getByTestId("location").textContent).toBe(
      "/settings/updates#whats-new",
    );
    expect(window.localStorage.getItem(SEEN_KEY)).toBe("0.5.0");
    expect(widget()).toBeNull();
  });

  it("scrolls to What's new below the update rows and marks the release seen", async () => {
    const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView");
    window.localStorage.setItem(SEEN_KEY, "0.4.0");
    renderWidget({
      extra: (
        <>
          <HashNavigationScroll />
          <UpdatesRouteProbe />
        </>
      ),
    });

    fireEvent.click(
      await screen.findByRole("button", {
        name: "See what's new in bb 0.5.0",
      }),
    );

    const target = await waitFor(() => {
      const element = document.getElementById("whats-new");
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });
    await waitFor(() => {
      expect(scrollIntoView.mock.contexts).toContain(target);
    });
    expect(
      document
        .querySelector('[data-updates-domain="bb"]')
        ?.compareDocumentPosition(target),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(document.activeElement).toBe(target);
    expect(window.localStorage.getItem(SEEN_KEY)).toBe("0.5.0");
    expect(widget()).toBeNull();
    scrollIntoView.mockRestore();
  });

  it("disappears once the Settings section has shown the release", async () => {
    window.localStorage.setItem(SEEN_KEY, "0.4.0");
    renderWidget({ extra: <SettingsSectionToggle /> });
    await screen.findByTestId("sidebar-whats-new");

    fireEvent.click(screen.getByRole("button", { name: "Show settings" }));

    expect(document.getElementById("whats-new")).not.toBeNull();
    await waitFor(() => expect(widget()).toBeNull());
    expect(window.localStorage.getItem(SEEN_KEY)).toBe("0.5.0");
  });

  it("stays hidden when the installed version cannot be loaded", async () => {
    versionMock.mockRejectedValue(new Error("server unavailable"));
    renderWidget();

    await waitFor(() => expect(versionMock).toHaveBeenCalled());
    await act(async () => {});
    expect(widget()).toBeNull();
  });

  it("stays hidden while the sidebar is collapsed", async () => {
    window.localStorage.setItem(SEEN_KEY, "0.4.0");
    renderWidget({ open: false });

    await waitFor(() => expect(versionMock).toHaveBeenCalled());
    await act(async () => {});
    expect(widget()).toBeNull();
  });
});
