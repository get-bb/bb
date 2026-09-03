import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SiteFooter, SiteNav } from "./site-chrome";

describe("site navigation", () => {
  it("shows the compact link set with an icon-only GitHub button", () => {
    const html = renderToStaticMarkup(<SiteNav current="plugins" />);
    const navLinks = html.slice(html.indexOf('class="nav-links"'));
    const links = [...navLinks.matchAll(/<a [^>]*>/gu)].map(
      (match) => match[0],
    );
    expect(links).toHaveLength(5);
    expect(html).toContain('class="nav-current" href="/marketplace">Plugins');
    expect(html).toContain('href="/blog">Blog');
    expect(html).toContain("Sign in");
    expect(html).toContain('aria-label="GitHub"');
    expect(html).toContain("Download for macOS");
    expect(html).not.toContain(">GitHub<");
    expect(html).not.toContain("Changelog");
    expect(html).not.toContain("Theme");
    expect(html).not.toContain("<button");
  });

  it("keeps the Changelog link in the footer", () => {
    const html = renderToStaticMarkup(<SiteFooter />);
    expect(html).toContain('href="/changelog">Changelog');
  });
});
