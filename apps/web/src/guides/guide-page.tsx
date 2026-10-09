import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon";
import Copy01Icon from "@hugeicons/core-free-icons/Copy01Icon";
import Tick02Icon from "@hugeicons/core-free-icons/Tick02Icon";
import { HugeiconsIcon } from "@hugeicons/react";
import { notFound, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import blogCss from "../blog/blog.css?url";
import compareCss from "../compare/compare.css?url";
import { trackLandingEvent, useInitAnalytics } from "../landing/analytics";
import { DesktopDownloadButton } from "../landing/cta";
import { useDesktopPlatform } from "../landing/desktop-platform";
import { InstallOptions } from "../landing/landing-visuals";
import { pageMeta, siteHeadLinks } from "../landing/page-head";
import { brandProse, faqJsonLd } from "../compare/compare-page";
import { canonicalPath } from "../landing/content-links";
import { SiteFooter, SiteNav } from "../landing/site-chrome";
import {
  CopyToast,
  GuidePromptContext,
  ProductShot,
  PROMPT_COPIED,
  useCopy,
} from "./guide-blocks";
import type { Guide, GuideFaq, GuidePicker, GuideStep } from "./guide-types";
import { getGuide } from "./guides";
import guidesCss from "./guides.css?url";

export function loadGuide(slug: string, variant: string | null) {
  const guide = getGuide(slug, variant);
  if (!guide) {
    throw notFound();
  }
  return { slug, variant: guide.picker ? guide.picker.selected : null };
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
    links: [
      {
        rel: "canonical",
        href: `https://getbb.app${canonicalPath(`/guides/${guide.slug}`)}`,
      },
      ...siteHeadLinks(blogCss, compareCss, guidesCss),
    ],
    scripts: [
      {
        type: "application/ld+json",
        children: faqJsonLd([
          { title: "", items: [...guide.troubleshooting, ...guide.faq] },
        ]),
      },
    ],
  };
}

function CopyForAgent({
  prompt,
  label,
  className,
  guide,
  placement,
}: {
  prompt: string;
  label: string;
  className: string;
  guide: string;
  placement: "hero" | "handoff";
}) {
  const { copied, copy } = useCopy(prompt, PROMPT_COPIED);
  return (
    <button
      type="button"
      className={`btn gd-copy ${className}`}
      onClick={() => {
        copy();
        trackLandingEvent({
          name: "guide_prompt_copied",
          properties: { guide, placement },
        });
      }}
    >
      <HugeiconsIcon
        icon={copied ? Tick02Icon : Copy01Icon}
        className="gd-ic"
      />
      {copied ? "Copied" : label}
    </button>
  );
}

function GuidePickerField({
  picker,
  slug,
}: {
  picker: GuidePicker;
  slug: string;
}) {
  const navigate = useNavigate();
  const selectedLabel =
    picker.options.find((option) => option.id === picker.selected)?.label ??
    picker.placeholder;
  return (
    <label className="gd-picker">
      <span>{picker.label}</span>
      <span className="gd-picker-control">
        <span className="gd-picker-size" aria-hidden="true">
          {selectedLabel}
        </span>
        <select
          value={picker.selected ?? ""}
          onChange={(event) => {
            const value = event.target.value;
            void navigate({
              to: "/guides/$slug",
              params: { slug },
              search: value ? { from: value } : {},
              replace: true,
              resetScroll: false,
            });
          }}
        >
          {picker.selected !== null ? null : (
            <option value="" disabled hidden>
              {picker.placeholder}
            </option>
          )}
          {picker.options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          className="gd-picker-chev"
          aria-hidden="true"
        />
      </span>
    </label>
  );
}

function GuideHero({ guide }: { guide: Guide }) {
  const platform = useDesktopPlatform();
  return (
    <header className="hero cmp-hero gd-hero">
      <h1>{brandProse(guide.title)}</h1>
      <p className="sub">{brandProse(guide.description)}</p>
      {guide.picker ? (
        <div className="gd-pick">
          <GuidePickerField picker={guide.picker} slug={guide.slug} />
          {guide.concept}
        </div>
      ) : null}
      <div className="gd-hero-actions">
        <CopyForAgent
          prompt={guide.agentPrompt}
          label="Copy for agent"
          className="btn-primary"
          guide={guide.slug}
          placement="hero"
        />
        <DesktopDownloadButton
          placement="hero"
          platform={platform}
          className="btn btn-ghost"
        />
      </div>
      {guide.requirement ? (
        <p className="gd-requirement">
          You'll need {brandProse(guide.requirement)}.
        </p>
      ) : null}
      {guide.picker ? null : guide.concept}
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
        <div className="gd-handoff-title">Hand this to your agent</div>
        <CopyForAgent
          prompt={guide.agentPrompt}
          label="Copy"
          className="btn-primary btn-sm"
          guide={guide.slug}
          placement="handoff"
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
      <ProductShot shot={step.shot} />
      {step.options.map((option) => (
        <div key={option.title} className="gd-option">
          <h3 className="gd-h3">{brandProse(option.title)}</h3>
          {brandProse(option.body)}
          <ProductShot shot={option.shot} />
        </div>
      ))}
    </section>
  );
}

function FaqList({ items }: { items: GuideFaq[] }) {
  return (
    <div className="cmp-faq-list">
      {items.map((item) => (
        <details key={item.question} className="cmp-faq-item">
          <summary>
            <span>{brandProse(item.question)}</span>
            <HugeiconsIcon
              icon={ArrowDown01Icon}
              className="cmp-faq-chevron"
              aria-hidden="true"
            />
          </summary>
          <div className="cmp-faq-answer">{brandProse(item.answer)}</div>
        </details>
      ))}
    </div>
  );
}

export function GuidePage({ guide }: { guide: Guide }) {
  useInitAnalytics();

  return (
    <GuidePromptContext.Provider
      value={{ guide: guide.slug, prompt: guide.agentPrompt }}
    >
      <CopyToast>
        <div className="wrap cmp-page gd-page">
          <SiteNav current="guides" path={`/guides/${guide.slug}`} />

          <GuideHero guide={guide} />

          <section className="gd-plan">
            {guide.steps.length > 0 ? (
              <div className="gd-plan-grid">
                <AgentHandoff guide={guide} />
                <div>
                  <h2 className="gd-h2">Steps</h2>
                  <StepOverview steps={guide.steps} />
                </div>
              </div>
            ) : (
              <div className="gd-plan-solo">
                <AgentHandoff guide={guide} />
              </div>
            )}
          </section>

          <div className="gd-main">
            {guide.steps.map((step, index) => (
              <StepSection key={step.id} step={step} number={index + 1} />
            ))}

            <section id="troubleshooting">
              <h2 className="gd-h2">Troubleshooting</h2>
              <FaqList items={guide.troubleshooting} />
            </section>

            {guide.faq.length > 0 ? (
              <section id="faq">
                <h2 className="gd-h2">FAQ</h2>
                <FaqList items={guide.faq} />
              </section>
            ) : null}
          </div>

          <section className="closer">
            <h2 className="sec-title">{brandProse(guide.closer.title)}</h2>
            <p>{brandProse(guide.closer.body)}</p>
            <InstallOptions placement="closer" />
          </section>

          <SiteFooter current={`/guides/${guide.slug}`} />
        </div>
      </CopyToast>
    </GuidePromptContext.Provider>
  );
}
