import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon";
import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import MinusSignIcon from "@hugeicons/core-free-icons/MinusSignIcon";
import Tick02Icon from "@hugeicons/core-free-icons/Tick02Icon";
import { HugeiconsIcon } from "@hugeicons/react";

import { useInitAnalytics } from "../landing/analytics";
import {
  Band,
  InstallOptions,
  useScrollReveal,
} from "../landing/landing-visuals";
import { pageMeta, siteHeadLinks } from "../landing/page-head";
import { SiteFooter, SiteNav } from "../landing/site-chrome";
import type { CompareCell, Comparison, Mark } from "./comparisons";
import { BrandMark, type BrandLogo } from "./compare-visuals";
import compareCss from "./compare.css?url";

export function compareHead(comparison: Comparison) {
  return {
    meta: pageMeta(
      `${comparison.title} — bb`,
      comparison.description,
      `/compare/${comparison.slug}`,
    ),
    links: siteHeadLinks(compareCss),
  };
}

const MARKS: Record<
  Mark,
  { icon: typeof Tick02Icon; label: string; className: string }
> = {
  yes: { icon: Tick02Icon, label: "Yes", className: "cmp-mark cmp-mark-yes" },
  partial: {
    icon: MinusSignIcon,
    label: "Partly",
    className: "cmp-mark cmp-mark-partial",
  },
  no: { icon: Cancel01Icon, label: "No", className: "cmp-mark cmp-mark-no" },
};

function Cell({ cell }: { cell: CompareCell }) {
  const mark = cell.mark ? MARKS[cell.mark] : null;
  return (
    <td className={mark ? "cmp-cell" : "cmp-cell cmp-cell-text"}>
      <span className="cmp-cell-inner">
        {mark ? (
          <span className={mark.className}>
            <HugeiconsIcon icon={mark.icon} aria-hidden="true" />
            <span className="cmp-sr">{mark.label}</span>
          </span>
        ) : null}
        {cell.text || cell.pro ? (
          <span className="cmp-cell-note">
            {cell.text}
            {cell.pro ? <span className="cmp-pro">Pro</span> : null}
          </span>
        ) : null}
      </span>
    </td>
  );
}

function BrandHeader({ name, logo }: { name: string; logo: BrandLogo }) {
  return (
    <th scope="col" className="cmp-brand">
      <span className="cmp-brand-inner">
        <BrandMark logo={logo} className="cmp-brand-logo" />
        {name}
      </span>
    </th>
  );
}

function CompareTable({ comparison }: { comparison: Comparison }) {
  return (
    <table className="cmp-table">
      <thead>
        <tr>
          <td className="cmp-corner" />
          <BrandHeader name="bb" logo={{ kind: "bb" }} />
          <BrandHeader
            name={comparison.competitor.name}
            logo={comparison.competitor.logo}
          />
        </tr>
      </thead>
      {comparison.table.map((group) => (
        <tbody key={group.title}>
          <tr className="cmp-group">
            <th scope="colgroup" colSpan={3}>
              {group.title}
            </th>
          </tr>
          {group.rows.map((row) => (
            <tr key={row.feature}>
              <th scope="row" className="cmp-feature">
                {row.feature}
              </th>
              <Cell cell={row.bb} />
              <Cell cell={row.competitor} />
            </tr>
          ))}
        </tbody>
      ))}
    </table>
  );
}

export function ComparePage({ comparison }: { comparison: Comparison }) {
  useInitAnalytics();
  useScrollReveal();
  const { competitor } = comparison;

  return (
    <div className="wrap">
      <SiteNav />

      <header className="hero cmp-hero">
        <div className="cmp-logos">
          <span className="cmp-logo-item">
            <BrandMark logo={{ kind: "bb" }} className="cmp-logo" />
            bb
          </span>
          <span className="cmp-vs">vs</span>
          <span className="cmp-logo-item">
            <BrandMark logo={competitor.logo} className="cmp-logo" />
            {competitor.name}
          </span>
        </div>
        <h1>{comparison.headline}</h1>
        <p className="sub">{comparison.sub}</p>
        <InstallOptions placement="hero" />
        <a className="cmp-switch" href={comparison.switchGuide.href}>
          {comparison.switchGuide.label}
          <HugeiconsIcon icon={ArrowRight01Icon} className="cmp-switch-arrow" />
        </a>
      </header>

      {comparison.highlights.map((highlight, index) => (
        <Band
          key={highlight.title}
          title={highlight.title}
          flip={index % 2 === 1}
          visual={highlight.visual}
        >
          {highlight.body}
        </Band>
      ))}

      <section className="cmp-section" data-reveal>
        <h2 className="sec-title">{comparison.tableTitle}</h2>
        <CompareTable comparison={comparison} />
      </section>

      <section className="cmp-section cmp-faq" data-reveal>
        <h2 className="sec-title">Frequently asked questions</h2>
        <div className="cmp-faq-list">
          {comparison.faq.map((item) => (
            <details key={item.question} className="cmp-faq-item">
              <summary>
                {item.question}
                <HugeiconsIcon
                  icon={ArrowDown01Icon}
                  className="cmp-faq-chevron"
                  aria-hidden="true"
                />
              </summary>
              <div className="cmp-faq-answer">{item.answer}</div>
            </details>
          ))}
        </div>
      </section>

      <section className="closer" data-reveal>
        <h2 className="sec-title">Put your agents to work.</h2>
        <p>Free, open source, and local-first. Install in under a minute.</p>
        <InstallOptions placement="closer" />
      </section>

      <SiteFooter />
    </div>
  );
}
