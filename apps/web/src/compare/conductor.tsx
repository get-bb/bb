import conductorIcon from "../assets/competitors/conductor.png";
import type { Comparison } from "./comparisons";
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
  anywhereSection,
  PLUGINS_COPY,
  pluginsSection,
  pricingSection,
} from "./compare-sections";
import { FleetVisual, type BrandLogo } from "./compare-visuals";

const CONDUCTOR_LOGO: BrandLogo = { kind: "image", src: conductorIcon };

const AWAY_SECTION = anywhereSection({
  title: "Keep working after you close your Mac",
  body: (
    <>
      <p>
        Add an always-on desktop or server to bb, and your agents keep running
        there while you’re out. Answer them and approve their work from the bb
        mobile app or any browser.
      </p>
      <p>
        In Conductor, closing your Mac ends local sessions, and the phone app
        works with cloud workspaces on its $50-a-month Pro plan. In bb, it’s all
        free.
      </p>
    </>
  ),
});

const COST_SECTION = pricingSection(
  {
    title: "Free for your whole team",
    body: (
      <>
        <p>
          bb is free at any team size, with the mobile app, remote machines,
          automations, and plugins included. You only pay for the AI plans you
          already have.
        </p>
        <p>
          It’s open source under the MIT license, so you can read every line and
          use it anywhere, including at work.
        </p>
      </>
    ),
  },
  {
    plan: "Conductor Teams",
    logo: CONDUCTOR_LOGO,
    yearlyPerSeatMonthly: 60,
    priceNote: "Conductor Teams at $60 per person a month.",
  },
);

