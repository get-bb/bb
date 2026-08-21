import { Moon02Icon, Sun03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import bbIcon from "../assets/bb-icon.png";
import bbIconDark from "../assets/bb-icon-dark.png";
import { DASHBOARD_PATH } from "../lib/connect-return-to";
import { DiscordLink, DownloadLink, GitHubLink, XLink } from "./cta";

type SiteNavPage = "blog" | "changelog";

// Flip the same html.dark class THEME_INIT (__root.tsx) sets pre-paint, and
// persist to the bb.theme key the app and dashboard read ("light" | "dark" |
// "system"; an explicit toggle collapses "system" to a choice, exactly like
// picking Light/Dark in the app's appearance settings). The button renders
// both glyphs; CSS keyed off html.dark shows the current one, so SSR output
// is theme-independent and hydration can't mismatch.
function toggleTheme() {
  const dark = document.documentElement.classList.toggle("dark");
  try {
    localStorage.setItem("bb.theme", dark ? "dark" : "light");
  } catch {
    // Storage can be unavailable (private mode); the in-page flip still works.
  }
  // Mirror the resolved background onto the theme-color metas so browser
  // chrome follows the explicit choice even when it disagrees with the OS
  // scheme (same approach as the app's useTheme syncThemeColorMeta).
  const background = getComputedStyle(document.body).backgroundColor;
  if (background && background !== "rgba(0, 0, 0, 0)") {
    for (const meta of document.querySelectorAll<HTMLMetaElement>(
      'meta[name="theme-color"]',
    )) {
      meta.content = background;
    }
  }
}

function ThemeToggle() {
  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label="Toggle dark mode"
      onClick={toggleTheme}
    >
      <HugeiconsIcon icon={Sun03Icon} className="theme-ic-sun" />
      <HugeiconsIcon icon={Moon02Icon} className="theme-ic-moon" />
    </button>
  );
}

export function SiteNav({ current }: { current?: SiteNavPage }) {
  return (
    <nav className="nav">
      {/* Both logo variants ship in the DOM and CSS keyed off html.dark picks
          one — the same hydration-safe pattern as the theme toggle glyphs.
          The dark asset is the brand's white glyph (assets/bb-logo-white.png)
          scaled so its glyph optically matches the light tile's. */}
      <a className="logo" href="/">
        <img className="logo-light" src={bbIcon} alt="bb" width={36} height={36} />
        <img className="logo-dark" src={bbIconDark} alt="bb" width={36} height={36} />
      </a>
      <div className="nav-links">
        <a
          className={current === "blog" ? "nav-current" : undefined}
          href="/blog"
        >
          Blog
        </a>
        <a
          className={current === "changelog" ? "nav-current" : undefined}
          href="/changelog"
        >
          Changelog
        </a>
        <GitHubLink placement="nav">GitHub</GitHubLink>
        <a href={DASHBOARD_PATH}>Sign in</a>
        {/* Toggle sits before the CTA so the nav ends on the primary action. */}
        <ThemeToggle />
        <DownloadLink placement="nav" className="btn btn-primary btn-sm">
          Download for macOS
        </DownloadLink>
      </div>
    </nav>
  );
}

export function SiteFooter() {
  return (
    <footer className="footer">
      <span>bb is free and open source (MIT)</span>
      <span>
        <a href="/blog">Blog</a>
        {" · "}
        <a href="/changelog">Changelog</a>
        {" · "}
        <a href="/privacy">Privacy</a>
        {" · "}
        <GitHubLink placement="footer">GitHub</GitHubLink>
        {" · "}
        <XLink placement="footer">X</XLink>
        {" · "}
        <DiscordLink placement="footer">Discord</DiscordLink>
        {" · "}
        <DownloadLink placement="footer">Download</DownloadLink>
      </span>
    </footer>
  );
}
