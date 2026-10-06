import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import Tick02Icon from "@hugeicons/core-free-icons/Tick02Icon";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  cloneElement,
  Fragment,
  isValidElement,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

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
import figmaLogo from "../assets/company-logos/figma.svg";
import mapboxLogo from "../assets/company-logos/mapbox.svg";
import metaLogo from "../assets/company-logos/meta.svg";
import quoraLogo from "../assets/company-logos/quora.svg";
import compareCss from "./compare.css?url";

const TEAM_COMPANIES = [
  ["Figma", figmaLogo],
  ["Meta", metaLogo],
  ["Quora", quoraLogo],
  ["Mapbox", mapboxLogo],
] as const;

function plainText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(plainText).join("");
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    const text = plainText(node.props.children);
    return node.type === "p" || node.type === "li" ? `${text} ` : text;
  }
  return "";
}

function brandText(text: string): ReactNode {
  const parts = text.split(/\b(bb)\b/);
  if (parts.length === 1) return text;
  return parts.map((part, index) =>
    index % 2 === 1 ? (
      <span key={index} className="cmp-bb">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

function brandProse(node: ReactNode): ReactNode {
  if (typeof node === "string") return brandText(node);
  if (Array.isArray(node)) {
    return node.map((child, index) => (
      <Fragment key={index}>{brandProse(child)}</Fragment>
    ));
  }
  if (
    isValidElement<{ children?: ReactNode }>(node) &&
    (node.type === Fragment ||
      (typeof node.type === "string" && node.type !== "code")) &&
    node.props.children !== undefined
  ) {
    return cloneElement(node, undefined, brandProse(node.props.children));
  }
  return node;
}

function faqJsonLd(comparison: Comparison): string {
  const data = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: comparison.faq.flatMap((group) =>
      group.items.map((item) => ({
        "@type": "Question",
        name: item.question,
        acceptedAnswer: {
          "@type": "Answer",
          text: plainText(item.answer).replace(/\s+/g, " ").trim(),
        },
      })),
    ),
  };
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

export function compareHead(comparison: Comparison) {
  return {
    meta: pageMeta(
      comparison.title,
      comparison.description,
      `/compare/${comparison.slug}`,
    ),
    links: siteHeadLinks(compareCss),
    scripts: [{ type: "application/ld+json", children: faqJsonLd(comparison) }],
  };
}

const MARKS: Record<
  Mark,
  { icon: typeof Tick02Icon | null; label: string; className: string }
> = {
  yes: { icon: Tick02Icon, label: "Yes", className: "cmp-mark cmp-mark-yes" },
  partial: {
    icon: null,
    label: "Partly",
    className: "cmp-mark cmp-mark-partial",
  },
  no: { icon: Cancel01Icon, label: "No", className: "cmp-mark cmp-mark-no" },
};

function Cell({ cell, us }: { cell: CompareCell; us: boolean }) {
  const mark = cell.mark ? MARKS[cell.mark] : null;
  return (
    <td role="cell" className={us ? "cmp-cell cmp-us" : "cmp-cell"}>
      <span className="cmp-cell-main">
        {mark ? (
          <span className={mark.className}>
            {mark.icon ? (
              <HugeiconsIcon icon={mark.icon} aria-hidden="true" />
            ) : (
              <span className="cmp-half" aria-hidden="true" />
            )}
            <span className="cmp-sr">{mark.label}</span>
          </span>
        ) : null}
        {cell.value ? (
          <span className="cmp-cell-value">{cell.value}</span>
        ) : null}
        {cell.pro ? (
          <span className="cmp-pro">
            $ Pro<span className="cmp-sr"> plan only</span>
          </span>
        ) : null}
      </span>
      {cell.text ? <span className="cmp-cell-note">{cell.text}</span> : null}
    </td>
  );
}

function BrandHeader({
  name,
  logo,
  us,
}: {
  name: string;
  logo: BrandLogo;
  us: boolean;
}) {
  return (
    <th
      role="columnheader"
      scope="col"
      className={us ? "cmp-brand cmp-us" : "cmp-brand"}
    >
      <span className="cmp-brand-inner">
        <BrandMark logo={logo} className="cmp-brand-logo" />
        {name}
      </span>
    </th>
  );
}

function useHeaderStuck() {
  const sentinel = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const update = () => {
      const node = sentinel.current;
      if (node) setStuck(node.getBoundingClientRect().top < 0);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);
  return { sentinel, stuck };
}

function CompareTable({ comparison }: { comparison: Comparison }) {
  const [firstGroup] = comparison.table;
  const { sentinel, stuck } = useHeaderStuck();
  return (
    <>
      <div ref={sentinel} className="cmp-table-sentinel" aria-hidden="true" />
      <table
        role="table"
        className={stuck ? "cmp-table cmp-table-stuck" : "cmp-table"}
        aria-labelledby="cmp-table-title"
      >
        <thead role="rowgroup">
          <tr role="row">
            <th role="columnheader" scope="col" className="cmp-corner">
              {firstGroup?.title}
            </th>
            <BrandHeader name="bb" logo={{ kind: "bb" }} us />
            <BrandHeader
              name={comparison.competitor.name}
              logo={comparison.competitor.logo}
              us={false}
            />
          </tr>
        </thead>
        {comparison.table.map((group) => (
          <tbody role="rowgroup" key={group.title}>
            <tr
              role="row"
              className={
                group === firstGroup ? "cmp-group cmp-group-first" : "cmp-group"
              }
            >
              <th role="rowheader" scope="rowgroup">
                {group.title}
              </th>
              <td className="cmp-group-fill cmp-us" aria-hidden="true" />
              <td className="cmp-group-fill" aria-hidden="true" />
            </tr>
            {group.rows.map((row) => (
              <tr role="row" key={row.feature}>
                <th role="rowheader" scope="row" className="cmp-feature">
                  {row.feature}
                </th>
                <Cell cell={row.bb} us />
                <Cell cell={row.competitor} us={false} />
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </>
  );
}

export function ComparePage({ comparison }: { comparison: Comparison }) {
  useInitAnalytics();
  useScrollReveal();
  const { competitor } = comparison;

  return (
    <div className="wrap cmp-page">
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
        <h1>{brandProse(comparison.headline)}</h1>
        <p className="sub">{brandProse(comparison.sub)}</p>
        <InstallOptions placement="hero" />
        {comparison.heroVisual ? (
          <div className="cmp-hero-visual">{comparison.heroVisual}</div>
        ) : null}
      </header>

      {[comparison.tailored, ...comparison.sections].map((highlight) =>
        highlight.wide ? (
          <section
            key={highlight.title}
            className="band cmp-wide-band"
            data-reveal
          >
            <div className="cmp-wide-copy">
              <h2>{brandProse(highlight.title)}</h2>
              {brandProse(highlight.body)}
            </div>
            {highlight.visual}
          </section>
        ) : (
          <Band
            key={highlight.title}
            title={brandProse(highlight.title)}
            visual={highlight.visual}
          >
            {brandProse(highlight.body)}
          </Band>
        ),
      )}

      <section className="cmp-section" data-reveal>
        <h2 id="cmp-table-title" className="sec-title cmp-table-title">
          <BrandMark logo={{ kind: "bb" }} className="cmp-table-title-logo" />
          bb
          <span className="cmp-table-title-vs">vs</span>
          <BrandMark logo={competitor.logo} className="cmp-table-title-logo" />
          {competitor.name}
        </h2>
        <p className="cmp-table-sub">Feature by feature</p>
        {comparison.tableNote ? (
          <p className="cmp-table-note">
            <span className="cmp-pro">$ Pro</span> {comparison.tableNote}
          </p>
        ) : null}
        <CompareTable comparison={comparison} />
      </section>

      <section className="cmp-section cmp-faq" data-reveal>
        <h2 className="sec-title">{comparison.faqTitle}</h2>
        {comparison.faq.map((group) => (
          <div key={group.title} className="cmp-faq-group">
            <h3 className="cmp-faq-group-title">{group.title}</h3>
            <div className="cmp-faq-list">
              {group.items.map((item) => (
                <details key={item.question} className="cmp-faq-item">
                  <summary>
                    <span>{brandProse(item.question)}</span>
                    <HugeiconsIcon
                      icon={ArrowDown01Icon}
                      className="cmp-faq-chevron"
                      aria-hidden="true"
                    />
                  </summary>
                  <div className="cmp-faq-answer">
                    {brandProse(item.answer)}
                  </div>
                </details>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="closer" data-reveal>
        <h2 className="sec-title">{brandProse(comparison.closer.title)}</h2>
        <p>{brandProse(comparison.closer.body)}</p>
        <InstallOptions placement="closer" />
        <div className="cmp-team">
          <h3>Built by alumni from</h3>
          <ul className="company-proof-logos cmp-team-logos">
            {TEAM_COMPANIES.map(([name, logo]) => (
              <li key={name} className="company-proof-company">
                <img src={logo} alt="" width={20} height={20} />
                {name}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
