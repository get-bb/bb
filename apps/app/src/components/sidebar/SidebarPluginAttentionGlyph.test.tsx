// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Provider } from "jotai";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar.js";
import {
  type PluginListItem,
  type PluginListResult,
} from "@/hooks/queries/plugin-settings-queries";
import { pluginListQueryKey } from "@/hooks/queries/query-keys";
import { SidebarPluginAttentionGlyph } from "./SidebarPluginAttentionGlyph";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function plugin(overrides: Partial<PluginListItem>): PluginListItem {
  return /* SAFETY: The test controls this fixture and verifies its behavior. */ {
    id: "notify",
    name: "Notify",
    enabled: true,
    status: "incompatible",
    statusDetail: "requires bb >=0.38.0 <0.39.0, this is 0.39.0",
    ...overrides,
  } as PluginListItem;
}

function renderGlyph(plugins: PluginListItem[]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData<PluginListResult>(pluginListQueryKey(true), {
    plugins,
  });
  return render(
    <Provider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SidebarProvider>
            <SidebarPluginAttentionGlyph className="footer-action" />
          </SidebarProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
}

const glyph = () => screen.queryByTestId("sidebar-plugin-attention-glyph");

describe("SidebarPluginAttentionGlyph", () => {
  it("renders nothing while every enabled plugin runs", () => {
    renderGlyph([
      plugin({ status: "running" }),
      plugin({ id: "off", enabled: false, status: "incompatible" }),
    ]);
    expect(glyph()).toBeNull();
  });

  it("names the plugin, links to Installed plugins, and uses the warning tone", () => {
    renderGlyph([plugin({})]);
    const el = glyph()!;
    expect(el.getAttribute("aria-label")).toBe(
      "Notify is incompatible: requires bb >=0.38.0 <0.39.0, this is 0.39.0",
    );
    expect(el.getAttribute("href")).toBe("/extensions/plugins?view=installed");
    expect(el.className).toContain("text-warning-text");
    expect(el.querySelector('[data-icon="AlertTriangle"]')).not.toBeNull();
  });

  it("hides on click, stays hidden for the same set across a remount, and returns on any change", () => {
    renderGlyph([plugin({})]);
    fireEvent.click(glyph()!);
    expect(glyph()).toBeNull();
    cleanup();

    renderGlyph([plugin({})]);
    expect(glyph()).toBeNull();
    cleanup();

    renderGlyph([plugin({ status: "error", statusDetail: "boom" })]);
    expect(glyph()).not.toBeNull();
    cleanup();

    renderGlyph([
      plugin({}),
      plugin({ id: "foo", name: "Foo", status: "missing" }),
    ]);
    expect(glyph()?.getAttribute("aria-label")).toBe(
      "2 plugins are not running",
    );
  });

  it("clears the acknowledgement when the count drops to zero", () => {
    renderGlyph([plugin({})]);
    fireEvent.click(glyph()!);
    cleanup();

    renderGlyph([]);
    expect(glyph()).toBeNull();
    cleanup();

    renderGlyph([plugin({})]);
    expect(glyph()).not.toBeNull();
  });
});
