import vibeKanbanIcon from "../assets/competitors/vibe-kanban.png";
import type { CompareHighlight, Comparison } from "./comparisons";
import { CLOSER, FAQ_AGENTS, FAQ_REVIEW, cell, price } from "./compare-content";
import {
  AGENTS_COPY,
  agentsSection,
  pluginsSection,
  type SectionCopy,
} from "./compare-sections";
import { TaskLedger, TasksBoard, type BrandLogo } from "./compare-visuals";

const VIBE_KANBAN_LOGO: BrandLogo = { kind: "image", src: vibeKanbanIcon };

const LEDGER_HIGHLIGHT: CompareHighlight = {
  title: "Know where every task stands",
  wide: false,
  visual: <TaskLedger />,
  body: (
    <>
      <p>
        Each card keeps its agents’ threads, branches, and progress in one
        place. Come back after a break and see what’s running and what’s ready
        for you.
      </p>
    </>
  ),
};

const BUILD_COPY: SectionCopy = {
  title: "Missing something? Build it.",
  body: (
    <>
      <p>
        bb is open source and made to be changed. Install a plugin from the{" "}
        <a href="/marketplace">marketplace</a>, or ask an agent to build the
        panel or command you miss.
      </p>
    </>
  ),
};

export const BB_VS_VIBE_KANBAN: Comparison = {
  slug: "vibe-kanban-alternative",
  title: "Vibe Kanban Alternative: Bring Your Board to bb",
  description:
    "Vibe Kanban shut down. bb is a free, open-source app with a local kanban board: hand any card to Claude Code, Codex, or another agent in its own Git worktree.",
  competitor: { name: "Vibe Kanban", logo: VIBE_KANBAN_LOGO },
  headline: "Vibe Kanban shut down. Bring your board to bb.",
  sub: "A kanban board on your own machine, with no sign-in. Hand any card to Claude Code, Codex, or another agent, and it works in its own Git worktree.",
  heroVisual: <TasksBoard />,
  tailored: LEDGER_HIGHLIGHT,
  sections: [agentsSection(AGENTS_COPY), pluginsSection(BUILD_COPY)],
  tableNote: null,
  table: [
    {
      title: "Price and license",
      rows: [
        {
          feature: "Pricing",
          bb: price("$0", "Any team size"),
          competitor: price("$0", "Open source"),
        },
        {
          feature: "Open-source license",
          bb: cell("yes", "MIT"),
          competitor: cell("yes", "Apache 2.0"),
        },
        {
          feature: "Active development",
          bb: cell("yes", "Weekly releases"),
          competitor: cell("partial", "No release since April"),
        },
      ],
    },
    {
      title: "Tasks and agents",
      rows: [
        {
          feature: "Kanban board",
          bb: cell("yes", "Local, no sign-in"),
          competitor: cell("partial", "Projects off since 0.1.44"),
        },
        {
          feature: "Git worktree per task",
          bb: cell("yes"),
          competitor: cell("yes"),
        },
        {
          feature: "Diff review",
          bb: cell("yes"),
          competitor: cell("yes"),
        },
        {
          feature: "Merge from the app",
          bb: cell("yes", "Checks and Merge button"),
          competitor: cell("yes"),
        },
        {
          feature: "Agent-to-agent handoff",
          bb: cell("yes", "Spawn, message, wait"),
          competitor: cell("no"),
        },
      ],
    },
  ],
  faqTitle: "FAQ",
  faq: [
    {
      title: "Switching from Vibe Kanban",
      items: [
        {
          question: "Is Vibe Kanban shut down?",
          answer: (
            <p>
              Yes. Its maker, bloop,{" "}
              <a href="https://www.vibekanban.com/blog/shutdown">shut down</a>{" "}
              in April 2026 and turned off its cloud, including shared projects
              and issues. Version 0.1.44 turned off Projects for everyone, and
              there hasn’t been a release since. Local workspaces still run.
            </p>
          ),
        },
        {
          question: "What’s the difference between bb and Vibe Kanban?",
          answer: (
            <p>
              Both run Claude Code, Codex, and other coding agents in Git
              worktrees, and both are free and open source. bb keeps its task
              board on your machine with no sign-in, and its agents can start,
              message, and review each other’s work. bb is actively developed,
              with a release every week.
            </p>
          ),
        },
        {
          question: "Do I need an account to use bb?",
          answer: (
            <p>
              No. bb runs on your computer, and your tasks stay in its local
              database. Signing in is optional and only turns on bb’s hosted
              extras, like remote access.
            </p>
          ),
        },
        {
          question: "Can I bring my Vibe Kanban tasks and worktrees?",
          answer: (
            <p>
              Yes. Your branches and worktrees are plain Git, so add the same
              repo to bb and pick up where you left off. If you exported your
              Vibe Kanban issues, ask a bb agent to turn each one into a task on
              your board.
            </p>
          ),
        },
        FAQ_REVIEW,
        FAQ_AGENTS,
      ],
    },
  ],
  closer: CLOSER,
};