export const BB_VS_CONDUCTOR: Comparison = {
  slug: "conductor-alternatives",
  title: "Conductor Alternatives: bb, the Free, Open-Source Option",
  description:
    "bb is a free, open-source Conductor alternative for Mac, Windows, and Linux. Run Claude Code, Codex, and other agents on any computer you own, and approve from your phone.",
  competitor: { name: "Conductor", logo: CONDUCTOR_LOGO },
  headline: "The free, open-source Conductor alternative",
  sub: "Run Claude Code, Codex, and any agent on Mac, Windows, or Linux, and approve their work from your phone.",
  heroVisual: <FleetVisual />,
  tailored: AWAY_SECTION,
  sections: [
    COST_SECTION,
    agentsSection(AGENTS_COPY),
    pluginsSection(PLUGINS_COPY),
  ],
  tableNote:
    "marks features that need a paid Conductor plan, from $50 a month.",
  table: [
    {
      title: "Price and license",
      rows: [
        {
          feature: "Pricing",
          bb: price("$0", "Any team size"),
          competitor: price("$0", "Teams at $60 per person a month"),
        },
        {
          feature: "Open-source license",
          bb: cell("yes", "MIT"),
          competitor: cell("no", "Closed source"),
        },
      ],
    },
    {
      title: "Platforms",
      rows: [
        {
          feature: "Windows support",
          bb: cell("yes", "Native app"),
          competitor: cell("no", "Mac only"),
        },
        {
          feature: "Linux support",
          bb: cell("yes", "Alpha"),
          competitor: cell("no"),
        },
        {
          feature: "macOS",
          bb: cell("yes", "Apple Silicon app"),
          competitor: cell("yes", "Mac app"),
        },
        {
          feature: "Mobile app",
          bb: cell("yes", "iOS beta, Android alpha"),
          competitor: cell("partial", "iOS, for cloud workspaces", true),
        },
      ],
    },
    {
      title: "Away from your desk",
      rows: [
        {
          feature: "Run agents on other machines",
          bb: cell("yes", "Any computer you own"),
          competitor: cell("partial", "Your Mac or Conductor’s cloud", true),
        },
        {
          feature: "Cloud workspaces",
          bb: cell("yes", "Modal plugin"),
          competitor: cell("yes", "Hosted", true),
        },
        {
          feature: "Scheduled automations",
          bb: cell("yes", "On your own machines"),
          competitor: cell("partial", "Cloud routines", true),
        },
      ],
    },
    {
      title: "Agents",
      rows: [
        {
          feature: "Multi-agent support",
          bb: cell("yes", "Claude Code, Codex, and more"),
          competitor: cell("yes", "Claude Code, Codex, Cursor, OpenCode"),
        },
        {
          feature: "Agent-to-agent handoff",
          bb: cell("yes", "Spawn, message, wait"),
          competitor: cell("partial", "Via MCP, cloud workspaces", true),
        },
      ],
    },
    {
      title: "Integrations",
      rows: [
        {
          feature: "Plugin marketplace",
          bb: cell("yes", "Gallery or agent-built"),
          competitor: cell("no"),
        },
        {
          feature: "GitHub integration",
          bb: cell("yes", "Issues, PRs, checks"),
          competitor: cell("yes", "Checks tab, PR actions"),
        },
      ],
    },
    {
      title: "Workspace and teams",
      rows: [
        {
          feature: "Git worktrees",
          bb: cell("yes", "Setup runs for you"),
          competitor: cell("yes", "Setup and archive scripts"),
        },
        {
          feature: "Diff review and merge",
          bb: cell("yes"),
          competitor: cell("yes", "Diff comments, checks, merge"),
        },
        {
          feature: "Multiplayer workspaces",
          bb: cell("no"),
          competitor: cell("partial", "Prompt the same agent", true),
        },
        {
          feature: "Team plans and SSO",
          bb: cell("no"),
          competitor: cell("partial", "SSO on Enterprise", true),
        },
      ],
    },
  ],
  faqTitle: "FAQ",
  faq: [
    {
      title: "Switching from Conductor",
      items: [
        FAQ_GET_STARTED,
        {
          question: "What’s the difference between bb and Conductor?",
          answer: (
            <p>
              Both run Claude Code, Codex, and other coding agents in parallel
              Git worktrees. bb is free for any team size, open source, and runs
              on Mac, Windows, and Linux. Conductor is a closed-source Mac app
              that’s free locally, with cloud workspaces, scheduled routines,
              multiplayer, and its mobile app on the Pro plan, at $50 a month.
              In bb, one agent can start another and hear back without you in
              the middle.
            </p>
          ),
        },
        {
          question: "What are the best Conductor alternatives?",
          answer: (
            <p>
              It depends on how you work. Use bb if you want agents to hand work
              to each other, free phone access, and Windows or Linux. Pick
              Claude Code desktop or the ChatGPT desktop app if you only use one
              company’s agent. <a href="/compare/bb-vs-superset">Superset</a>{" "}
              suits a review-first workspace per task, Emdash starts agents from
              Linear, GitHub, or Jira tickets, Nimbalyst edits docs and designs
              beside the code, and Claude Squad keeps you in the terminal.
            </p>
          ),
        },
        {
          question: "Is there a free, open-source Conductor alternative?",
          answer: (
            <p>
              Yes: bb. It’s free for any team size and MIT-licensed, so you can
              use and change it for anything, including at work. Conductor is
              closed source and free only for local workspaces on a Mac, with
              Pro at $50 a month and Teams at $60 per person a month.{" "}
              <a href="/download/macos">Download bb</a>.
            </p>
          ),
        },
        {
          question: "How do I switch from Conductor to bb?",
          answer: (
            <p>
              There’s nothing to migrate. Install bb and add the same repo
              folder. Conductor’s workspaces are plain Git branches, so bb picks
              up unfinished work where it is, and Conductor keeps working while
              you try bb.
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
        faqSchedule("Conductor’s routines run only in its cloud, on Pro."),
      ],
    },
    {
      title: "Price and license",
      items: [
        faqFree(
          ", while Conductor puts its mobile app, cloud workspaces, and routines on its Pro plan, at $50 a month",
        ),
        FAQ_SUBSCRIPTIONS,
        faqUsageLimit(null),
      ],
    },
    {
      title: "Agents",
      items: [
        FAQ_AGENTS,
        FAQ_CODEX_TOGETHER,
        faqTalk(
          ", while Conductor connects agents through MCP or its Pro cloud workspaces",
        ),
        FAQ_PARALLEL,
        FAQ_PERMISSIONS,
      ],
    },
    {
      title: "Mobile and remote",
      items: [
        faqPhone(
          "Conductor’s iPhone app works with its cloud workspaces, on the $50-a-month Pro plan.",
        ),
        FAQ_LAPTOP,
      ],
    },
    {
      title: "Platforms, privacy, and teams",
      items: [
        faqPlatforms("Conductor runs only on macOS."),
        FAQ_PRIVACY,
        faqTeam(", while Conductor Teams costs $60 per person a month"),
      ],
    },
  ],
  closer: CLOSER,
};
