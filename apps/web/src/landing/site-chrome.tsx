import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon";
import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
import GithubIcon from "@hugeicons/core-free-icons/GithubIcon";
import NewTwitterIcon from "@hugeicons/core-free-icons/NewTwitterIcon";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { DASHBOARD_PATH } from "../lib/connect-return-to";
import {
  compareLinks,
  guideFooterLinks,
  guideMenu,
  type ContentLink,
} from "./content-links";
import {
  DesktopDownloadButton,
  DiscordLink,
  DownloadLink,
  GitHubLink,
  XLink,
} from "./cta";
import { useDesktopPlatform } from "./desktop-platform";

type SiteNavPage = "blog" | "changelog" | "plugins" | "plugin-guide" | "guides";

function NavMenu({
  label,
  inSection,
  children,
}: {
  label: string;
  inSection: boolean;
  children: ReactNode;
}) {
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
        {label}
        <HugeiconsIcon icon={ArrowDown01Icon} aria-hidden />
      </summary>
      <div className="nav-menu-panel">{children}</div>
    </details>
  );
}

function PluginsMenu({ current }: { current?: SiteNavPage }) {
  return (
    <NavMenu
      label="Plugins"
      inSection={current === "plugins" || current === "plugin-guide"}
    >
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
    </NavMenu>
  );
}

const INLINE_SUBMENU_QUERY = "(max-width: 760px)";

function opensOnHover(event: ReactPointerEvent<HTMLElement>) {
  return (
    event.pointerType === "mouse" &&
    !window.matchMedia(INLINE_SUBMENU_QUERY).matches
  );
}

function GuidesMenu({
  current,
  path,
}: {
  current?: SiteNavPage;
  path?: string;
}) {
  const [openGroup, setOpenGroup] = useState(
    guideMenu().find(
      (item) =>
        "links" in item && item.links.some((link) => link.href === path),
    )?.label ?? null,
  );
  useEffect(() => {
    if (window.matchMedia(INLINE_SUBMENU_QUERY).matches) {
      setOpenGroup(null);
    }
  }, []);
  return (
    <NavMenu label="Guides" inSection={current === "guides"}>
      {guideMenu().map((group) => {
        if (!("links" in group)) {
          return (
            <a
              key={group.href}
              href={group.href}
              aria-current={path === group.href ? "page" : undefined}
              onPointerEnter={(event) => {
                if (opensOnHover(event)) {
                  setOpenGroup(null);
                }
              }}
            >
              {group.label}
            </a>
          );
        }
        const open = openGroup === group.label;
        return (
          <div
            key={group.label}
            className={open ? "nav-sub open" : "nav-sub"}
            onPointerEnter={(event) => {
              if (opensOnHover(event)) {
                setOpenGroup(group.label);
              }
            }}
          >
            <button
              type="button"
              className="nav-sub-trigger"
              aria-expanded={open}
              onClick={() => setOpenGroup(open ? null : group.label)}
            >
              {group.label}
              <HugeiconsIcon icon={ArrowRight01Icon} aria-hidden />
            </button>
            <div className="nav-sub-panel">
              {group.links.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  aria-current={path === link.href ? "page" : undefined}
                >
                  {link.label}
                </a>
              ))}
            </div>
          </div>
        );
      })}
    </NavMenu>
  );
}

export function SiteNav({
  current,
  path,
}: {
  current?: SiteNavPage;
  path?: string;
}) {
  const platform = useDesktopPlatform();
  return (
    <nav className="nav">
      {}
      <a className="logo" href="/" aria-label="bb">
        <span className="bb-mark logo-mark" />
      </a>
      <div className="nav-links">
        <PluginsMenu current={current} />
        <GuidesMenu current={current} path={path} />
        <a
          className={current === "blog" ? "nav-current" : undefined}
          href="/blog"
        >
          Blog
        </a>
        <a
          className={
            current === "changelog" ? "nav-current nav-wide" : "nav-wide"
          }
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
          <a href="https://github.com/get-bb/bb/blob/main/LICENSE">
            Software License
          </a>
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
      <FooterColumn title="Guides">
        <FooterLinks links={guideFooterLinks()} current={current} />
      </FooterColumn>
      <FooterColumn title="Compare">
        <FooterLinks links={compareLinks()} current={current} />
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
