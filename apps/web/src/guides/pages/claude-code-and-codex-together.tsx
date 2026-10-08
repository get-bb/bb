import AiMagicIcon from "@hugeicons/core-free-icons/AiMagicIcon";
import ComputerIcon from "@hugeicons/core-free-icons/ComputerIcon";
import GitBranchIcon from "@hugeicons/core-free-icons/GitBranchIcon";

import { AgentSplit } from "../../compare/compare-visuals";
import { Substeps } from "../guide-blocks";
import type { Guide } from "../guide-types";
import {
  NESTED_SHOT,
  SPLIT_SHOT,
  TALK_SHOT,
  TEAM_FAQ,
  TEAM_TROUBLESHOOTING,
} from "./agent-teams";

const AGENT_PROMPT = `Build the task I describe, have a Codex child thread review it, talk it through with the reviewer, and stop after two review rounds.
Guide: https://getbb.app/guides/claude-code-and-codex-together

You're in a bb thread, so the bb CLI is on your PATH. Do these steps in order and run each check. If a check fails, stop and tell me what you saw. If I haven't described the task, ask me first.

1. Build the task on this thread's branch and commit your work.
   Check: \`git status\` is clean and \`git log -1\` shows your commit.

2. Start a Codex child thread to review it, in this worktree:
   bb thread spawn --json --project "$BB_PROJECT_ID" --environment "$BB_ENVIRONMENT_ID" --parent-self --provider codex --title "Review: <task>" --prompt "Review the latest commits on this branch read-only. Don't edit files or commit. List each issue as serious or minor, with file and line."
   Check: the spawn returns a thread ID. If Codex fails to start, stop and ask me to sign in with \`codex login\`.

3. Wait for the review and read it:
   bb thread wait <codex-thread-id>
   bb thread output <codex-thread-id>
   Check: the output lists issues or says there are none.

4. If a finding is unclear, ask the reviewer: bb thread tell <codex-thread-id> "<your question>". Fix every serious issue and commit. Then ask for one more pass:
   bb thread tell <codex-thread-id> "I fixed the serious issues in the latest commit. Review the branch again, read-only."
   Check: \`bb thread wait\` and \`bb thread output\` return a second review.

5. Stop after the second review, even if issues remain. If the first review found nothing serious, stop after it. Leave the Codex thread open so I can read it; don't archive it.

Reply with what you built, what each review found, what you fixed, and what's left for me. Don't push, open a PR, or merge unless I ask.`;

export const CLAUDE_CODE_AND_CODEX: Guide = {
  slug: "claude-code-and-codex-together",
  title: "Use Claude Code and Codex together",
  description:
    "Have Claude Code build and Codex review. They message each other and report back to you, in threads you can watch side by side.",
  concept: <AgentSplit />,
  picker: null,
  handoffNote:
    "Paste it into a Claude Code thread with your task. It builds it, has Codex review, and stops after two review rounds.",
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
      lead: "Claude Code builds it and brings in Codex. You only talk to one of them unless you want to.",
      body: (
        <Substeps>
          <li>
            Choose <strong>New thread</strong>. Pick a Claude model, like{" "}
            <strong>Opus 5.5</strong>, and choose <strong>Worktree</strong>.
          </li>
          <li>
            Paste the prompt from <strong>Copy for agent</strong>, and describe
            your task below it.
          </li>
        </Substeps>
      ),
      shot: {
        src: "/guides/claude-code-and-codex-together/window-start.png",
        alt: "A new bb thread with Opus 5.5, acme-web, and Worktree picked. The guide's prompt is pasted, ending with the task: add per-user rate limiting to the upload endpoint, with a test.",
      },
      options: [],
      doneWhen: "Claude Code is working on a new branch in its own worktree.",
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
      doneWhen: "the Codex thread shows up under the Claude Code thread.",
    },
    {
      id: "step-3",
      title: "Watch them side by side",
      lead: "Claude Code hears back as soon as Codex finishes, fixes what's serious, and asks for one more pass.",
      body: (
        <Substeps>
          <li>
            In the sidebar, open the Codex thread's <strong>⋯</strong> menu and
            choose <strong>Open in split</strong>.
          </li>
          <li>Type in either thread to step in yourself.</li>
        </Substeps>
      ),
      shot: SPLIT_SHOT,
      options: [],
      doneWhen: "both threads are open side by side.",
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
      doneWhen:
        "Claude Code replies with what it built, what each review found, and what's left for you.",
    },
  ],
  troubleshooting: TEAM_TROUBLESHOOTING,
  faq: [
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
