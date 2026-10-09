import AiMagicIcon from "@hugeicons/core-free-icons/AiMagicIcon";
import ComputerIcon from "@hugeicons/core-free-icons/ComputerIcon";
import GitBranchIcon from "@hugeicons/core-free-icons/GitBranchIcon";

import { AgentSplit } from "../../compare/compare-visuals";
import { CopyPromptButton, Substeps, Ui } from "../guide-blocks";
import { withIntake } from "../prompt-intake";
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
  `Build the task, have Codex review it in its own thread, talk it through with Codex, and stop after two review rounds.
Guide: https://getbb.app/guides/claude-code-and-codex-together

You're in a bb thread, so the bb CLI is on your PATH. Do these steps in order and run each check. If a check fails, stop and tell me what you saw. Don't push, open a pull request, or merge unless I ask.

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
   Check: the output lists issues or says there are none.

5. If the review found no serious issues, skip to step 6. Otherwise:
   - If a finding is unclear, ask: bb thread tell <codex-thread-id> "<your question>", then read the answer with bb thread wait and bb thread output. Questions don't count as review rounds.
   - Fix every serious issue and commit.
   - Ask for one more pass: bb thread tell <codex-thread-id> "I fixed the serious issues in the latest commit. Review git diff <BASE>..HEAD again, read-only."
   Check: bb thread wait and bb thread output return the second review.

6. Stop after the second review, even if issues remain. Leave the reviewer's thread open so I can read it; don't archive it.

Reply with what you built, what each review found, what you fixed, and what's left for me.`,
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
  concept: <AgentSplit />,
  picker: null,
  handoffNote:
    "Claude Code asks for your task, builds it, and has Codex review it.",
  agentPrompt: AGENT_PROMPT,
  needs: [
    {
      title: "bb on your computer",
      icon: ComputerIcon,
      body: "A Mac with Apple Silicon, Windows, or Linux (alpha).",
    },
    {
      title: "Claude Code and Codex",
      icon: AiMagicIcon,
      body: "Each signed in once on your computer. bb runs the CLIs you already use.",
    },
    {
      title: "A Git repo",
      icon: GitBranchIcon,
      body: "Each task gets its own worktree, so your checkout stays as it is.",
    },
  ],
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
      lead: "Claude Code hears back as soon as Codex finishes, fixes what's serious, and asks for one more pass.",
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
          Yes. Start a Codex thread instead and ask it to have Claude Code
          review. To keep a manager that runs every morning, or to fan out
          across a whole codebase, see{" "}
          <a href="/guides/orchestrate-coding-agents">
            Orchestrate your coding agents
          </a>
          .
        </p>
      ),
    },
  ],
  closer: {
    title: "Get your agents working together",
    body: "Free and open source. Bring the Claude and ChatGPT plans you already have.",
  },
};
