import cursorIcon from "../assets/competitors/cursor.png";
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
  anywhereSection,
  PLUGINS_COPY,
  pluginsSection,
  SPAWN_COPY,
  spawnSection,
} from "./compare-sections";
import { AgentSplit, PlansVisual, type BrandLogo } from "./compare-visuals";

const CURSOR_LOGO: BrandLogo = { kind: "image", src: cursorIcon };

const PLANS_SECTION = {
  title: "Every agent, on the plans you already pay for",
  wide: false,
  visual: <PlansVisual />,
  body: (
    <>
      <p>
        Claude Code runs on your Claude plan, Codex on your ChatGPT plan, and
        Cursor’s agent on your Cursor plan. Each agent works the way its own
        team built it, and you pick the right one for each task.
      </p>
      <p>
        When a Claude or Codex account hits its limit, bb moves the thread to
        your next one and it keeps going. bb itself is free.
      </p>
    </>
  ),
};

const AWAY_SECTION = anywhereSection({
  title: "Keep your agents running on your own machines",
  body: (
    <>
      <p>
        You can run any agent on your laptop, a desktop at home, or a cloud
        server, and manage them all from one bb. Check in from the bb mobile app
        or any browser while they keep working.
      </p>
      <p>Remote machines, the mobile app, and browser access are all free.</p>
    </>
  ),
});

