import { useInitAnalytics } from "./analytics";
import {
  InstallOptions,
  ProviderChips,
  useScrollReveal,
} from "./landing-visuals";
import { pageMeta, siteHeadLinks } from "./page-head";
import { SiteFooter, SiteNav } from "./site-chrome";
import {
  brandProse,
  Closer,
  FaqSection,
  faqJsonLd,
  Highlight,
} from "../compare/compare-page";
import {
  FAQ_AGENTS,
  FAQ_CODEX_TOGETHER,
  FAQ_GET_STARTED,
  FAQ_PARALLEL,
  FAQ_PRIVACY,
  faqFree,
  faqPhone,
} from "../compare/compare-content";
import {
  AgentSplit,
  AnywhereVisual,
  FleetVisual,
} from "../compare/compare-visuals";
import type {
  CompareFaq,
  CompareFaqGroup,
  CompareHighlight,
} from "../compare/comparisons";
import compareCss from "../compare/compare.css?url";

export const CLAUDE_CODE_MOBILE_PATH = "/claude-code-mobile";

export type LandingVariant = "phone" | "codex-review" | "parallel";

export function parseLandingVariant(value: unknown): LandingVariant {
  return value === "codex-review" || value === "parallel" ? value : "phone";
}

const PHONE_SECTION: CompareHighlight = {
  title: "Step away. Answer from your phone.",
  wide: false,
  visual: <AnywhereVisual />,
  body: (
    <>
      <p>
        Every agent on every machine you add shows up in one list, marked
        running, waiting on you, or done. From any phone browser, answer its
        questions and approvals, start new work, or open the app it’s building.
      </p>
      <p>
        Add the bb mobile app, in beta on iPhone and alpha on Android, to get a
        push notification when an agent needs you.
      </p>
    </>
  ),
};

const CODEX_SECTION: CompareHighlight = {
  title: "Codex reviews. Claude Code fixes.",
  wide: true,
  visual: <AgentSplit />,
  body: (
    <>
      <p>
        Ask Claude Code to have Codex review its branch. Codex sends its
        findings back and Claude Code fixes them, with no copy-paste between
        tools.
      </p>
      <p>
        Each agent runs in its own thread, signed in as usual, so you can read
        exactly what one sent the other and step in at any point. Any pair of
        agents works the same way.
      </p>
    </>
  ),
};

const PARALLEL_SECTION: CompareHighlight = {
  title: "Run agents side by side without collisions",
  wide: true,
  visual: <FleetVisual />,
  body: (
    <>
      <p>
        Give each agent its own Git worktree so they don’t overwrite each
        other’s changes. List your .env files and setup commands once, and bb
        prepares every new worktree.
      </p>
      <p>
        Add a desktop at home or a cloud server, and one list shows every agent
        on every machine.
      </p>
    </>
  ),
};

const FAQ_REMOTE_CONTROL: CompareFaq = {
  question: "Do I need Claude Code’s Remote Control to use bb from my phone?",
  answer: (
    <p>
      No. bb runs Claude Code on your own computer, signed in as usual with a
      Claude plan or an API key, and your phone reaches bb through bb Connect,
      bb’s free remote access. There’s no terminal to leave open, and Codex and
      your other agents show up in the same list.
    </p>
  ),
};

const FAQ_PREVIEW: CompareFaq = {
  question: "Can I see what my agent built from my phone?",
  answer: (
    <p>
      Yes. Ask the agent to share its dev server with bb Connect, then open the
      link on your phone. Only you can open it, signed in to your getbb.app
      account.
    </p>
  ),
};

const FAQ_STAY_ON: CompareFaq = {
  question: "Does my computer need to stay on?",
  answer: (
    <p>
      Yes. Your agents run on your own machines, so the computer running bb has
      to stay awake and online. Switch on Keep Awake, a built-in bb plugin, to
      stop idle sleep on macOS and Windows. To step away with your laptop
      closed, run bb on an always-on desktop, home server, or cloud VM.
    </p>
  ),
};

const FAQ_LIMIT_RESET: CompareFaq = {
  question: "What happens when an agent hits a usage limit?",
  answer: (
    <p>
      bb picks the work back up. When an agent stops on a usage limit that
      reports when it resets, bb sends the message again a little after the
      reset, up to four times per turn, so you don’t have to come back and
      press send. Credit and spend limits aren’t retried.
    </p>
  ),
};

const FAQ_BOTH_PLANS: CompareFaq = {
  question: "Do I need a plan for both Claude Code and Codex?",
  answer: (
    <p>
      Yes. Each agent runs signed in as usual, with its own plan or API key,
      the way you use it today, and bb adds no model bill of its own. Any pair
      of agents works the same way, including two Claude Code threads.
    </p>
  ),
};

