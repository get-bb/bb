// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JsonValue } from "@get-bb/plugin-sdk";
import {
  getThreadFixedTabOwnerId,
  UNAVAILABLE_APP_PANEL_CONTROLLER,
} from "@/lib/app-fixed-tab-navigation";
import type { AppTabOpenIntent } from "@/lib/app-navigation-host";
import {
  isThreadTab,
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
  usePluginSlots,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import {
  useOpenClaimedUrl,
  type PluginThreadActionTabSlot,
} from "./plugin-url-claims";

type ClaimedOptions = { title?: string; params?: JsonValue };
type ClaimUrl = (url: URL) => ClaimedOptions | null;

function claimedTab(
  pluginId: string,
  tabId: string,
  options: ClaimedOptions = {},
): AppTabOpenIntent {
  return {
    tab: { ownerId: getThreadFixedTabOwnerId(pluginId), tabId },
    availability: "action",
    ...options,
  };
}

function PanelComponent() {
  return null;
}

function registerClaims(
  pluginId: string,
  claims: Record<string, (url: URL) => unknown>,
) {
  setPluginSlotRegistrations(
    pluginId,
    makePluginRegistrationSet({
      tabs: Object.entries(claims).map(([id, claim]) => ({
        id,
        title: id,
        icon: "Github",
        context: { kind: "thread" },
        availability: "action",
        component: PanelComponent,
        experimental_claimUrl: claim as ClaimUrl,
      })),
    }),
  );
}

function renderOpener(
  accepts = true,
  isVisible: (tab: PluginThreadActionTabSlot) => boolean = () => true,
) {
  const openTab = vi.fn((_intent: AppTabOpenIntent) => accepts);
  const panel = { ...UNAVAILABLE_APP_PANEL_CONTROLLER, openTab };
  const { result } = renderHook(() =>
    useOpenClaimedUrl(
      panel,
      usePluginSlots()
        .tabs.filter(isThreadTab)
        .filter(
          (tab): tab is PluginThreadActionTabSlot =>
            tab.availability === "action",
        )
        .filter(isVisible),
    ),
  );
  return { openClaimedUrl: result.current, openTab };
}

const PULL_URL = "https://github.com/acme/app/pull/7";

afterEach(() => {
  resetPluginSlotStoreForTest();
  vi.restoreAllMocks();
});

describe("useOpenClaimedUrl", () => {
  it("opens the first claim in slot order with its title and params", () => {
    const later = vi.fn(() => ({ title: "Later" }));
    registerClaims("github", { pull: later });
    registerClaims("acme", {
      notes: () => null,
      review: (url) => ({ title: "Review", params: { path: url.pathname } }),
    });
    const { openClaimedUrl, openTab } = renderOpener();

    expect(openClaimedUrl(PULL_URL, null)).toBe(true);
    expect(openTab).toHaveBeenCalledExactlyOnceWith(
      claimedTab("acme", "review", {
        title: "Review",
        params: { path: "/acme/app/pull/7" },
      }),
    );
    expect(later).not.toHaveBeenCalled();
  });

  it("asks only the tabs the thread view shows", () => {
    const hidden = vi.fn(() => ({ title: "Hidden" }));
    registerClaims("acme", { review: hidden });
    registerClaims("github", { pull: () => ({ title: "PR #7" }) });
    const { openClaimedUrl, openTab } = renderOpener(
      true,
      (tab) => tab.pluginId !== "acme",
    );

    expect(openClaimedUrl(PULL_URL, null)).toBe(true);
    expect(hidden).not.toHaveBeenCalled();
    expect(openTab).toHaveBeenCalledExactlyOnceWith(
      claimedTab("github", "pull", {
        title: "PR #7",
      }),
    );
  });

  it("leaves a plugin's own links to the browser", () => {
    const own = vi.fn(() => ({ title: "PR #7" }));
    registerClaims("github", { pull: own });
    const { openClaimedUrl, openTab } = renderOpener();

    expect(openClaimedUrl(PULL_URL, "github")).toBe(false);
    expect(own).not.toHaveBeenCalled();
    expect(openTab).not.toHaveBeenCalled();
  });

  it("offers a plugin's links to other plugins' tabs", () => {
    const own = vi.fn(() => ({ title: "Review" }));
    registerClaims("acme", { review: own });
    registerClaims("github", { pull: () => ({ title: "PR #7" }) });
    const { openClaimedUrl, openTab } = renderOpener();

    expect(openClaimedUrl(PULL_URL, "acme")).toBe(true);
    expect(own).not.toHaveBeenCalled();
    expect(openTab).toHaveBeenCalledExactlyOnceWith(
      claimedTab("github", "pull", {
        title: "PR #7",
      }),
    );
  });

  it("leaves links to the browser when the side panel declines", () => {
    registerClaims("github", { pull: () => ({}) });
    const { openClaimedUrl, openTab } = renderOpener(false);

    expect(openClaimedUrl(PULL_URL, null)).toBe(false);
    expect(openTab).toHaveBeenCalledExactlyOnceWith(
      claimedTab("github", "pull"),
    );
  });

  it.each(["mailto:octocat@github.com", "/threads/thr_1", "not a url"])(
    "never offers %s to plugins",
    (href) => {
      const claim = vi.fn(() => ({}));
      registerClaims("github", { pull: claim });
      const { openClaimedUrl, openTab } = renderOpener();

      expect(openClaimedUrl(href, null)).toBe(false);
      expect(claim).not.toHaveBeenCalled();
      expect(openTab).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      "throws",
      () => {
        throw new Error("boom");
      },
      "boom",
    ],
    ["returns a promise", () => Promise.resolve({}), "must return"],
    ["returns a string", () => "pull", "must return"],
    ["returns a numeric title", () => ({ title: 7 }), "title"],
    [
      "returns non-JSON params",
      () => ({ params: { at: new Date() } }),
      "params",
    ],
  ])("skips a claim that %s and asks the next one", (_name, broken, logged) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    registerClaims("acme", { broken });
    registerClaims("github", { pull: () => ({ title: "PR #7" }) });
    const { openClaimedUrl, openTab } = renderOpener();

    expect(openClaimedUrl(PULL_URL, null)).toBe(true);
    expect(openTab).toHaveBeenCalledExactlyOnceWith(
      claimedTab("github", "pull", {
        title: "PR #7",
      }),
    );
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining(
        '[plugin:acme] experimental_tab "broken" experimental_claimUrl failed',
      ),
    );
    expect(warn.mock.calls[0]?.[0]).toContain(logged);
  });

  it("hands each claim its own copy of the URL", () => {
    registerClaims("acme", {
      mutate: (url) => {
        url.hostname = "example.com";
        return null;
      },
    });
    const seen = vi.fn<(href: string) => null>(() => null);
    registerClaims("github", { pull: (url) => seen(url.href) });
    const { openClaimedUrl } = renderOpener();

    openClaimedUrl(PULL_URL, null);
    expect(seen).toHaveBeenCalledExactlyOnceWith(PULL_URL);
  });
});
