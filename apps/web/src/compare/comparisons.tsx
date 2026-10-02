import type { ReactNode } from "react";

import supersetIcon from "../assets/competitors/superset.png";
import {
  AgentSplit,
  PhoneApp,
  PluginsPanel,
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
  sub: "Run Claude Code, Codex or any agent side by side, let them hand off work, and approve from your phone.",
  switchGuide: {
    label: "Switching from Superset? Read the guide",
    href: "/guides/move-from-superset-to-bb",
  },
  highlights: [
    {
      title: "Nothing behind a paywall",
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
            bb is free and MIT-licensed, with no paid tier. Phone access,
            automations, remote access to your machine, and plugins are all
            included.
          </p>
          <p>You pay only for the agent subscriptions you already have.</p>
        </>
      ),
    },
    {
      title: "Hand off work between agents",
      wide: true,
      visual: <AgentSplit />,
      body: (
        <>
          <p>
            Claude Code builds, Codex reviews, Cursor writes the release notes.
            Your agents message each other, and you watch them side by side.
          </p>
          <p>
            Works with any agent: Claude Code, Codex, Cursor, Pi, OpenCode,
            Devin. Need another? Add it with a plugin.
          </p>
        </>
      ),
    },
    {
      title: "Your whole bb, on your phone",
      wide: false,
      visual: <PhoneApp />,
      body: (
        <>
          <p>
            Start a task, check on every agent, reply, and review their work
            from anywhere. Open bb in any phone browser, or get push
            notifications with the bb iOS app, in beta on TestFlight.
          </p>
          <p>It’s free. Superset keeps its phone app behind Pro.</p>
        </>
      ),
    },
    {
      title: "Make bb yours, on every screen",
      wide: false,
      visual: <PluginsPanel />,
      body: (
        <>
          <p>
            Add a task board, GitHub, or your own tools from the plugin gallery,
            or ask an agent to build one. A panel, a command, or a theme shows
            up in bb as soon as it’s done.
          </p>
          <p>
            Your plugins come with you. bb’s phone app runs your own bb, so
            everything you add works on mobile too.
          </p>
        </>
      ),
    },
  ],
  tableTitle: "bb vs Superset, feature by feature",
  tableNote: "Pro marks features that need Superset Pro, $20 per user / month.",
  table: [
    {
      title: "Agents",
      rows: [
        {
          feature: "Claude Code, Codex, and more",
          bb: cell("yes", "Plus any ACP agent"),
          competitor: cell("yes", "20+ CLI agents"),
        },
        {
          feature: "Agents hand off work to each other",
          bb: cell("yes", "Each in its own thread"),
          competitor: cell("yes", "Through its CLI and MCP"),
        },
      ],
    },
    {
      title: "Phone, remote, and automations",
      rows: [
        {
          feature: "Phone app",
          bb: cell("yes", "Free. Browser or iOS beta"),
          competitor: cell("yes", "iPhone, iOS 26+", true),
        },
        {
          feature: "Automations",
          bb: cell("yes", "Free"),
          competitor: cell("yes", "", true),
        },
        {
          feature: "Reach your machine remotely",
          bb: cell("yes", "Free"),
          competitor: cell("yes", "", true),
        },
        {
          feature: "Run agents on other machines",
          bb: cell("yes", "Free"),
          competitor: cell("yes", "", true),
        },
      ],
    },
    {
      title: "Workspace",
      rows: [
        {
          feature: "Worktree per task",
          bb: cell("yes", "One click"),
          competitor: cell("yes", "Automatic"),
        },
        {
          feature: "Diff review with comments",
          bb: cell("yes"),
          competitor: cell("yes"),
        },
        {
          feature: "Terminal and browser",
          bb: cell("yes"),
          competitor: cell("yes"),
        },
        {
          feature: "File editor",
          bb: cell("yes", "As a plugin"),
          competitor: cell("yes"),
        },
        {
          feature: "Plugins",
          bb: cell("yes", "Your agents can write them"),
          competitor: cell("partial", "Themes and integrations"),
        },
      ],
    },
    {
      title: "Platform and license",
      rows: [
        {
          feature: "Windows",
          bb: cell("yes", "Through WSL2"),
          competitor: cell("no"),
        },
        {
          feature: "Linux",
          bb: cell("partial", "Alpha"),
          competitor: cell("partial", "Experimental"),
        },
        {
          feature: "Open source",
          bb: cell("yes", "MIT"),
          competitor: cell("no", "Source available"),
        },
      ],
    },
    {
      title: "Teams and price",
      rows: [
        {
          feature: "Linear",
          bb: cell("yes", "Plugin, free"),
          competitor: cell("yes", "", true),
        },
        {
          feature: "Slack",
          bb: cell("no"),
          competitor: cell("yes", "", true),
        },
        {
          feature: "Team plans, SSO, SLA",
          bb: cell("no"),
          competitor: cell("yes", "Pro and Enterprise"),
        },
        {
          feature: "Price",
          bb: cell(null, "Free"),
          competitor: cell(null, "Free for 1 user, then $20 per user / month"),
        },
      ],
    },
  ],
  faqTitle: "bb vs Superset: common questions",
  faq: [
    {
      title: "bb vs Superset",
      items: [
        {
          question: "What’s the difference between bb and Superset?",
          answer: (
            <p>
              Superset gives each agent its own workspace. bb lets your agents
              work as a team. Both run Claude Code, Codex, and other agents in
              parallel, each task in its own Git worktree. In bb, one agent can
              start another, wait for it, and act on what it finds, and phone
              access and automations are free instead of on a paid plan.
            </p>
          ),
        },
        {
          question: "What’s the best Superset alternative?",
          answer: (
            <p>
              bb is the best Superset alternative if you use more than one
              coding agent. It’s free and MIT-licensed, runs Claude Code, Codex,
              Cursor, OpenCode, and any ACP agent, and lets one agent hand work
              to another. Phone access, automations, and extra machines are
              included. Comparing more tools?{" "}
              <a href="/compare/conductor-alternatives">
                See our Conductor alternatives roundup
              </a>
              .
            </p>
          ),
        },
        {
          question: "When is Superset the better choice?",
          answer: (
            <p>
              If you review one agent’s patch at a time and want a diff, file
              editor, terminals, browser, and port management in one window, or
              you need paid team seats and a Slack integration, Superset is a
              great fit.
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
          question: "How is bb different from Conductor?",
          answer: (
            <p>
              Both run agents in parallel worktrees. Conductor is a Mac app with
              its mobile app and cloud workspaces on paid plans. bb is free and
              open source, runs on Linux and Windows through WSL2, and lets
              agents hand work to each other.{" "}
              <a href="/compare/conductor-alternatives">
                Compare Conductor alternatives
              </a>
              .
            </p>
          ),
        },
      ],
    },
    {
      title: "Pricing and license",
      items: [
        {
          question: "Is bb really free?",
          answer: (
            <p>
              Yes. bb is MIT-licensed with no paid tier. Phone access,
              automations, remote access to your machine, and plugins are all
              included, and bb Connect needs only a free account. You pay only
              for the Claude, ChatGPT, or other agent plans and API keys you
              already use.
            </p>
          ),
        },
        {
          question: "Is Superset free? How much does it cost?",
          answer: (
            <p>
              Superset’s free plan covers one user with local workspaces, the
              desktop app, and the CLI. Pro is $20 per user per month, or $15
              billed yearly, and adds more users, remote access, automations,
              the mobile app, and Slack and Linear. Enterprise is custom-priced.
              bb includes phone access, automations, and remote access for free.
            </p>
          ),
        },
        {
          question: "Is bb open source?",
          answer: (
            <p>
              Yes. bb is MIT-licensed end to end, and the code is on{" "}
              <a href="https://github.com/get-bb/bb">GitHub</a>. Fork it, change
              anything, and run your own build.
            </p>
          ),
        },
        {
          question: "Is Superset open source?",
          answer: (
            <p>
              No. Superset is source-available under the Elastic License 2.0,
              which isn’t an OSI-approved open-source license. bb is
              MIT-licensed end to end: fork it, change anything, run your own
              build, or have an agent write you a plugin.
            </p>
          ),
        },
        {
          question: "Do I need an API key?",
          answer: (
            <p>
              No. bb uses the Claude Code and Codex subscriptions you’re already
              signed in to, like Claude Pro or Max and ChatGPT plans. API keys
              work too if you prefer them.
            </p>
          ),
        },
      ],
    },
    {
      title: "Agents",
      items: [
        {
          question: "Which agents does bb support?",
          answer: (
            <p>
              Claude Code, Codex, and Pi through their own integrations, plus
              Cursor, OpenCode, Grok Build, omp, Hermes Agent, and any other
              agent that speaks the Agent Client Protocol. You choose the agent
              for each thread.
            </p>
          ),
        },
        {
          question: "Can I use Claude Code and Codex together?",
          answer: (
            <p>
              Yes, and in bb they work together, not just side by side. Tell
              Claude Code: “When you’re done, start a bb Codex thread to review
              this branch, then fix what it finds.” Claude starts Codex in the
              same worktree, waits for the review, and applies the fixes.{" "}
              <a href="/guides/claude-code-and-codex-together">See how</a>.
            </p>
          ),
        },
        {
          question: "Can’t Superset’s agents start other agents too?",
          answer: (
            <p>
              Yes, through Superset’s CLI, SDK, and MCP server. What’s different
              in bb is what you can see: every agent another agent starts is its
              own thread in your sidebar, with the exact prompt it got, its tool
              calls, and its answer. You can message it mid-run, with any agent,
              in either direction.
            </p>
          ),
        },
        {
          question:
            "Can I add an agent bb doesn’t list, like Gemini CLI or Devin?",
          answer: (
            <p>
              Yes. Add any agent that speaks the Agent Client Protocol in bb’s
              Custom agents setting, with the command that starts it. For
              anything else, a plugin can add a new agent provider.
            </p>
          ),
        },
        {
          question: "What is the Agent Client Protocol (ACP)?",
          answer: (
            <p>
              An open standard, started by Zed, for connecting coding agents to
              the apps you use them in. Agents like Cursor, OpenCode, Grok
              Build, and Devin speak it, which is how bb runs them alongside
              Claude Code and Codex.
            </p>
          ),
        },
        {
          question: "Do my Claude Code and Codex logins carry over?",
          answer: (
            <p>
              Yes. bb runs the agent CLIs you’re already signed in to, with your{" "}
              <code>CLAUDE.md</code>, skills, MCP servers, and{" "}
              <code>~/.codex</code> config. There’s nothing to set up again.
            </p>
          ),
        },
        {
          question: "How many agents can I run in parallel?",
          answer: (
            <p>
              As many as your machines can handle. By default, bb runs one
              thread per processor core on each machine and queues the rest
              until a thread goes idle. Change the limit, or enroll a desktop,
              mini PC, or cloud server and run threads on all of them from one
              bb.
            </p>
          ),
        },
        {
          question: "Can I control what agents are allowed to do?",
          answer: (
            <p>
              Yes. Each thread has a permission mode, from asking before
              commands to full access. When an agent needs approval, you allow
              or deny it from your desktop or your phone.
            </p>
          ),
        },
      ],
    },
    {
      title: "Working in bb",
      items: [
        {
          question: "How does bb use Git worktrees?",
          answer: (
            <p>
              Each thread can run in its own worktree, so agents never step on
              each other’s changes. Pick Worktree when you start a thread; bb
              remembers the choice per project and cleans up worktrees when you
              archive their threads.
            </p>
          ),
        },
        {
          question:
            "How do I handle .env files and databases in each worktree?",
          answer: (
            <p>
              With small files at your repo root. <code>.worktreeinclude</code>{" "}
              copies files like <code>.env</code> from your main checkout into
              every new worktree. <code>.bb-env-setup.sh</code> runs before the
              agent starts, so it can install dependencies or start a database,
              and <code>.bb-env-teardown.sh</code> cleans up when the worktree
              goes.
            </p>
          ),
        },
        {
          question: "How do I review an agent’s changes in bb?",
          answer: (
            <p>
              Each thread has a diff of its changes. Select lines and choose{" "}
              <strong>Add to chat</strong> to send feedback to the agent. Once
              it opens a PR, the thread shows the checks and a{" "}
              <strong>Merge</strong> button. The GitHub plugin adds your issues
              and PRs, with <strong>Review with agent</strong> on any PR.
            </p>
          ),
        },
        {
          question: "Can bb run agents on a schedule?",
          answer: (
            <p>
              Yes, free. Schedule an agent thread or a script with a cron
              expression, or once at a set time or after a delay. Choose the
              agent, model, and permission mode, and give each run a fresh
              worktree if you like. In Superset, automations are on Pro.
            </p>
          ),
        },
        {
          question: "Does bb have a CLI and an API?",
          answer: (
            <p>
              Yes. Everything in the app is also in the <code>bb</code> CLI and
              the HTTP API, so scripts, cron jobs, and other agents can start
              and manage threads.
            </p>
          ),
        },
        {
          question: "Does bb replace my editor?",
          answer: (
            <p>
              No. bb is where your agents work. The desktop app opens files in
              the editor you already use, like VS Code, Cursor, or Zed.
            </p>
          ),
        },
        {
          question: "Can I customize bb?",
          answer: (
            <p>
              Yes. Add plugins from the gallery, ask an agent to build one, or
              add a theme. Everything you add works on your phone too, because
              bb’s mobile app runs your own bb.
            </p>
          ),
        },
      ],
    },
    {
      title: "Phone and remote",
      items: [
        {
          question: "Can I control my coding agents from my phone?",
          answer: (
            <p>
              Yes, for free. bb Connect gives your computer a private address
              only you can open, so the whole app works in your phone’s browser:
              approve commands, answer questions, or start tasks. For push
              alerts, install the bb iOS app, in public TestFlight beta. In
              Superset, the mobile app is on Pro.{" "}
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
              bb works in any Android browser today through bb Connect, and a
              native Android app is in testing. On iPhone and iPad, the bb iOS
              app is in public beta on TestFlight.
            </p>
          ),
        },
        {
          question: "Can bb run agents on other machines?",
          answer: (
            <p>
              Yes. Enroll a desktop, a mini PC, or a cloud server, and run
              threads on any of them from one bb, for free.
            </p>
          ),
        },
        {
          question: "Will my agents keep running when I close my laptop?",
          answer: (
            <p>
              Agents run on your machine, so it needs to stay awake. On a Mac,
              switch on Keep Awake. For long runs, put bb on an always-on
              machine and check in from anywhere.
            </p>
          ),
        },
      ],
    },
    {
      title: "Switching and setup",
      items: [
        {
          question: "How do I get started with bb?",
          answer: (
            <p>
              Download the Mac app or run <code>npx bb-app@latest</code>, add a
              repo, and start a thread. bb uses the Claude Code and Codex logins
              you already have, so your first agent runs in about a minute.
            </p>
          ),
        },
        {
          question: "Can I move my Superset projects to bb?",
          answer: (
            <p>
              Yes. Your repo, branches, and worktrees are plain Git, so they
              come with you, and bb can work inside an existing Superset
              worktree. Your setup and teardown scripts map to bb’s own setup
              files.{" "}
              <a href="/guides/move-from-superset-to-bb">
                Follow the step-by-step guide
              </a>
              .
            </p>
          ),
        },
        {
          question: "Does Superset work on Windows?",
          answer: (
            <p>
              Not yet. Superset runs on macOS, with an experimental Linux build.
              bb runs on Windows through WSL2 and on Linux as an alpha with{" "}
              <code>npx bb-app@latest</code>. The desktop app is for Apple
              Silicon Macs, and Intel Macs use <code>npx</code> too.
            </p>
          ),
        },
        {
          question: "Is my code private?",
          answer: (
            <p>
              bb runs on your machines, and your agents talk to their providers
              exactly as they do without bb. bb’s usage events are anonymous,
              never include code, prompts, or project names, and can be turned
              off. bb Connect’s relay doesn’t store your traffic, and you can
              use Tailscale instead.
            </p>
          ),
        },
        {
          question: "Does bb have team plans or SSO?",
          answer: (
            <p>
              No. bb is a free app for your own machines, with no seats to buy.
              If your company needs SAML SSO, SCIM, audit logs, or an uptime
              SLA, Superset’s Enterprise plan is built for that.
            </p>
          ),
        },
      ],
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
