import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SiteFooter, SiteNav } from "./site-chrome";

describe("site navigation", () => {
  it("shows the compact link set with an icon-only GitHub button", () => {
    const html = renderToStaticMarkup(<SiteNav current="plugins" />);
    const links = [...html.matchAll(/<a [^>]*>/gu)].map((match) => match[0]);
    expect(links).toHaveLength(6);
    expect(html).toContain('class="nav-current" href="/marketplace">Plugins');
    expect(html).toContain('href="/blog">Blog');
    expect(html).toContain("Sign in");
    expect(html).toContain('aria-label="GitHub"');
    expect(html).toContain('class="nav-icon-button theme-toggle"');
    expect(html).toContain("Download for macOS");
    expect(html).not.toContain(">GitHub<");
    expect(html).not.toContain("Changelog");
    expect(html.indexOf('aria-label="GitHub"')).toBeLessThan(
      html.indexOf('aria-label="Theme"'),
    );
  });

  it("keeps the Changelog link in the footer", () => {
    const html = renderToStaticMarkup(<SiteFooter />);
    expect(html).toContain('href="/changelog">Changelog');
  });
});
