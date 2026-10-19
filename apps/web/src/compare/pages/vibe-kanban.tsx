import type { CompareHighlight, Comparison } from "../compare-types";
import {
  BB_ROWS,
  FAQ_AGENTS,
  FAQ_REVIEW,
  cell,
  price,
} from "../compare-content";
import { AGENTS_COPY, agentsSection } from "../compare-sections";
import { WINDOWS_DOWNLOAD_URL } from "../../landing/site";
import { TaskLedger, TasksBoard } from "../compare-visuals";
import { meta } from "./vibe-kanban.meta";

const LEDGER_HIGHLIGHT: CompareHighlight = {
  title: "See the agents on every task",
  wide: false,
  visual: <TaskLedger />,
  body: (
    <p>
      Each task shows its agents working live, with their comments and pull
      requests.
    </p>
  ),
};

export const comparison: Comparison = {
  ...meta,
  title: "Vibe Kanban Alternative: Get Your Board Back in bb",
  description:
    "Vibe Kanban’s cloud shut down. bb is a free, open-source app whose Tasks plugin gives you a local board: hand any task to Claude Code, Codex, or another agent in its own Git worktree.",
  headline: "Vibe Kanban’s cloud shut down. Get your board back in bb.",
  sub: "Hand any task to Claude Code, Codex, or another agent on a local board, in an app that ships a release every week.",
  heroVisual: <TasksBoard compact={false} />,
  tailored: LEDGER_HIGHLIGHT,
  sections: [agentsSection(AGENTS_COPY)],
  tableNote: null,
  table: [
    {
      title: "Price and license",
      rows: [
        { ...BB_ROWS.pricing, competitor: price("$0", "Open source") },
        { ...BB_ROWS.license, competitor: cell("yes", "Apache 2.0") },
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
          competitor: cell("no", "Retired in 0.1.44"),
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
          ...BB_ROWS.handoff,
          competitor: cell("yes", "Through its MCP server"),
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
              in April 2026 and said it would remove cloud projects, issues, and
              organizations. The open-source app continues as a community
              project, but version 0.1.44 turned off Projects for everyone, and
              there hasn’t been a release since. Local workspaces still run.
            </p>
          ),
        },
        {
          question: "What’s the difference between bb and Vibe Kanban?",
          answer: (
            <p>
              Both run Claude Code, Codex, and other coding agents in Git
              worktrees, and both are free and open source. Vibe Kanban retired
              its board in 0.1.44; bb’s Tasks plugin keeps yours on your machine
              with no sign-in. bb is actively developed, with a release every
              week.
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
              can turn each one into a task on your board.{" "}
              <a href="/guides/switch-from-vibe-kanban">Copy the prompt</a>.
            </p>
          ),
        },
        {
          question: "How do I get started?",
          answer: (
            <ol>
              <li>
                Download bb for <a href="/download/macos">macOS</a> (Apple
                Silicon), <a href={WINDOWS_DOWNLOAD_URL}>Windows (Alpha)</a>, or{" "}
                <a href="/download/linux">Linux (Alpha)</a>.
              </li>
              <li>
                Install and sign in to a coding agent, like Claude Code, Codex,
                Cursor, or OpenCode.
              </li>
              <li>
                Install the Tasks plugin from bb’s plugin marketplace, then add
                your project and create your first task.
              </li>
            </ol>
          ),
        },
        FAQ_REVIEW,
        FAQ_AGENTS,
      ],
    },
  ],
  closer: {
    title: "Get your board back",
    body: "Free and open source, with a release every week. Bring the AI plans you already pay for.",
  },
};
