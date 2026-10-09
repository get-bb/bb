import conductorIcon from "../../assets/competitors/conductor.png";
import type { CompareMeta, Comparison } from "../compare-types";
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
  faqFree,
  faqPhone,
  faqPlatforms,
  faqSchedule,
  faqTalk,
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

const CONDUCTOR_LOGO: BrandLogo = { kind: "image", src: conductorIcon };

const COST_SECTION = pricingSection(PRICING_COPY, {
  plan: "Conductor Teams",
  logo: CONDUCTOR_LOGO,
  yearlyPerSeatMonthly: 60,
  priceNote: "Conductor Teams at $60 per person a month.",
});

export const meta: CompareMeta = {
  slug: "conductor-alternatives",
  competitor: { name: "Conductor", logo: CONDUCTOR_LOGO },
};

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
    "marks features that need a paid Conductor plan: Pro at $50 a month, or Teams at $60 per person.",
  table: [
    {
      title: "Price and license",
      rows: [
        {
          ...BB_ROWS.pricing,
          competitor: price("$0", "Teams at $60 per person a month"),
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
          competitor: cell("partial", "iOS, for cloud workspaces", true),
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
          competitor: cell("partial", "Via MCP, cloud workspaces", true),
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
          question: "What’s the difference between bb and Conductor?",
          answer: (
            <p>
              Both run Claude Code, Codex, and other coding agents in parallel
              Git worktrees. bb is free for any team size, open source, and runs
              on Mac, Windows, and Linux. Conductor is a closed-source Mac app
              that’s free locally, with cloud workspaces, scheduled routines,
              multiplayer, and its mobile app on the Pro plan, at $50 a month.
              In bb, your agents keep working on any computer you own, follow
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
              closed source and free only for local workspaces on a Mac, with
              Pro at $50 a month and Teams at $60 per person a month.{" "}
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
              <a href="/guides/switch-to-bb?from=conductor">Copy the prompt</a>.
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
          "Conductor’s iPhone app works with its cloud workspaces, on the $50-a-month Pro plan.",
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
        faqScript(null),
      ],
    },
    {
      title: "Price, platforms, and privacy",
      items: [
        faqFree(
          ", while Conductor puts its mobile app, cloud workspaces, and routines on its Pro plan, at $50 a month",
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
