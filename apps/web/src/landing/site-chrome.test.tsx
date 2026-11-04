import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ExperimentsProvider } from "../experiments/context";
import { guideMenu } from "./content-links";
import { GitHubStarsLink, SiteFooter, SiteNav } from "./site-chrome";
import { formatStarCount } from "./site";

function navFor(key: string, variant: string): string {
  return renderToStaticMarkup(
    <ExperimentsProvider
      value={{
        distinctID: null,
        featureFlags: { [key]: variant },
        preview: false,
      }}
    >
      <SiteNav current="blog" />
    </ExperimentsProvider>,
  );
}

describe("site navigation", () => {
  it("shows the compact link set with an icon-only GitHub button", () => {
    const html = renderToStaticMarkup(<SiteNav current="plugins" />);
    const navLinks = html.slice(html.indexOf('class="nav-links"'));
    const links = [...navLinks.matchAll(/<a [^>]*>/gu)].map(
      (match) => match[0],
    );
    const guideLinks = guideMenu().flatMap((item) =>
      "links" in item ? item.links : [item],
    );
    expect(links).toHaveLength(7 + guideLinks.length);
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
  });

  it("keeps today's header in control", () => {
    for (const html of [
      renderToStaticMarkup(<SiteNav current="blog" />),
      navFor("homepage-download-path", "control"),
    ]) {
      expect(html).toMatch(/^<nav class="nav">/);
      expect(html).not.toContain("nav-actions");
      expect(html).not.toContain("nav-star-count");
      expect(html).toContain('href="/download/macos?placement=nav"');
    }
  });

  it("puts every header change in the test arm", () => {
    const html = navFor("homepage-download-path", "test");
    expect(html).toMatch(/^<nav class="nav nav-sticky nav-centered">/);
    const actionsAt = html.indexOf('<div class="nav-actions">');
    const links = html.slice(html.indexOf('class="nav-links"'), actionsAt);
    const actions = html.slice(actionsAt);
    expect(links).toContain("Sign in");
    expect(links).not.toContain("GitHub");
    expect(actions).toContain('aria-label="GitHub');
    expect(actions).toContain(
      '<a class="btn btn-primary btn-sm nav-download" href="/download">Download</a>',
    );
    expect(html).not.toContain("/download/macos");
  });

  it("shows the build-time star count beside the GitHub icon", () => {
    const html = renderToStaticMarkup(<GitHubStarsLink stars={4762} />);
    expect(html).toContain('class="nav-icon-button nav-github-stars"');
    expect(html).toContain('aria-label="GitHub, 4,762 stars"');
    expect(html).toContain(
      '<span class="nav-star-count" aria-hidden="true">4.8k</span>',
    );
    const fallback = renderToStaticMarkup(<GitHubStarsLink stars={null} />);
    expect(fallback).toContain('class="nav-icon-button" aria-label="GitHub"');
    expect(fallback).not.toContain("nav-star-count");
  });

  it.each([
    [812, "812"],
    [4762, "4.8k"],
    [12040, "12k"],
  ])("formats %d stars as %s", (count, label) => {
    expect(formatStarCount(count)).toBe(label);
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
    expect(html).toContain(
      'class="nav-current nav-wide" href="/changelog">Changelog',
    );
    expect(html).toContain("<summary>Plugins");
    const footer = renderToStaticMarkup(<SiteFooter />);
    expect(footer).toContain('href="/changelog">Changelog');
    expect(footer).toContain('href="/plugin-guide">Building plugins');
    expect(footer).toContain('href="/brand">Brand assets');
  });

  it("groups footer links and marks the current page", () => {
    const footer = renderToStaticMarkup(
      <SiteFooter current="/compare/superset-alternative" />,
    );
    for (const title of ["Product", "Guides", "Compare", "Community", "Legal"]) {
      expect(footer).toContain(`<h2 class="footer-title">${title}</h2>`);
    }
    expect(footer).toContain(
      'href="/compare/superset-alternative" aria-current="page">bb vs Superset',
    );
    expect(footer).not.toContain('href="/plugin-guide" aria-current="page"');
  });
});
