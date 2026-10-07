import type { ReactNode } from "react";

import supersetIcon from "../assets/competitors/superset.png";
import { WINDOWS_DOWNLOAD_URL } from "../landing/site";
import {
  CLOSER,
  FAQ_AGENTS,
  FAQ_CODEX_TOGETHER,
  FAQ_CUSTOMIZE,
  FAQ_GET_STARTED,
  FAQ_LAPTOP,
  FAQ_PARALLEL,
  FAQ_PERMISSIONS,
  FAQ_PRIVACY,
  FAQ_REVIEW,
  FAQ_SUBSCRIPTIONS,
  cell,
  faqFree,
  faqPhone,
  faqPlatforms,
  faqSchedule,
  faqTalk,
  faqTeam,
  faqUsageLimit,
  price,
} from "./compare-content";
import {
  AGENTS_COPY,
  agentsSection,
  ANYWHERE_COPY,
  anywhereSection,
  PLUGINS_COPY,
  pluginsSection,
  PRICING_COPY,
  pricingSection,
} from "./compare-sections";
import type { BrandLogo } from "./compare-visuals";
import { BB_VS_CONDUCTOR } from "./conductor";
import { BB_VS_CURSOR } from "./cursor";
import { BB_VS_T3_CODE } from "./t3-code";
import { BB_VS_VIBE_KANBAN } from "./vibe-kanban";

export type Mark = "yes" | "partial" | "no";

export type CompareCell = {
  mark: Mark | null;
  value: string;
  text: string;
  href: string | null;
  pro: boolean;
};

export type CompareRow = {
  feature: string;
  bb: CompareCell;
  competitor: CompareCell;
};

export type CompareGroup = {
  title: string;
  rows: CompareRow[];
};

export type CompareHighlight = {
  title: string;
  body: ReactNode;
  visual: ReactNode;
  wide: boolean;
};

export type CompareFaq = {
  question: string;
  answer: ReactNode;
};

export type CompareFaqGroup = {
  title: string;
  items: CompareFaq[];
};

export type Comparison = {
  slug: string;
  title: string;
  description: string;
  competitor: { name: string; logo: BrandLogo };
  headline: string;
  sub: string;
  heroVisual: ReactNode | null;
  tailored: CompareHighlight;
  sections: CompareHighlight[];
  tableNote: string | null;
  table: CompareGroup[];
  faqTitle: string;
  faq: CompareFaqGroup[];
  closer: { title: string; body: string };
};

const SUPERSET_LOGO: BrandLogo = { kind: "image", src: supersetIcon };

