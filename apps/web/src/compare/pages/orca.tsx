import { FAQ_PLUGIN_TRUST } from "../plugin-trust";
import { CustomizeBuild } from "../../landing/landing-visuals";
import { BB_ROWS, FAQ_GET_STARTED, cell, linkedCell } from "../compare-content";
import { agentsSection } from "../compare-sections";
import type { Comparison } from "../compare-types";
import { meta } from "./orca.meta";

export const comparison: Comparison = {
  ...meta,
  title: "bb vs Orca: an agent workspace you can make your own",
  description:
    "Compare bb and Orca. Ask agents to set up recurring work and build plugins that change bb. See the shared capabilities and when Orca is a better fit.",
  headline: "An Orca alternative you can make your own",
  sub: "Ask agents to set up recurring work and build plugins that change the app. Keep the tools and routines that fit the way you work.",
  heroVisual: <CustomizeBuild />,
  tailored: {
    title: "Describe the routine. Let an agent set it up.",
    body: (
      <>
        <p>
          “Every weekday, read new issues and leave me a short triage.” Tell an
          agent what to do, when to do it, and where the results should go. It
          can create the schedule and test it with you.
        </p>
        <p>
          Start with the{" "}
          <a href="/guides/run-an-agent-on-a-schedule">scheduling guide</a>, or
          ask for a plugin that puts your own workflow inside bb.
        </p>
      </>
    ),
    visual: null,
    wide: true,
  },
  sections: [
    agentsSection({
      title: "Keep the agents you already use",
      body: (
        <p>
          Work with your existing coding agents in bb. Give each a thread you
          can return to, and ask one to hand part of the job to another.
        </p>
      ),
    }),
  ],
  tableNote: null,
  table: [
    {
      title: "Make the workspace yours",
      rows: [
        {
          feature: "Extend the app with plugins",
          bb: linkedCell(
            "yes",
            "Panels, tools and app controls",
            "/marketplace",
          ),
          competitor: linkedCell(
            "yes",
            "Panels, commands and events",
            "https://github.com/stablyai/orca/tree/59a9da22a0c6086a86c223534b36a6498eaf1b0a/examples/plugins/hello-orca",
          ),
        },
        {
          feature: "Agents can operate the app",
          bb: cell("yes", "Threads, schedules and plugins; MCP access too"),
          competitor: linkedCell(
            "yes",
            "Worktrees, terminals and browser via Orca CLI",
            "https://www.onorca.dev/docs/cli/overview",
          ),
        },
        {
          ...BB_ROWS.automations,
          bb: cell("yes", "Recurring or one-time agent jobs and scripts"),
          competitor: linkedCell(
            "yes",
            "Scheduled prompts for repos or workspaces",
            "https://www.onorca.dev/docs/cli/automations",
          ),
        },
      ],
    },
    {
      title: "The daily coding workflow",
      rows: [
        {
          ...BB_ROWS.worktrees,
          competitor: linkedCell(
            "yes",
            "Worktree-centered projects and agent terminals",
            "https://www.onorca.dev/docs/model/worktrees",
          ),
        },
        {
          feature: "Give feedback on a diff",
          bb: cell("yes", "Select lines and add them to the chat"),
          competitor: linkedCell(
            "yes",
            "Pin line comments and send them to an agent in a batch",
            "https://www.onorca.dev/docs/review/annotate-ai-diff",
          ),
        },
        {
          ...BB_ROWS.mobile,
          competitor: linkedCell(
            "yes",
            "iOS and Android companion",
            "https://www.onorca.dev/docs/mobile",
          ),
        },
      ],
    },
  ],
  faqTitle: "Choosing between bb and Orca",
  faq: [
    {
      title: "Finding your fit",
      items: [
        {
          question: "When is Orca a better fit?",
          answer: (
            <p>
              Orca is a better fit if you want a worktree-first IDE with
              built-in split terminals and a line-by-line review loop. Its diff
              annotations stay attached to lines as code changes, and you can
              send a batch of comments back to an agent. See Orca’s{" "}
              <a href="https://www.onorca.dev/docs/review/annotate-ai-diff">
                diff review documentation
              </a>
              .
            </p>
          ),
        },
        {
          question: "Why try bb if Orca already has plugins and automations?",
          answer: (
            <p>
              Try bb for the way you can change the workspace itself. Ask an
              agent to build a panel, add a tool, or change how you browse your
              threads. Browse the <a href="/marketplace">plugin marketplace</a>{" "}
              for a starting point. Orca has plugins and agent-driven controls
              too; the choice is which workflow and extensions fit you.
            </p>
          ),
        },
        {
          question: "Can another AI app drive bb for me?",
          answer: (
            <p>
              Yes. With bb’s MCP server plugin, a connected MCP client can start
              and message threads, run terminals, and manage schedules. Ask your
              agent to help you connect it. See the{" "}
              <a href="https://github.com/get-bb/bb/blob/9937c46f5c7e369de3563eb864c8cbc4c3b9c231/plugins/mcp/skills/mcp/SKILL.md">
                MCP setup and access details
              </a>
              .
            </p>
          ),
        },
      ],
    },
    {
      title: "Trying bb",
      items: [
        FAQ_PLUGIN_TRUST,
        FAQ_GET_STARTED,
        {
          question: "Do I need to move all my work out of Orca?",
          answer: (
            <p>
              No. Try one task in a separate checkout of your repository first.
              Ask bb to help you find the repo and set up a thread. Orca’s
              worktrees are{" "}
              <a href="https://www.onorca.dev/docs/model/worktrees">
                ordinary Git worktrees
              </a>
              , so you can keep using Orca while you decide. This is not an
              import of Orca’s conversations or settings.
            </p>
          ),
        },
        {
          question: "Can I keep working from my phone?",
          answer: (
            <p>
              Yes. bb has an iOS beta, an Android alpha, and browser access
              through bb Connect. Keep the computer running your agents on and
              connected. See{" "}
              <a href="/guides/work-from-anywhere">how to work from anywhere</a>
              . Orca also has a mobile companion.
            </p>
          ),
        },
      ],
    },
  ],
  closer: {
    title: "Make bb work your way",
    body: "Start with one task. Ask an agent to set up the workflow around it.",
  },
};
