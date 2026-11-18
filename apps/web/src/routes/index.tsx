import PauseIcon from "@hugeicons/core-free-icons/PauseIcon";
import PlayIcon from "@hugeicons/core-free-icons/PlayIcon";
import { HugeiconsIcon } from "@hugeicons/react";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { observeSharedResize } from "@bb/shared-ui/lib/shared-resize-observer";
import type { CSSProperties } from "react";

import changelogMd from "../../../../CHANGELOG.md?raw";
import { RELEASE_META } from "../../../../changelog-metadata";
import { useInitAnalytics } from "../landing/analytics";
import { useSectionViews } from "../landing/section-views";
import adobeLogo from "../assets/company-logos/adobe.svg";
import atlassianLogo from "../assets/company-logos/atlassian.svg";
import blackstoneLogo from "../assets/company-logos/blackstone.png";
import browserbaseLogo from "../assets/company-logos/browserbase.png";
import bytedanceLogo from "../assets/company-logos/bytedance.svg";
import customerIoLogo from "../assets/company-logos/customer-io.png";
import datadogLogo from "../assets/company-logos/datadog.svg";
import figmaLogo from "../assets/company-logos/figma.svg";
import gustoLogo from "../assets/company-logos/gusto.png";
import hubspotLogo from "../assets/company-logos/hubspot.svg";
import jetbrainsLogo from "../assets/company-logos/jetbrains.svg";
import justEatTakeawayLogo from "../assets/company-logos/just-eat-takeaway.svg";
import kernelLogo from "../assets/company-logos/kernel.png";
import linearLogo from "../assets/company-logos/linear.svg";
import metaLogo from "../assets/company-logos/meta.svg";
import microsoftLogo from "../assets/company-logos/microsoft.svg";
import moodysLogo from "../assets/company-logos/moodys.png";
import notionLogo from "../assets/company-logos/notion.png";
import oracleLogo from "../assets/company-logos/oracle.svg";
import ownerLogo from "../assets/company-logos/owner.png";
import pendoLogo from "../assets/company-logos/pendo.svg";
import renderLogo from "../assets/company-logos/render.svg";
import shopifyLogo from "../assets/company-logos/shopify.svg";
import shortcutLogo from "../assets/company-logos/shortcut.svg";
import simileLogo from "../assets/company-logos/simile.svg";
import statsigLogo from "../assets/company-logos/statsig.svg";
import stitchFixLogo from "../assets/company-logos/stitch-fix.png";
import tencentLogo from "../assets/company-logos/tencent.png";
import vercelLogo from "../assets/company-logos/vercel.svg";
import zooxLogo from "../assets/company-logos/zoox.png";
import { parseChangelog } from "../../../../changelog-parser";
import { ChevronRight } from "../landing/app-mock-parts";
import { MarketplaceLink, SubscribeSection } from "../landing/cta";
import { HeroWindowSlot } from "../landing/hero-window";
import heroWindowCss from "../landing/hero-window.css?url";
import { siteHeadLinks } from "../landing/page-head";
import { Testimonials } from "../landing/testimonials";
import { SiteFooter, SiteNav } from "../landing/site-chrome";
import {
  AgentRow,
  Band,
  InstallOptions,
  DelegationTree,
  PluginMorph,
  StartAnywhere,
  useScrollReveal,
} from "../landing/landing-visuals";
import {
  DISCORD_URL,
  GITHUB_URL,
  OG_DESCRIPTION,
  SITE_DESCRIPTION,
  X_URL,
  unfurlMeta,
} from "../landing/site";

const COMPANY_PROOF = [
  ["Meta", metaLogo, "glyph"],
  ["Microsoft", microsoftLogo, "glyph"],
  ["Figma", figmaLogo, "glyph"],
  ["Notion", notionLogo, "tile"],
  ["Vercel", vercelLogo, "glyph"],
  ["Shopify", shopifyLogo, "glyph"],
  ["Adobe", adobeLogo, "glyph"],
  ["Linear", linearLogo, "glyph"],
  ["Datadog", datadogLogo, "glyph"],
  ["HubSpot", hubspotLogo, "glyph"],
  ["Atlassian", atlassianLogo, "glyph"],
  ["JetBrains", jetbrainsLogo, "glyph"],
  ["Owner.com", ownerLogo, "tile"],
  ["Pendo", pendoLogo, "glyph"],
  ["ByteDance", bytedanceLogo, "glyph"],
  ["Blackstone", blackstoneLogo, "tile"],
  ["Moody's", moodysLogo, "tile"],
  ["Shortcut", shortcutLogo, "tile"],
  ["Oracle", oracleLogo, "glyph"],
  ["Render", renderLogo, "glyph"],
  ["Tencent", tencentLogo, "glyph"],
  ["Gusto", gustoLogo, "tile"],
  ["Simile", simileLogo, "glyph"],
  ["Browserbase", browserbaseLogo, "tile"],
  ["Kernel", kernelLogo, "tile"],
  ["Customer.io", customerIoLogo, "tile"],
  ["Statsig", statsigLogo, "glyph"],
  ["Zoox", zooxLogo, "tile"],
  ["Stitch Fix", stitchFixLogo, "glyph"],
  ["Just Eat Takeaway", justEatTakeawayLogo, "glyph"],
] as const;

