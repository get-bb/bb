// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { listenForDownloadIntent } from "./download-intent";
import { carryUtmToDownloadLinks } from "./download-utm";
import { withoutAdvertisingIds } from "./analytics-privacy";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  history.replaceState(null, "", "/");
  document.body.replaceChildren();
});

function setup(path: string, href: string) {
  history.replaceState(null, "", path);
  const capture = vi.fn();
  cleanups.push(carryUtmToDownloadLinks(), listenForDownloadIntent(capture));
  const link = document.createElement("a");
  link.href = href;
  link.innerHTML = "<span>Download</span>";
  document.body.appendChild(link);
  link.addEventListener("click", (event) => event.preventDefault());
  link.addEventListener("auxclick", (event) => event.preventDefault());
  const activate = (type: string, button = 0) =>
    link.firstElementChild?.dispatchEvent(
      new MouseEvent(type, { bubbles: true, button }),
    );
  return { link, capture, activate };
}

describe("download intent", () => {
  it.each([
    ["/", "homepage", "homepage", "hero"],
    ["/marketplace", "marketplace", "root", "nav"],
    ["/marketplace/plugin", "marketplace", "detail", "local"],
    ["/marketplace/author/test", "marketplace", "author", "inline"],
    ["/compare/t3-code-alternatives", "comparison", "comparison", "inline"],
  ])(
    "captures raw and shared links from %s without confusing target with visitor OS",
    (path, family, subtype, placement) => {
      const { activate, capture } = setup(
        path,
        `/download/windows${placement === "inline" ? "" : `?placement=${placement}`}`,
      );
      activate("pointerdown");
      expect(capture).not.toHaveBeenCalled();
      activate("click");
      expect(capture).toHaveBeenCalledTimes(1);
      expect(capture.mock.calls[0]?.[0]).toMatchObject({
        source_path: path,
        page_family: family,
        page_subtype: subtype,
        placement,
        download_target: "windows",
        measurement_version: 1,
      });
      expect(capture.mock.calls[0]?.[0]).not.toHaveProperty("$os");
    },
  );

  it("tracks keyboard click and middle click once each, ignoring right click and pointerdown", () => {
    const { activate, capture } = setup("/", "/download/linux");
    activate("click");
    activate("pointerdown", 1);
    activate("auxclick", 1);
    activate("auxclick", 2);
    expect(capture).toHaveBeenCalledTimes(2);
  });

  it.each([
    "https://elsewhere.test/download/macos",
    "/download/macos/extra",
    "/other",
    "/download/unknown",
  ])("ignores %s", (href) => {
    const { activate, capture } = setup("/", href);
    activate("click");
    expect(capture).not.toHaveBeenCalled();
  });

  it("snapshots current route and carried campaign after SPA navigation, respecting GPC", () => {
    vi.stubGlobal("navigator", { globalPrivacyControl: true });
    const { activate, capture, link } = setup(
      "/?utm_campaign=launch&gclid=private",
      "/download/macos",
    );
    history.pushState(null, "", "/compare/cursor-alternative");
    activate("auxclick", 1);
    expect(capture.mock.calls[0]?.[0]).toMatchObject({
      source_path: "/compare/cursor-alternative",
      download_campaign: { utm_campaign: "launch" },
    });
    expect(link.search).not.toContain("gclid");
  });

  it("removes handlers on teardown", () => {
    const { activate, capture } = setup("/", "/download/macos");
    for (const stop of cleanups.splice(0)) stop();
    activate("click");
    expect(capture).not.toHaveBeenCalled();
  });
});

describe("analytics GPC sanitization", () => {
  it("removes current and initial advertising identifiers including nested person properties while retaining campaigns", () => {
    expect(
      withoutAdvertisingIds({
        gclid: "secret",
        $initial_gbraid: "secret",
        utm_campaign: "launch",
        $current_url:
          "https://getbb.app/compare/test?gclid=secret&utm_campaign=launch",
        $set_once: {
          $initial_referrer: "https://search.test/?wbraid=secret",
          $initial_gclid: "secret",
        },
      }),
    ).toEqual({
      utm_campaign: "launch",
      $current_url: "https://getbb.app/compare/test?utm_campaign=launch",
      $set_once: { $initial_referrer: "https://search.test/" },
    });
  });
});
