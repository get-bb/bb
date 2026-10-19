import { DISCORD_URL } from "../../landing/site";
import { FAQ_PLUGIN_TRUST } from "../plugin-trust";
import {
  BB_ROWS,
  CLOSER,
  FAQ_CUSTOMIZE,
  FAQ_GET_STARTED,
  FAQ_REVIEW,
  cell,
  linkedCell,
  price,
} from "../compare-content";
import { AGENTS_COPY, agentsSection } from "../compare-sections";
import type { Comparison } from "../compare-types";
import { FleetVisual } from "../compare-visuals";
import { meta } from "./devin.meta";

export const comparison: Comparison = {
  ...meta,
  title: "bb vs Devin: An Open-Source Workspace for Your Coding Agents",
  description:
    "Compare bb and Devin. In bb, agents run the work you ask for and build plugins that change the app, in a free, open-source workspace that uses your existing AI plans.",
  headline: "The open-source Devin alternative",
  sub: "Ask agents to run the work for you, and have them build plugins that change the app. One free, open-source workspace that uses the AI plans you already have.",
  heroVisual: <FleetVisual />,
  tailored: {
    title: "Keep the agents you already trust",
    body: (
      <>
        <p>
          Claude Code builds the feature. Codex reviews the changes. You can
          open either conversation, steer the work, and see what each agent did
          without juggling terminal windows.
        </p>
        <p>
          bb runs the coding agents themselves, with their own tools and
          sign-ins. The workspace is free and MIT-licensed. You pay for your
          agents and any hosted machines you choose.
        </p>
      </>
    ),
    visual: null,
    wide: true,
  },
  sections: [agentsSection(AGENTS_COPY)],
  tableNote:
    "Checked October 19, 2026. Devin links point to its current documentation; plans and features can change.",
  table: [
    {
      title: "Price and ownership",
      rows: [
        {
          feature: "Price",
          bb: price("$0", "App is free; AI plans and hosting are separate"),
          competitor: {
            ...price(
              "$0 / $20 / $200",
              "Free / Pro / Max per month; paid plans include usage",
            ),
            href: "https://devin.ai/pricing",
          },
        },
        {
          feature: "Use your existing AI plans",
          bb: cell("yes", "Claude Code and Codex use your own sign-ins"),
          competitor: linkedCell(
            "partial",
            "ChatGPT plan linking on Pro, Max, and Teams",
            "https://docs.devin.ai/admin/billing/chatgpt",
          ),
        },
        {
          ...BB_ROWS.license,
          competitor: linkedCell(
            "no",
            "Licensed under Cognition’s platform terms",
            "https://cognition.com/legal/platform-terms-of-service",
          ),
        },
      ],
    },
    {
      title: "Your agents and workspace",
      rows: [
        {
          feature: "Choose how you work with AI",
          bb: cell(
            "yes",
            "Run Claude Code, Codex, Pi, and other agents together",
          ),
          competitor: linkedCell(
            "yes",
            "Choose models inside Devin’s agent",
            "https://docs.devin.ai/cli/models",
          ),
        },
        {
          ...BB_ROWS.handoff,
          competitor: linkedCell(
            "yes",
            "Managed Devin sessions; external agents can hand off to Devin",
            "https://docs.devin.ai/work-with-devin/devin-handoff",
          ),
        },
        {
          feature: "Customize with plugins",
          bb: cell(
            "yes",
            "Add app panels, commands, tools, and agent providers",
          ),
          competitor: linkedCell(
            "yes",
            "Skills, rules, hooks, subagents, and MCP servers",
            "https://docs.devin.ai/cli/extensibility/plugins/overview",
          ),
        },
        {
          ...BB_ROWS.diffReview,
          competitor: linkedCell(
            "yes",
            "Devin Review and pull requests",
            "https://docs.devin.ai/work-with-devin/devin-review",
          ),
        },
      ],
    },
    {
      title: "Where work runs",
      rows: [
        {
          feature: "Work on your computer",
          bb: cell("yes", "Your repo, terminal, and Git worktrees"),
          competitor: linkedCell(
            "yes",
            "Devin Desktop and CLI",
            "https://docs.devin.ai/work-with-devin/devin-cli",
          ),
        },
        {
          ...BB_ROWS.otherMachines,
          competitor: linkedCell(
            "yes",
            "Outposts on your infrastructure; controlled through Devin Cloud",
            "https://docs.devin.ai/cloud/outposts/overview",
          ),
        },
        {
          ...BB_ROWS.cloud,
          competitor: linkedCell(
            "yes",
            "Devin Cloud on Pro and above",
            "https://devin.ai/pricing",
          ),
        },
        {
          ...BB_ROWS.automations,
          competitor: linkedCell(
            "yes",
            "Schedules and event triggers",
            "https://docs.devin.ai/product-guides/automations",
          ),
        },
        {
          ...BB_ROWS.webAccess,
          competitor: linkedCell(
            "yes",
            "Devin web app",
            "https://docs.devin.ai/get-started/first-run",
          ),
        },
      ],
    },
  ],
  faqTitle: "FAQ",
  faq: [
    {
      title: "Switching from Devin",
      items: [
        {
          question: "What’s different about bb and Devin?",
          answer: (
            <p>
              bb is an open-source workspace where agents run work for you and
              build plugins that change the app. It works with coding agents
              such as Claude Code, Codex, and Pi. Each runs with its own tools
              and account, and agents can start and message one another. Devin
              is a coding agent with a choice of models, local tools, and cloud
              sessions. bb gives you one place to work with the agents you
              already use, plus an open-source app you can customize.
            </p>
          ),
        },
        {
          question: "Is bb free, or do I still pay for AI?",
          answer: (
            <p>
              The bb app is free for any team size. Your coding agents still use
              their own subscriptions or API billing, and any hosted machines
              are paid separately. Devin has a Free plan with limited usage, Pro
              at $20 a month, and Max at $200 a month. Paid plans include usage,
              with extra usage available to buy. See{" "}
              <a href="https://devin.ai/pricing">Devin’s current plans</a>.
            </p>
          ),
        },
        {
          question: "Can I keep using my Claude and ChatGPT subscriptions?",
          answer: (
            <p>
              Yes. Sign in to Claude Code and Codex on the machine where your
              agents run, and bb uses those accounts. Devin also supports{" "}
              <a href="https://docs.devin.ai/admin/billing/chatgpt">
                linking eligible ChatGPT plans
              </a>{" "}
              for GPT usage on its Pro, Max, and Teams plans. In bb, you run
              Claude Code and Codex themselves without a separate bb
              subscription.
            </p>
          ),
        },
        {
          question: "How do I bring unfinished Devin work into bb?",
          answer: (
            <p>
              Ask bb to do it. Push your unfinished Devin work to a Git branch,
              then give a bb agent the repository, branch, and a short handoff
              describing what’s done and what’s left. It can fetch the branch
              and continue from the code. Your Devin chat history and cloud
              environment don’t transfer automatically. Start with:{" "}
              <q>
                Fetch my branch, read this handoff, and help me finish the task.
              </q>
            </p>
          ),
        },
        FAQ_GET_STARTED,
      ],
    },
    {
      title: "Your workflow in bb",
      items: [
        {
          question: "Can I delegate work and close my laptop?",
          answer: (
            <p>
              Yes. Run bb and your agents on a desktop or server that stays on,
              and check in from your phone or browser. You can also use a cloud
              environment plugin. Work running only on your laptop pauses when
              it sleeps. Start with the{" "}
              <a href="/guides/remote-dev-servers">remote machines guide</a>.
            </p>
          ),
        },
        {
          question: "Can bb run several tasks in parallel?",
          answer: (
            <p>
              Yes. Give each thread its own Git worktree, and different agents
              can work on separate branches at the same time. An agent can
              delegate work to another agent and hear back when it finishes. You
              can open and message each thread yourself. Parallel work still
              uses your agents’ plan limits and your machines’ capacity.
            </p>
          ),
        },
        FAQ_REVIEW,
        FAQ_CUSTOMIZE,
        FAQ_PLUGIN_TRUST,
        {
          question: "Can I schedule work like Devin’s automations?",
          answer: (
            <p>
              Yes. bb’s Automations plugin can start agent threads or run
              scripts on a recurring schedule or at a specific time. Pick the
              project and machine once, then inspect each run in bb. The server
              and execution machine need to be awake when it runs.
            </p>
          ),
        },
        {
          question: "Can my team use bb?",
          answer: (
            <p>
              Yes, free at any team size. Share one bb on an always-on machine
              so everyone sees the same projects and threads, or run separate
              instances and share work through Git. If your company has access
              or support requirements, <a href={DISCORD_URL}>ask the bb team</a>{" "}
              before you adopt bb. See the{" "}
              <a href="/guides/remote-dev-servers">remote setup guide</a>.
            </p>
          ),
        },
      ],
    },
  ],
  closer: CLOSER,
};
