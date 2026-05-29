// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { createElement, type ReactNode } from "react";
import type { BbDesktopApi, BbDesktopInfo } from "@bb/server-contract";
import { NewTabFileSearch } from "./NewTabFileSearch";
import { createNoopDesktopBrowserApi } from "@/test/bb-desktop-test-utils";

// The launcher's data sources are the only external boundary here; stub them so
// the test focuses on whether the desktop-only Browser entry is gated correctly.
vi.mock("@/hooks/useFileSearchSuggestions", () => ({
  useFileSearchSuggestions: () => ({
    suggestions: [],
    isLoading: false,
    isError: false,
    isDebouncing: false,
    isUnavailable: false,
  }),
}));

vi.mock("@/hooks/usePromptDraftStorage", () => ({
  usePromptDraftStorage: () => ({
    storageKey: "draft-key",
    getCurrent: () => ({ text: "", attachments: [] }),
    setDraft: () => {},
  }),
}));

const DESKTOP_INFO: BbDesktopInfo = {
  lastCheckedAt: null,
  latestVersion: null,
  pendingVersion: null,
  platform: "macos",
  updateAvailable: false,
  updateDownloaded: false,
  version: "0.0.1",
};

function createDesktopApiStub(): BbDesktopApi {
  return {
    ...DESKTOP_INFO,
    browser: createNoopDesktopBrowserApi(),
    async checkForUpdates() {
      return DESKTOP_INFO;
    },
    async getInfo() {
      return DESKTOP_INFO;
    },
    async installUpdate() {
      return undefined;
    },
    onChange() {
      return () => undefined;
    },
    setTheme() {
      // no-op
    },
  };
}

function renderLauncher() {
  const store = createStore();
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(Provider, { store }, children);
  return render(
    createElement(NewTabFileSearch, {
      projectId: "proj_1",
      environmentId: null,
      currentThreadId: "thr_1",
      currentThreadType: "manager",
      focusRequest: 0,
      onSelect: () => {},
      onOpenBrowser: () => {},
    }),
    { wrapper },
  );
}

afterEach(() => {
  cleanup();
  delete window.bbDesktop;
});

describe("NewTabFileSearch — Browser entry gating", () => {
  it("shows the Open browser entry on the desktop build", () => {
    window.bbDesktop = createDesktopApiStub();
    renderLauncher();
    expect(screen.queryByText("Open browser")).not.toBeNull();
  });

  it("hides the Open browser entry on the web build (no window.bbDesktop)", () => {
    renderLauncher();
    expect(screen.queryByText("Open browser")).toBeNull();
  });
});
