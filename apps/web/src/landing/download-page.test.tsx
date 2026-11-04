// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DownloadPage } from "./download-page";
import { InstallOptions } from "./landing-visuals";
import { CLI_COMMAND, DESKTOP_DOWNLOADS } from "./site";

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
  it("lists the other computers apart from the phone apps", () => {
    const html = renderToStaticMarkup(<DownloadPage />);
    expect(html).toContain('href="/download/macos?placement=download_page"');
    const computers = html.slice(
      html.indexOf('class="dl-rows dl-computers"'),
      html.indexOf('class="dl-h2"'),
    );
    expect(computers).not.toContain("/download/macos");
    expect(computers).toContain(
      'href="/download/windows?placement=download_page"',
    );
    expect(computers).toContain(
      'href="/download/linux?placement=download_page"',
    );
    expect(computers).toContain(CLI_COMMAND);
    expect(computers).toMatch(/<div class="dl-row">[^]*npx bb-app@latest/);
    expect(computers).toContain('class="dl-row dl-row-installer"');
    const phones = html.slice(html.indexOf('class="dl-h2"'));
    expect(phones).toContain("testflight.apple.com");
    expect(phones).toContain("bb-android.apk");
    expect(html).toContain('class="install-note install-note-touch"');
    expect(html).toContain("install-send");
  });

  it("shows the same platform notes as the homepage install block", () => {
    const page = renderToStaticMarkup(<DownloadPage />);
    const home = renderToStaticMarkup(<InstallOptions placement="hero" />);
    const note = `<span class="install-note install-note-desktop">${DESKTOP_DOWNLOADS.macos.note}`;
    expect(page).toContain(note);
    expect(home).toContain(note);
    expect(page).toContain(
      `<span class="dl-row-tag">${DESKTOP_DOWNLOADS.windows.note}</span>`,
    );
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
});
