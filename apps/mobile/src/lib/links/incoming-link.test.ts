import { describe, expect, it } from "vitest";
import {
  addServerPathForLink,
  isDeveloperRoutePath,
  mapSchemePathToMobilePath,
  mapWebPathToMobilePath,
  matchProfileForWebLink,
  parseIncomingLink,
  resolveIncomingLink,
} from "./incoming-link";

const sawyer = { id: "p1", serverUrl: "https://sawyer.getbb.app" };
const lan = { id: "p2", serverUrl: "http://192.168.1.20:3000" };
const prefixed = { id: "p3", serverUrl: "https://home.example.com/bb" };

describe("parseIncomingLink", () => {
  it("treats the first segment of a bb:// link as a path segment, not a host", () => {
    expect(parseIncomingLink("bb://threads/thr_1?x=1#frag")).toEqual({
      kind: "scheme",
      path: "/threads/thr_1?x=1",
    });
    expect(parseIncomingLink("bb:///settings/servers/")).toEqual({
      kind: "scheme",
      path: "/settings/servers",
    });
    expect(parseIncomingLink("bb://")).toEqual({ kind: "scheme", path: "/" });
    expect(parseIncomingLink("BB://e2e/reset")).toEqual({
      kind: "scheme",
      path: "/e2e/reset",
    });
  });

  it("parses web links into origin + path + search", () => {
    expect(
      parseIncomingLink("https://sawyer.getbb.app/threads/thr_1/?view=full"),
    ).toEqual({
      kind: "web",
      origin: "https://sawyer.getbb.app",
      pathname: "/threads/thr_1",
      search: "?view=full",
    });
  });

  it("leaves dev-client and other schemes alone", () => {
    expect(
      parseIncomingLink(
        "exp+bb-app://expo-development-client/?url=http://127.0.0.1:8082",
      ),
    ).toEqual({ kind: "foreign" });
    expect(parseIncomingLink("mailto:x@y.z")).toEqual({ kind: "foreign" });
    expect(parseIncomingLink("")).toEqual({ kind: "foreign" });
  });
});

describe("mapWebPathToMobilePath", () => {
  it.each([
    ["/", "/"],
    ["/threads/thr_1", "/threads/thr_1"],
    ["/projects/prj_1/threads/thr_2", "/threads/thr_2"],
    ["/projects/prj_1/settings", "/projects/prj_1/settings"],
    ["/projects/prj_1/archived", "/settings/archived?projectId=prj_1"],
    ["/projects/prj_1", "/?projectId=prj_1"],
    ["/compose", "/?newThread=1"],
    ["/archived", "/settings/archived"],
    ["/settings", "/settings"],
    ["/settings/servers", "/settings/servers"],
    ["/settings/general", "/settings"],
    ["/settings/providers/codex", "/settings"],
    ["/extensions/plugins/foo", "/"],
    ["/plugins/automations/automations", "/"],
    ["/threads", "/"],
  ])("%s → %s", (input, expected) => {
    expect(mapWebPathToMobilePath(input)).toBe(expected);
  });

  it("opens the home dock for compose links and keeps their params", () => {
    expect(mapWebPathToMobilePath("/compose", "?projectId=prj_1")).toBe(
      "/?newThread=1&projectId=prj_1",
    );
    expect(mapSchemePathToMobilePath("/compose")).toBe("/?newThread=1");
    expect(mapSchemePathToMobilePath("/compose?projectId=prj_1")).toBe(
      "/?newThread=1&projectId=prj_1",
    );
    expect(mapSchemePathToMobilePath("/composer")).toBe("/composer");
    expect(mapSchemePathToMobilePath("/threads/thr_1")).toBe("/threads/thr_1");
  });

  it("keeps the query string on thread and settings links", () => {
    expect(mapWebPathToMobilePath("/threads/thr_1", "?x=1")).toBe(
      "/threads/thr_1?x=1",
    );
    expect(mapWebPathToMobilePath("/settings/archived", "?projectId=p")).toBe(
      "/settings/archived?projectId=p",
    );
  });
});

