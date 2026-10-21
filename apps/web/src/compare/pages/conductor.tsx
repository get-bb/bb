import { FAQ_PLUGIN_TRUST } from "../plugin-trust";
import type { Comparison } from "../compare-types";
import {
  BB_ROWS,
  CLOSER,
  FAQ_AGENTS,
  FAQ_CODEX_TOGETHER,
  FAQ_CUSTOMIZE,
  FAQ_GET_STARTED,
  FAQ_LAPTOP,
  FAQ_PERMISSIONS,
  FAQ_PRIVACY,
  FAQ_SUBSCRIPTIONS,
  cell,
  linkedCell,
  faqFree,
  faqPhone,
  faqPlatforms,
  faqSchedule,
  faqTalk,
  faqUsageLimit,
  price,
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
import { FleetVisual } from "../compare-visuals";
import { CONDUCTOR_LOGO, meta } from "./conductor.meta";

const COST_SECTION = pricingSection(PRICING_COPY, {
  plan: "Conductor Teams",
  logo: CONDUCTOR_LOGO,
  yearlyPerSeatMonthly: 60,
  priceNote: "Conductor Teams at $60 per person a month.",
});

export const comparison: Comparison = {
  ...meta,
  title: "Conductor Alternatives: bb, the Free, Open-Source Option",
  description:
    "bb is a free, open-source Conductor alternative for Mac, Windows, and Linux. Run Claude Code, Codex, and other agents on any computer you own, and keep working from anywhere.",
  headline: "The free, open-source Conductor alternative",
  sub: "Run Claude Code, Codex, or any agent on Mac, Windows, or Linux, with the mobile app and remote machines free.",
  heroVisual: <FleetVisual />,
  tailored: anywhereSection(ANYWHERE_COPY),
  sections: [
    COST_SECTION,
    limitsSection(LIMITS_COPY),
    agentsSection(AGENTS_COPY),
  ],
  tableNote:
    "marks paid Conductor features. Checked October 20, 2026: Pro $50/month; Teams $60/person/month. Sources are linked below.",
  table: [
    {
      title: "Price and license",
      rows: [
        {
          ...BB_ROWS.pricing,
          competitor: {
            ...price("$0 local", "Pro $50/month; Teams $60/person/month"),
            href: "https://www.conductor.build/pricing",
          },
        },
        { ...BB_ROWS.license, competitor: cell("no", "Closed source") },
      ],
    },
    {
      title: "Platforms",
      rows: [
        { ...BB_ROWS.windows, competitor: cell("no", "Mac only") },
        { ...BB_ROWS.linux, competitor: cell("no") },
        { ...BB_ROWS.macos, competitor: cell("yes", "Mac app") },
        {
          ...BB_ROWS.mobile,
          competitor: {
            ...linkedCell(
              "partial",
              "iOS: cloud and experimental Mac remote control",
              "https://www.conductor.build/docs/reference/remote-control",
            ),
            pro: true,
          },
        },
      ],
    },
    {
      title: "Away from your desk",
      rows: [
        {
          ...BB_ROWS.otherMachines,
          competitor: cell("partial", "Your Mac or Conductor’s cloud", true),
        },
        { ...BB_ROWS.cloud, competitor: cell("yes", "Hosted", true) },
        {
          ...BB_ROWS.automations,
          competitor: cell("partial", "Cloud routines", true),
        },
      ],
    },
    {
      title: "Agents",
      rows: [
        {
          ...BB_ROWS.multiAgent,
          competitor: cell("yes", "Claude Code, Codex, Cursor, OpenCode"),
        },
        {
          ...BB_ROWS.handoff,
          competitor: {
            ...linkedCell(
              "partial",
              "Hosted MCP and API for cloud workspaces (beta)",
              "https://www.conductor.build/docs/api/mcp",
            ),
            pro: true,
          },
        },
      ],
    },
    {
      title: "Integrations",
      rows: [
        { ...BB_ROWS.marketplace, competitor: cell("no") },
        {
          ...BB_ROWS.github,
          competitor: cell("yes", "Checks tab, PR actions"),
        },
        {
          ...BB_ROWS.gitlab,
          competitor: cell("partial", "Repos in local workspaces"),
        },
        {
          ...BB_ROWS.gitea,
          competitor: cell("partial", "Repos in local workspaces"),
        },
      ],
    },
    {
      title: "Workspace and teams",
      rows: [
        {
          ...BB_ROWS.worktrees,
          competitor: cell("yes", "Setup and archive scripts"),
        },
        {
          feature: "Run your dev server",
          bb: cell("yes", "A terminal per thread, shared at a link"),
          competitor: cell("yes", "Run script"),
        },
        {
          ...BB_ROWS.diffReview,
          competitor: cell("yes", "Diff comments, checks, merge"),
        },
        { ...BB_ROWS.rewind, competitor: cell("yes", "Checkpoints") },
        {
          feature: "Multiplayer workspaces",
          bb: cell("partial", "Share one bb with your team"),
          competitor: cell("yes", "Shared cloud workspaces", true),
        },
        {
          ...BB_ROWS.teamPlans,
          competitor: cell("yes", "Teams plan, SSO on Enterprise", true),
        },
      ],
    },
  ],
  faqTitle: "FAQ",
  faq: [
    {
      title: "Switching from Conductor",
      items: [
        {
          question: "When is Conductor a better fit?",
          answer: (
            <p>
              Conductor is a better fit if you want a hosted workspace where
              teammates can prompt agents together in real time. Pro supports
              groups of up to five Pro users; Teams adds centralized billing
              and an admin portal. See{" "}
              <a href="https://www.conductor.build/pricing">
                Conductor’s plans
              </a>
              .
            </p>
          ),
        },
        {
          question: "What do Conductor users value?",
          answer: (
            <>
              <p>
                Two comments in a public r/conductorbuild thread that asked
                users for their favourite thing in Conductor describe the
                appeal of keeping the work together:
              </p>
              <blockquote>
                <p>“I like that it fits my workflow. Everything I need is right there.”</p>
                <p>
                  <a href="https://www.reddit.com/r/conductorbuild/comments/1wp7deq/favourite_thing_in_conductor/pbuil6i/">
                    A Reddit user in r/conductorbuild, September 24, 2026
                  </a>
                </p>
              </blockquote>
              <blockquote>
                <p>
                  “I really like the way the projects are structured with
                  worktrees, makes it easy to keep things organised and do more
                  work in parallel.”
                </p>
                <p>
                  <a href="https://www.reddit.com/r/conductorbuild/comments/1wp7deq/favourite_thing_in_conductor/pbxng4x/">
                    A Reddit user in r/conductorbuild, September 25, 2026
                  </a>
                </p>
              </blockquote>
              <p>
                These are individual experiences, not a survey or endorsements
                of bb. They are good reasons to value Conductor’s workflow.
                Consider bb if you also want agents to change the app with
                plugins, or need a Windows or Linux desktop app (both in Alpha).
              </p>
            </>
          ),
        },
        {
          question: "What’s the difference between bb and Conductor?",
          answer: (
            <p>
              Both run Claude Code, Codex, and other coding agents in parallel
              Git worktrees. bb is free for any team size, open source, and runs
              on Mac, Windows, and Linux. Conductor is a closed-source Mac app
              that’s free locally, with cloud workspaces, scheduled routines,
              multiplayer, and its mobile app on the Pro plan, at $50 a month. Its iOS app
              also supports experimental remote control of local Mac workspaces.{" "}
              <a href="https://www.conductor.build/docs/reference/remote-control">
                Conductor’s remote-control guide
              </a>{" "}
              describes the setup. In bb, your agents keep working on any computer you own, follow
              you to your phone, and can start each other and hear back.
            </p>
          ),
        },
        {
          question: "Is there a free, open-source Conductor alternative?",
          answer: (
            <p>
              Yes: bb. It’s free for any team size and MIT-licensed, so you can
              use and change it for anything, including at work. Conductor is
              closed source, with free local Mac workspaces. Its{" "}
              <a href="https://www.conductor.build/pricing">paid plans</a>
              {" "}start at $50 a month for Pro and $60 per person a month for Teams.{" "}
              <a href="/download/macos">Download bb</a>.
            </p>
          ),
        },
        {
          question: "How do I move a repo and my unfinished work to bb?",
          answer: (
            <p>
              Ask bb to do it. Conductor’s local workspaces are plain Git
              worktrees on your Mac, and its cloud workspaces push to branches,
              so a bb agent can add the repo and open each unfinished workspace
              or branch as a thread. Your CLAUDE.md, skills, MCP servers, slash
              commands, and agent sign-ins come along, and Conductor keeps
              working while you try bb.{" "}
              <a href="/guides/switch-from-conductor">Copy the prompt</a>.
            </p>
          ),
        },
        {
          question: "What’s different day to day?",
          answer: (
            <ul>
              <li>
                Each Conductor chat becomes a thread. Threads can get their own
                worktree or share one, like chats in a workspace.
              </li>
              <li>
                Your setup script moves to <code>.bb-env-setup.sh</code>. A{" "}
                <code>.worktreeinclude</code> file works as is, and Files to
                copy patterns from Conductor’s settings move into it.
              </li>
              <li>
                Threads run on whichever of your computers you pick, and follow
                you to your phone and any browser.
              </li>
              <li>
                Agents can start new threads and message each other, whatever
                the provider.
              </li>
            </ul>
          ),
        },
        FAQ_GET_STARTED,
      ],
    },
    {
      title: "Your Conductor workflow in bb",
      items: [
        {
          question: "Does bb give each task its own workspace?",
          answer: (
            <p>
              Yes. Start a thread in a worktree and it gets its own Git worktree
              and branch, so agents never overwrite each other’s changes. Run as
              many as you like: bb runs one thread per processor core and starts
              the rest as others finish.
            </p>
          ),
        },
        {
          question: "Does bb have setup and run scripts?",
          answer: (
            <p>
              Yes. Commit a <code>.bb-env-setup.sh</code> at your repo root and
              bb runs it in every new worktree. List untracked files like{" "}
              <code>.env</code> in <code>.worktreeinclude</code> and bb copies
              them in first, and <code>.bb-env-teardown.sh</code> cleans up when
              a worktree goes away. Start your dev server in the thread’s
              terminal or ask the agent to, and open it from anywhere at a
              private link with bb Connect.
            </p>
          ),
        },
        {
          question: "Can I review diffs and merge pull requests in bb?",
          answer: (
            <p>
              Yes, without leaving the thread. Select lines in the diff and
              choose Add to chat to send feedback. When the agent opens a pull
              request, the thread shows its checks and a Merge button. The
              GitHub plugin adds an issues and PR panel and Review with agent on
              any PR.
            </p>
          ),
        },
        {
          question: "Does bb have checkpoints?",
          answer: (
            <p>
              bb lets you rewind the conversation instead. Edit any earlier
              message to rerun the thread from there, or fork a new thread from
              any message to try a different approach. Every change stays on the
              thread’s own Git branch, so nothing lands until you merge it.
            </p>
          ),
        },
        {
          question: "Does bb have multiplayer?",
          answer: (
            <p>
              Yes, as one shared bb, free at any team size. Teams usually run
              one bb on an always-on machine and share it, so everyone sees the
              same projects, threads, terminals, and links, and can jump into
              any thread. Keep it on your tailnet and let your Tailscale ACLs
              decide who gets in, since everyone with access can run commands on
              every machine.
            </p>
          ),
        },
        faqPhone(
          <>
            Conductor’s iOS app supports cloud workspaces and{" "}
            <a href="https://www.conductor.build/docs/reference/remote-control">
              experimental remote control of local Mac workspaces
            </a>
            . The Mac must stay awake, online, and running Conductor.
            Conductor’s <a href="https://www.conductor.build/pricing">pricing</a>
            {" "}lists the mobile app under Pro.
          </>,
        ),
        faqSchedule("Conductor’s routines run only in its cloud, on Pro."),
        FAQ_LAPTOP,
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
        FAQ_PERMISSIONS,
        FAQ_CUSTOMIZE,
        FAQ_PLUGIN_TRUST,
        {
          question: "Can another agent or app drive bb and Conductor?",
          answer: (
            <p>
              Yes. In bb, ask an agent to set up a schedule, start threads, or
              build a plugin that changes the app. Other apps can drive bb
              through its MCP server and SDK. Conductor’s{" "}
              <a href="https://www.conductor.build/docs/api">API</a> and{" "}
              <a href="https://www.conductor.build/docs/api/mcp">hosted MCP server</a>
              {" "}let agents create cloud workspaces, send tasks, follow progress,
              and read results. Both Conductor interfaces are in beta; its
              pricing page includes API access in Pro.
            </p>
          ),
        },
        {
          question: "Can I use my ChatGPT plan in Conductor?",
          answer: (
            <p>
              Yes. Conductor added Sign in with ChatGPT in{" "}
              <a href="https://www.conductor.build/changelog/0.89.0-sign-in-with-chatgpt">
                version 0.89.0 on September 29, 2026
              </a>
              . In Settings → Agents → Codex, choose Continue with ChatGPT.
              Using an existing AI subscription is something both apps support.
            </p>
          ),
        },
      ],
    },
    {
      title: "Price, platforms, and privacy",
      items: [
        faqFree(
          ", while Conductor’s Pro plan includes cloud workspaces, routines, and its mobile app at $50 a month",
        ),
        FAQ_SUBSCRIPTIONS,
        faqUsageLimit(null),
        faqPlatforms("Conductor’s desktop app runs only on macOS."),
        FAQ_PRIVACY,
      ],
    },
  ],
  closer: CLOSER,
};
