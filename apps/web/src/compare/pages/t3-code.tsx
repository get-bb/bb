import type { Comparison } from "../compare-types";
import {
  BB_ROWS,
  CLOSER,
  FAQ_AGENTS,
  FAQ_CODEX_TOGETHER,
  FAQ_CUSTOMIZE,
  FAQ_GET_STARTED,
  FAQ_PERMISSIONS,
  FAQ_PRIVACY,
  FAQ_REVIEW,
  FAQ_SUBSCRIPTIONS,
  cell,
  faqFree,
  faqPhone,
  faqPlatforms,
  faqSchedule,
  faqTeam,
  faqUsageLimit,
  price,
  faqScript,
} from "../compare-content";
import {
  ANYWHERE_COPY,
  anywhereSection,
  pluginsSection,
  SPAWN_COPY,
  spawnSection,
  type SectionCopy,
  LIMITS_COPY,
  limitsSection,
} from "../compare-sections";
import { AgentSplit } from "../compare-visuals";
import { meta } from "./t3-code.meta";

const PLUGINS_COPY_T3: SectionCopy = {
  title: "Customize everything in the app with plugins",
  body: (
    <>
      <p>
        Plugins can change almost any part of bb: pages, side panels, message
        cards, file editors, and the command palette. They can also add new
        agents, tools and skills for your agents, background jobs, webhooks, and
        machines to run on.
      </p>
      <p>
        300+ are already in the marketplace, and bb still updates every week
        with nothing for you to rebase.
      </p>
    </>
  ),
};

export const comparison: Comparison = {
  ...meta,
  title: "T3 Code Alternatives: bb, Change Anything Without Forking",
  description:
    "bb is a free, open-source T3 Code alternative you can change without forking. Add panels, commands, and agents from the plugin marketplace, or have your agent build them.",
  headline: "The T3 Code alternative you can change without forking",
  sub: "Add what you need from the plugin marketplace, or have your agent build it and share it with your team. Free and open source.",
  heroVisual: <AgentSplit />,
  tailored: pluginsSection(PLUGINS_COPY_T3),
  sections: [
    spawnSection(SPAWN_COPY),
    limitsSection(LIMITS_COPY),
    anywhereSection(ANYWHERE_COPY),
  ],
  tableNote: null,
  table: [
    {
      title: "Customize",
      rows: [
        { ...BB_ROWS.marketplace, competitor: cell("no", "Fork the code") },
      ],
    },
    {
      title: "Agents",
      rows: [
        {
          feature: "Message a subagent",
          bb: cell("yes", "Mid-run, from any device"),
          competitor: cell("partial", "Through its MCP tools"),
        },
        {
          ...BB_ROWS.accountSwitch,
          competitor: cell("partial", "Tracks limits, you switch"),
        },
        {
          ...BB_ROWS.multiAgent,
          competitor: cell(
            "yes",
            "Claude Code, Codex, Cursor, OpenCode, and more",
          ),
        },
      ],
    },
    {
      title: "Everything you use today",
      rows: [
        { ...BB_ROWS.worktrees, bb: cell("yes"), competitor: cell("yes") },
        { ...BB_ROWS.diffReview, competitor: cell("yes") },
        {
          feature: "Phone and remote access",
          bb: cell("yes"),
          competitor: cell("yes"),
        },
        { ...BB_ROWS.rewind, competitor: cell("yes") },
      ],
    },
    {
      title: "Price and license",
      rows: [
        { ...BB_ROWS.pricing, competitor: price("$0", "Any team size") },
        { ...BB_ROWS.license, competitor: cell("yes", "MIT") },
      ],
    },
  ],
  faqTitle: "FAQ",
  faq: [
    {
      title: "Switching from T3 Code",
      items: [
        {
          question: "What’s the difference between bb and T3 Code?",
          answer: (
            <p>
              Both are free, MIT-licensed apps that run Claude Code, Codex, and
              other coding agents in Git worktrees on your own machines, with
              mobile and remote access, and both let agents hand work to each
              other. bb is built to be changed: install a plugin from the
              marketplace or have an agent build one, instead of keeping a fork.
              And in bb, every agent another agent starts is a full thread you
              can open and message mid-run. bb is also fully scriptable: its CLI
              and SDK can drive anything the app does.
            </p>
          ),
        },
        {
          question: "Is there a free, open-source T3 Code alternative?",
          answer: (
            <p>
              Yes: bb. It’s free for any team size and MIT-licensed, so you can
              use and change it for anything, including at work. Plugins add
              whatever you need without forking, and your agents work together
              across providers. <a href="/download/macos">Download bb</a>.
            </p>
          ),
        },
        {
          question: "How do I move my projects and worktrees to bb?",
          answer: (
            <p>
              Ask bb to do it. T3 Code keeps each thread’s worktree as plain Git
              on your machine, in <code>~/.t3/worktrees</code>, so a bb agent
              can add your repos and open each unfinished worktree as a thread.
              Your CLAUDE.md, skills, MCP servers, and agent sign-ins come
              along, and T3 Code keeps working while you try bb.{" "}
              <a href="/guides/switch-from-t3-code">Copy the prompt</a>.
            </p>
          ),
        },
        {
          question: "What’s different day to day?",
          answer: (
            <ul>
              <li>
                When you want a new panel, command, or agent, you install or
                build a plugin instead of patching the app.
              </li>
              <li>
                When an agent starts another, the new one is a full thread you
                can message.
              </li>
              <li>
                Several threads can share one worktree, so a reviewer works
                right next to the agent that wrote the code.
              </li>
              <li>
                Setup commands from <code>t3.json</code> move to{" "}
                <code>.bb-env-setup.sh</code>, and untracked files like{" "}
                <code>.env</code> go in <code>.worktreeinclude</code>.
              </li>
            </ul>
          ),
        },
        FAQ_CUSTOMIZE,
        faqScript(
          " T3 Code’s CLI mostly installs and runs its server, and outside agents can start and message threads through its MCP server.",
        ),
        {
          question: "Do my skills and slash commands work in bb?",
          answer: (
            <p>
              Yes. bb reads each agent’s own skills and slash commands and shows
              them in that agent’s <code>/</code> menu, so the ones you use
              today keep working.
            </p>
          ),
        },
        FAQ_GET_STARTED,
      ],
    },
    {
      title: "Agents",
      items: [
        FAQ_AGENTS,
        FAQ_CODEX_TOGETHER,
        faqUsageLimit(
          "T3 Code shows your accounts’ limits, but you switch accounts yourself.",
        ),
        FAQ_PERMISSIONS,
      ],
    },
    {
      title: "Your T3 Code workflow in bb",
      items: [
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
          question: "Does bb have checkpoints?",
          answer: (
            <p>
              bb lets you rewind the conversation instead. Edit any earlier
              message to rerun the thread from there, or fork a new thread from
              any message to try a different approach. In a worktree thread,
              changes stay on that thread’s branch until you merge them.
            </p>
          ),
        },
        faqPhone(null),
        faqSchedule(null),
      ],
    },
    {
      title: "Price, platforms, and privacy",
      items: [
        faqFree(""),
        FAQ_SUBSCRIPTIONS,
        faqPlatforms(null),
        FAQ_PRIVACY,
        faqTeam(""),
      ],
    },
  ],
  closer: CLOSER,
};
