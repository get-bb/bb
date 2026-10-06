import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon";
import GithubIcon from "@hugeicons/core-free-icons/GithubIcon";
import NewTwitterIcon from "@hugeicons/core-free-icons/NewTwitterIcon";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, type ReactNode } from "react";

import { DASHBOARD_PATH } from "../lib/connect-return-to";
import { COMPARE_LINKS, type ContentLink } from "./content-links";
import {
  DesktopDownloadButton,
  DiscordLink,
  DownloadLink,
  GitHubLink,
  XLink,
} from "./cta";
import { useDesktopPlatform } from "./desktop-platform";

type SiteNavPage = "blog" | "changelog" | "plugins" | "plugin-guide";

function PluginsMenu({ current }: { current?: SiteNavPage }) {
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !menu.current?.contains(event.target)
      ) {
        menu.current?.removeAttribute("open");
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && menu.current?.open) {
        menu.current.removeAttribute("open");
        menu.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);
  const inSection = current === "plugins" || current === "plugin-guide";
  return (
    <details
      className="nav-menu"
      ref={menu}
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
          Building plugins
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
        <DesktopDownloadButton
          placement="nav"
          platform={platform}
          className="btn btn-primary btn-sm nav-download"
        />
      </div>
    </nav>
  );
}

function FooterColumn({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="footer-column">
      <h2 className="footer-title">{title}</h2>
      <ul>{children}</ul>
    </div>
  );
}

function FooterLinks({
  links,
  current,
}: {
  links: ContentLink[];
  current: string | undefined;
}) {
  return links.map((link) => (
    <li key={link.href}>
      <a
        href={link.href}
        aria-current={link.href === current ? "page" : undefined}
      >
        {link.label}
      </a>
    </li>
  ));
}

export function SiteFooter({ current }: { current?: string }) {
  const platform = useDesktopPlatform();
  return (
    <footer className="footer">
      <div className="footer-brand">
        <span className="bb-mark footer-mark" aria-hidden="true" />
        <p className="footer-legal">
          <a href="/privacy">Privacy</a>
        </p>
      </div>
      <FooterColumn title="Product">
        <li>
          <DownloadLink placement="footer" platform={platform}>
            Download
          </DownloadLink>
        </li>
        <li>
          <a href="/marketplace">Plugins</a>
        </li>
        <li>
          <a
            href="/plugin-guide"
            aria-current={current === "/plugin-guide" ? "page" : undefined}
          >
            Building plugins
          </a>
        </li>
        <li>
          <a href="/changelog">Changelog</a>
        </li>
        <li>
          <a href={DASHBOARD_PATH}>Sign in</a>
        </li>
      </FooterColumn>
      <FooterColumn title="Compare">
        <FooterLinks links={COMPARE_LINKS} current={current} />
      </FooterColumn>
      <FooterColumn title="Community">
        <li>
          <a href="/blog">Blog</a>
        </li>
        <li>
          <GitHubLink placement="footer">GitHub</GitHubLink>
        </li>
        <li>
          <DiscordLink placement="footer">Discord</DiscordLink>
        </li>
        <li>
          <XLink placement="footer" aria-label="X">
            <HugeiconsIcon
              icon={NewTwitterIcon}
              className="footer-x"
              aria-hidden="true"
            />
          </XLink>
        </li>
      </FooterColumn>
    </footer>
  );
}
