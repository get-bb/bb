import { describe, expect, it } from "vitest";
import {
  advanceAppSettingsRouteMemory,
  classifyAppSettingsRoute,
  createAppSettingsRouteMemory,
  resolveAppSettingsRouteMemory,
} from "./useAppSettingsRouteMemory";

const BOT_STUDIO = "/plugins/studio/bots/triage";
const SIDEBAR_ROUTES: ReadonlySet<string> = new Set([BOT_STUDIO]);

function memoryAfterVisiting(paths: readonly [string, ...string[]]) {
  const routes = paths.map((path) => {
    const url = new URL(path, "https://bb.test");
    return classifyAppSettingsRoute(url, SIDEBAR_ROUTES.has(url.pathname));
  });
  let state = createAppSettingsRouteMemory(routes[0]);
  for (const route of routes) {
    state = advanceAppSettingsRouteMemory(state, route);
  }
  return resolveAppSettingsRouteMemory(state, routes[routes.length - 1]);
}

const THREAD = "/projects/proj_one/threads/thr_one?message=12#event-12";
const CODEX_SETTINGS = "/settings/providers/codex?tab=models#preferred";
const PLUGIN_DETAIL = "/plugins/ui-patterns?tab=settings#source";

describe("app/settings route memory", () => {
  it.each(["/projects/proj_one/settings", "/settings/projects/proj_one"])(
    "uses a safe app destination when opening %s directly",
    (path) => {
      expect(memoryAfterVisiting([path]).appRoutePath).toBe("/");
    },
  );

  it("preserves the previous app route across a legacy project settings redirect", () => {
    expect(
      memoryAfterVisiting([
        "/threads/thr_one",
        "/projects/proj_one/settings",
        "/settings/projects/proj_one",
      ]).appRoutePath,
    ).toBe("/threads/thr_one");
  });

  it("switches between the most recent app and settings routes", () => {
    expect(memoryAfterVisiting([THREAD]).settingsRoutePath).toBe("/settings");
    expect(
      memoryAfterVisiting([THREAD, "/settings", CODEX_SETTINGS]).appRoutePath,
    ).toBe(THREAD);
    expect(
      memoryAfterVisiting([THREAD, "/settings", CODEX_SETTINGS, THREAD])
        .settingsRoutePath,
    ).toBe(CODEX_SETTINGS);
  });

  it("returns Plugins to the core app route, not the previous Plugins page", () => {
    expect(
      memoryAfterVisiting([THREAD, "/plugins", PLUGIN_DETAIL])
        .sectionBackRoutePath,
    ).toBe(THREAD);
    expect(
      memoryAfterVisiting([
        THREAD,
        "/plugins",
        PLUGIN_DETAIL,
        THREAD,
        "/plugins",
      ]).sectionBackRoutePath,
    ).toBe(THREAD);
  });

  it("returns a plugin page with its own sidebar to the core app route", () => {
    expect(memoryAfterVisiting([THREAD, BOT_STUDIO]).sectionBackRoutePath).toBe(
      THREAD,
    );
    expect(
      memoryAfterVisiting([THREAD, BOT_STUDIO, "/settings"]).appRoutePath,
    ).toBe(BOT_STUDIO);
  });

  it("never returns a plugin page to itself when its sidebar registers after the first visit", () => {
    const url = new URL(BOT_STUDIO, "https://bb.test");
    const before = classifyAppSettingsRoute(url, false);
    const after = classifyAppSettingsRoute(url, true);
    const state = advanceAppSettingsRouteMemory(
      createAppSettingsRouteMemory(before),
      before,
    );
    expect(
      resolveAppSettingsRouteMemory(state, after).sectionBackRoutePath,
    ).toBe("/");
  });

  it("remembers installed plugin management as Settings and preserves the app destination", () => {
    const thread = "/projects/proj_one/threads/thr_one";
    expect(memoryAfterVisiting([thread, "/settings/plugins"])).toMatchObject({
      settingsRoutePath: "/settings/plugins",
      appRoutePath: thread,
    });
    expect(
      memoryAfterVisiting([thread, "/settings/plugins", thread])
        .settingsRoutePath,
    ).toBe("/settings/plugins");
  });

  it("uses safe defaults when opened directly at the installed plugins list", () => {
    expect(memoryAfterVisiting(["/settings/plugins"])).toEqual({
      appRoutePath: "/",
      settingsRoutePath: "/settings/plugins",
      sectionBackRoutePath: "/settings/plugins",
    });
  });

  it.each([
    "/settings/plugins/ui-patterns",
    "/settings/plugins/ui-patterns?view=installed#source",
  ])("remembers %s as a Settings route", (path) => {
    expect(memoryAfterVisiting([path])).toMatchObject({
      settingsRoutePath: path,
      appRoutePath: "/",
    });
    expect(memoryAfterVisiting([path, "/"]).settingsRoutePath).toBe(path);
  });
});
