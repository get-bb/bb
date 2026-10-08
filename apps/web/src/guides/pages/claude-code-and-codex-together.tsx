import AiMagicIcon from "@hugeicons/core-free-icons/AiMagicIcon";
import ComputerIcon from "@hugeicons/core-free-icons/ComputerIcon";
import GitBranchIcon from "@hugeicons/core-free-icons/GitBranchIcon";

import { AgentSplit } from "../../compare/compare-visuals";
import { AgentTeamConcept, NewThreadConcept } from "../concepts";
import { ProductShot, Substeps } from "../guide-blocks";
import type { Guide } from "../guide-types";
import {
  CHILD_THREAD_SHOT,
  TEAM_COST,
  TEAM_TROUBLESHOOTING,
  WHEN_IT_PAYS,
  talkStep,
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

5. Stop after the second review, even if issues remain. If the first review found nothing serious, stop after it.

Reply with what you built, what each review found, what you fixed, and what's left for me. Don't push, open a PR, or merge unless I ask.`;

export const CLAUDE_CODE_AND_CODEX: Guide = {
  slug: "claude-code-and-codex-together",
  title: "Use Claude Code and Codex together",
  description:
    "Have Claude Code be the parent and Codex review. They start each other, message each other, and report back, in threads you can watch side by side.",
  concept: <AgentSplit />,
  picker: null,
  handoffNote:
    "Paste it into a Claude Code thread with your task. It runs every step and stops after two review rounds.",
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
      body: (
        <>
          Signed in once on your computer. bb runs the agents you already use.
        </>
      ),
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
      title: "Start a Claude Code thread",
      lead: "This thread is the parent. Start it with the agent you want in charge.",
      body: (
        <>
          <NewThreadConcept />
          <Substeps>
            <li>
              Start a new thread. Pick <strong>Claude Code</strong> and{" "}
              <strong>Worktree</strong>.
            </li>
            <li>
              Paste the prompt from <strong>Copy for agent</strong>, and
              describe your task below it.
            </li>
          </Substeps>
        </>
      ),
      doneWhen: "Claude Code is working on a new branch in its own worktree.",
    },
    {
      id: "step-2",
      title: "Claude Code starts a Codex child thread",
      lead: "The parent thread starts Codex as a child thread, with its own prompt, in the same worktree.",
      body: CHILD_THREAD_SHOT,
      doneWhen: "the Codex thread shows up under the Claude Code thread.",
    },
    {
      id: "step-3",
      title: "Watch them side by side",
      lead: "Open the child thread next to its parent and follow both at once.",
      body: (
        <>
          <p>
            Choose <strong>Open in split</strong> from the child thread's menu,
            or drag it into the window. You can split the window into up to 8
            threads, and each one keeps its right panel, with its Diff,
            Terminal, and previews.
          </p>
          <ProductShot
            src="/guides/claude-code-and-codex-together/split-view.png"
            alt="bb with the Claude Code thread and its Codex child thread open side by side in a split"
          />
        </>
      ),
      doneWhen: "both threads are open side by side.",
    },
    talkStep(
      "step-4",
      "Claude Code replies with what it built, what each review found, and what's left for you.",
    ),
  ],
  sections: [
    {
      id: "when-it-pays",
      title: WHEN_IT_PAYS.title,
      body: (
        <>
          <AgentTeamConcept />
          {WHEN_IT_PAYS.body}
          <p>
            Any agent can be the parent, and any agent can join: Claude Code,
            Codex, Cursor, OpenCode, Pi, and more. Ask for a Cursor thread to
            write the release notes, or a second Claude Code thread to try
            another approach. Each one shows up in your sidebar, under the
            thread that started it. To keep a manager that runs every morning,
            or to fan out across a whole codebase, see{" "}
            <a href="/guides/orchestrate-coding-agents">
              Orchestrate your coding agents
            </a>
            .
          </p>
        </>
      ),
    },
  ],
  faqTitle: "Troubleshooting FAQ",
  faq: [
    ...TEAM_TROUBLESHOOTING,
    {
      question: "Can Codex be the parent and Claude Code review?",
      answer: (
        <p>
          Yes. Any thread can be the parent. Start a Codex thread and ask it to
          have Claude Code review.
        </p>
      ),
    },
    TEAM_COST,
  ],
  closer: {
    title: "Get your agents working together",
    body: "Free and open source. Bring the Claude and ChatGPT plans you already have.",
  },
};