type CompanyProofEntry = (typeof COMPANY_PROOF)[number];

const COMPANY_PROOF_ROWS = [
  COMPANY_PROOF.filter((_, index) => index % 2 === 0),
  COMPANY_PROOF.filter((_, index) => index % 2 === 1),
];

function CompanyProofLogos({
  companies,
  duplicate = false,
}: {
  companies: readonly CompanyProofEntry[];
  duplicate?: boolean;
}) {
  return (
    <ul className="company-proof-logos" aria-hidden={duplicate || undefined}>
      {companies.map(([name, logo, kind]) => (
        <li key={name} className="company-proof-company">
          <img
            src={logo}
            alt={duplicate ? "" : name}
            width={20}
            height={20}
            className={kind === "tile" ? "company-proof-tile" : undefined}
          />
          <span aria-hidden="true">{name}</span>
        </li>
      ))}
    </ul>
  );
}

function CompanyProofMarquee({
  companies,
  reverse,
}: {
  companies: readonly CompanyProofEntry[];
  reverse: boolean;
}) {
  const [copies, setCopies] = useState(5);
  const marqueeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const marquee = marqueeRef.current;
    const firstCopy = marquee?.querySelector(".company-proof-logos");
    if (!marquee || !firstCopy) return;

    const readCopies = () => {
      const copyWidth = firstCopy.getBoundingClientRect().width;
      if (copyWidth === 0) return null;
      return Math.max(2, Math.ceil(marquee.clientWidth / copyWidth) + 1);
    };
    const applyCopies = (next: number | null) => {
      if (next !== null) setCopies(next);
    };
    applyCopies(readCopies());
    return observeSharedResize([marquee, firstCopy], {
      read: readCopies,
      write: applyCopies,
    });
  }, []);

  return (
    <div className="company-proof-marquee" ref={marqueeRef}>
      <div
        className={`company-proof-track${reverse ? " is-reverse" : ""}`}
        style={
          {
            "--company-proof-copies": copies,
            "--company-proof-logos": companies.length,
          } as CSSProperties
        }
      >
        <CompanyProofLogos companies={companies} />
        {Array.from({ length: copies - 1 }, (_, i) => (
          <CompanyProofLogos key={i} companies={companies} duplicate />
        ))}
      </div>
    </div>
  );
}

const [LATEST_RELEASE] = parseChangelog(changelogMd);
if (!LATEST_RELEASE) {
  throw new Error("CHANGELOG.md must contain at least one release");
}
const LATEST_RELEASE_META = RELEASE_META[LATEST_RELEASE.version];
if (!LATEST_RELEASE_META) {
  throw new Error(
    `Latest release ${LATEST_RELEASE.version} must have presentation metadata`,
  );
}
const LATEST_RELEASE_URL = `/changelog#${LATEST_RELEASE.version.replaceAll(".", "-")}`;

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "bb: agentic IDE · The IDE that builds itself" },
      { name: "description", content: SITE_DESCRIPTION },
      ...unfurlMeta("bb", OG_DESCRIPTION, "/"),
    ],
    links: siteHeadLinks(heroWindowCss),
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "Organization",
              "@id": "https://getbb.app/#organization",
              name: "bb",
              url: "https://getbb.app/",
              logo: "https://getbb.app/brand/bb-logo-flat-black.png",
              sameAs: [GITHUB_URL, X_URL, DISCORD_URL],
            },
            {
              "@type": "SoftwareApplication",
              "@id": "https://getbb.app/#software",
              name: "bb",
              url: "https://getbb.app/",
              description: SITE_DESCRIPTION,
              applicationCategory: "DeveloperApplication",
              operatingSystem: ["macOS", "Windows", "Linux"],
              isAccessibleForFree: true,
              offers: { "@type": "Offer", price: 0, priceCurrency: "USD" },
              publisher: { "@id": "https://getbb.app/#organization" },
              sameAs: [GITHUB_URL, X_URL, DISCORD_URL],
            },
          ],
        }).replace(/</g, "\\u003c"),
      },
    ],
  }),
  component: LandingRoute,
});

