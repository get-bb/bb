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
    expect(links).toHaveLength(7);
    expect(html).toMatch(
      /<details class="nav-menu"><summary class="nav-current">Plugins/,
    );
    expect(html).toContain(
      'href="/marketplace" aria-current="page">Marketplace',
    );
    expect(html).toContain('href="/plugin-guide">Building plugins');
    expect(html).toContain('href="/blog">Blog');
    expect(html).toContain('href="/changelog">Changelog');
    expect(html.indexOf("Changelog")).toBeLessThan(html.indexOf("Sign in"));
    expect(html).toContain("Sign in");
    expect(html).toContain('aria-label="GitHub"');
    expect(html).toContain('href="/download/macos?placement=nav"');
    expect(html).toContain("Download for macOS");
    expect(html).not.toContain(">GitHub<");
    expect(html).not.toContain("Theme");
    expect(html).not.toContain("<button");
  });

  it("marks Building plugins current inside the Plugins menu", () => {
    const html = renderToStaticMarkup(<SiteNav current="plugin-guide" />);
    expect(html).toContain('<summary class="nav-current">Plugins');
    expect(html).toContain(
      'href="/plugin-guide" aria-current="page">Building plugins',
    );
    expect(html).not.toContain('aria-current="page">Marketplace');
  });

  it("marks Changelog current on the changelog route", () => {
    const html = renderToStaticMarkup(<SiteNav current="changelog" />);
    expect(html).toContain('class="nav-current" href="/changelog">Changelog');
    expect(html).toContain("<summary>Plugins");
    const footer = renderToStaticMarkup(<SiteFooter />);
    expect(footer).toContain('href="/changelog">Changelog');
    expect(footer).toContain('href="/plugin-guide">Building plugins');
  });

  it("groups footer links and marks the current page", () => {
    const footer = renderToStaticMarkup(
      <SiteFooter current="/compare/superset-alternative" />,
    );
    for (const title of ["Product", "Compare", "Community"]) {
      expect(footer).toContain(`<h2 class="footer-title">${title}</h2>`);
    }
    expect(footer).toContain(
      'href="/compare/superset-alternative" aria-current="page">bb vs Superset',
    );
    expect(footer).not.toContain('href="/plugin-guide" aria-current="page"');
  });
});
