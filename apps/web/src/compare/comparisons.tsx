import type { ReactNode } from "react";

import supersetIcon from "../assets/competitors/superset.png";
import { SpawnSidebar } from "../landing/landing-visuals";
import { PhoneApproval, PlanCompare, type BrandLogo } from "./compare-visuals";

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
  faq: CompareFaq[];
};

function cell(mark: Mark | null, text = "", pro = false): CompareCell {
  return { mark, text, pro };
}

const SUPERSET_LOGO: BrandLogo = { kind: "image", src: supersetIcon };

const BB_VS_SUPERSET: Comparison = {
  slug: "bb-vs-superset",
  title: "bb vs Superset",
  description:
    "Superset gives each agent its own workspace. bb lets Claude Code, Codex, and other agents hand work to each other, free from your desk to your phone.",
  competitor: { name: "Superset", logo: SUPERSET_LOGO },
  headline: "The Superset alternative where your agents work together",
  sub: "Superset gives each agent its own workspace. bb lets Claude Code, Codex, and the rest hand work to each other, and it’s free from your desk to your phone.",
  switchGuide: {
    label: "Moving from Superset? See how",
    href: "/guides/move-from-superset-to-bb",
  },
  highlights: [
    {
      title: "Agents that work as a team.",
      visual: <SpawnSidebar />,
      body: (
        <>
          <p>
            In bb, one agent can start another, wait for it, and act on what it
            finds. Claude Code writes, Codex reviews, Claude fixes, and you
            never paste a diff between terminals.
          </p>
          <p>
            Every agent it starts is its own thread in your sidebar, so you can
            open it, read exactly what it was asked, and steer it.
          </p>
        </>
      ),
    },
    {
      title: "Your agents, in your pocket.",
      visual: <PhoneApproval />,
      body: (
        <>
          <p>
            Approve a command, answer a question, or start a new task from your
            phone. Open your bb in any phone browser, or get push notifications
            with the bb iOS app, now in beta.
          </p>
          <p>It’s free. In Superset, the phone app is part of Pro.</p>
        </>
      ),
    },
    {
      title: "Everything included. $0.",
      visual: (
        <PlanCompare
          plans={[
            {
              name: "bb",
              logo: { kind: "bb" },
              price: "$0",
              period: "forever",
              items: [
                "Phone access",
                "Automations",
                "Remote access to your machine",
                "Plugins",
              ],
            },
            {
              name: "Superset Pro",
              logo: SUPERSET_LOGO,
              price: "$20",
              period: "per user / month",
              items: [
                "iPhone app",
                "Automations",
                "Remote access to your machine",
              ],
            },
          ]}
        />
      ),
      body: (
        <>
          <p>
            bb is free and MIT-licensed, with no paid tier. Phone access,
            automations, and remote access to your own machine are all included.
          </p>
          <p>You only pay for the agent subscriptions you already have.</p>
        </>
      ),
    },
  ],
  tableTitle: "bb vs Superset, side by side",
  table: [
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
          competitor: cell("yes", "Any CLI agent"),
        },
        {
          feature: "Agents start and manage other agents",
          bb: cell("yes", "Each one a thread you can open"),
          competitor: cell("partial", "Through its CLI and MCP server"),
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
          bb: cell("yes", "Send selected lines back to the agent"),
          competitor: cell("yes", "Plus a built-in file editor"),
        },
        {
          feature: "Terminal and browser",
          bb: cell("yes", "Browser in the desktop app"),
          competitor: cell("yes"),
        },
        {
          feature: "Plugins",
          bb: cell("yes", "Including ones your agents write"),
          competitor: cell("partial", "Themes and integrations"),
        },
      ],
    },
    {
      title: "Anywhere",
      rows: [
        {
          feature: "Phone",
          bb: cell("yes", "Any phone browser, plus an iOS beta"),
          competitor: cell("yes", "iPhone app", true),
        },
        {
          feature: "Automations",
          bb: cell("yes"),
          competitor: cell("yes", "", true),
        },
        {
          feature: "Remote access to your machine",
          bb: cell("yes"),
          competitor: cell("yes", "", true),
        },
        {
          feature: "Run agents on other machines",
          bb: cell("yes"),
          competitor: cell("yes", "Remote hosts"),
        },
      ],
    },
    {
      title: "Platform and price",
      rows: [
        { feature: "macOS", bb: cell("yes"), competitor: cell("yes") },
        {
          feature: "Linux",
          bb: cell("partial", "Alpha"),
          competitor: cell("partial", "Experimental"),
        },
        {
          feature: "Windows",
          bb: cell("yes", "Through WSL2"),
          competitor: cell("no"),
        },
        {
          feature: "Open source",
          bb: cell("yes", "MIT"),
          competitor: cell("partial", "Source available"),
        },
        {
          feature: "Team plans, SSO, SLA",
          bb: cell("no"),
          competitor: cell("yes"),
        },
        {
          feature: "Price",
          bb: cell(null, "Free"),
          competitor: cell(null, "Free for 1 user. Pro $20 per user / month"),
        },
      ],
    },
  ],
  faq: [
    {
      question: "What’s the difference between bb and Superset?",
      answer: (
        <p>
          Both run Claude Code, Codex, and other coding agents in parallel on
          your own machine, each task in its own Git worktree. Superset is built
          around a workspace per task, with a diff, file editor, terminals, and
          browser side by side. bb is built around threads that can start and
          manage other threads, so your agents can hand work to each other. And
          bb is free in full, including the phone access and automations that
          are on Superset’s Pro plan.
        </p>
      ),
    },
    {
      question: "Is bb really free?",
      answer: (
        <p>
          Yes. bb is MIT-licensed with no paid tier. Phone access, automations,
          remote access to your machine, and plugins are all included. You pay
          only for the agent subscriptions or API keys you already use.
        </p>
      ),
    },
    {
      question: "How much does Superset cost?",
      answer: (
        <p>
          Superset’s free plan covers one user, with local workspaces, the
          desktop app, the CLI, and GitHub. Pro is $20 per user per month ($15
          billed yearly) and adds the iPhone app, automations, remote access to
          your own machine, and Slack and Linear integrations.
        </p>
      ),
    },
    {
      question: "Do my Claude Code and Codex logins carry over?",
      answer: (
        <p>
          Yes. bb runs the agent CLIs you already have signed in, with your{" "}
          <code>CLAUDE.md</code>, skills, MCP servers, and <code>~/.codex</code>{" "}
          config. There’s nothing to set up again.
        </p>
      ),
    },
    {
      question: "Which agents does bb support?",
      answer: (
        <p>
          Claude Code, Codex, and Pi through their native interfaces, plus
          Cursor, OpenCode, Grok Build, omp, Hermes Agent, and any other agent
          that speaks the Agent Client Protocol. You pick the agent for each
          thread.
        </p>
      ),
    },
    {
      question: "How do agents hand work to each other in bb?",
      answer: (
        <p>
          Just ask: “When you’re done, start a bb Codex thread to review this
          branch, then fix what it finds.” Claude starts the Codex thread in the
          same worktree, waits for the review, and applies the fixes. The Codex
          thread shows up under Claude’s in your sidebar, so you can open it,
          read it, or message it.{" "}
          <a href="/guides/claude-code-and-codex-together">
            See the full guide
          </a>
          .
        </p>
      ),
    },
    {
      question: "Can I use bb from my phone?",
      answer: (
        <p>
          Yes, for free. bb Connect gives your computer a private address that
          only you can open, so the whole app works in your phone’s browser. For
          push notifications, install the bb iOS app, now in public beta on
          TestFlight. Phone browsers don’t show bb’s notifications, so use the
          app if you want alerts.{" "}
          <a href="/guides/steer-coding-agents-from-your-phone">
            See the setup guide
          </a>
          .
        </p>
      ),
    },
    {
      question: "Does bb run on Windows and Linux?",
      answer: (
        <p>
          bb runs on Linux as an alpha, and on Windows through WSL2 with{" "}
          <code>npx bb-app@latest</code>. Superset supports macOS and
          experimental Linux, and doesn’t run on Windows.
        </p>
      ),
    },
    {
      question: "Can I move my Superset projects to bb?",
      answer: (
        <p>
          Yes. Your repo, branches, and worktrees are plain Git, so they come
          with you, and bb can work inside an existing Superset worktree. Your
          setup scripts map to bb’s own setup files.{" "}
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
          logins. Try bb on one real task and keep what fits.
        </p>
      ),
    },
    {
      question: "When is Superset the better choice?",
      answer: (
        <p>
          If you review one agent’s patch at a time and want a diff, file
          editor, terminals, browser, and port management in one window, or you
          need team plans, SSO, and an SLA, Superset is built for that.
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
      question: "Can bb run agents on other machines?",
      answer: (
        <p>
          Yes. Enroll a desktop, a mini PC, or a cloud server, and run threads
          on any of them from one bb, for free.
        </p>
      ),
    },
    {
      question: "Is my code private?",
      answer: (
        <p>
          bb runs on your machines, and your agents talk to their providers as
          they do without bb. bb’s usage events are anonymous, never include
          code, prompts, or project names, and can be turned off. With bb
          Connect, traffic passes through bb’s relay, which doesn’t store it.
        </p>
      ),
    },
    {
      question: "Is bb open source?",
      answer: (
        <p>
          Yes, MIT-licensed end to end. Fork it, change anything, and run your
          own build.
        </p>
      ),
    },
  ],
};

const COMPARISONS: Comparison[] = [BB_VS_SUPERSET];

export function getComparison(slug: string): Comparison | undefined {
  return COMPARISONS.find((comparison) => comparison.slug === slug);
}
