import {
  ComputerIcon,
  Moon02Icon,
  Sun03Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";

import bbIcon from "../assets/bb-icon.png";
import bbIconDark from "../assets/bb-icon-dark.png";
import { DASHBOARD_PATH } from "../lib/connect-return-to";
import { DiscordLink, DownloadLink, GitHubLink, XLink } from "./cta";

type SiteNavPage = "blog" | "changelog";

/* ── Theme ─────────────────────────────────────────────────────────
   Same model as the app's useTheme: a preference of "light" | "dark" |
   "system" (default "system") stored under bb.theme, resolved against the
   OS scheme, and re-applied whenever the OS scheme changes. The html.dark
   class is the one THEME_INIT (__root.tsx) sets pre-paint and the one
   landing.css keys its dark tokens off. */

type ThemePreference = "light" | "dark" | "system";

const THEME_STORAGE_KEY = "bb.theme";
const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";

const THEME_OPTIONS: ReadonlyArray<{
  value: ThemePreference;
  label: string;
  icon: IconSvgElement;
}> = [
  { value: "light", label: "Light", icon: Sun03Icon },
  { value: "dark", label: "Dark", icon: Moon02Icon },
  { value: "system", label: "System", icon: ComputerIcon },
];

function readThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // Storage can be unavailable (private mode); fall through to system.
  }
  return "system";
}

// Mirror the resolved background onto the theme-color meta so browser chrome
// follows the page even when the choice disagrees with the OS scheme (same
// approach as the app's useTheme syncThemeColorMeta).
function syncThemeColorMeta() {
  const background = getComputedStyle(document.body).backgroundColor;
  if (!background || background === "rgba(0, 0, 0, 0)") return;
  for (const meta of document.querySelectorAll<HTMLMetaElement>(
    'meta[name="theme-color"]',
  )) {
    meta.content = background;
  }
}

function applyThemePreference(preference: ThemePreference) {
  const dark =
    preference === "dark" ||
    (preference === "system" && matchMedia(DARK_SCHEME_QUERY).matches);
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  // The button glyph keys off the preference (not the resolved theme), via
  // the same attribute THEME_INIT stamps pre-paint.
  root.setAttribute("data-theme-preference", preference);
  syncThemeColorMeta();
}

function setThemePreference(preference: ThemePreference) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // The in-page change still applies for this visit.
  }
  applyThemePreference(preference);
}

// Preference button (sun / moon / monitor for Light / Dark / System — all
// three glyphs render and CSS keyed off html[data-theme-preference] picks
// one, so SSR output is preference-independent and hydration can't
// mismatch) that opens a Light / Dark / System menu. The menu only exists
// while open, so its checked state is read from storage at open time and
// never has to agree with the server render.
function ThemeMenu() {
  const [open, setOpen] = useState(false);
  const [preference, setPreference] = useState<ThemePreference>("system");
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Follow the OS while the preference is "system" (live, not just at load),
  // and pick up a choice made in another tab or in the app.
  useEffect(() => {
    const media = matchMedia(DARK_SCHEME_QUERY);
    const onScheme = () => {
      if (readThemePreference() === "system") applyThemePreference("system");
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY || event.key === null) {
        applyThemePreference(readThemePreference());
      }
    };
    media.addEventListener("change", onScheme);
    window.addEventListener("storage", onStorage);
    return () => {
      media.removeEventListener("change", onScheme);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // Dismiss on outside click or Escape; Escape returns focus to the button.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const choose = (next: ThemePreference) => {
    setThemePreference(next);
    setPreference(next);
    setOpen(false);
    buttonRef.current?.focus();
  };

  return (
    <div ref={rootRef} className="theme-menu-wrap">
      <button
        ref={buttonRef}
        type="button"
        className="theme-toggle"
        aria-label="Theme"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          if (!open) setPreference(readThemePreference());
          setOpen((value) => !value);
        }}
      >
        <HugeiconsIcon icon={Sun03Icon} className="theme-ic-sun" />
        <HugeiconsIcon icon={Moon02Icon} className="theme-ic-moon" />
        <HugeiconsIcon icon={ComputerIcon} className="theme-ic-system" />
      </button>
      {open && (
        <div className="theme-menu" role="menu" aria-label="Theme">
          {THEME_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={preference === option.value}
              className="theme-menu-item"
              onClick={() => choose(option.value)}
            >
              <HugeiconsIcon icon={option.icon} className="theme-menu-ic" />
              {option.label}
              {preference === option.value && (
                <HugeiconsIcon icon={Tick02Icon} className="theme-menu-check" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
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
        {/* Theme control sits before the CTA so the nav ends on the primary
            action. */}
        <ThemeMenu />
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
