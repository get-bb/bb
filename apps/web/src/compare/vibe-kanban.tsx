import vibeKanbanIcon from "../assets/competitors/vibe-kanban.png";
import type { CompareHighlight, Comparison } from "./comparisons";
import { CLOSER, FAQ_AGENTS, FAQ_REVIEW, cell, price } from "./compare-content";
import {
  AGENTS_COPY,
  agentsSection,
  PLUGINS_COPY,
  pluginsSection,
} from "./compare-sections";
import { TaskLedger, TasksBoard, type BrandLogo } from "./compare-visuals";

const VIBE_KANBAN_LOGO: BrandLogo = { kind: "image", src: vibeKanbanIcon };

const LEDGER_HIGHLIGHT: CompareHighlight = {
  title: "Know which agent is on each task",
  wide: false,
  visual: <TaskLedger />,
  body: (
    <p>
      Each task shows the agents working on it, live, with their comments and
      pull requests.
    </p>
  ),
};

export const BB_VS_VIBE_KANBAN: Comparison = {
  slug: "vibe-kanban-alternative",
  title: "Vibe Kanban Alternative: Bring Your Board to bb",
  description:
    "Vibe Kanban is sunsetting. bb is a free, open-source app whose Tasks plugin gives you a local board: hand any card to Claude Code, Codex, or another agent in its own Git worktree.",
  competitor: { name: "Vibe Kanban", logo: VIBE_KANBAN_LOGO },
  headline: "Vibe Kanban is sunsetting. Bring your board to bb.",
  sub: "Hand any card to Claude Code, Codex, or another agent, and it works in its own Git worktree.",
  heroVisual: <TasksBoard compact={false} />,
  tailored: LEDGER_HIGHLIGHT,
  sections: [agentsSection(AGENTS_COPY), pluginsSection(PLUGINS_COPY)],
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
          bb: cell("yes", "Tasks plugin, local"),
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
          question: "Is Vibe Kanban shutting down?",
          answer: (
            <p>
              Its maker, bloop,{" "}
              <a href="https://www.vibekanban.com/blog/shutdown">shut down</a>{" "}
              in April 2026 and turned off its cloud, including shared projects
              and issues. The open-source app continues as a community project,
              but version 0.1.44 turned off Projects for everyone, and there
              hasn’t been a release since. Local workspaces still run.
            </p>
          ),
        },
        {
          question: "What’s the difference between bb and Vibe Kanban?",
          answer: (
            <p>
              Both run Claude Code, Codex, and other coding agents in Git
              worktrees, and both are free and open source. bb’s Tasks plugin
              keeps your board on your machine with no sign-in, and bb’s agents
              can start, message, and review each other’s work. bb is actively
              developed, with a release every week.
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
              Yes. Ask bb to do it. Your branches and worktrees are plain Git on
              your machine, so a bb agent can add the repo and open each
              worktree as a thread. If you exported your Vibe Kanban issues, it
              can turn each one into a task on your board.
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
