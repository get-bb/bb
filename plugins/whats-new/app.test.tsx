// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { compareVersions } from "./seen.js";
import {
  resetWhatsNewEnabledOverrideForTest,
  type ReleaseNotes,
  type ReleaseNotesResponse,
} from "./state.js";

const app = await loadPluginApp(() => import("./app"));

const SEEN_KEY = "bb.whats-new.seen-version";
const PREVIOUS_KEY = "bb.whats-new.previous-version";

const FIVE: ReleaseNotes = {
  version: "0.5.0",
  date: "October 2, 2026",
  headline: "Five headline",
  visual: "native-windows",
  hero: {
    src: "https://example.test/five.png",
    darkSrc: null,
    alt: "Five in action",
  },
  lede: [{ kind: "paragraph", text: "Five is here." }],
  sections: [
    {
      title: "Highlights",
      blocks: [
        { kind: "list", items: ["**Faster threads:** switch instantly."] },
      ],
    },
    {
      title: "Fixes",
      blocks: [{ kind: "list", items: ["Fix a five-specific crash."] }],
    },
    {
      title: "Thanks",
      blocks: [
        {
          kind: "list",
          items: [
            "[@ada](https://github.com/ada), [@grace](https://github.com/grace)",
          ],
        },
      ],
    },
  ],
};

const FOUR: ReleaseNotes = {
  version: "0.4.0",
  date: "September 20, 2026",
  headline: "Four headline",
  visual: null,
  hero: null,
  lede: [{ kind: "paragraph", text: "Four arrives." }],
  sections: [
    { title: "Highlights", blocks: [{ kind: "list", items: ["Four's one."] }] },
  ],
};

const THREE: ReleaseNotes = {
  ...FOUR,
  version: "0.3.0",
  date: null,
  headline: "Three headline",
  lede: [{ kind: "paragraph", text: "Three." }],
};

const SIX: ReleaseNotes = {
  ...FOUR,
  version: "0.6.0",
  date: null,
  headline: null,
  lede: [{ kind: "paragraph", text: "Six is ready." }],
};

const CATALOG = [SIX, FIVE, FOUR, THREE];

function releaseNotesFake(installed: ReleaseNotes | null) {
  return vi.fn(
    async (args?: {
      version?: string;
      since?: string;
    }): Promise<ReleaseNotesResponse> => {
      if (installed === null) {
        throw new Error("release_notes_unavailable");
      }
      const installedVersion = installed.version;
      if (args?.version !== undefined) {
        const release = CATALOG.find((entry) => entry.version === args.version);
        if (release === undefined) throw new Error("release_not_found");
        return { installedVersion, releases: [release] };
      }
      if (args?.since !== undefined) {
        const since = args.since;
        return {
          installedVersion,
          releases: CATALOG.filter(
            (entry) =>
              compareVersions(entry.version, since) > 0 &&
              compareVersions(entry.version, installedVersion) <= 0,
          ),
        };
      }
      return { installedVersion, releases: [installed] };
    },
  );
}

function versionFake(latestVersion: string | null) {
  return vi.fn(async () => ({
    currentCommit: null,
    installKind: "npm" as const,
    currentVersion: FIVE.version,
    latestVersion,
    source: "npm" as const,
    updateAvailable: latestVersion !== null,
    isDevelopment: false,
    upgradeCommand: "npx bb-app@latest",
  }));
}

function cardRegistration() {
  const registration = app.sidebarFooterSections[0];
  if (registration === undefined) throw new Error("missing sidebar card");
  return registration;
}

function notesRegistration() {
  const registration = app.settingsSections.find(
    (section) => section.experimental_page === "updates",
  );
  if (registration === undefined) throw new Error("missing Updates section");
  return registration;
}

function renderCard({
  installed = FIVE,
  enabled = true,
  onNavigate = vi.fn(),
}: {
  installed?: ReleaseNotes | null;
  enabled?: boolean;
  onNavigate?: () => void;
} = {}) {
  const slot = renderSlot(
    cardRegistration(),
    { isCompactViewport: false, onNavigate },
    {
      pluginId: "bb--whats-new",
      settings: { enabled },
      rpc: { setEnabled: () => ({ ok: true as const }) },
      sdk: {
        system: { experimental_releaseNotes: releaseNotesFake(installed) },
      },
    },
  );
  return { slot, onNavigate };
}

function renderNotes({
  installed = FIVE,
  latestVersion = null,
  enabled = true,
}: {
  installed?: ReleaseNotes;
  latestVersion?: string | null;
  enabled?: boolean;
} = {}) {
  return renderSlot(
    notesRegistration(),
    {},
    {
      pluginId: "bb--whats-new",
      settings: { enabled },
      sdk: {
        system: {
          experimental_releaseNotes: releaseNotesFake(installed),
          version: versionFake(latestVersion),
        },
      },
    },
  );
}

