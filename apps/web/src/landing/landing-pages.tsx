import type { LandingPage } from "./landing-template";
import { textOnly } from "../compare/compare-page";
import {
  FAQ_AGENTS,
  FAQ_CODEX_TOGETHER,
  FAQ_CUSTOMIZE,
  FAQ_GET_STARTED,
  FAQ_PARALLEL,
  FAQ_PRIVACY,
  FAQ_SUBSCRIPTIONS,
  faqFree,
  faqPhone,
  faqScript,
  faqTalk,
} from "../compare/compare-content";
import {
  ANYWHERE_COPY,
  anywhereSection,
  LIMITS_COPY,
  limitsSection,
  SPAWN_COPY,
  spawnSection,
} from "../compare/compare-sections";
import {
  AgentSplit,
  AnywhereVisual,
  FleetVisual,
  ReviewVisual,
  WorktreesVisual,
} from "../compare/compare-visuals";
import type {
  CompareFaq,
  CompareFaqGroup,
  CompareHighlight,
} from "../compare/comparisons";

const PHONE_SECTION: CompareHighlight = {
  title: "Step away. Reply from your phone.",
  wide: false,
  visual: <AnywhereVisual />,
  body: (
    <>
      <p>
        When an agent is waiting on you, answer its question or approval from
        any phone browser. You can also start new work on any of your machines,
        or open the app an agent is building to see what it made.
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
        Have one agent check another’s work and fix what it finds, with no
        copy-paste.
      </p>
      <p>You see everything they send each other and can step in anytime.</p>
    </>
  ),
};

const PARALLEL_SECTION: CompareHighlight = {
  title: "Every agent gets its own copy of your repo",
  wide: false,
  visual: <WorktreesVisual />,
  body: (
    <>
      <p>
        bb gives each agent its own Git worktree and branch, so a dozen agents
        can work on one repo without overwriting each other.
      </p>
      <p>
        List your <code>.env</code> files and setup commands once, and every new
        worktree starts ready to work.
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

const FAQ_WHO_NEEDS_YOU: CompareFaq = {
  question: "How do I know which agent needs me?",
  answer: (
    <p>
      bb’s thread list marks every agent as running, waiting on you, or done,
      across all your machines. When one needs an answer or an approval, the bb
      mobile app sends a push notification, and you can reply from any browser.
    </p>
  ),
};

const FAQ_LIMIT_RESET: CompareFaq = {
  question: "What happens when an agent hits a usage limit?",
  answer: (
    <p>
      bb picks the work back up. When an agent stops on a usage limit that
      reports when it resets, bb sends the message again a little after the
      reset, up to four times per turn, so you don’t have to come back and press
      send. Credit and spend limits aren’t retried.
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

const START_WITH_PLANS_FAQ: CompareFaqGroup = {
  title: "Getting started",
  items: [FAQ_GET_STARTED, FAQ_SUBSCRIPTIONS, faqFree(""), FAQ_PRIVACY],
};

export const LANDING_PAGES: LandingPage[] = [
  {
    slug: "claude-code-mobile",
    title: "Claude Code Mobile: See Which Agent Needs You — bb",
    description:
      "See which of your Claude Code, Codex, and other agents needs you, across all your machines, and reply from any phone browser. Free and open source.",
    headline: "Claude Code on your phone. See which agent needs you.",
    sub: "Claude Code, Codex, and your other agents in one list, marked running, waiting on you, or done. Reply from any phone browser. Free and open source.",
    closer: "Know which agent needs you",
    heroVisual: <AnywhereVisual />,
    sections: [
      textOnly(PHONE_SECTION),
      { ...anywhereSection(ANYWHERE_COPY), visual: <FleetVisual /> },
      PARALLEL_SECTION,
      limitsSection(LIMITS_COPY),
      CODEX_SECTION,
    ],
    faq: [
      PHONE_FAQ,
      {
        title: "Running several agents",
        items: [FAQ_PARALLEL, FAQ_CODEX_TOGETHER, FAQ_LIMIT_RESET, FAQ_AGENTS],
      },
      START_WITH_PLANS_FAQ,
    ],
  },
  {
    slug: "claude-code-and-codex",
    title: "Use Claude Code and Codex Together — bb",
    description:
      "Have Codex review Claude Code’s work with no copy-paste between them. Both run in one free, open-source app, on the subscriptions you already have.",
    headline: "Have Codex review Claude Code’s work",
    sub: "No copy-paste between them. Both run in one app on the subscriptions you already have. Free and open source.",
    closer: "Let your agents check each other’s work",
    heroVisual: <AgentSplit />,
    sections: [
      { ...CODEX_SECTION, wide: false, visual: <ReviewVisual /> },
      spawnSection(SPAWN_COPY),
      PARALLEL_SECTION,
      limitsSection(LIMITS_COPY),
      anywhereSection(ANYWHERE_COPY),
    ],
    faq: [
      {
        title: "Claude Code and Codex",
        items: [FAQ_SUBSCRIPTIONS, FAQ_PARALLEL, FAQ_LIMIT_RESET, FAQ_AGENTS],
      },
      START_FAQ,
      PHONE_FAQ,
    ],
  },
  {
    slug: "claude-code-parallel-agents",
    title: "Run Claude Code Agents in Parallel — bb",
    description:
      "Run Claude Code, Codex, and other agents in parallel, each in its own Git worktree, and always know which one needs you. Free and open source.",
    headline: "Build your own software factory of coding agents",
    sub: "Run Claude Code, Codex, and more in parallel, see which one needs you, and script every step with plugins and the bb CLI.",
    closer: "Start building your software factory",
    heroVisual: <FleetVisual />,
    sections: [
      PARALLEL_SECTION,
      spawnSection(SPAWN_COPY),
      anywhereSection(ANYWHERE_COPY),
      limitsSection(LIMITS_COPY),
      CODEX_SECTION,
    ],
    faq: [
      {
        title: "Running a software factory",
        items: [
          FAQ_WHO_NEEDS_YOU,
          FAQ_PARALLEL,
          faqTalk(null),
          FAQ_CODEX_TOGETHER,
          FAQ_CUSTOMIZE,
          faqScript(null),
          FAQ_LIMIT_RESET,
          FAQ_STAY_ON,
          FAQ_AGENTS,
        ],
      },
      START_WITH_PLANS_FAQ,
    ],
  },
];

export function getLandingPage(slug: string): LandingPage | undefined {
  return LANDING_PAGES.find((page) => page.slug === slug);
}
