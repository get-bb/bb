import type { ReactNode } from "react";

import supersetIcon from "../assets/competitors/superset.png";
import { CustomizeBuild, ProviderChips } from "../landing/landing-visuals";
import {
  AgentSplit,
  AnywhereVisual,
  TeamCost,
  type BrandLogo,
} from "./compare-visuals";

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
  switchGuide: { label: string; href: string };
  highlights: CompareHighlight[];
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
      title: "Run more agents, $0 more.",
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
            you run one agent on your own or a whole team runs dozens.
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
            the release notes.
          </p>
          <p>
            They pass work back and forth on their own, so you get finished,
            reviewed work without copying between tools.
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
      visual: <AnywhereVisual />,
      body: (
        <>
          <p>
            Start tasks, answer your agents, and approve their work from the bb
            desktop app, the mobile app, or any browser.
          </p>
          <p>
            Run agents on your laptop, a desktop at home, or a cloud server, and
            manage them all from one bb. They keep working while you’re out.
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
            bb works out of the box. Worktrees, diff review, automations,
            notifications, and the mobile app are ready from your first thread,
            with defaults you can change anytime in Settings.
          </p>
          <p>
            When you want more, browse the{" "}
            <a href="/marketplace">plugin marketplace</a> or ask an agent to
            build exactly what you need: a chief of staff that triages your
            inbox, a research agent that tracks the topics you follow, or a
            morning digest of everything your agents did. Everything you add
            shows up on your phone too.
          </p>
        </>
      ),
    },
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
          bb: cell("yes", "Through WSL2"),
          competitor: cell("no", "Planned, no date"),
        },
        {
          feature: "iOS app",
          bb: cell("yes", "TestFlight beta"),
          competitor: cell("partial", "iOS 26+", true),
        },
        {
          feature: "Android app",
          bb: cell("partial", "In testing, browser works"),
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
      title: "Only in bb",
      rows: [
        {
          feature: "Side chats",
          bb: cell("yes", "Ask without derailing the agent"),
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
