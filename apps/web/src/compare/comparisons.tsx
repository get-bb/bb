import type { ReactNode } from "react";

import supersetIcon from "../assets/competitors/superset.png";
import { SpawnSidebar } from "../landing/landing-visuals";
import { PhoneApproval, TeamCost, type BrandLogo } from "./compare-visuals";

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
};

export type CompareFaq = {
  question: string;
  answer: ReactNode;
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
  table: CompareGroup[];
  faqTitle: string;
  faq: CompareFaq[];
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
  sub: "Run Claude Code and Codex side by side, let them hand off work, and approve from your phone.",
  switchGuide: {
    label: "Switching from Superset? Read the guide",
    href: "/guides/move-from-superset-to-bb",
  },
  highlights: [
    {
      title: "Nothing behind a paywall",
      visual: (
        <TeamCost
          plan="Superset Pro"
          logo={SUPERSET_LOGO}
          yearlyPerSeatMonthly={15}
          included={["Phone access", "Automations", "Remote access", "Plugins"]}
        />
      ),
      body: (
        <>
          <p>
            bb is free and MIT-licensed, with no paid tier. Phone access,
            automations, remote access to your machine, and plugins are all
            included.
          </p>
          <p>You pay only for the agent subscriptions you already have.</p>
        </>
      ),
    },
    {
      title: "Agents that hand off to each other",
      visual: <SpawnSidebar />,
      body: (
        <>
          <p>
            Ask Claude Code to have Codex review its branch. Claude starts the
            Codex thread, waits for the review, and fixes what it finds. You
            never paste a diff between terminals.
          </p>
          <p>
            Every agent it starts gets its own thread in your sidebar. Open it,
            see its instructions, and step in anytime.
          </p>
        </>
      ),
    },
    {
      title: "Approve from your phone, free",
      visual: <PhoneApproval />,
      body: (
        <>
          <p>
            Approve a command, answer a question, or start a task from any phone
            browser. For push alerts, add the bb iOS app, in beta on TestFlight.
          </p>
          <p>Superset keeps its phone app behind Pro.</p>
        </>
      ),
    },
  ],
  tableTitle: "bb vs Superset, feature by feature",
  table: [
    {
      title: "Price and plans",
      rows: [
        {
          feature: "Price",
          bb: cell(null, "Free, no paid tier"),
          competitor: cell(
            null,
            "Free for 1 user. Pro $20 per user / month, $15 billed yearly",
          ),
        },
        {
          feature: "Team plans, SSO, SLA",
          bb: cell("no"),
          competitor: cell("yes", "Teams on Pro. SSO and SLA on Enterprise"),
        },
      ],
    },
    {
      title: "Agents",
      rows: [
        {
          feature: "Claude Code and Codex",
          bb: cell("yes"),
          competitor: cell("yes"),
        },
        {
          feature: "Other agents",
          bb: cell("yes", "Pi, Cursor, OpenCode, Grok, any ACP agent"),
          competitor: cell(
            "yes",
            "20+ built in, including Pi, Cursor, and Grok",
          ),
        },
        {
          feature: "Agents start and manage other agents",
          bb: cell("yes", "Each one a thread you can open and message"),
          competitor: cell("yes", "Through a bundled skill, its CLI, and MCP"),
        },
      ],
    },
    {
      title: "Workspace",
      rows: [
        {
          feature: "Worktree per task",
          bb: cell("yes", "One click, remembered per project"),
          competitor: cell("yes", "Automatic"),
        },
        {
          feature: "Diff review",
          bb: cell("yes", "Send selected lines to an agent"),
          competitor: cell("yes", "Send selected PR lines to an agent"),
        },
        {
          feature: "File editor",
          bb: cell("yes", "Built-in plugin, off by default"),
          competitor: cell("yes"),
        },
        {
          feature: "Terminal and browser",
          bb: cell("yes", "Browser in the desktop app"),
          competitor: cell("yes"),
        },
        {
          feature: "Plugins",
          bb: cell("yes", "Including ones your agents write"),
          competitor: cell("partial", "Agent integrations and themes"),
        },
        {
          feature: "Linear and Slack",
          bb: cell("no"),
          competitor: cell("yes", "", true),
        },
      ],
    },
    {
      title: "Phone and remote",
      rows: [
        {
          feature: "Phone",
          bb: cell("yes", "Any phone browser, plus an iOS beta"),
          competitor: cell("yes", "iPhone app, iOS 26 or later", true),
        },
        {
          feature: "Remote access to your machine",
          bb: cell("yes"),
          competitor: cell("yes", "", true),
        },
        {
          feature: "Run agents on other machines",
          bb: cell("yes"),
          competitor: cell("yes", "Remote hosts", true),
        },
        {
          feature: "Automations",
          bb: cell("yes"),
          competitor: cell("yes", "", true),
        },
      ],
    },
    {
      title: "Platform",
      rows: [
        { feature: "macOS", bb: cell("yes"), competitor: cell("yes") },
        {
          feature: "Linux",
          bb: cell("partial", "Alpha"),
          competitor: cell("partial", "Experimental"),
        },
        {
          feature: "Windows",
          bb: cell("partial", "Through WSL2"),
          competitor: cell("no", "Planned"),
        },
        {
          feature: "Open source",
          bb: cell("yes", "MIT"),
          competitor: cell("partial", "Elastic License 2.0"),
        },
      ],
    },
  ],
  faqTitle: "bb vs Superset: common questions",
  faq: [
    {
      question: "What’s the difference between bb and Superset?",
      answer: (
        <p>
          Superset gives each agent its own workspace. bb lets your agents work
          as a team. Both run Claude Code, Codex, and other agents in parallel,
          each task in its own Git worktree. In bb, one agent can start another,
          wait for it, and act on what it finds, and phone access and
          automations are free instead of on a paid plan.
        </p>
      ),
    },
    {
      question: "What’s the best Superset alternative?",
      answer: (
        <p>
          bb is the best Superset alternative if you use more than one coding
          agent. It’s free and MIT-licensed, runs Claude Code, Codex, Cursor,
          OpenCode, and any ACP agent, and lets one agent hand work to another.
          Phone access, automations, and extra machines are included. Comparing
          more tools?{" "}
          <a href="/compare/conductor-alternatives">
            See our Conductor alternatives roundup
          </a>
          .
        </p>
      ),
    },
    {
      question: "Is bb really free?",
      answer: (
        <p>
          Yes. bb is MIT-licensed with no paid tier. Phone access, automations,
          remote access to your machine, and plugins are all included, and bb
          Connect needs only a free account. You pay only for the Claude,
          ChatGPT, or other agent plans and API keys you already use.
        </p>
      ),
    },
    {
      question: "Is Superset free? How much does it cost?",
      answer: (
        <p>
          Superset’s free plan covers one user with local workspaces, the
          desktop app, and the CLI. Pro is $20 per user per month, or $15 billed
          yearly, and adds more users, remote access, automations, the mobile
          app, and Slack and Linear. Enterprise is custom-priced. bb includes
          phone access, automations, and remote access for free.
        </p>
      ),
    },
    {
      question: "Is Superset open source?",
      answer: (
        <p>
          No. Superset is source-available under the Elastic License 2.0, which
          isn’t an OSI-approved open-source license. bb is MIT-licensed end to
          end: fork it, change anything, run your own build, or have an agent
          write you a plugin.
        </p>
      ),
    },
    {
      question: "Can I use Claude Code and Codex together?",
      answer: (
        <p>
          Yes, and in bb they work together, not just side by side. Tell Claude
          Code: “When you’re done, start a bb Codex thread to review this
          branch, then fix what it finds.” Claude starts Codex in the same
          worktree, waits for the review, and applies the fixes.{" "}
          <a href="/guides/claude-code-and-codex-together">See how</a>.
        </p>
      ),
    },
    {
      question: "Can’t Superset’s agents start other agents too?",
      answer: (
        <p>
          Yes, through Superset’s CLI, SDK, and MCP server. What’s different in
          bb is what you can see: every agent another agent starts is its own
          thread in your sidebar, with the exact prompt it got, its tool calls,
          and its answer. You can message it mid-run, with any agent, in either
          direction.
        </p>
      ),
    },
    {
      question: "Which agents does bb support?",
      answer: (
        <p>
          Claude Code, Codex, and Pi through their own integrations, plus
          Cursor, OpenCode, Grok Build, omp, Hermes Agent, and any other agent
          that speaks the Agent Client Protocol. You choose the agent for each
          thread.
        </p>
      ),
    },
    {
      question: "Do my Claude Code and Codex logins carry over?",
      answer: (
        <p>
          Yes. bb runs the agent CLIs you’re already signed in to, with your{" "}
          <code>CLAUDE.md</code>, skills, MCP servers, and <code>~/.codex</code>{" "}
          config. There’s nothing to set up again.
        </p>
      ),
    },
    {
      question: "Can I move my Superset projects to bb?",
      answer: (
        <p>
          Yes. Your repo, branches, and worktrees are plain Git, so they come
          with you, and bb can work inside an existing Superset worktree. Your
          setup and teardown scripts map to bb’s own setup files.{" "}
          <a href="/guides/move-from-superset-to-bb">
            Follow the step-by-step guide
          </a>
          .
        </p>
      ),
    },
    {
      question: "Can I use bb and Superset together?",
      answer: (
        <p>
          Yes. Both work on the same repo with plain Git and the same agent
          logins. Try bb on one real task this week and keep what fits.
        </p>
      ),
    },
    {
      question: "Can I control my coding agents from my phone?",
      answer: (
        <p>
          Yes, for free. bb Connect gives your computer a private address only
          you can open, so the whole app works in your phone’s browser: approve
          commands, answer questions, or start tasks. For push alerts, install
          the bb iOS app, in public TestFlight beta. In Superset, the mobile app
          is on Pro.{" "}
          <a href="/guides/steer-coding-agents-from-your-phone">Set it up</a>.
        </p>
      ),
    },
    {
      question: "Does Superset work on Windows?",
      answer: (
        <p>
          Not yet. Superset runs on macOS, with an experimental Linux build. bb
          runs on Windows through WSL2 and on Linux as an alpha with{" "}
          <code>npx bb-app@latest</code>. The desktop app is for Apple Silicon
          Macs, and Intel Macs use <code>npx</code> too.
        </p>
      ),
    },
    {
      question: "Can bb run agents on a schedule?",
      answer: (
        <p>
          Yes, free. Schedule an agent thread or a script with a cron
          expression, or once at a set time or after a delay. Choose the agent,
          model, and permission mode, and give each run a fresh worktree if you
          like. In Superset, automations are on Pro.
        </p>
      ),
    },
    {
      question: "How many agents can I run in parallel?",
      answer: (
        <p>
          As many as your machines can handle. By default, bb runs one thread
          per processor core on each machine and queues the rest until a thread
          goes idle. Change the limit, or enroll a desktop, mini PC, or cloud
          server and run threads on all of them from one bb.
        </p>
      ),
    },
    {
      question: "How do I handle .env files and databases in each worktree?",
      answer: (
        <p>
          With small files at your repo root. <code>.worktreeinclude</code>{" "}
          copies files like <code>.env</code> from your main checkout into every
          new worktree. <code>.bb-env-setup.sh</code> runs before the agent
          starts, so it can install dependencies or start a database, and{" "}
          <code>.bb-env-teardown.sh</code> cleans up when the worktree goes.
        </p>
      ),
    },
    {
      question: "How do I review an agent’s changes in bb?",
      answer: (
        <p>
          Each thread has a diff of its changes. Select lines and choose{" "}
          <strong>Add to chat</strong> to send feedback to the agent. Once it
          opens a PR, the thread shows the checks and a <strong>Merge</strong>{" "}
          button. The GitHub plugin adds your issues and PRs, with{" "}
          <strong>Review with agent</strong> on any PR.
        </p>
      ),
    },
    {
      question: "Does bb replace my editor?",
      answer: (
        <p>
          No. bb is where your agents work. The desktop app opens files in the
          editor you already use, like VS Code, Cursor, or Zed.
        </p>
      ),
    },
    {
      question: "Is my code private?",
      answer: (
        <p>
          bb runs on your machines, and your agents talk to their providers
          exactly as they do without bb. bb’s usage events are anonymous, never
          include code, prompts, or project names, and can be turned off. bb
          Connect’s relay doesn’t store your traffic, and you can use Tailscale
          instead.
        </p>
      ),
    },
    {
      question: "Does bb have team plans or SSO?",
      answer: (
        <p>
          No. bb is a free app for your own machines, with no seats to buy. If
          your company needs SAML SSO, SCIM, audit logs, or an uptime SLA,
          Superset’s Enterprise plan is built for that.
        </p>
      ),
    },
    {
      question: "When is Superset the better choice?",
      answer: (
        <p>
          If you review one agent’s patch at a time and want a diff, file
          editor, terminals, browser, and port management in one window, or you
          need paid team seats and Linear or Slack integrations, Superset is a
          great fit.
        </p>
      ),
    },
    {
      question: "How do I get started with bb?",
      answer: (
        <p>
          Download the Mac app or run <code>npx bb-app@latest</code>, add a
          repo, and start a thread. bb uses the Claude Code and Codex logins you
          already have, so your first agent runs in about a minute.
        </p>
      ),
    },
  ],
  closer: {
    title: "Try bb on your next task",
    body: "Free and open source. It works on the same repo as Superset, so you can try it without switching anything.",
  },
};

const COMPARISONS: Comparison[] = [BB_VS_SUPERSET];

export function getComparison(slug: string): Comparison | undefined {
  return COMPARISONS.find((comparison) => comparison.slug === slug);
}