const PHONE_FAQ: CompareFaqGroup = {
  title: "Your phone",
  items: [
    FAQ_REMOTE_CONTROL,
    faqPhone(
      "The app adds push notifications; everything else works in the browser.",
    ),
    FAQ_PREVIEW,
    FAQ_STAY_ON,
  ],
};

const START_FAQ: CompareFaqGroup = {
  title: "Getting started",
  items: [FAQ_GET_STARTED, faqFree(""), FAQ_PRIVACY],
};

type VariantContent = {
  title: string;
  description: string;
  headline: string;
  sub: string;
  sections: CompareHighlight[];
  faq: CompareFaqGroup[];
};

const VARIANTS: Record<LandingVariant, VariantContent> = {
  phone: {
    title: "Claude Code Mobile: See Which Agent Needs You — bb",
    description:
      "See which of your Claude Code, Codex, and other agents needs you, across all your machines, and answer from any phone browser. Free and open source.",
    headline: "See which agent needs you, from your phone",
    sub: "Install bb on your computer, then step away. Claude Code, Codex, and your other agents show up in one list on your phone, where you can answer questions and preview what was built. Free and open source.",
    sections: [PHONE_SECTION, CODEX_SECTION, PARALLEL_SECTION],
    faq: [
      PHONE_FAQ,
      {
        title: "Running several agents",
        items: [FAQ_PARALLEL, FAQ_CODEX_TOGETHER, FAQ_LIMIT_RESET, FAQ_AGENTS],
      },
      START_FAQ,
    ],
  },
  "codex-review": {
    title: "Use Claude Code and Codex Together — bb",
    description:
      "Have Codex review Claude Code’s work, or the reverse, with no copy-paste between them. Both run in one free, open-source app.",
    headline: "Have Codex review Claude Code’s work",
    sub: "Or the reverse, with no copy-paste between them. Both run in one app, each signed in as usual, and you’ll see which one needs you.",
    sections: [CODEX_SECTION, PARALLEL_SECTION, PHONE_SECTION],
    faq: [
      {
        title: "Running several agents",
        items: [FAQ_BOTH_PLANS, FAQ_PARALLEL, FAQ_LIMIT_RESET, FAQ_AGENTS],
      },
      START_FAQ,
      PHONE_FAQ,
    ],
  },
  parallel: {
    title: "Run Claude Code Agents in Parallel — bb",
    description:
      "Run Claude Code, Codex, and other agents in parallel, each in its own Git worktree, and always know which one needs you. Free and open source.",
    headline: "Run agents in parallel and always know which one needs you",
    sub: "One list shows which agents are running, waiting on you, or done. Each can get its own Git worktree.",
    sections: [PARALLEL_SECTION, CODEX_SECTION, PHONE_SECTION],
    faq: [
      {
        title: "Running several agents",
        items: [FAQ_LIMIT_RESET, FAQ_CODEX_TOGETHER, FAQ_AGENTS],
      },
      START_FAQ,
      PHONE_FAQ,
    ],
  },
};

const CLOSER = {
  title: "Know which agent needs you",
  body: "Free and open source, on your own machines. Bring the agents you already use.",
};

export function claudeCodeMobileHead(variant: LandingVariant) {
  const content = VARIANTS[variant];
  return {
    meta: pageMeta(content.title, content.description, CLAUDE_CODE_MOBILE_PATH),
    links: [
      ...siteHeadLinks(compareCss),
      {
        rel: "canonical",
        href: `https://getbb.app${CLAUDE_CODE_MOBILE_PATH}`,
      },
    ],
    scripts: [
      { type: "application/ld+json", children: faqJsonLd(content.faq) },
    ],
  };
}

export function ClaudeCodeMobilePage({
  variant,
}: {
  variant: LandingVariant;
}) {
  useInitAnalytics();
  useScrollReveal();
  const content = VARIANTS[variant];

  return (
    <div className="wrap cmp-page">
      <SiteNav />

      <header className="hero cmp-hero">
        <h1>{brandProse(content.headline)}</h1>
        <p className="sub">{brandProse(content.sub)}</p>
        <InstallOptions placement="hero" />
        <div className="providers">
          <span className="label">Works with</span>
          <ProviderChips />
        </div>
      </header>

      {content.sections.map((highlight) => (
        <Highlight key={highlight.title} highlight={highlight} />
      ))}

      <FaqSection title="Common questions" faq={content.faq} />

      <Closer closer={CLOSER} />

      <SiteFooter current={CLAUDE_CODE_MOBILE_PATH} />
    </div>
  );
}
