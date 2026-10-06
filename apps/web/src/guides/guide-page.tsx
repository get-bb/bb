import AiMagicIcon from "@hugeicons/core-free-icons/AiMagicIcon";
import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon";
import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
import Copy01Icon from "@hugeicons/core-free-icons/Copy01Icon";
import Tick02Icon from "@hugeicons/core-free-icons/Tick02Icon";
import UserIcon from "@hugeicons/core-free-icons/UserIcon";
import { HugeiconsIcon } from "@hugeicons/react";
import { notFound } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import blogCss from "../blog/blog.css?url";
import compareCss from "../compare/compare.css?url";
import { useInitAnalytics } from "../landing/analytics";
import { InstallOptions } from "../landing/landing-visuals";
import { pageMeta, siteHeadLinks } from "../landing/page-head";
import { brandProse, faqJsonLd } from "../landing/prose";
import { SiteFooter, SiteNav } from "../landing/site-chrome";
import {
  CopyToast,
  DoneWhen,
  PROMPT_COPIED,
  PromptCard,
  useCopy,
} from "./guide-blocks";
import type { Guide, GuideStep, Who } from "./guide-types";
import { getGuide, GUIDES } from "./guides";
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

const WHO_LABEL: Record<Who, string> = { you: "You, once", agent: "Agent" };

function WhoTag({ who }: { who: Who }) {
  return (
    <span className={who === "agent" ? "gd-who gd-who-agent" : "gd-who"}>
      <HugeiconsIcon
        icon={who === "agent" ? AiMagicIcon : UserIcon}
        className="gd-ic"
      />
      {WHO_LABEL[who]}
    </span>
  );
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
      <p className="gd-meta">{guide.meta}</p>
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
            <WhoTag who={step.who} />
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
        <span>Works with Claude Code, Codex, or any agent in bb</span>
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

interface RailItem {
  id: string;
  title: string;
  number: number | null;
}

function useActiveSection(ids: string[]) {
  const [active, setActive] = useState(ids[0]);
  useEffect(() => {
    const update = () => {
      let current = ids[0];
      for (const id of ids) {
        const node = document.getElementById(id);
        if (node && node.getBoundingClientRect().top <= 120) {
          current = id;
        }
      }
      setActive(current);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, [ids]);
  return active;
}

function StepRail({ items, prompt }: { items: RailItem[]; prompt: string }) {
  const [ids] = useState(() => items.map((item) => item.id));
  const active = useActiveSection(ids);
  return (
    <aside className="gd-rail" aria-label="Steps">
      <div className="gd-rail-title">Steps</div>
      <ol>
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              className={item.id === active ? "active" : undefined}
              aria-current={item.id === active ? "location" : undefined}
            >
              {item.number === null ? (
                <span className="gd-rail-dot">·</span>
              ) : (
                <span className="gd-num">{item.number}</span>
              )}
              {item.title}
            </a>
          </li>
        ))}
      </ol>
      <CopyForAgent
        prompt={prompt}
        label="Copy for agent"
        className="btn-ghost btn-sm gd-rail-copy"
      />
    </aside>
  );
}

function StepSection({ step, number }: { step: GuideStep; number: number }) {
  return (
    <section id={step.id}>
      <div className="gd-step-head">
        <span className="gd-num">{number}</span>
        <h2>{step.title}</h2>
        <WhoTag who={step.who} />
      </div>
      <p className="gd-lead">{brandProse(step.lead)}</p>
      {brandProse(step.body)}
      <DoneWhen>{brandProse(step.doneWhen)}</DoneWhen>
    </section>
  );
}

function RelatedGuides({ slugs }: { slugs: string[] }) {
  const related = slugs.flatMap((slug) => {
    const guide = GUIDES.find((candidate) => candidate.slug === slug);
    return guide ? [guide] : [];
  });
  if (related.length === 0) {
    return null;
  }
  return (
    <section id="related">
      <h2 className="gd-h2">Related guides</h2>
      <div className="gd-related">
        {related.map((guide) => (
          <a key={guide.slug} href={`/guides/${guide.slug}`}>
            <span className="gd-related-title">
              {guide.title}
              <HugeiconsIcon icon={ArrowRight01Icon} className="gd-ic" />
            </span>
            <p>{brandProse(guide.blurb)}</p>
          </a>
        ))}
      </div>
    </section>
  );
}

function railItems(guide: Guide): RailItem[] {
  return [
    ...(guide.needs.length > 0
      ? [{ id: "before", title: "Before you start", number: null }]
      : []),
    ...guide.steps.map((step, index) => ({
      id: step.id,
      title: step.title,
      number: index + 1,
    })),
    ...guide.sections.map((section) => ({
      id: section.id,
      title: section.title,
      number: null,
    })),
    ...(guide.prompts.length > 0
      ? [{ id: "prompts", title: "Prompts that work", number: null }]
      : []),
    { id: "faq", title: "FAQ", number: null },
  ];
}

export function GuidePage({ guide }: { guide: Guide }) {
  useInitAnalytics();
  const items = railItems(guide);

  return (
    <CopyToast>
      <div className="wrap cmp-page gd-page">
        <SiteNav />

        <GuideHero guide={guide} firstId={items[0].id} />

        <section className="gd-plan">
          <div className="gd-plan-grid">
            <div>
              <h2 className="gd-h2">The short version</h2>
              <StepOverview steps={guide.steps} />
              <p className="gd-plan-after">{brandProse(guide.overviewNote)}</p>
            </div>
            <AgentHandoff guide={guide} />
          </div>
        </section>

        <div className="gd-body">
          <StepRail items={items} prompt={guide.agentPrompt} />

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

            {guide.prompts.length > 0 ? (
              <section id="prompts">
                <h2 className="gd-h2">Prompts that work</h2>
                <div className="gd-prompts">
                  {guide.prompts.map((prompt) => (
                    <PromptCard key={prompt} prompt={prompt} />
                  ))}
                </div>
              </section>
            ) : null}

            <section id="faq">
              <h2 className="gd-h2">FAQ</h2>
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

            <RelatedGuides slugs={guide.related} />
          </div>
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
