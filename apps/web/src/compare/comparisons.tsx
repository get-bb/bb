import type { ReactNode } from "react";

import supersetIcon from "../assets/competitors/superset.png";
import { WINDOWS_DOWNLOAD_URL } from "../landing/site";
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

export type Mark = "yes" | "partial" | "no";

export type CompareCell = {
  mark: Mark | null;
  value: string;
  text: string;
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
  tableNote: string;
  table: CompareGroup[];
  faqTitle: string;
  faq: CompareFaqGroup[];
  closer: { title: string; body: string };
};

function cell(mark: Mark | null, text = "", pro = false): CompareCell {
  return { mark, value: "", text, pro };
}

function price(value: string, text: string): CompareCell {
  return { mark: null, value, text, pro: false };
}

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
        {
          question: "How do I get started?",
          answer: (
            <p>
              Download bb for <a href="/download/macos">macOS</a> (Apple
              Silicon), <a href={WINDOWS_DOWNLOAD_URL}>Windows</a>, or{" "}
              <a href="/download/linux">Linux</a> (alpha), or run{" "}
              <code>npx bb-app@latest</code> in a terminal on any of them,
              including Intel Macs; that needs Node.js 22.19 or later. You also
              need at least one coding agent, like Claude Code, Codex, Cursor,
              or OpenCode, installed and signed in. Then add your repo folder
              and start a thread.
            </p>
          ),
        },
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
        {
          question: "Can I customize bb with plugins or scripts?",
          answer: (
            <p>
              Yes. bb works out of the box, with worktrees, diff review,
              automations, and the mobile app ready from your first thread. When
              you want more, install plugins from the{" "}
              <a href="/marketplace">marketplace</a> or ask an agent to build
              one. Plugins can add panels, commands, and new agents, and they
              work in the mobile app too. Everything in the app is also in the
              bb CLI and HTTP API, so scripts and other agents can start,
              message, and manage threads.
            </p>
          ),
        },
        {
          question: "Can I review and merge an agent’s changes in bb?",
          answer: (
            <p>
              Yes, without leaving the thread. Select lines in its diff and
              choose Add to chat to send feedback. Once the agent opens a pull
              request, the thread shows its checks and a Merge button. The
              GitHub plugin adds Review with agent to any PR.
            </p>
          ),
        },
        {
          question: "Can bb run agents on a schedule?",
          answer: (
            <p>
              Yes, free. Automations start an agent thread or run a script on a
              repeating schedule, once at a set time, or after a delay.
              Superset’s automations only repeat and need Pro. Pick the agent,
              model, and permission mode, and give each run its own worktree if
              you like.
            </p>
          ),
        },
      ],
    },
    {
      title: "Price and license",
      items: [
        {
          question: "Is bb free and open source?",
          answer: (
            <p>
              Yes, for one person or a whole team. The mobile app, remote
              machines, automations, and plugins are all included, while
              Superset puts its mobile app, remote machines, and automations on
              its $20-per-user Pro plan. You pay only for the agent plans or API
              keys you already use, from any provider. The code is on{" "}
              <a href="https://github.com/get-bb/bb">GitHub</a> under the MIT
              license.
            </p>
          ),
        },
        {
          question: "Can I use my existing AI subscriptions with bb?",
          answer: (
            <p>
              Yes. bb runs the agents you already use, signed in the way you
              already pay for them: a Claude Pro or Max plan, a ChatGPT plan for
              Codex, a Cursor plan, API keys, or any other provider’s plan. Your
              existing setup comes along too (CLAUDE.md, skills, MCP servers,
              and agent settings).
            </p>
          ),
        },
        {
          question: "Can bb switch accounts when I hit a usage limit?",
          answer: (
            <p>
              Yes, with Account Pooler, an experimental plugin built into bb.
              Turn it on and add the Claude Code and Codex accounts you own.
              When one account hits its limit, bb moves the thread’s requests to
              the next one, so it keeps running. Superset can hold several
              accounts, but you pick the default yourself, and a running agent
              keeps its account until you relaunch it.
            </p>
          ),
        },
      ],
    },
    {
      title: "Agents",
      items: [
        {
          question: "Which coding agents does bb support?",
          answer: (
            <p>
              Claude Code, Codex, Cursor, and OpenCode, plus Pi, Grok Build,
              omp, and Hermes Agent. In Settings, add any other agent that
              supports the Agent Client Protocol (ACP), an open standard for
              connecting coding agents to apps, like Gemini CLI or Devin. You
              can also add one with a plugin. Each thread can use a different
              agent.
            </p>
          ),
        },
        {
          question: "Can I use Claude Code and Codex together?",
          answer: (
            <p>
              Yes. Ask Claude Code to “start a bb Codex thread to review this
              branch, then fix what it finds.” It starts Codex in the same
              worktree, waits, and applies the fixes. Codex shows up as its own
              thread, so you can read the exact prompt Claude sent, watch it
              work, and message it mid-run. Any other pair works the same way,
              like Cursor and OpenCode.
            </p>
          ),
        },
        {
          question: "Can my coding agents talk to each other?",
          answer: (
            <p>
              Yes, and there’s no coordinator to set up; Superset does this
              through a coordinator skill. Tell your agents to work together and
              they coordinate on their own: any agent can message another
              thread, whatever the provider, agents answer each other’s
              messages, and an agent hears back automatically when a thread it
              started finishes or fails. The receiving thread shows each message
              and who sent it, and you can step in and message any of them
              yourself.
            </p>
          ),
        },
        {
          question: "Can I run multiple coding agents in parallel?",
          answer: (
            <p>
              Yes. Give each thread its own Git worktree so agents don’t
              overwrite each other’s changes. List your .env files and setup
              commands once, and bb prepares every new worktree. By default, bb
              runs one thread per processor core and starts the rest as others
              finish.
            </p>
          ),
        },
        {
          question: "Can I control what my agents are allowed to do?",
          answer: (
            <p>
              Yes. Pick a permission mode for each thread. Accept Edits applies
              changes inside the project and asks before anything else. Approve
              for me reviews requests automatically and sends high-risk ones to
              you. Full Access skips approvals and can run anything on your
              machine. Allow or deny approvals from your computer or your phone.
            </p>
          ),
        },
      ],
    },
    {
      title: "Mobile and remote",
      items: [
        {
          question: "Can I control my coding agents from my phone?",
          answer: (
            <p>
              Yes, for free. Use the bb mobile app, a public beta on iPhone
              through TestFlight (Apple’s beta testing app) and in alpha on
              Android, or open bb in any browser through bb Connect, bb’s free
              remote access. Superset’s iPhone app needs Pro and iOS 26, its
              Android app is a waitlist, and it has no browser access.
            </p>
          ),
        },
        {
          question: "Will my agents keep running when I close my laptop?",
          answer: (
            <p>
              Not on that laptop. Agents run on your machine, and closing the
              lid puts it to sleep. On a Mac, switch on Keep Awake, a built-in
              bb plugin that stops idle sleep while bb runs. For long runs, add
              an always-on desktop or server to bb, or run threads in the cloud
              with a <a href="/marketplace">cloud plugin</a> like Modal Sandbox,
              which is built in (experimental) and starts each thread in an
              on-demand sandbox in your own Modal account.
            </p>
          ),
        },
      ],
    },
    {
      title: "Platforms, privacy, and teams",
      items: [
        {
          question: "Does bb run on Mac, Windows, and Linux?",
          answer: (
            <p>
              Yes. Download the app for{" "}
              <a href="/download/macos">Apple Silicon Macs</a>,{" "}
              <a href={WINDOWS_DOWNLOAD_URL}>Windows</a>, or{" "}
              <a href="/download/linux">Linux</a> (alpha), or run{" "}
              <code>npx bb-app@latest</code> on an Intel Mac. Superset doesn’t
              run on Windows yet.
            </p>
          ),
        },
        {
          question: "Is my code private with bb?",
          answer: (
            <p>
              Yes: bb runs on your machines, so your code goes only where your
              agents send it, the AI providers you chose. Anonymous usage stats
              exclude code and prompts and can be turned off. The bb Connect
              relay doesn’t store traffic, but isn’t end-to-end encrypted.
            </p>
          ),
        },
        {
          question: "Can my team use bb?",
          answer: (
            <p>
              Yes, free at any team size, while Superset charges $20 per user a
              month for teams. Each person runs bb on their own machines with
              their own agent subscriptions and shares work through Git and pull
              requests as usual. bb doesn’t offer team plans, SSO, or a support
              SLA.
            </p>
          ),
        },
      ],
    },
  ],
  closer: {
    title: "Get your agents working together",
    body: "Free and open source. Bring the AI plans you already pay for.",
  },
};

export const COMPARISONS: Comparison[] = [BB_VS_SUPERSET];

export function getComparison(slug: string): Comparison | undefined {
  return COMPARISONS.find((comparison) => comparison.slug === slug);
}