function card(): HTMLElement | null {
  return document.querySelector('[data-testid="sidebar-whats-new"]');
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  resetWhatsNewEnabledOverrideForTest();
  vi.restoreAllMocks();
});

describe("What's new sidebar card", () => {
  it("records a fresh client's release and shows no card until the next update", async () => {
    renderCard();

    await waitFor(() => {
      expect(window.localStorage.getItem(SEEN_KEY)).toBe("0.5.0");
    });
    expect(card()).toBeNull();
  });

  it("shows the first update after a fresh client's baseline", async () => {
    renderCard({ installed: FOUR });
    await waitFor(() => {
      expect(window.localStorage.getItem(SEEN_KEY)).toBe("0.4.0");
    });
    expect(card()).toBeNull();
    cleanup();

    const { slot } = renderCard();

    expect(await slot.findByTestId("sidebar-whats-new")).toBeTruthy();
  });

  it("shows the installed release after an update", async () => {
    window.localStorage.setItem(SEEN_KEY, "0.4.0");
    const { slot } = renderCard();

    const section = await slot.findByTestId("sidebar-whats-new");
    expect(section.textContent).toContain("What’s new · v0.5.0");
    expect(section.textContent).toContain("Five headline");
    expect(
      section
        .querySelector('[data-release-visual="native-windows"]')
        ?.getAttribute("aria-hidden"),
    ).toBe("true");
    expect(
      slot
        .getByRole("link", { name: "See what's new in bb 0.5.0" })
        .getAttribute("href"),
    ).toBe("/settings/updates#whats-new");
  });

  it("marks the release seen and closes the drawer when opened", async () => {
    window.localStorage.setItem(SEEN_KEY, "0.4.0");
    const stopNavigation = (event: MouseEvent) => event.preventDefault();
    document.addEventListener("click", stopNavigation);
    const { slot, onNavigate } = renderCard();

    fireEvent.click(
      await slot.findByRole("link", { name: "See what's new in bb 0.5.0" }),
    );

    document.removeEventListener("click", stopNavigation);
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(SEEN_KEY)).toBe("0.5.0");
    expect(card()).toBeNull();
  });

  it("dismisses one release and keeps the version it updated from", async () => {
    window.localStorage.setItem(SEEN_KEY, "0.4.0");
    const { slot } = renderCard();

    fireEvent.click(
      await slot.findByRole("button", {
        name: "Dismiss what's new in bb 0.5.0",
      }),
    );

    expect(card()).toBeNull();
    expect(window.localStorage.getItem(SEEN_KEY)).toBe("0.5.0");
    expect(window.localStorage.getItem(PREVIOUS_KEY)).toBe("0.4.0");
  });

  it("stays hidden once the release has been seen", async () => {
    window.localStorage.setItem(SEEN_KEY, "0.5.0");
    renderCard();
    await flush();

    expect(card()).toBeNull();
  });

  it("stays hidden when the release notes cannot be loaded", async () => {
    window.localStorage.setItem(SEEN_KEY, "0.4.0");
    renderCard({ installed: null });
    await flush();

    expect(card()).toBeNull();
    expect(window.localStorage.getItem(SEEN_KEY)).toBe("0.4.0");
  });

  it("stays hidden while What's new is turned off", async () => {
    window.localStorage.setItem(SEEN_KEY, "0.4.0");
    renderCard({ enabled: false });
    await flush();

    expect(card()).toBeNull();
  });

  it("turns What's new off from the card and undoes it inline", async () => {
    window.localStorage.setItem(SEEN_KEY, "0.4.0");
    const { slot } = renderCard();

    fireEvent.pointerDown(
      await slot.findByRole("button", { name: "What's new options" }),
      { button: 0 },
    );
    fireEvent.click(
      await slot.findByRole("menuitem", { name: "Turn off What’s new" }),
    );

    expect(card()).toBeNull();
    const notice = await slot.findByTestId("sidebar-whats-new-off");
    expect(notice.textContent).toContain(
      "What’s new is off. Turn it back on in Settings → Plugins → What’s new.",
    );
    expect(
      within(notice)
        .getByRole("link", { name: "Settings → Plugins → What’s new" })
        .getAttribute("href"),
    ).toBe("/settings/plugins/bb--whats-new");
    await waitFor(() => {
      expect(slot.inspection.rpcCalls).toEqual([
        { method: "setEnabled", input: { enabled: false } },
      ]);
    });

    fireEvent.click(within(notice).getByRole("button", { name: "Undo" }));

    expect(await slot.findByTestId("sidebar-whats-new")).toBeTruthy();
    expect(slot.queryByTestId("sidebar-whats-new-off")).toBeNull();
    await waitFor(() => {
      expect(slot.inspection.rpcCalls.at(-1)).toEqual({
        method: "setEnabled",
        input: { enabled: true },
      });
    });
    expect(window.localStorage.getItem(SEEN_KEY)).toBe("0.4.0");
  });

  it("keeps What's new off after the notice closes", async () => {
    window.localStorage.setItem(SEEN_KEY, "0.4.0");
    const { slot } = renderCard();

    fireEvent.pointerDown(
      await slot.findByRole("button", { name: "What's new options" }),
      { button: 0 },
    );
    fireEvent.click(
      await slot.findByRole("menuitem", { name: "Turn off What’s new" }),
    );
    fireEvent.click(
      within(await slot.findByTestId("sidebar-whats-new-off")).getByRole(
        "button",
        { name: "Close" },
      ),
    );

    expect(slot.queryByTestId("sidebar-whats-new-off")).toBeNull();
    expect(card()).toBeNull();
  });

  it("disappears once the Settings → Updates notes show the release", async () => {
    window.localStorage.setItem(SEEN_KEY, "0.4.0");
    renderCard();
    await waitFor(() => expect(card()).not.toBeNull());

    renderNotes();

    await waitFor(() => expect(card()).toBeNull());
    expect(window.localStorage.getItem(SEEN_KEY)).toBe("0.5.0");
  });
});