describe("matchProfileForWebLink", () => {
  it("matches by origin, ignoring scheme/port differences", () => {
    const profiles = [sawyer, lan];
    expect(
      matchProfileForWebLink(profiles, "https://sawyer.getbb.app", "/threads/x")
        ?.profile,
    ).toBe(sawyer);
    expect(
      matchProfileForWebLink(profiles, "http://sawyer.getbb.app", "/threads/x"),
    ).toBeNull();
    expect(
      matchProfileForWebLink(profiles, "http://192.168.1.20:3000", "/")
        ?.profile,
    ).toBe(lan);
    expect(
      matchProfileForWebLink(profiles, "http://192.168.1.20:3001", "/"),
    ).toBeNull();
  });

  it("strips a profile path prefix and refuses paths outside it", () => {
    const match = matchProfileForWebLink(
      [prefixed],
      "https://home.example.com",
      "/bb/threads/thr_9",
    );
    expect(match).toEqual({ profile: prefixed, pathname: "/threads/thr_9" });
    expect(
      matchProfileForWebLink([prefixed], "https://home.example.com", "/bb"),
    ).toEqual({ profile: prefixed, pathname: "/" });
    expect(
      matchProfileForWebLink(
        [prefixed],
        "https://home.example.com",
        "/bbx/threads/thr_9",
      ),
    ).toBeNull();
  });
});

describe("resolveIncomingLink", () => {
  const context = {
    profiles: [sawyer, lan],
    activeProfileId: "p2",
    developerRoutesEnabled: false,
  };

  it("passes foreign URLs through untouched", () => {
    expect(
      resolveIncomingLink(
        "exp+bb-app://expo-development-client/?url=x",
        context,
      ),
    ).toEqual({ kind: "passthrough" });
  });

  it("routes scheme links as typed without touching the active profile", () => {
    expect(resolveIncomingLink("bb://threads/thr_1", context)).toEqual({
      kind: "navigate",
      path: "/threads/thr_1",
      profileId: null,
    });
  });

  it("sends developer-only scheme links home unless the bundle exposes them", () => {
    // Any web page can open `bb://…`; the dev spike / e2e reset screens must
    // stay unreachable in release bundles even though the route files ship.
    for (const url of [
      "bb://dev/connect-spike",
      "bb://dev",
      "bb://e2e/reset?x=1",
    ]) {
      expect(resolveIncomingLink(url, context)).toEqual({
        kind: "navigate",
        path: "/",
        profileId: null,
      });
    }
    // Only the route groups themselves, not paths that merely start with "dev".
    expect(resolveIncomingLink("bb://devices/d1", context)).toMatchObject({
      path: "/devices/d1",
    });
    expect(
      resolveIncomingLink("bb://dev/connect-spike", {
        ...context,
        developerRoutesEnabled: true,
      }),
    ).toEqual({
      kind: "navigate",
      path: "/dev/connect-spike",
      profileId: null,
    });
    expect(isDeveloperRoutePath("/e2e")).toBe(true);
    expect(isDeveloperRoutePath("/settings/dev")).toBe(false);
  });

  it("switches to the profile that owns a universal link", () => {
    expect(
      resolveIncomingLink("https://sawyer.getbb.app/threads/thr_1", context),
    ).toEqual({ kind: "navigate", path: "/threads/thr_1", profileId: "p1" });
    expect(
      resolveIncomingLink("http://192.168.1.20:3000/settings", context),
    ).toEqual({ kind: "navigate", path: "/settings", profileId: null });
  });

  it("maps web-only paths of a known server onto the mobile surface", () => {
    expect(
      resolveIncomingLink(
        "https://sawyer.getbb.app/projects/prj_1/threads/thr_2",
        context,
      ),
    ).toEqual({ kind: "navigate", path: "/threads/thr_2", profileId: "p1" });
  });

  it("sends an unknown server to the add-server screen with the follow-up path", () => {
    expect(
      resolveIncomingLink("https://other.getbb.app/threads/thr_3", context),
    ).toEqual({
      kind: "unknown-server",
      serverUrl: "https://other.getbb.app",
      path: "/threads/thr_3",
    });
    expect(
      addServerPathForLink("https://other.getbb.app", "/threads/thr_3"),
    ).toBe(
      "/settings/servers/add?serverUrl=https%3A%2F%2Fother.getbb.app&next=%2Fthreads%2Fthr_3",
    );
    expect(addServerPathForLink("https://other.getbb.app", "/")).toBe(
      "/settings/servers/add?serverUrl=https%3A%2F%2Fother.getbb.app",
    );
  });
});
