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
      const stopLanding = carryUtmToDownloadLinks(() => null);
      for (const [name, value] of [
        ["gclid", "landing"],
        ["gbraid", "gb"],
        ["wbraid", "wb"],
      ] as const) {
        expect(new URL(window.location.href).searchParams.get(name)).toBe(
          globalPrivacyControl === true ? null : value,
        );
      }
      stopLanding();
      history.replaceState(null, "", "/compare/cursor-alternative");
      const link = document.createElement("a");
      link.href = "/download/windows?placement=hero";
      document.body.appendChild(link);
      const stop = carryUtmToDownloadLinks(() => null);
      try {
        link.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
        const params = new URL(link.href).searchParams;
        const saved = new URLSearchParams(
          sessionStorage.getItem("bb:landing-utm") ?? "",
        );
        for (const [name, value] of [
          ["gclid", "landing"],
          ["gbraid", "gb"],
          ["wbraid", "wb"],
        ] as const) {
          const expected = globalPrivacyControl === true ? null : value;
          expect(params.get(name)).toBe(expected);
          expect(saved.get(name)).toBe(expected);
        }
        expect(params.get("instructions")).toBeNull();
        expect(params.get("placement")).toBe("hero");
        expect(params.get("utm_source")).toBe("qa");
        expect(params.get("utm_campaign")).toBe("privacy");
        expect(saved.get("utm_source")).toBe("qa");
        expect(saved.get("utm_campaign")).toBe("privacy");
      } finally {
        stop();
      }
    },
  );

  it.each(["macos", "windows", "linux"])(
    "keeps a hardcoded %s link direct on keyboard activation",
    (platform) => {
      const link = document.createElement("a");
      link.href = `/download/${platform}`;
      link.addEventListener("click", (event) => event.preventDefault());
      document.body.appendChild(link);
      const stop = carryUtmToDownloadLinks(() => null);
      try {
        link.click();
        expect(link.pathname).toBe(`/download/${platform}`);
        expect(link.search).toBe("?first_page=%2F");
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
    const stop = carryUtmToDownloadLinks(() => null);
    try {
      link.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      expect(link.href).toBe(original);
    } finally {
      stop();
    }
  });

  it("purges previously saved click IDs when GPC becomes enabled", () => {
    sessionStorage.setItem(
      "bb:landing-utm",
      "utm_campaign=old&gclid=saved&gbraid=gb&wbraid=wb",
    );
    vi.stubGlobal("navigator", { globalPrivacyControl: true });
    const stop = carryUtmToDownloadLinks(() => null);
    try {
      expect(sessionStorage.getItem("bb:landing-utm")).toBe("utm_campaign=old");
    } finally {
      stop();
    }
  });

  it.each(["gclid", "gbraid", "wbraid"])(
    "removes %s without other click IDs or session storage",
    (name) => {
      vi.stubGlobal("navigator", { globalPrivacyControl: true });
      vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
        throw new DOMException("Storage blocked", "SecurityError");
      });
      history.replaceState(
        { review: true },
        "",
        `/?${name}=landing&utm_source=qa#download`,
      );
      const link = document.createElement("a");
      link.href = `/download/macos?placement=hero&${name}=direct&utm_campaign=own`;
      document.body.appendChild(link);
      const stop = carryUtmToDownloadLinks(() => null);
      try {
        link.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
        expect(window.location.search).toBe("?utm_source=qa");
        expect(window.location.hash).toBe("#download");
        expect(window.history.state).toEqual({ review: true });
        expect(new URL(link.href).searchParams.get("instructions")).toBeNull();
        expect(new URL(link.href).searchParams.get(name)).toBeNull();
        expect(new URL(link.href).searchParams.get("utm_campaign")).toBe("own");
      } finally {
        stop();
      }
    },
  );

  it.each([true, false])(
    "carries the visit and first touch onto a download link with GPC %s",
    (globalPrivacyControl) => {
      vi.stubGlobal("navigator", { globalPrivacyControl });
      vi.spyOn(document, "referrer", "get").mockReturnValue(
        "https://www.google.com/search?q=bb&gclid=ref",
      );
      history.replaceState(null, "", "/compare/cursor-alternative?gclid=abc");
      const link = document.createElement("a");
      link.href = "/download/macos?placement=hero";
      link.addEventListener("click", (event) => event.preventDefault());
      document.body.appendChild(link);
      const stop = carryUtmToDownloadLinks(() => ({
        distinctId: "019a0000-0000-7000-8000-000000000001",
        sessionId: "019a0000-0000-7000-8000-000000000002",
      }));
      try {
        link.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
        link.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
        const params = new URL(link.href).searchParams;
        expect(params.get("placement")).toBe("hero");
        expect(params.getAll("visitor_id")).toEqual([
          "019a0000-0000-7000-8000-000000000001",
        ]);
        expect(params.get("session_id")).toBe(
          "019a0000-0000-7000-8000-000000000002",
        );
        expect(params.get("first_page")).toBe("/compare/cursor-alternative");
        expect(params.get("first_referrer")).toBe(
          globalPrivacyControl
            ? "https://www.google.com/search?q=bb"
            : "https://www.google.com/search?q=bb&gclid=ref",
        );
        expect(params.get("gclid")).toBe(globalPrivacyControl ? null : "abc");
      } finally {
        stop();
      }
    },
  );

  it("keeps the first page and external referrer of the tab session", () => {
    const referrer = vi
      .spyOn(document, "referrer", "get")
      .mockReturnValue("https://duckduckgo.com/");
    history.replaceState(null, "", "/blog");
    carryUtmToDownloadLinks(() => null)();
    referrer.mockReturnValue("https://web.test/blog");
    history.replaceState(null, "", "/changelog");
    const link = document.createElement("a");
    link.href = "/download/linux";
    document.body.appendChild(link);
    const stop = carryUtmToDownloadLinks(() => null);
    try {
      link.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      const params = new URL(link.href).searchParams;
      expect(params.get("first_page")).toBe("/blog");
      expect(params.get("first_referrer")).toBe("https://duckduckgo.com/");
      expect(params.get("visitor_id")).toBeNull();
      expect(params.get("session_id")).toBeNull();
    } finally {
      stop();
    }
  });

  it("drops a stale visitor id when analytics is not loaded", () => {
    let visit: { distinctId: string; sessionId: string | null } | null = {
      distinctId: "019a0000-0000-7000-8000-000000000001",
      sessionId: null,
    };
    const link = document.createElement("a");
    link.href = "/download/windows";
    document.body.appendChild(link);
    const stop = carryUtmToDownloadLinks(() => visit);
    try {
      link.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      expect(new URL(link.href).searchParams.get("visitor_id")).toBe(
        "019a0000-0000-7000-8000-000000000001",
      );
      expect(new URL(link.href).searchParams.get("session_id")).toBeNull();
      visit = null;
      link.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      expect(new URL(link.href).searchParams.get("visitor_id")).toBeNull();
    } finally {
      stop();
    }
  });
});
