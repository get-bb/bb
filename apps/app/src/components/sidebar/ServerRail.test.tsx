// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  BbDesktopServerListEntry,
  BbDesktopServersApi,
} from "@bb/desktop-contract";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { createBbDesktopApi } from "@/test/bb-desktop-test-utils";
import { ServerRail } from "./ServerRail";

const desktopInfo = {
  lastCheckedAt: null,
  latestVersion: null,
  pendingVersion: null,
  platform: "macos" as const,
  updateAvailable: false,
  updateDownloaded: false,
  version: "0.0.5",
};

function serverEntry(
  overrides: Partial<BbDesktopServerListEntry> &
    Pick<BbDesktopServerListEntry, "id" | "name" | "source" | "url">,
): BbDesktopServerListEntry {
  return {
    active: false,
    color: null,
    icon: null,
    status: "connected",
    ...overrides,
  };
}

function createServersApi(
  overrides: Partial<BbDesktopServersApi> = {},
): BbDesktopServersApi {
  return {
    list: vi.fn().mockResolvedValue([]),
    add: vi.fn(),
    remove: vi.fn(),
    rename: vi.fn(),
    setActive: vi.fn().mockResolvedValue(undefined),
    setTileStyle: vi.fn().mockResolvedValue(undefined),
    getAutoConnect: vi.fn().mockResolvedValue(true),
    setAutoConnect: vi.fn(),
    getShowConnectServers: vi.fn().mockResolvedValue(true),
    setShowConnectServers: vi.fn(),
    onChange: vi.fn().mockReturnValue(() => {}),
    ...overrides,
  } as BbDesktopServersApi;
}

function renderRail() {
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <ServerRail />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  delete window.bbDesktop;
  vi.clearAllMocks();
});

describe("ServerRail", () => {
  it("renders nothing without the bridge or with fewer than two servers", async () => {
    renderRail();
    expect(screen.queryByTestId("app-server-rail")).toBeNull();
    cleanup();

    window.bbDesktop = {
      ...createBbDesktopApi(desktopInfo),
      servers: createServersApi({
        list: vi
          .fn()
          .mockResolvedValue([
            serverEntry({
              id: "builtin",
              name: "This Mac",
              source: "builtin",
              url: "http://127.0.0.1:1",
              active: true,
            }),
          ]),
      }),
    };
    renderRail();
    await Promise.resolve();
    expect(screen.queryByTestId("app-server-rail")).toBeNull();
  });

  it("shows tiles with active state and quiet status, switches on click", async () => {
    const servers = createServersApi({
      list: vi.fn().mockResolvedValue([
        serverEntry({
          id: "builtin",
          name: "This Mac",
          source: "builtin",
          url: "http://127.0.0.1:1",
          active: true,
        }),
        serverEntry({
          id: "remote",
          name: "Studio",
          source: "connect",
          url: "https://studio.example",
          status: "offline",
        }),
      ]),
    });
    window.bbDesktop = { ...createBbDesktopApi(desktopInfo), servers };

    renderRail();
    const rail = await screen.findByTestId("app-server-rail");
    expect(rail).toBeDefined();

    const builtinTile = screen.getByTestId("server-rail-tile-builtin");
    expect(builtinTile.getAttribute("aria-current")).toBe("true");
    // Healthy server shows no dot; offline one does.
    expect(screen.queryByTestId("server-rail-status-builtin")).toBeNull();
    expect(screen.getByTestId("server-rail-status-remote")).toBeDefined();

    fireEvent.click(screen.getByTestId("server-rail-tile-remote"));
    expect(servers.setActive).toHaveBeenCalledWith("remote");
    // Clicking the already-active tile is a no-op.
    fireEvent.click(builtinTile);
    expect(servers.setActive).toHaveBeenCalledTimes(1);

    expect(
      screen.getByTestId("server-rail-add").getAttribute("href"),
    ).toBe("/settings/servers");
  });

  it("renders chosen icon and color, and falls back on unknown values", async () => {
    const servers = createServersApi({
      list: vi.fn().mockResolvedValue([
        serverEntry({
          id: "styled",
          name: "Studio",
          source: "manual",
          url: "https://studio.example",
          active: true,
          icon: "Zap",
          color: "blue",
        }),
        serverEntry({
          id: "unknown",
          name: "Lab",
          source: "connect",
          url: "https://lab.example",
          icon: "NotARealIcon",
          color: "not-a-color",
        }),
      ]),
    });
    window.bbDesktop = { ...createBbDesktopApi(desktopInfo), servers };

    renderRail();
    await screen.findByTestId("app-server-rail");

    const styled = screen.getByTestId("server-rail-tile-styled");
    expect(styled.querySelector("[data-icon='Zap']")).not.toBeNull();
    expect(styled.style.backgroundColor).toContain("color-mix");
    // Glyph color is applied on the inner span (jsdom may normalize hex → rgb).
    const styledGlyph = styled.querySelector("span");
    expect(styledGlyph?.style.color).toMatch(/rgb\(0,\s*144,\s*255\)|#0090ff/i);

    const unknown = screen.getByTestId("server-rail-tile-unknown");
    // Unknown icon → letter glyph; unknown color → no custom tint.
    expect(unknown.querySelector("[data-icon]")).toBeNull();
    expect(unknown.textContent).toContain("L");
    expect(unknown.style.backgroundColor).toBe("");
  });
});
