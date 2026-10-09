import supersetIcon from "../../assets/competitors/superset.png";
import { WINDOWS_DOWNLOAD_URL } from "../../landing/site";
import {
  BB_ROWS,
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
  faqScript,
} from "../compare-content";
import {
  AGENTS_COPY,
  agentsSection,
  ANYWHERE_COPY,
  anywhereSection,
  PRICING_COPY,
  pricingSection,
  LIMITS_COPY,
  limitsSection,
} from "../compare-sections";
import { FleetVisual, type BrandLogo } from "../compare-visuals";

import type { CompareMeta, Comparison } from "../compare-types";

const SUPERSET_LOGO: BrandLogo = { kind: "image", src: supersetIcon };

export const meta: CompareMeta = {
  slug: "superset-alternative",
  competitor: { name: "Superset", logo: SUPERSET_LOGO },
};

export const comparison: Comparison = {
  ...meta,
  title: "bb vs Superset: The Free, Open-Source Alternative",
  description:
    "bb is a free, open-source Superset alternative. Run Claude Code and Codex in parallel, let agents hand off work, and check in from your phone. No Pro plan.",
  headline: "The free, open-source Superset alternative",
  sub: "Pay nothing per seat, with mobile, remote machines, and automations included. Run Claude Code, Codex, or any agent on the same task.",
  heroVisual: <FleetVisual />,
  tailored: pricingSection(PRICING_COPY, {
    plan: "Superset Pro",
    logo: SUPERSET_LOGO,
    yearlyPerSeatMonthly: 15,
    priceNote: "Superset Pro at $15 per user a month, billed yearly.",
  }),
  sections: [
    agentsSection(AGENTS_COPY),
    limitsSection(LIMITS_COPY),
    anywhereSection(ANYWHERE_COPY),
  ],
  tableNote:
    "marks features that need a paid Superset plan, from $15 per user / month, billed yearly.",
  table: [
    {
      title: "Price and license",
      rows: [
        {
          ...BB_ROWS.pricing,
          competitor: price(
            "$0 solo",
            "$15 per user / month for teams, billed yearly",
          ),
        },
        { ...BB_ROWS.license, competitor: cell("no", "Elastic License 2.0") },
      ],
    },
    {
      title: "Away from your desk",
      rows: [
        {
          ...BB_ROWS.webAccess,
          competitor: cell("partial", "Desktop and iPhone only"),
        },
        {
          ...BB_ROWS.otherMachines,
          competitor: cell("partial", "Via Superset relay", true),
        },
        {
          feature: "Self-host on your own server",
          bb: cell("yes", "Home server or VM, your network"),
          competitor: cell("partial", "Hosts go through Superset relay", true),
        },
        {
          ...BB_ROWS.cloud,
          feature: "Cloud sandboxes",
          competitor: cell("partial", "Limited access"),
        },
        {
          ...BB_ROWS.automations,
          bb: cell("yes", "Cron, one-shot, scripts"),
          competitor: cell("partial", "Recurring only", true),
        },
      ],
    },
    {
      title: "Agents",
      rows: [
        { ...BB_ROWS.multiAgent, competitor: cell("yes", "Any CLI agent") },
        {
          ...BB_ROWS.handoff,
          competitor: cell("yes", "Via a coordinator skill"),
        },
        {
          ...BB_ROWS.accountSwitch,
          competitor: cell("partial", "Manual default switch"),
        },
      ],
    },
    {
      title: "Integrations",
      rows: [
        { ...BB_ROWS.marketplace, competitor: cell("partial", "Themes only") },
        {
          ...BB_ROWS.linear,
          competitor: cell("yes", "Two-way issue sync", true),
        },
        { ...BB_ROWS.github, competitor: cell("yes", "PR view with checks") },
        { ...BB_ROWS.gitlab, competitor: cell("no") },
        { ...BB_ROWS.gitea, competitor: cell("no") },
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
        { ...BB_ROWS.windows, competitor: cell("no") },
        {
          feature: "iOS app",
          bb: cell("yes", "TestFlight beta"),
          competitor: cell("partial", "iOS 26+", true),
        },
        {
          feature: "Android app",
          bb: cell("yes", "Alpha"),
          competitor: cell("no"),
        },
        {
          ...BB_ROWS.macos,
          competitor: cell("yes", "Apple Silicon and Intel"),
        },
        { ...BB_ROWS.linux, competitor: cell("yes", "Experimental") },
      ],
    },
    {
      title: "Workspace and teams",
      rows: [
        {
          ...BB_ROWS.worktrees,
          competitor: cell("yes", "Setup, teardown, run"),
        },
        { ...BB_ROWS.diffReview, competitor: cell("yes") },
        {
          feature: "Built-in terminal and browser",
          bb: cell("yes", "Browser on desktop"),
          competitor: cell("yes"),
        },
        {
          feature: "Code editor",
          bb: cell("yes"),
          competitor: cell("yes"),
        },
        {
          feature: "Port management",
          bb: cell("no"),
          competitor: cell("yes", "View, kill, group"),
        },
        {
          ...BB_ROWS.teamPlans,
          competitor: cell("partial", "SSO on Enterprise", true),
        },
      ],
    },
    {
      title: "Talking to your agents",
      rows: [
        {
          feature: "Side chats",
          bb: cell("yes"),
          competitor: cell("partial", "Fork a session"),
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
          competitor: cell("partial", "Dictation on iPhone", true),
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
              Superset charges $15 per user a month for teams, billed yearly. bb
              includes phone and browser access, remote machines, and
              automations at no cost, and runs on{" "}
              <a href={WINDOWS_DOWNLOAD_URL}>Windows</a> (alpha). When one agent
              starts another, the new agent gets its own thread (one
              conversation with one agent) that you can open and message.
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
              charges $15 per user a month for teams, billed yearly, and its
              Elastic License 2.0 makes the code public but isn’t an open-source
              license. <a href="/download/macos">Download bb</a>.
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
              try bb.{" "}
              <a href="/guides/switch-to-bb?from=superset">Copy the prompt</a>.
            </p>
          ),
        },
      ],
    },
    {
      title: "Working in bb",
      items: [
        FAQ_CUSTOMIZE,
        faqScript(null),
        FAQ_REVIEW,
        faqSchedule("Superset’s automations only repeat and need Pro."),
      ],
    },
    {
      title: "Price and license",
      items: [
        faqFree(
          ", while Superset puts its mobile app, remote machines, and automations on its Pro plan, from $15 per user a month billed yearly",
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
        faqTeam(
          ", while Superset charges $15 per user a month for teams, billed yearly",
        ),
      ],
    },
  ],
  closer: CLOSER,
};
