import {
  ComputerIcon,
  Moon02Icon,
  Sun03Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";

import { DASHBOARD_PATH } from "../lib/connect-return-to";
import {
  DARK_SCHEME_QUERY,
  THEME_STORAGE_KEY,
  type ThemePreference,
  applyThemePreference,
  readThemePreference,
  setThemePreference,
} from "../lib/theme";
import { DiscordLink, DownloadLink, GitHubLink, XLink } from "./cta";

type SiteNavPage = "blog" | "changelog";

/* ── Theme ─────────────────────────────────────────────────────────
   The preference model itself lives in lib/theme.ts, shared with the
   pre-paint script in __root.tsx so there is one implementation of the rule.
   This file only owns the control. */

const THEME_OPTIONS: ReadonlyArray<{
  value: ThemePreference;
  label: string;
  icon: IconSvgElement;
}> = [
  { value: "light", label: "Light", icon: Sun03Icon },
  { value: "dark", label: "Dark", icon: Moon02Icon },
  { value: "system", label: "System", icon: ComputerIcon },
];

// Preference button (sun / moon / monitor for Light / Dark / System — all
// three glyphs render and CSS keyed off html[data-theme-preference] picks
// one, so SSR output is preference-independent and hydration can't
// mismatch) that opens a Light / Dark / System menu. The menu only exists
// while open, and its checked state comes from the effect below rather than
// the server render, so it never has to agree with SSR.
function ThemeMenu() {
  const [open, setOpen] = useState(false);
  const [preference, setPreference] = useState<ThemePreference>("system");
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Follow the OS while the preference is "system" (live, not just at load),
  // and pick up a choice made in another tab. Both the document and this
  // component's copy of the preference are refreshed together, so an open menu
  // can't keep showing a checkmark the page no longer agrees with.
  useEffect(() => {
    const media = matchMedia(DARK_SCHEME_QUERY);
    const sync = () => {
      const next = readThemePreference();
      setPreference(next);
      applyThemePreference(next);
    };
    // THEME_INIT normally did this pre-paint, but it gives up when storage
    // access throws, which would otherwise leave the page light while this
    // control reported "System".
    sync();
    const onScheme = () => {
      if (readThemePreference() === "system") applyThemePreference("system");
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY || event.key === null) sync();
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

  // A same-tab write fires no storage event, so this tab's copy is set here.
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
        onClick={() => setOpen((value) => !value)}
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
      {/* One element; landing.css picks the asset off html.dark, so only the
          variant in use is ever downloaded (see .bb-mark). */}
      <a className="logo" href="/" aria-label="bb">
        <span className="bb-mark logo-mark" />
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