describe("What's new in Settings → Updates", () => {
  it("shows a compact summary of the installed release and expands the notes in place", async () => {
    const slot = renderNotes();

    const section = await waitFor(() => {
      const element = document.getElementById("whats-new");
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });
    expect(
      slot.getByRole("heading", { level: 2, name: "What’s new" }),
    ).toBeTruthy();
    expect(
      slot.getByRole("heading", { level: 3, name: "Five headline" }),
    ).toBeTruthy();
    expect(slot.getByText("bb 0.5.0 · October 2, 2026")).toBeTruthy();
    expect(
      section
        .querySelector('[data-release-visual="native-windows"]')
        ?.getAttribute("aria-hidden"),
    ).toBe("true");
    const summary = section.querySelector("[data-whats-new-summary]");
    expect(summary?.textContent).toBe("Five is here.");
    expect(summary?.className).toContain("line-clamp-1");

    const highlight = slot.getByText("switch instantly.", { exact: false });
    expect(highlight.closest("[hidden]")).not.toBeNull();
    expect(slot.getByText("Faster threads:").tagName).toBe("STRONG");
    expect(slot.queryByRole("img", { name: "Five in action" })).toBeNull();

    const showAll = slot.getByRole("button", { name: "Show all changes" });
    expect(showAll.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(showAll);

    expect(highlight.closest("[hidden]")).toBeNull();
    expect(
      slot.getByText("Fix a five-specific crash.").closest("[hidden]"),
    ).toBeNull();
    expect(summary?.className).not.toContain("line-clamp-1");
    expect(
      slot.getByRole("img", { name: "Five in action" }).getAttribute("src"),
    ).toBe("https://example.test/five.png");
    expect(section.textContent).toContain("Thanks to @ada, @grace.");
  });

  it("links the installed release on the website changelog", async () => {
    const slot = renderNotes();

    const link = await slot.findByRole("link", {
      name: "Open the full bb 0.5.0 changelog",
    });

    expect(link.getAttribute("href")).toBe("https://getbb.app/changelog#0-5-0");
  });

  it("names the previous version and collapses releases skipped since then", async () => {
    window.localStorage.setItem(SEEN_KEY, "0.3.0");
    const slot = renderNotes();

    expect(
      await slot.findByText("bb 0.5.0 · October 2, 2026 · Updated from 0.3.0"),
    ).toBeTruthy();
    const skipped = await waitFor(() => {
      const element = document.querySelector("[data-whats-new-skipped]");
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });
    expect(skipped.textContent).toContain("Also new since 0.3.0");
    const row = within(skipped).getByRole("button", { name: /Four headline/ });
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(slot.queryByText("Four arrives.")).toBeNull();
    fireEvent.click(row);
    expect(slot.getByText("Four arrives.")).toBeTruthy();
    expect(within(skipped).queryByText(/Five headline/)).toBeNull();
    expect(window.localStorage.getItem(SEEN_KEY)).toBe("0.5.0");
    expect(window.localStorage.getItem(PREVIOUS_KEY)).toBe("0.3.0");
  });

  it("keeps the update note after a reload until the next update", async () => {
    window.localStorage.setItem(SEEN_KEY, "0.4.0");
    const first = renderNotes();
    await first.findByText("bb 0.5.0 · October 2, 2026 · Updated from 0.4.0");
    cleanup();

    const second = renderNotes();

    expect(
      await second.findByText(
        "bb 0.5.0 · October 2, 2026 · Updated from 0.4.0",
      ),
    ).toBeTruthy();
  });

  it("adds an available update's notes", async () => {
    const slot = renderNotes({ latestVersion: "0.6.0" });

    const available = await waitFor(() => {
      const element = document.querySelector("[data-whats-new-available]");
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });
    expect(within(available).getByText("Update available")).toBeTruthy();
    fireEvent.click(
      within(available).getByRole("button", { name: /bb 0\.6\.0/ }),
    );
    expect(within(available).getByText("Six is ready.")).toBeTruthy();
    expect(
      slot.getByRole("heading", { level: 3, name: "Five headline" }),
    ).toBeTruthy();
  });

  it("omits the available update when its notes cannot be loaded", async () => {
    const slot = renderNotes({ latestVersion: "0.7.0" });

    await slot.findByRole("heading", { level: 3, name: "Five headline" });
    await flush();

    expect(document.querySelector("[data-whats-new-available]")).toBeNull();
  });

  it("renders nothing while What's new is turned off", async () => {
    renderNotes({ enabled: false });
    await flush();

    expect(document.getElementById("whats-new")).toBeNull();
    expect(window.localStorage.getItem(SEEN_KEY)).toBeNull();
  });
});

const SHOW_ME_RELEASE: ReleaseNotes = {
  ...FIVE,
  sections: [
    {
      title: "Highlights",
      blocks: [
        {
          kind: "list",
          items: [
            "**Faster threads:** switch instantly.",
            "**Safer archiving.** Undo within 30 seconds.",
            "**Filter the diff panel** with globs like `*.md`.",
            "Plugin [safe mode](https://example.test/safe) in one step.",
          ],
        },
      ],
    },
    {
      title: "Fixes",
      blocks: [{ kind: "list", items: ["Fix a five-specific crash."] }],
    },
  ],
};

function walkthrough(subject: string) {
  return `Walk me through ${subject} in this bb, one step at a time, and check each step with me. If the interactive_answer tool is available, show the steps as an interactive answer; otherwise reply with plain numbered steps.`;
}

async function expandedShowMeNotes() {
  const slot = renderNotes({ installed: SHOW_ME_RELEASE });
  fireEvent.click(
    await slot.findByRole("button", { name: "Show all changes" }),
  );
  return slot;
}

describe("Show me on What's new highlights", () => {
  it("offers a walkthrough prompt for each highlight and none for other sections", async () => {
    const slot = await expandedShowMeNotes();

    const prompts = slot
      .getAllByRole("button", { name: /^Show me / })
      .map((button) => {
        fireEvent.click(button);
        const call = slot.navigateCalls.at(-1);
        return call?.method === "toCompose"
          ? call.options?.initialPrompt
          : null;
      });

    expect(prompts).toEqual([
      walkthrough("Faster threads: switch instantly"),
      walkthrough("Safer archiving: Undo within 30 seconds"),
      walkthrough(
        "Filter the diff panel: Filter the diff panel with globs like *.md",
      ),
      walkthrough("Plugin safe mode in one step"),
    ]);
    const fix = slot.getByText("Fix a five-specific crash.");
    expect(within(fix).queryByRole("button")).toBeNull();
  });

  it("opens the new-thread composer filled and focused without changing seen state", async () => {
    window.localStorage.setItem(SEEN_KEY, "0.4.0");
    const slot = await expandedShowMeNotes();
    await slot.findByText("bb 0.5.0 · October 2, 2026 · Updated from 0.4.0");
    const seen = window.localStorage.getItem(SEEN_KEY);
    const previous = window.localStorage.getItem(PREVIOUS_KEY);

    fireEvent.click(
      slot.getByRole("button", { name: "Show me Faster threads" }),
    );

    expect(slot.navigateCalls).toEqual([
      {
        method: "toCompose",
        options: {
          initialPrompt: walkthrough("Faster threads: switch instantly"),
          focusPrompt: true,
        },
      },
    ]);
    expect(window.localStorage.getItem(SEEN_KEY)).toBe(seen);
    expect(window.localStorage.getItem(PREVIOUS_KEY)).toBe(previous);
  });

  it("is a focusable native button, so Enter and Space activate it", async () => {
    const slot = await expandedShowMeNotes();
    const action = slot.getByRole("button", {
      name: "Show me Safer archiving",
    });

    expect(action.tagName).toBe("BUTTON");
    expect(action.getAttribute("type")).toBe("button");
    expect(action.tabIndex).toBe(0);
    expect(action.textContent).toBe("Show me");
    action.focus();
    expect(document.activeElement).toBe(action);
  });
});

describe("version records", () => {
  it("compares numerically and ignores prerelease suffixes", () => {
    expect(compareVersions("0.10.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareVersions("0.43.3", "0.43.10")).toBeLessThan(0);
    expect(compareVersions("0.45.0-dev.3", "0.45.0")).toBe(0);
  });
});