export const BB_VS_CURSOR: Comparison = {
  slug: "cursor-alternative",
  title: "Cursor Alternative for Coding Agents: bb, Free and Open Source",
  description:
    "bb is a free, open-source Cursor alternative for running coding agents. Claude Code, Codex, and Cursor’s agent work together on your machines, on the plans you already pay for.",
  competitor: { name: "Cursor", logo: CURSOR_LOGO },
  headline: "The Cursor alternative for running all your coding agents",
  sub: "Claude Code, Codex, and Cursor’s own agent work together on the plans you already pay for. Free and open source.",
  heroVisual: <AgentSplit />,
  tailored: PLANS_SECTION,
  sections: [
    spawnSection(SPAWN_COPY),
    AWAY_SECTION,
    pluginsSection(PLUGINS_COPY),
  ],
  tableNote: "marks features that need a paid Cursor plan, from $20 a month.",
  table: [
    {
      title: "Agents",
      rows: [
        {
          feature: "Claude Code and Codex agents",
          bb: cell("yes", "Side by side with Cursor’s agent"),
          competitor: cell("partial", "As editor extensions"),
        },
        {
          feature: "Claude and GPT models",
          bb: cell("yes", "Billed to your Claude and ChatGPT plans"),
          competitor: cell("yes", "Billed to your Cursor usage", true),
        },
        {
          feature: "Agent-to-agent handoff",
          bb: cell("yes", "Any provider, each in its own thread"),
          competitor: cell("partial", "Subagents inside Cursor’s agent"),
        },
        {
          feature: "Switch accounts at usage limits",
          bb: cell("yes", "Automatic with Account Pooler"),
          competitor: cell("no", "On-demand billing instead"),
        },
      ],
    },
    {
      title: "Price and license",
      rows: [
        {
          feature: "Pricing",
          bb: price("$0", "You pay agent providers directly"),
          competitor: price("$20 / mo", "Teams at $40 per user / month"),
        },
        {
          feature: "Open-source license",
          bb: cell("yes", "MIT"),
          competitor: cell("no", "Closed source"),
        },
      ],
    },
    {
      title: "Away from your desk",
      rows: [
        {
          feature: "Run agents on other machines you own",
          bb: cell("yes", "Any computer, free"),
          competitor: cell("yes", "Self-hosted cloud agents", true),
        },
        {
          feature: "Cloud agents",
          bb: cell("yes", "Modal plugin, experimental"),
          competitor: cell("yes", "Hosted VMs at API rates", true),
        },
        {
          feature: "Mobile app",
          bb: cell("yes", "iOS beta, Android alpha"),
          competitor: cell("yes", "iOS beta, web on Android"),
        },
        {
          feature: "Scheduled automations",
          bb: cell("yes", "On your own machines"),
          competitor: cell("yes", "Run as cloud agents", true),
        },
      ],
    },
    {
      title: "Workspace",
      rows: [
        {
          feature: "Parallel agents in Git worktrees",
          bb: cell("yes", "Setup runs for you"),
          competitor: cell("yes", "Agents window"),
        },
        {
          feature: "Diff review and merge",
          bb: cell("yes"),
          competitor: cell("yes"),
        },
        {
          feature: "Plugin marketplace",
          bb: cell("yes", "Panels, commands, and agents"),
          competitor: cell("yes", "Rules, skills, and MCP servers"),
        },
        {
          feature: "Code editor",
          bb: cell("partial", "Opens your worktree in Cursor"),
          competitor: cell("yes", "Full editor with Tab"),
        },
      ],
    },
  ],
  faqTitle: "FAQ",
  faq: [
    {
      title: "Switching from Cursor",
      items: [
        {
          question: "What’s the difference between bb and Cursor?",
          answer: (
            <p>
              Cursor is a code editor with its own agent, plus cloud agents on
              its paid plans. bb isn’t an editor: it’s a free, open-source app
              for running coding agents. Claude Code, Codex, Cursor’s agent, and
              others run side by side on your own machines, each on its own
              plan, and they can start and message each other. You can keep
              editing in Cursor while bb runs the agents.
            </p>
          ),
        },
        {
          question: "Is there a free, open-source Cursor alternative?",
          answer: (
            <p>
              Yes, for running coding agents: bb. It’s free for any team size
              and MIT-licensed, so you can use and change it for anything,
              including at work. You pay only for the agent plans you already
              have. <a href="/download/macos">Download bb</a>.
            </p>
          ),
        },
        {
          question: "Can I use Cursor with bb?",
          answer: (
            <p>
              Yes. Keep editing in Cursor, and open any thread’s worktree in it
              with one click. You can also pick Cursor as the agent for any bb
              thread: bb runs Cursor’s agent CLI with your own sign-in and plan,
              so your rules and MCP servers come along.
            </p>
          ),
        },
        {
          question: "How do I move my agent work to bb?",
          answer: (
            <p>
              Ask bb to do it. Cursor’s local worktrees are plain Git on your
              machine, and its cloud agents push their work to branches, so a bb
              agent can add your repo and open each unfinished worktree or
              branch as a thread. Your AGENTS.md, CLAUDE.md, skills, and MCP
              servers come along, and Cursor keeps working while you try bb.
            </p>
          ),
        },
        {
          question: "What’s different day to day?",
          answer: (
            <ul>
              <li>
                Each agent task is a thread you can open from your computer,
                phone, or any browser.
              </li>
              <li>
                You pick the agent per thread, and agents start and message each
                other across providers.
              </li>
              <li>
                Setup commands from <code>.cursor/worktrees.json</code> move to{" "}
                <code>.bb-env-setup.sh</code>, and untracked files like{" "}
                <code>.env</code> go in <code>.worktreeinclude</code>.
              </li>
              <li>
                Long runs keep going on whichever of your computers you pick.
              </li>
            </ul>
          ),
        },
        FAQ_GET_STARTED,
      ],
    },
    {
      title: "Agents and plans",
      items: [
        FAQ_SUBSCRIPTIONS,
        faqUsageLimit(null),
        FAQ_CODEX_TOGETHER,
        faqTalk(""),
        FAQ_AGENTS,
        FAQ_PERMISSIONS,
      ],
    },
    {
      title: "Your Cursor workflow in bb",
      items: [
        {
          question: "Does bb have background agents?",
          answer: (
            <p>
              Yes. Every bb thread runs in the background on the machine you
              pick: your laptop, an always-on desktop, or a server you own. You
              can also start threads in on-demand cloud sandboxes in your own
              Modal account with the built-in Modal Sandbox plugin
              (experimental). Either way, you pay nothing extra to bb.
            </p>
          ),
        },
        FAQ_PARALLEL,
        {
          question: "Does bb have setup scripts for new worktrees?",
          answer: (
            <p>
              Yes. Commit a <code>.bb-env-setup.sh</code> at your repo root and
              bb runs it in every new worktree. List untracked files like{" "}
              <code>.env</code> in <code>.worktreeinclude</code> and bb copies
              them in first, and <code>.bb-env-teardown.sh</code> cleans up when
              a worktree goes away.
            </p>
          ),
        },
        FAQ_REVIEW,
        {
          question: "Does bb have a code editor?",
          answer: (
            <p>
              bb opens any thread’s worktree in Cursor, VS Code, or another
              editor you have installed. For quick edits without leaving bb,
              turn on the File Editor plugin.
            </p>
          ),
        },
        faqPhone(null),
        faqSchedule(null),
        FAQ_LAPTOP,
        FAQ_CUSTOMIZE,
      ],
    },
    {
      title: "Price, platforms, and privacy",
      items: [
        faqFree(
          ", while Cursor puts cloud agents and frontier models on its paid plans",
        ),
        faqPlatforms(null),
        FAQ_PRIVACY,
        faqTeam(""),
      ],
    },
  ],
  closer: CLOSER,
};
