import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon";
import GithubIcon from "@hugeicons/core-free-icons/GithubIcon";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef } from "react";

import { DASHBOARD_PATH } from "../lib/connect-return-to";
import { DiscordLink, DownloadLink, GitHubLink, XLink } from "./cta";
import { useDesktopPlatform } from "./desktop-platform";
import { DESKTOP_DOWNLOADS } from "./site";

type SiteNavPage = "blog" | "changelog" | "plugins" | "plugin-guide";

function PluginsMenu({ current }: { current?: SiteNavPage }) {
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !menu.current?.contains(event.target)) {
        menu.current?.removeAttribute("open");
      }
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);
  const inSection = current === "plugins" || current === "plugin-guide";
  return (
    <details
      className="nav-menu"
      ref={menu}
      onKeyDown={(event) => {
        if (event.key === "Escape" && event.currentTarget.open) {
          event.currentTarget.removeAttribute("open");
          event.currentTarget.querySelector("summary")?.focus();
        }
      }}
      onBlur={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          !event.currentTarget.contains(event.relatedTarget)
        ) {
          event.currentTarget.removeAttribute("open");
        }
      }}
    >
      <summary className={inSection ? "nav-current" : undefined}>
        Plugins
        <HugeiconsIcon icon={ArrowDown01Icon} aria-hidden />
      </summary>
      <div className="nav-menu-panel">
        <a
          href="/marketplace"
          aria-current={current === "plugins" ? "page" : undefined}
        >
          Marketplace
        </a>
        <a
          href="/plugin-guide"
          aria-current={current === "plugin-guide" ? "page" : undefined}
        >
          Plugin Guide
        </a>
      </div>
    </details>
  );
}

export function SiteNav({ current }: { current?: SiteNavPage }) {
  const platform = useDesktopPlatform();
  return (
    <nav className="nav">
      {}
      <a className="logo" href="/" aria-label="bb">
        <span className="bb-mark logo-mark" />
      </a>
      <div className="nav-links">
        <PluginsMenu current={current} />
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
        <a href={DASHBOARD_PATH}>Sign in</a>
        <GitHubLink
          placement="nav"
          className="nav-icon-button"
          aria-label="GitHub"
        >
          <HugeiconsIcon icon={GithubIcon} />
        </GitHubLink>
        <DownloadLink
          placement="nav"
          platform={platform}
          className="btn btn-primary btn-sm"
        >
          {DESKTOP_DOWNLOADS[platform].buttonLabel}
        </DownloadLink>
      </div>
    </nav>
  );
}

export function SiteFooter() {
  const platform = useDesktopPlatform();
  return (
    <footer className="footer">
      <span>bb is free and open source (MIT)</span>
      <span>
        <a href="/blog">Blog</a>
        {" · "}
        <a href="/changelog">Changelog</a>
        {" · "}
        <a href="/plugin-guide">Plugin Guide</a>
        {" · "}
        <a href="/privacy">Privacy</a>
        {" · "}
        <GitHubLink placement="footer">GitHub</GitHubLink>
        {" · "}
        <XLink placement="footer">X</XLink>
        {" · "}
        <DiscordLink placement="footer">Discord</DiscordLink>
        {" · "}
        <DownloadLink placement="footer" platform={platform}>
          Download
        </DownloadLink>
      </span>
    </footer>
  );
}
