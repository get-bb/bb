import vibeKanbanIcon from "../assets/competitors/vibe-kanban.png";
import type { CompareHighlight, Comparison } from "./comparisons";
import {
  CLOSER,
  FAQ_GET_STARTED,
  cell,
  faqFree,
  price,
} from "./compare-content";
import { AGENTS_COPY, agentsSection } from "./compare-sections";
import { TasksBoard, type BrandLogo } from "./compare-visuals";

const VIBE_KANBAN_LOGO: BrandLogo = { kind: "image", src: vibeKanbanIcon };

const BOARD_HIGHLIGHT: CompareHighlight = {
  title: "Your board, with an agent behind every card",
  wide: true,
  visual: <TasksBoard />,
  body: (
    <>
      <p>
        bb has a task board built in, with IDs, labels, priorities, and
        subtasks. Choose Delegate on a card and an agent starts on it while the
        card moves to In Progress.
      </p>
      <p>
        Comment on the card to steer it. When the work is done, it lands in In
        Review, ready for you.
      </p>
    </>
  ),
};

export const BB_VS_VIBE_KANBAN: Comparison = {
  slug: "vibe-kanban-alternative",
  title: "Vibe Kanban Alternative: Bring Your Board to bb",
  description:
    "Vibe Kanban’s maker shut down. bb is a free, open-source app with a built-in task board that hands work to Claude Code, Codex, and other agents.",
  competitor: { name: "Vibe Kanban", logo: VIBE_KANBAN_LOGO },
  headline: "Keep your tasks going in bb",
  sub: "Vibe Kanban shut down, but you can keep working: write a task, hand it to Claude Code, Codex, or any agent, and review the diff.",
  heroVisual: null,
  tailored: BOARD_HIGHLIGHT,
  sections: [agentsSection(AGENTS_COPY)],
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
          bb: cell("yes", "Regular releases"),
          competitor: cell("partial", "Community updates"),
        },
      ],
    },
    {
      title: "Tasks and agents",
      rows: [
        {
          feature: "Kanban board",
          bb: cell("yes", "Built in"),
          competitor: cell("partial", "Removed in 0.1.44"),
        },
        {
          feature: "Git worktrees",
          bb: cell("yes"),
          competitor: cell("yes"),
        },
        {
          feature: "Diff review",
          bb: cell("yes"),
          competitor: cell("yes"),
        },
        {
          feature: "Agent-to-agent handoff",
          bb: cell("yes", "Spawn, message, wait"),
          competitor: cell("no"),
        },
        {
          feature: "Mobile app",
          bb: cell("yes", "iOS beta, Android alpha"),
          competitor: cell("no", "Browser only"),
        },
      ],
    },
  ],
  faqTitle: "FAQ",
  faq: [
    {
      title: "Switching from Vibe Kanban",
      items: [
        FAQ_GET_STARTED,
        {
          question: "What’s the difference between bb and Vibe Kanban?",
          answer: (
            <p>
              Both run Claude Code, Codex, and other coding agents in Git
              worktrees, and both are free and open source. bb includes the task
              board that Vibe Kanban’s official build no longer ships, and adds
              agents that review each other’s work, scheduled automations, and
              free access from your phone.
            </p>
          ),
        },
        {
          question: "Is Vibe Kanban still maintained?",
          answer: (
            <p>
              Vibe Kanban’s maker, bloop,{" "}
              <a href="https://www.vibekanban.com/blog/shutdown">shut down</a>{" "}
              in April 2026 and turned off its hosted features. The open-source
              project still gets community updates and local workspaces still
              work, but the official build removed the board in version 0.1.44.
            </p>
          ),
        },
        {
          question: "Is there a Vibe Kanban alternative with a board?",
          answer: (
            <p>
              Yes: bb. Its Tasks board is built in, with list and board views,
              labels, priorities, and subtasks, and Delegate hands any task to
              an agent in its own thread. It’s free and MIT-licensed.{" "}
              <a href="/download/macos">Download bb</a>.
            </p>
          ),
        },
        {
          question: "Can I keep using Vibe Kanban alongside bb?",
          answer: (
            <p>
              Yes, and there’s nothing to migrate. Both work with Git worktrees
              on the same repo, so add the repo to bb and move one project at a
              time. If you exported your Vibe Kanban issues, a bb agent can turn
              each one into a task.
            </p>
          ),
        },
        faqFree(null),
      ],
    },
  ],
  closer: CLOSER,
};
