import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon";
import Copy01Icon from "@hugeicons/core-free-icons/Copy01Icon";
import Tick02Icon from "@hugeicons/core-free-icons/Tick02Icon";
import { HugeiconsIcon } from "@hugeicons/react";
import { notFound } from "@tanstack/react-router";
import { useState } from "react";

import blogCss from "../blog/blog.css?url";
import compareCss from "../compare/compare.css?url";
import { useInitAnalytics } from "../landing/analytics";
import { InstallOptions } from "../landing/landing-visuals";
import { pageMeta, siteHeadLinks } from "../landing/page-head";
import { brandProse, faqJsonLd } from "../landing/prose";
import { SiteFooter, SiteNav } from "../landing/site-chrome";
import { CopyToast, DoneWhen, PROMPT_COPIED, useCopy } from "./guide-blocks";
import type { Guide, GuideStep } from "./guide-types";
import { getGuide } from "./guides";
import guidesCss from "./guides.css?url";

export function loadGuide(slug: string) {
  const guide = getGuide(slug);
  if (!guide) {
    throw notFound();
  }
  return { slug };
}

export function guideHead(guide: Guide | undefined) {
  if (!guide) {
    return { meta: [{ title: "bb" }] };
  }
  return {
    meta: pageMeta(
      `${guide.title} — bb`,
      guide.description,
      `/guides/${guide.slug}`,
    ),
    links: siteHeadLinks(blogCss, compareCss, guidesCss),
    scripts: [{ type: "application/ld+json", children: faqJsonLd(guide.faq) }],
  };
}

function CopyForAgent({
  prompt,
  label,
  className,
}: {
  prompt: string;
  label: string;
  className: string;
}) {
  const { copied, copy } = useCopy(prompt, PROMPT_COPIED);
  return (
    <button type="button" className={`btn gd-copy ${className}`} onClick={copy}>
      <HugeiconsIcon
        icon={copied ? Tick02Icon : Copy01Icon}
        className="gd-ic"
      />
      {copied ? "Copied" : label}
    </button>
  );
}

function GuideHero({ guide, firstId }: { guide: Guide; firstId: string }) {
  return (
    <header className="hero cmp-hero gd-hero">
      <h1>{brandProse(guide.title)}</h1>
      <p className="sub">{brandProse(guide.description)}</p>
      <div className="gd-hero-actions">
        <CopyForAgent
          prompt={guide.agentPrompt}
          label="Copy for agent"
          className="btn-primary"
        />
        <a className="btn btn-ghost" href={`#${firstId}`}>
          See the steps
        </a>
      </div>
      {guide.concept}
    </header>
  );
}

function StepOverview({ steps }: { steps: GuideStep[] }) {
  return (
    <ol className="gd-overview">
      {steps.map((step, index) => (
        <li key={step.id}>
          <a href={`#${step.id}`}>
            <span className="gd-num">{index + 1}</span>
            <span className="gd-overview-label">{step.title}</span>
          </a>
        </li>
      ))}
    </ol>
  );
}

function AgentHandoff({ guide }: { guide: Guide }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="gd-card gd-handoff" id="handoff">
      <div className="gd-handoff-head">
        <div>
          <div className="gd-handoff-title">Hand this to your agent</div>
          <p className="gd-handoff-sub">{brandProse(guide.handoffNote)}</p>
        </div>
        <CopyForAgent
          prompt={guide.agentPrompt}
          label="Copy"
          className="btn-primary btn-sm"
        />
      </div>
      <div className={open ? "gd-prompt open" : "gd-prompt"}>
        <pre>{guide.agentPrompt}</pre>
      </div>
      <div className="gd-handoff-foot">
        <button
          type="button"
          className="gd-textbtn"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Show less" : "Show full prompt"}
        </button>
      </div>
    </div>
  );
}

function StepSection({ step, number }: { step: GuideStep; number: number }) {
  return (
    <section id={step.id}>
      <div className="gd-step-head">
        <span className="gd-num">{number}</span>
        <h2>{step.title}</h2>
      </div>
      <p className="gd-lead">{brandProse(step.lead)}</p>
      {brandProse(step.body)}
      <DoneWhen>{brandProse(step.doneWhen)}</DoneWhen>
    </section>
  );
}

export function GuidePage({ guide }: { guide: Guide }) {
  useInitAnalytics();
  const firstId = guide.needs.length > 0 ? "before" : guide.steps[0].id;

  return (
    <CopyToast>
      <div className="wrap cmp-page gd-page">
        <SiteNav current="guides" path={`/guides/${guide.slug}`} />

        <GuideHero guide={guide} firstId={firstId} />

        <section className="gd-plan">
          <div className="gd-plan-grid">
            <div>
              <h2 className="gd-h2">The short version</h2>
              <StepOverview steps={guide.steps} />
            </div>
            <AgentHandoff guide={guide} />
          </div>
        </section>

        <div className="gd-main">
          {guide.needs.length > 0 ? (
            <section id="before">
              <h2 className="gd-h2">Before you start</h2>
              <div className="gd-needs">
                {guide.needs.map((need) => (
                  <div key={need.title} className="gd-need">
                    <div className="gd-need-title">
                      <HugeiconsIcon icon={need.icon} className="gd-ic" />
                      <span>{brandProse(need.title)}</span>
                    </div>
                    <p>{brandProse(need.body)}</p>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {guide.steps.map((step, index) => (
            <StepSection key={step.id} step={step} number={index + 1} />
          ))}

          {guide.sections.map((section) => (
            <section key={section.id} id={section.id}>
              <h2 className="gd-h2">{brandProse(section.title)}</h2>
              {brandProse(section.body)}
            </section>
          ))}

          <section id="faq">
            <h2 className="gd-h2">{guide.faqTitle}</h2>
            <div className="cmp-faq-list">
              {guide.faq.map((item) => (
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
          </section>
        </div>

        <section className="closer">
          <h2 className="sec-title">{brandProse(guide.closer.title)}</h2>
          <p>{brandProse(guide.closer.body)}</p>
          <InstallOptions placement="closer" />
        </section>

        <SiteFooter current={`/guides/${guide.slug}`} />
      </div>
    </CopyToast>
  );
}
