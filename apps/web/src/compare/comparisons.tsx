import type { ReactNode } from "react";

import supersetIcon from "../assets/competitors/superset.png";
import { CustomizeBuild, ProviderChips } from "../landing/landing-visuals";
import {
  AgentSplit,
  PhoneApp,
  TeamCost,
  type BrandLogo,
} from "./compare-visuals";

export type Mark = "yes" | "partial" | "no";

export type CompareCell = {
  mark: Mark | null;
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
  switchGuide: { label: string; href: string };
  highlights: CompareHighlight[];
  tableTitle: string;
  tableNote: string;
  table: CompareGroup[];
  faqTitle: string;
  faq: CompareFaqGroup[];
  closer: { title: string; body: string };
};

function cell(mark: Mark | null, text = "", pro = false): CompareCell {
  return { mark, text, pro };
}

const SUPERSET_LOGO: BrandLogo = { kind: "image", src: supersetIcon };

const BB_VS_SUPERSET: Comparison = {
  slug: "bb-vs-superset",
  title: "bb vs Superset: The Free, Open-Source Alternative",
  description:
    "bb is a free, open-source Superset alternative. Run Claude Code and Codex in parallel, let agents hand off work, and approve from your phone. No Pro plan.",
  competitor: { name: "Superset", logo: SUPERSET_LOGO },
  headline: "The free, open-source Superset alternative",
  sub: "Get Claude Code, Codex or any agent working together on the same task, and approve from your phone.",
  switchGuide: {
    label: "Switching from Superset? Read the guide",
    href: "/guides/move-from-superset-to-bb",
  },
  highlights: [
    {
      title: "More agents and teammates. $0 more.",
      wide: false,
      visual: (
        <TeamCost
          plan="Superset Pro"
          logo={SUPERSET_LOGO}
          yearlyPerSeatMonthly={15}
        />
      ),
      body: (
        <>
          <p>
            You only pay for the AI plans you already have. bb is free, whether
            one person runs one agent or a whole team runs dozens.
          </p>
          <p>
            The mobile app, automations, remote access, and plugins all come
            included.
          </p>
        </>
      ),
    },
    {
      title: "Agents that work together like a team",
      wide: true,
      visual: <AgentSplit />,
      body: (
        <>
          <p>
            Claude Code builds a feature, Codex reviews it, and Cursor writes
            the release notes. They pass work back and forth on their own, so
            you get finished, reviewed work without copying between tools.
          </p>
          <div className="providers cmp-providers">
            <span className="label">Works with any agent</span>
            <ProviderChips />
          </div>
          <p className="cmp-providers-note">
            Need another? Add it with a <a href="/marketplace">plugin</a>.
          </p>
        </>
      ),
    },
    {
      title: "Keep working from anywhere",
      wide: false,
      visual: <PhoneApp />,
      body: (
        <>
          <p>
            Start tasks, answer your agents, and approve their work from the bb
            mobile app or any browser. Your agents keep running on your computer
            while you’re out.
          </p>
        </>
      ),
    },
    {
      title: "Turn bb into the tool you need",
      wide: false,
      visual: <CustomizeBuild />,
      body: (
        <>
          <p>
            bb works out of the box. When you need more, add a plugin or ask an
            agent to build one, like a task board, a dashboard, or a new agent.
            It shows up on your phone too.
          </p>
        </>
      ),
    },
  ],
  tableTitle: "bb vs Superset, feature by feature",
  tableNote:
    "Pro marks features that need a paid Superset plan, from $20 per user / month.",
  table: [
    {
      title: "Agents",
      rows: [
        {
          feature: "Claude Code, Codex, and more",
          bb: cell("yes", "Plus any you add"),
          competitor: cell("yes", "Any CLI agent"),
        },
        {
          feature: "Agents hand off work to each other",
          bb: cell("yes", "Spawn, message, wait"),
          competitor: cell("yes", "Via terminal read/send"),
        },
      ],
    },
    {
      title: "Away from your desk",
      rows: [
        {
          feature: "Mobile app",
          bb: cell("yes", "iOS beta, any browser"),
          competitor: cell("partial", "iPhone only, iOS 26+", true),
        },
        {
          feature: "Run agents on other machines",
          bb: cell("yes", "Enroll any machine"),
          competitor: cell("partial", "Via Superset relay", true),
        },
        {
          feature: "Scheduled automations",
          bb: cell("yes", "Cron, one-shot, scripts"),
          competitor: cell("partial", "Recurring only", true),
        },
      ],
    },
    {
      title: "Worktrees and review",
      rows: [
        {
          feature: "Worktree per task",
          bb: cell("yes", ".env copy, setup, teardown"),
          competitor: cell("yes", "Setup, teardown, run"),
        },
        {
          feature: "Diff review and PR merge",
          bb: cell("yes"),
          competitor: cell("yes"),
        },
        {
          feature: "Terminal and browser",
          bb: cell("yes", "Browser on desktop"),
          competitor: cell("yes"),
        },
        {
          feature: "File editor",
          bb: cell("yes", "Opt-in plugin"),
          competitor: cell("yes"),
        },
        {
          feature: "Dev server ports",
          bb: cell("no"),
          competitor: cell("yes", "Detect, label, kill"),
        },
      ],
    },
    {
      title: "Integrations",
      rows: [
        {
          feature: "Plugins",
          bb: cell("yes", "Gallery or agent-built"),
          competitor: cell("partial", "Themes and integrations"),
        },
        {
          feature: "Linear",
          bb: cell("yes", "Community plugin"),
          competitor: cell("partial", "", true),
        },
        {
          feature: "Slack",
          bb: cell("no"),
          competitor: cell("partial", "@superset agent bot", true),
        },
      ],
    },
    {
      title: "Platform and license",
      rows: [
        {
          feature: "Windows",
          bb: cell("yes", "Through WSL2"),
          competitor: cell("no", "Planned, no date"),
        },
        {
          feature: "Linux",
          bb: cell("partial", "Alpha"),
          competitor: cell("partial", "Experimental AppImage"),
        },
        {
          feature: "Open source",
          bb: cell("yes", "MIT"),
          competitor: cell("no", "Elastic License 2.0"),
        },
      ],
    },
    {
      title: "Teams and price",
      rows: [
        {
          feature: "Team plans, SSO, SLA",
          bb: cell("no"),
          competitor: cell("partial", "SSO on Enterprise", true),
        },
        {
          feature: "Price",
          bb: cell(null, "$0, any team size"),
          competitor: cell(null, "$0 solo, $20/user/mo"),
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
          question: "Is there a free, open-source Superset alternative?",
          answer: (
            <p>
              Yes: bb is free and MIT-licensed. It runs Claude Code, Codex, and
              other coding agents on your own machines, lets them start and
              message each other, and includes a mobile app. Comparing more
              tools? See the{" "}
              <a href="/compare/conductor-alternatives">
                Conductor alternatives roundup
              </a>
              .
            </p>
          ),
        },
        {
          question: "How do I switch from Superset to bb?",
          answer: (
            <p>
              Add your repo to bb. Branches and worktrees are plain Git, so bb
              can work in an existing Superset worktree, and your setup scripts
              map to bb’s setup files. Chats don’t carry over, and Superset
              keeps working while you try bb. Follow the{" "}
              <a href="/guides/move-from-superset-to-bb">step-by-step guide</a>.
            </p>
          ),
        },
      ],
    },
    {
      title: "Price and license",
      items: [
        {
          question: "Is bb free?",
          answer: (
            <p>
              Yes. bb has no paid tier, for one person or a whole team. The
              mobile app, automations, remote access, and plugins are all
              included. You pay only for the Claude, ChatGPT, or other agent
              plans and API keys you already use.
            </p>
          ),
        },
        {
          question: "Is bb open source?",
          answer: (
            <p>
              Yes. bb is MIT-licensed, and the code is on{" "}
              <a href="https://github.com/get-bb/bb">GitHub</a>. Read it, fork
              it, change anything, and run your own build.
            </p>
          ),
        },
        {
          question: "Can I use my Claude Max or ChatGPT subscription with bb?",
          answer: (
            <p>
              Yes. bb runs the Claude Code and Codex you’re already signed in
              to, so your Claude Pro or Max and ChatGPT plans work as they do
              today, along with your CLAUDE.md, skills, MCP servers, and Codex
              settings. API keys work too.
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
              Claude Code, Codex, Pi, Cursor, OpenCode, Grok Build, omp, and
              Hermes Agent. Add any other agent that supports the open Agent
              Client Protocol, like Gemini CLI or Devin, in Settings, or add one
              with a plugin. You pick the agent for each thread.
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
              thread you can open.{" "}
              <a href="/guides/claude-code-and-codex-together">See how</a>.
            </p>
          ),
        },
        {
          question: "Can my coding agents talk to each other?",
          answer: (
            <p>
              Yes. Tell them to work together, and any agent can message another
              thread, whatever the provider: mid-task, or queued until it
              finishes. The receiving thread shows each message and who sent it,
              and you can step in and message any of them yourself.
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
              runs one thread per processor core and queues the rest.
            </p>
          ),
        },
        {
          question: "Can I control what my agents are allowed to do?",
          answer: (
            <p>
              Yes. Pick a permission mode for each thread: Accept Edits, Approve
              for me, or Full Access. When an agent needs your approval, allow
              or deny it from your computer or your phone.
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
              Yes, for free. Install the bb mobile app for iPhone, in public
              beta on TestFlight, for push notifications, or open bb in any
              phone or computer browser through bb Connect. Start tasks, approve
              commands, answer questions, and review changes from anywhere.{" "}
              <a href="/guides/steer-coding-agents-from-your-phone">
                Set it up
              </a>
              .
            </p>
          ),
        },
        {
          question: "Is there an Android app?",
          answer: (
            <p>
              Not yet. On Android, open bb in your phone’s browser through bb
              Connect: the whole app works there, without push notifications. A
              native Android app is in testing.
            </p>
          ),
        },
        {
          question: "Will my agents keep running when I close my laptop?",
          answer: (
            <p>
              Not on that laptop. Agents run on your machine, and closing the
              lid puts it to sleep. On a Mac, Keep Awake stops idle sleep. For
              long runs, add an always-on desktop, mini PC, or cloud server to
              bb and run threads there.
            </p>
          ),
        },
      ],
    },
    {
      title: "Working in bb",
      items: [
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
              repeating schedule, once at a set time, or after a delay. Pick the
              agent, model, and permission mode, and give each run its own
              worktree if you like.
            </p>
          ),
        },
        {
          question: "Does bb replace my code editor?",
          answer: (
            <p>
              No. bb is where your agents work, and it opens files in the editor
              you already use, like VS Code, Cursor, or Zed. For quick edits
              inside bb, turn on the built-in code editor plugin.
            </p>
          ),
        },
        {
          question: "Can I customize bb with plugins?",
          answer: (
            <p>
              Yes. Install plugins from the{" "}
              <a href="/marketplace">marketplace</a>, or ask an agent to build
              one for you. Plugins can add panels, commands, and new agents.
              Everything you add works in the mobile app too, because it runs
              your own bb.
            </p>
          ),
        },
        {
          question: "Does bb have a CLI and an API?",
          answer: (
            <p>
              Yes. Everything in the app is also in the bb CLI and the HTTP API,
              so scripts, cron jobs, and other agents can start, message, and
              manage threads.
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
              Yes. Download the app for Apple Silicon Macs or Linux (alpha), or
              run <code>npx bb-app@latest</code> on Windows through WSL2 or an
              Intel Mac. Then add a repo and start a thread; there’s nothing
              else to set up.
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
              Yes, for free, with no seats to buy. Each person runs bb on their
              own machines with their own agent subscriptions. bb doesn’t offer
              team plans, SSO, or a support SLA.
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

const COMPARISONS: Comparison[] = [BB_VS_SUPERSET];

export function getComparison(slug: string): Comparison | undefined {
  return COMPARISONS.find((comparison) => comparison.slug === slug);
}
