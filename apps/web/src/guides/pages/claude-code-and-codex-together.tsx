import { AgentSplit } from "../../compare/compare-visuals";
import { CopyPromptButton, Substeps, Ui } from "../guide-blocks";
import { skillOffer, withIntake } from "../prompt-intake";
import type { Guide, GuideMeta } from "../guide-types";
import {
  NESTED_SHOT,
  SPLIT_SHOT,
  TALK_SHOT,
  TEAM_FAQ,
  TEAM_TROUBLESHOOTING,
} from "../shared/agent-teams";

const AGENT_PROMPT = withIntake(
  [{ label: "Task", hint: "what to build or fix" }],
  `Build the task, have Codex review it in its own thread, talk it through with Codex. One review round, then stop.
Guide: https://getbb.app/guides/claude-code-and-codex-together

Do these steps in order and run each check. If a check fails, stop and tell me what you saw. Don't push, open a pull request, or merge unless I ask.

If you aren't Claude Code, tell me to paste this into a Claude Code thread instead, and stop.

1. Get a branch. If you're on the repo's default branch, create a new branch first. Run \`BASE=$(git rev-parse HEAD)\` and keep the value.
   Check: \`git branch --show-current\` isn't the default branch.

2. Build the task and commit your work.
   Check: \`git status\` is clean and \`git log -1\` shows your commit.

3. Start Codex as the reviewer in its own thread, in this worktree:
   bb thread spawn --json --project "$BB_PROJECT_ID" --environment "$BB_ENVIRONMENT_ID" --parent-self --provider codex --title "<task>" --prompt "Task: <task>. Review git diff <BASE>..HEAD read-only. Don't edit files or commit. List each issue as serious or minor, with file and line."
   Check: the spawn returns a thread ID. If Codex fails to start, stop and ask me to sign in to Codex on this computer.

4. Wait for the review and read it:
   bb thread wait <codex-thread-id>
   bb thread output <codex-thread-id>
   Check: the output lists issues or says there are none. If bb later tells you the reviewer completed, just repeat your final report.

5. Fix every serious issue and commit. If a finding is unclear, ask first: bb thread tell <codex-thread-id> "<your question>", then read the answer with bb thread wait and bb thread output. Don't ask for a second review.
   Check: \`git status\` is clean and each serious issue has a fix.

6. Stop. Leave the reviewer's thread open so I can read it; don't archive it.

Reply with what you built, what the review found, what you fixed, and what's left for me. ${skillOffer("build-and-review", "the reviewer")}`,
);

export const meta: GuideMeta = {
  slug: "claude-code-and-codex-together",
  title: "Use Claude Code and Codex together",
  nav: null,
  canonical: "/claude-code-and-codex",
};

export const guide: Guide = {
  ...meta,
  description:
    "Have Claude Code build and Codex review. They message each other and report back to you, in threads you can watch side by side.",
  heroTop: null,
  concept: <AgentSplit />,
  agentPrompt: AGENT_PROMPT,
  requirement: "Claude Code and Codex, each signed in once",
  steps: [
    {
      id: "step-1",
      title: "Start a Claude Code thread with your task",
      lead: "Claude Code builds it and brings in Codex to review. You talk to Claude Code, and can open Codex's thread anytime.",
      body: (
        <Substeps>
          <li>
            Choose <strong>New thread</strong>. Pick a Claude model, like{" "}
            <strong>Opus 5.5</strong>, and choose <strong>Worktree</strong>.
          </li>
          <li>
            Paste the prompt from <CopyPromptButton /> and send it. Claude Code
            asks for your task.
          </li>
        </Substeps>
      ),
      shot: {
        src: "/guides/claude-code-and-codex-together/window-start-interview.png",
        alt: "A new bb thread with Opus 5.5, acme-web, and Worktree picked. The guide's prompt is pasted, starting with the questions the agent asks: your task.",
        width: 2048,
        height: 1280,
      },
      options: [],
    },
    {
      id: "step-2",
      title: "Claude Code brings in Codex to review",
      lead: "A second model reads the change with fresh eyes and catches what the first one missed.",
      body: (
        <p>
          Once its work is committed, Claude Code starts Codex in a thread of
          its own, on the same branch, and nests it under its thread in the
          sidebar. Codex reviews read-only and lists each issue as serious or
          minor.
        </p>
      ),
      shot: NESTED_SHOT,
      options: [],
    },
    {
      id: "step-3",
      title: "Watch them side by side",
      lead: "Claude Code hears back as soon as Codex finishes, and fixes what's serious.",
      body: (
        <Substeps>
          <li>
            In the sidebar, open the Codex thread's <Ui icon="more" /> menu and
            choose <strong>Open in split</strong>.
          </li>
          <li>Type in either thread to step in yourself.</li>
        </Substeps>
      ),
      shot: SPLIT_SHOT,
      options: [],
    },
    {
      id: "step-4",
      title: "Ask Codex a question through Claude Code",
      lead: "When you want a second opinion on a finding, have Claude Code ask. It waits for Codex's answer and tells you what it said.",
      body: (
        <p>
          Ask in the Claude Code thread, like “Ask the reviewer whether the
          memory growth is worth fixing before this merges.”
        </p>
      ),
      shot: TALK_SHOT,
      options: [],
    },
  ],
  troubleshooting: TEAM_TROUBLESHOOTING,
  faq: [
    {
      question: "Why use Claude Code and Codex together?",
      answer: (
        <p>
          A second model catches what the first one missed, and each agent runs
          on its own subscription.{" "}
          <a href="/claude-code-and-codex">See what it gets you</a>.
        </p>
      ),
    },
    ...TEAM_FAQ,
    {
      question: "Can Codex build and Claude Code review?",
      answer: (
        <p>
          Yes, but this page's prompt is for Claude Code building. Use the
          prompt in{" "}
          <a href="/guides/orchestrate-coding-agents">
            Orchestrate your coding agents
          </a>{" "}
          in a Codex thread, and name Claude Code as the reviewer.
        </p>
      ),
    },
  ],
  closer: {
    title: "Get your agents working together",
    body: "Free and open source. Bring the Claude and ChatGPT plans you already have.",
  },
};
