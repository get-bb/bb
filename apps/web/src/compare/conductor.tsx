import conductorIcon from "../assets/competitors/conductor.png";
import type { Comparison } from "./comparisons";
import {
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
  title: "Keep working after you close your laptop",
  body: (
    <>
      <p>
        You can use bb on an always-on desktop or server, so your agents keep
        running while you’re out. Check in on them from the bb mobile app or any
        browser.
      </p>
      <p>The mobile app, remote machines, and browser access are all free.</p>
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
    "bb is a free, open-source Conductor alternative for Mac, Windows, and Linux. Run Claude Code, Codex, and other agents on any computer you own, and keep working from anywhere.",
  competitor: { name: "Conductor", logo: CONDUCTOR_LOGO },
  headline: "The free, open-source Conductor alternative",
  sub: "Run Claude Code, Codex, and any agent on Mac, Windows, or Linux, and keep working from anywhere while they keep going.",
  heroVisual: <FleetVisual />,
  tailored: AWAY_SECTION,
  sections: [
    COST_SECTION,
    agentsSection(AGENTS_COPY),
    pluginsSection(PLUGINS_COPY),
  ],
  tableNote:
    "marks features that need a paid Conductor plan: Pro at $50 a month, or Teams at $60 per person.",
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
          bb: cell("yes", "Setup and teardown scripts"),
          competitor: cell("yes", "Setup and archive scripts"),
        },
        {
          feature: "Run your dev server",
          bb: cell("yes", "A terminal per thread, shared at a link"),
          competitor: cell("yes", "Run script"),
        },
        {
          feature: "Diff review and merge",
          bb: cell("yes", "Line comments to the agent, checks, merge"),
          competitor: cell("yes", "Diff comments, checks, merge"),
        },
        {
          feature: "Go back to an earlier point",
          bb: cell("yes", "Edit a message or fork from it"),
          competitor: cell("yes", "Checkpoints"),
        },
        {
          feature: "Multiplayer workspaces",
          bb: cell("partial", "Share one bb with your team"),
          competitor: cell("partial", "Prompt the same agent", true),
        },
        {
          feature: "Team plans and SSO",
          bb: cell("no"),
          competitor: cell("partial", "SSO on Enterprise"),
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
              Ask bb to do it. Your repo and Conductor’s workspaces are plain
              Git worktrees on your machine, so a bb agent can add the repo and
              open each unfinished workspace as a thread. Your CLAUDE.md,
              skills, MCP servers, slash commands, and agent sign-ins come
              along, and Conductor keeps working while you try bb.
            </p>
          ),
        },
        {
          question: "What’s different day to day?",
          answer: (
            <ul>
              <li>
                Each Conductor workspace becomes a thread, and several threads
                can share one worktree, so a reviewer can work right next to the
                agent that wrote the code.
              </li>
              <li>
                Your setup script moves to <code>.bb-env-setup.sh</code>, and
                Files to copy becomes a <code>.worktreeinclude</code> file.
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
              Yes, free. Run bb on an always-on machine and share it with your
              team. Everyone sees the same projects, threads, terminals, and
              links, and can jump into any thread.
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
        faqPlatforms("Conductor runs only on macOS."),
        FAQ_PRIVACY,
      ],
    },
  ],
  closer: CLOSER,
};