function LandingRoute() {
  useInitAnalytics();
  return <LandingPage />;
}

function Closer({ title, lede }: { title: string; lede: string }) {
  return (
    <section className="closer" data-reveal data-section="closer">
      <h2 className="sec-title">{title}</h2>
      <p>{lede}</p>
      <InstallOptions placement="closer" />
    </section>
  );
}

function BelowFold() {
  return (
    <>
      <Band
        title="Make bb yours. No need to fork."
        stacked
        section="make-it-yours"
        visual={<PluginMorph />}
      >
        <p>
          bb adapts to how you work, not the other way around. Prompt an agent
          to change almost anything in bb, or choose from 500+ plugins built by
          the community.
        </p>
        <MarketplaceLink placement="customize" className="band-link">
          Browse plugins &rarr;
        </MarketplaceLink>
      </Band>

      <Band
        title="Stop babysitting agents."
        stacked
        section="hand-off"
        visual={<DelegationTree />}
      >
        <p>
          Have Claude Code plan, Cursor implement, Codex review, and Grok
          orchestrate them all. Step in anytime, and only hear about what needs
          you.
        </p>
      </Band>

      <Band
        title="Start from anywhere. Pick up anywhere."
        stacked
        section="start-anywhere"
        visual={<StartAnywhere />}
      >
        <p>
          Start bb from your desk, CI, the bb mobile app, even other AI apps
          like ChatGPT or Claude. Threads run on machines you own, from your
          laptop to a remote server or VM.
        </p>
      </Band>

      <Testimonials />

      <Closer
        title="One programmable workspace for all your agents."
        lede="Free and self-hostable."
      />
    </>
  );
}

function LandingPage() {
  const [companyProofPaused, setCompanyProofPaused] = useState(false);
  const [companyProofInView, setCompanyProofInView] = useState(false);
  const companyProofRef = useRef<HTMLElement>(null);
  useScrollReveal();
  useSectionViews();

  useEffect(() => {
    const companyProof = companyProofRef.current;
    if (!companyProof) return;

    const observer = new IntersectionObserver(([entry]) => {
      setCompanyProofInView(entry?.isIntersecting ?? false);
    });
    observer.observe(companyProof);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="wrap">
      <SiteNav />

      <header className="hero">
        <a className="updates-callout" href={LATEST_RELEASE_URL}>
          <span className="updates-label">New</span>
          <span className="updates-title">{LATEST_RELEASE_META.headline}</span>
          <ChevronRight className="updates-arrow" />
        </a>
        <h1>The IDE that builds itself</h1>
        <p className="sub sub-wide">
          Run all your coding agents in one programmable workspace. Change
          almost anything with a plugin or a prompt.
        </p>

        <InstallOptions placement="hero" />

        <AgentRow />
      </header>

      <HeroWindowSlot />

      <section
        ref={companyProofRef}
        className={`company-proof${companyProofPaused ? " is-paused" : ""}${companyProofInView ? "" : " is-offscreen"}`}
        aria-labelledby="company-proof-title"
        data-section="logos"
      >
        <div className="company-proof-heading">
          <h2 id="company-proof-title">Used by builders at</h2>
          <button
            type="button"
            className="company-proof-toggle"
            aria-label={
              companyProofPaused
                ? "Resume company logos"
                : "Pause company logos"
            }
            onClick={() => setCompanyProofPaused((paused) => !paused)}
          >
            <HugeiconsIcon
              icon={companyProofPaused ? PlayIcon : PauseIcon}
              aria-hidden="true"
            />
          </button>
        </div>
        <div className="company-proof-rows">
          {COMPANY_PROOF_ROWS.map((companies, index) => (
            <CompanyProofMarquee
              key={index}
              companies={companies}
              reverse={index === 1}
            />
          ))}
        </div>
      </section>

      <BelowFold />

      <SubscribeSection
        reveal
        blurb={
          <>Product updates and what we&rsquo;re building next. No spam.</>
        }
      />

      <SiteFooter current="/" />
    </div>
  );
}
