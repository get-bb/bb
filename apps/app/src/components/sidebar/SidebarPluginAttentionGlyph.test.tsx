// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "jotai";
import { MemoryRouter } from "react-router-dom";
import type { PluginAttentionEntry } from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar.js";
import { SidebarPluginAttentionGlyph } from "./SidebarPluginAttentionGlyph";

const usePluginAttentionMock = vi.hoisted(() => vi.fn());
const useSystemVersionMock = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/usePluginAttention", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/usePluginAttention")>()),
  usePluginAttention: usePluginAttentionMock,
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemVersion: useSystemVersionMock,
}));

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  usePluginAttentionMock.mockReset();
  useSystemVersionMock.mockReset();
});

function entry(overrides: Partial<PluginAttentionEntry>): PluginAttentionEntry {
  return {
    id: "notify",
    name: "Notify",
    status: "incompatible",
    statusDetail: "requires bb >=0.38.0 <0.39.0, this is 0.39.0",
    ...overrides,
  };
}

function renderGlyph(plugins: PluginAttentionEntry[], version = "0.39.0") {
  usePluginAttentionMock.mockReturnValue({ count: plugins.length, plugins });
  useSystemVersionMock.mockReturnValue({
    data: { currentVersion: version },
  });
  return render(
    // A fresh jotai Provider per render, so "across remount" below means the
    // acknowledgement survived only through localStorage, like a page reload.
    <Provider>
      <MemoryRouter>
        <SidebarProvider>
          <SidebarPluginAttentionGlyph className="footer-action" />
        </SidebarProvider>
      </MemoryRouter>
    </Provider>,
  );
}

function glyph() {
  return screen.queryByTestId("sidebar-plugin-attention-glyph");
}

describe("SidebarPluginAttentionGlyph", () => {
  it("renders nothing while every enabled plugin runs", () => {
    renderGlyph([]);

    expect(screen.queryByTestId("sidebar-plugin-attention-glyph")).toBeNull();
    expect(document.querySelector('[data-icon="AlertTriangle"]')).toBeNull();
  });

  it("shows one warning triangle that names the incompatible plugin and opens Installed plugins", () => {
    renderGlyph([entry({})]);

    const glyph = screen.getByTestId("sidebar-plugin-attention-glyph");
    expect(glyph.getAttribute("aria-label")).toBe(
      "Notify is incompatible with bb 0.39.0",
    );
    expect(glyph.getAttribute("href")).toBe(
      "/extensions/plugins?view=installed",
    );
    expect(glyph.querySelector('[data-icon="AlertTriangle"]')).not.toBeNull();
    // A glyph, not a chip: no visible count or sentence.
    expect(glyph.textContent).toBe("Notify is incompatible with bb 0.39.0");
    expect(glyph.querySelector(".sr-only")).not.toBeNull();
    expect(glyph.className).toContain("footer-action");
    expect(glyph.className).toContain("text-warning-text");
  });

  it("collapses several plugins to a count", () => {
    renderGlyph([entry({}), entry({ id: "foo", name: "Foo", status: "error" })]);

    expect(
      screen
        .getByTestId("sidebar-plugin-attention-glyph")
        .getAttribute("aria-label"),
    ).toBe("2 plugins are not running");
    expect(
      document.querySelectorAll('[data-icon="AlertTriangle"]').length,
    ).toBe(1);
  });

  it("hides after a click as an acknowledgement of the current set", () => {
    renderGlyph([entry({})]);

    fireEvent.click(screen.getByTestId("sidebar-plugin-attention-glyph"));

    expect(glyph()).toBeNull();
  });

  it("stays hidden across a remount while the set is unchanged", () => {
    renderGlyph([entry({})]);
    fireEvent.click(screen.getByTestId("sidebar-plugin-attention-glyph"));
    cleanup();

    // Query order must not matter; only the entries do.
    renderGlyph([entry({})]);

    expect(glyph()).toBeNull();
  });

  it("returns when a plugin is added, changes status, or changes detail", () => {
    renderGlyph([entry({})]);
    fireEvent.click(screen.getByTestId("sidebar-plugin-attention-glyph"));
    cleanup();

    renderGlyph([entry({}), entry({ id: "foo", name: "Foo", status: "error" })]);
    expect(glyph()).not.toBeNull();
    cleanup();

    renderGlyph([entry({ status: "missing" })]);
    expect(glyph()).not.toBeNull();
    cleanup();

    renderGlyph([entry({ statusDetail: "requires bb >=0.40.0, this is 0.39.0" })]);
    expect(glyph()).not.toBeNull();
  });

  it("clears the acknowledgement when the count drops to zero", () => {
    renderGlyph([entry({})]);
    fireEvent.click(screen.getByTestId("sidebar-plugin-attention-glyph"));
    cleanup();

    // Every plugin runs again (bb upgraded, plugin updated, or disabled).
    renderGlyph([]);
    expect(glyph()).toBeNull();
    cleanup();

    // The same failure later is a new problem and shows again.
    renderGlyph([entry({})]);
    expect(glyph()).not.toBeNull();
  });
});
