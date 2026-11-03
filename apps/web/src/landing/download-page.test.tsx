// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { carryUtmToDownloadLinks } from "./download-utm";
import { DownloadPage } from "./download-page";
import { CLI_COMMAND } from "./site";

const posthog = vi.hoisted(() => ({
  init: vi.fn(),
  capture: vi.fn(),
  get_distinct_id: vi.fn(() => "client-id"),
  get_session_id: vi.fn(() => "client-session"),
}));

vi.mock("posthog-js", () => ({ default: posthog }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  history.replaceState(null, "", "/");
  document.body.replaceChildren();
});

describe("/download page", () => {
  it("lists the other computers, the command and the phone apps", () => {
    const html = renderToStaticMarkup(<DownloadPage />);
    const body = html.slice(
      html.indexOf('class="dl-body"'),
      html.indexOf('class="footer"'),
    );
    expect(html).toContain('href="/download/macos?placement=download_page"');
    expect(body).not.toContain("/download/macos");
    expect(body).toContain('href="/download/windows?placement=download_page"');
    expect(body).toContain('href="/download/linux?placement=download_page"');
    expect(body).toContain(CLI_COMMAND);
    expect(body).toContain("testflight.apple.com");
    expect(body).toContain("bb-android.apk");
  });

  it("hides the computer rows on phones and keeps the phone options", () => {
    const html = renderToStaticMarkup(<DownloadPage />);
    const computers = html.slice(
      html.indexOf('class="dl-rows dl-computers"'),
      html.indexOf('class="dl-h2"'),
    );
    expect(computers).toContain("/download/windows");
    expect(computers).toContain("/download/linux");
    expect(computers).toContain(CLI_COMMAND);
    const phones = html.slice(html.indexOf('class="dl-h2"'));
    expect(phones).toContain('<div class="dl-rows">');
    expect(phones).toContain("testflight.apple.com");
    expect(html).toContain('class="install-note install-note-touch"');
    expect(html).toContain("install-send");
  });

  it("starts page-view analytics", async () => {
    vi.stubEnv("VITE_POSTHOG_KEY", "phc_test");
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        addEventListener() {},
        removeEventListener() {},
      })),
    );
    const { Route } = await import("../routes/download.index");
    const Component = Route.options.component;
    if (!Component) {
      throw new Error("missing route component");
    }
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<Component />);
    });
    await vi.waitFor(() => expect(posthog.init).toHaveBeenCalledTimes(1));
    expect(posthog.init).toHaveBeenCalledWith(
      "phc_test",
      expect.objectContaining({ capture_pageview: true }),
    );
    act(() => root.unmount());
  });

  it("carries the page's ad tags onto its download buttons", () => {
    history.replaceState(null, "", "/download?utm_source=google&via=email");
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = renderToStaticMarkup(<DownloadPage />);
    const stop = carryUtmToDownloadLinks(() => null);
    const links = Array.from(
      container.querySelectorAll<HTMLAnchorElement>(
        'a[href*="placement=download_page"]',
      ),
    );
    expect(links.length).toBeGreaterThan(1);
    for (const link of links) {
      link.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      const params = new URLSearchParams(link.search);
      expect(params.get("placement")).toBe("download_page");
      expect(params.get("utm_source")).toBe("google");
    }
    stop();
  });
});