const BB_VS_SUPERSET: Comparison = {
  slug: "superset-alternative",
  title: "bb vs Superset: The Free, Open-Source Alternative",
  description:
    "bb is a free, open-source Superset alternative. Run Claude Code and Codex in parallel, let agents hand off work, and check in from your phone. No Pro plan.",
  competitor: { name: "Superset", logo: SUPERSET_LOGO },
  headline: "The free, open-source Superset alternative",
  sub: "Get Claude Code, Codex, or any agent working together on the same task, and check in from your phone.",
  heroVisual: null,
  tailored: pricingSection(PRICING_COPY, {
    plan: "Superset Pro",
    logo: SUPERSET_LOGO,
    yearlyPerSeatMonthly: 20,
    priceNote: "Superset Pro at $20 per user a month.",
  }),
  sections: [
    agentsSection(AGENTS_COPY),
    anywhereSection(ANYWHERE_COPY),
    pluginsSection(PLUGINS_COPY),
  ],
  tableNote:
    "marks features that need a paid Superset plan, from $20 per user / month.",
  table: [
    {
      title: "Price and license",
      rows: [
        {
          feature: "Pricing",
          bb: price("$0", "Any team size"),
          competitor: price("$0 solo", "$20 per user / month for teams"),
        },
        {
          feature: "Open-source license",
          bb: cell("yes", "MIT"),
          competitor: cell("no", "Elastic License 2.0"),
        },
      ],
    },
    {
      title: "Away from your desk",
      rows: [
        {
          feature: "Web access from any browser",
          bb: cell("yes", "Free with bb Connect"),
          competitor: cell("no", "No web dashboard"),
        },
        {
          feature: "Run agents on other machines",
          bb: cell("yes", "Enroll any machine"),
          competitor: cell("partial", "Via Superset relay", true),
        },
        {
          feature: "Self-host on your own server",
          bb: cell("yes", "Home server or VM, your network"),
          competitor: cell("partial", "Hosts go through Superset relay", true),
        },
        {
          feature: "Cloud sandboxes",
          bb: cell("yes", "Modal plugin, experimental"),
          competitor: cell("partial", "When enabled for your account"),
        },
        {
          feature: "Scheduled automations",
          bb: cell("yes", "Cron, one-shot, scripts"),
          competitor: cell("partial", "Recurring only", true),
        },
      ],
    },
    {
      title: "Agents",
      rows: [
        {
          feature: "Multi-agent support",
          bb: cell("yes", "Plus any you add"),
          competitor: cell("yes", "Any CLI agent"),
        },
        {
          feature: "Agent-to-agent handoff",
          bb: cell("yes", "Spawn, message, wait"),
          competitor: cell("yes", "Via a coordinator skill"),
        },
        {
          feature: "Switch accounts at usage limits",
          bb: cell("yes", "Automatic with Account Pooler"),
          competitor: cell("partial", "Manual default switch"),
        },
      ],
    },
    {
      title: "Integrations",
      rows: [
        {
          feature: "Plugin marketplace",
          bb: cell("yes", "Gallery or agent-built"),
          competitor: cell("partial", "Themes and integrations"),
        },
        {
          feature: "Linear integration",
          bb: cell("yes", "Community plugin"),
          competitor: cell("partial", "", true),
        },
        {
          feature: "GitHub integration",
          bb: cell("yes", "Issues, PRs, checks"),
          competitor: cell("yes", "PR view with checks"),
        },
        {
          feature: "Slack integration",
          bb: cell("no"),
          competitor: cell("partial", "@superset agent bot", true),
        },
      ],
    },
    {
      title: "Platforms",
      rows: [
        {
          feature: "Windows support",
          bb: cell("yes", "Native app"),
          competitor: cell("no", "Planned, no date"),
        },
        {
          feature: "iOS app",
          bb: cell("yes", "TestFlight beta"),
          competitor: cell("partial", "iOS 26+", true),
        },
        {
          feature: "Android app",
          bb: cell("yes", "Alpha"),
          competitor: cell("no", "Waitlist"),
        },
        {
          feature: "macOS",
          bb: cell("yes", "Apple Silicon app"),
          competitor: cell("yes", "Apple Silicon and Intel"),
        },
        {
          feature: "Linux support",
          bb: cell("yes", "Alpha"),
          competitor: cell("yes", "Experimental"),
        },
      ],
    },
    {
      title: "Workspace and teams",
      rows: [
        {
          feature: "Git worktrees",
          bb: cell("yes", ".env copy, setup, teardown"),
          competitor: cell("yes", "Setup, teardown, run"),
        },
        {
          feature: "Diff review and merge",
          bb: cell("yes"),
          competitor: cell("yes"),
        },
        {
          feature: "Built-in terminal and browser",
          bb: cell("yes", "Browser on desktop"),
          competitor: cell("yes"),
        },
        {
          feature: "Code editor",
          bb: cell("yes", "Opt-in plugin"),
          competitor: cell("yes"),
        },
        {
          feature: "Port management",
          bb: cell("no"),
          competitor: cell("yes", "View, kill, group"),
        },
        {
          feature: "Team plans and SSO",
          bb: cell("no"),
          competitor: cell("partial", "SSO on Enterprise", true),
        },
      ],
    },
    {
      title: "Talking to your agents",
      rows: [
        {
          feature: "Side chats",
          bb: cell("yes", "Ask without derailing the agent"),
          competitor: cell("no"),
        },
        {
          feature: "Drafts",
          bb: cell("yes", "Save a message, send when ready"),
          competitor: cell("no"),
        },
        {
          feature: "Scheduled send",
          bb: cell("yes", "Send a message later"),
          competitor: cell("no"),
        },
        {
          feature: "Voice input",
          bb: cell("yes", "Dictate prompts"),
          competitor: cell("no"),
        },
      ],
    },
  ],
  faqTitle: "FAQ",
  faq: [
    {
      title: "Switching from Superset",
      items: [
        {
          question: "What’s the difference between bb and Superset?",
          answer: (
            <p>
              Both run Claude Code, Codex, and other coding agents in parallel
              on your repo. bb is free for any team size and open source, while
              Superset charges $20 per user a month for teams. bb includes phone
              and browser access, remote machines, and automations at no cost,
              and runs natively on <a href={WINDOWS_DOWNLOAD_URL}>Windows</a>.
              When one agent starts another, the new agent gets its own thread
              (one conversation with one agent) that you can open and message.
            </p>
          ),
        },
        {
          question: "Who builds and maintains bb?",
          answer: (
            <>
              <p>
                A small, venture-backed team that most recently worked together
                at Figma, building Figma’s plugin platform. The team also
                includes alumni of Meta, Quora, and Mapbox.
              </p>
              <p>
                bb is developed in the open: the core team commits to it every
                day, dozens of community contributors send changes each month,
                and a new release ships every week. Follow along or reach the
                team on <a href="https://github.com/get-bb/bb">GitHub</a> and{" "}
                <a href="https://discord.gg/kvBU6tJhcJ">Discord</a>.
              </p>
            </>
          ),
        },
        {
          question: "Is there a free, open-source Superset alternative?",
          answer: (
            <p>
              Yes: bb. It’s free for any team size and MIT-licensed, so you can
              use and change it for anything, including at work. Superset
              charges $20 per user a month for teams, and its Elastic License
              2.0 makes the code public but isn’t an open-source license.{" "}
              <a href="/download/macos">Download bb</a>.
            </p>
          ),
        },
        FAQ_GET_STARTED,
        {
          question: "How do I switch from Superset to bb?",
          answer: (
            <p>
              Ask bb to do it. Your repo and Superset’s worktrees are plain Git
              on your machine, so a bb agent can add the repo and open each
              unfinished worktree as a thread. Superset keeps working while you
              try bb.
            </p>
          ),
        },
      ],
    },
    {
      title: "Working in bb",
      items: [
        FAQ_CUSTOMIZE,
        FAQ_REVIEW,
        faqSchedule("Superset’s automations only repeat and need Pro."),
      ],
    },
    {
      title: "Price and license",
      items: [
        faqFree(
          ", while Superset puts its mobile app, remote machines, and automations on its $20-per-user Pro plan",
        ),
        FAQ_SUBSCRIPTIONS,
        faqUsageLimit(
          "Superset can hold several accounts, but you pick the default yourself, and a running agent keeps its account until you relaunch it.",
        ),
      ],
    },
    {
      title: "Agents",
      items: [
        FAQ_AGENTS,
        FAQ_CODEX_TOGETHER,
        faqTalk("; Superset does this through a coordinator skill"),
        FAQ_PARALLEL,
        FAQ_PERMISSIONS,
      ],
    },
    {
      title: "Mobile and remote",
      items: [
        faqPhone(
          "Superset’s iPhone app needs Pro and iOS 26, its Android app is a waitlist, and it has no browser access.",
        ),
        FAQ_LAPTOP,
      ],
    },
    {
      title: "Platforms, privacy, and teams",
      items: [
        faqPlatforms("Superset doesn’t run on Windows yet."),
        FAQ_PRIVACY,
        faqTeam(", while Superset charges $20 per user a month for teams"),
      ],
    },
  ],
  closer: CLOSER,
};

export const COMPARISONS: Comparison[] = [
  BB_VS_SUPERSET,
  BB_VS_VIBE_KANBAN,
  BB_VS_CONDUCTOR,
  BB_VS_T3_CODE,
  BB_VS_CURSOR,
];

export function getComparison(slug: string): Comparison | undefined {
  return COMPARISONS.find((comparison) => comparison.slug === slug);
}
