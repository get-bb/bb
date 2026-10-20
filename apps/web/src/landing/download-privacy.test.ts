// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { carryUtmToDownloadLinks } from "./download-utm";

describe("download attribution privacy", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    sessionStorage.clear();
    history.replaceState(null, "", "/");
    document.body.replaceChildren();
  });

  it.each([true, false, undefined])(
    "handles landing and saved click IDs with GPC %s",
    (globalPrivacyControl) => {
      vi.stubGlobal("navigator", { globalPrivacyControl });
      history.replaceState(
        null,
        "",
        "/?utm_source=qa&utm_campaign=privacy&gclid=landing&gbraid=gb&wbraid=wb",
      );
      const stopLanding = carryUtmToDownloadLinks();
      expect(new URL(window.location.href).searchParams.get("gclid")).toBe(
        globalPrivacyControl === true ? null : "landing",
      );
      stopLanding();
      history.replaceState(null, "", "/compare/cursor-alternative");
      const link = document.createElement("a");
      link.href = "/download/windows?placement=hero";
      document.body.appendChild(link);
      const stop = carryUtmToDownloadLinks();
      try {
        link.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
        const params = new URL(link.href).searchParams;
        expect(params.get("gclid")).toBe(
          globalPrivacyControl === true ? null : "landing",
        );
        expect(params.get("instructions")).toBe("1");
        expect(params.get("placement")).toBe("hero");
        expect(params.get("utm_source")).toBe("qa");
        expect(params.get("utm_campaign")).toBe("privacy");
        expect(params.get("gbraid")).toBe("gb");
        expect(params.get("wbraid")).toBe("wb");
        expect(
          sessionStorage.getItem("bb:landing-utm")?.includes("gclid"),
        ).toBe(globalPrivacyControl !== true);
      } finally {
        stop();
      }
    },
  );

  it.each(["macos", "windows", "linux"])(
    "opts a hardcoded %s link into instructions on keyboard activation",
    (platform) => {
      const link = document.createElement("a");
      link.href = `/download/${platform}`;
      link.addEventListener("click", (event) => event.preventDefault());
      document.body.appendChild(link);
      const stop = carryUtmToDownloadLinks();
      try {
        link.click();
        expect(link.search).toBe("?instructions=1");
      } finally {
        stop();
      }
    },
  );

  it.each([
    "https://example.com/download/macos",
    "/download/unknown",
    "/download/macos/other",
    "/install/macos/file",
  ])("does not alter non-download link %s", (href) => {
    sessionStorage.setItem("bb:landing-utm", "utm_source=saved");
    const link = document.createElement("a");
    link.href = href;
    const original = link.href;
    document.body.appendChild(link);
    const stop = carryUtmToDownloadLinks();
    try {
      link.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      expect(link.href).toBe(original);
    } finally {
      stop();
    }
  });

  it("purges a previously saved click ID when GPC becomes enabled", () => {
    sessionStorage.setItem("bb:landing-utm", "utm_campaign=old&gclid=saved");
    vi.stubGlobal("navigator", { globalPrivacyControl: true });
    const stop = carryUtmToDownloadLinks();
    try {
      expect(sessionStorage.getItem("bb:landing-utm")).toBe("utm_campaign=old");
    } finally {
      stop();
    }
  });

  it("removes a link click ID even when session storage is unavailable", () => {
    vi.stubGlobal("navigator", { globalPrivacyControl: true });
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new DOMException("Storage blocked", "SecurityError");
    });
    history.replaceState(
      { review: true },
      "",
      "/?gclid=landing&utm_source=qa#download",
    );
    const link = document.createElement("a");
    link.href = "/download/macos?placement=hero&gclid=direct&utm_campaign=own";
    document.body.appendChild(link);
    const stop = carryUtmToDownloadLinks();
    try {
      link.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      expect(window.location.search).toBe("?utm_source=qa");
      expect(window.location.hash).toBe("#download");
      expect(window.history.state).toEqual({ review: true });
      expect(new URL(link.href).searchParams.get("instructions")).toBe("1");
      expect(new URL(link.href).searchParams.get("gclid")).toBeNull();
      expect(new URL(link.href).searchParams.get("utm_campaign")).toBe("own");
    } finally {
      stop();
    }
  });
});
