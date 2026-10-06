import AiMagicIcon from "@hugeicons/core-free-icons/AiMagicIcon";
import ComputerIcon from "@hugeicons/core-free-icons/ComputerIcon";
import GitBranchIcon from "@hugeicons/core-free-icons/GitBranchIcon";

import { AgentSplit } from "../../compare/compare-visuals";
import { CommandBlock, ProductShot, Substeps } from "../guide-blocks";
import type { Guide } from "../guide-types";

const AGENT_PROMPT = `Build the task I describe, have a Codex subthread review it, talk it through with the reviewer, and stop after two review rounds.
Guide: https://getbb.app/guides/claude-code-and-codex-together

You're in a bb thread, so the bb CLI is on your PATH. Do these steps in order and run each check. If a check fails, stop and tell me what you saw. If I haven't described the task, ask me first.

1. Build the task on this thread's branch and commit your work.
   Check: \`git status\` is clean and \`git log -1\` shows your commit.

2. Start a Codex subthread to review it, in this worktree:
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

const SPAWN = `bb thread spawn --project "$BB_PROJECT_ID" \\
    --environment "$BB_ENVIRONMENT_ID" --parent-self \\
    --provider codex --prompt "Review this branch read-only..."`;

export const CLAUDE_CODE_AND_CODEX: Guide = {
  slug: "claude-code-and-codex-together",
  title: "Use Claude Code and Codex together",
  description:
    "Have Claude Code lead and Codex review. They start each other, message each other, and report back, in threads you can watch side by side.",
  concept: <AgentSplit />,
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
          Signed in once, with <code>claude</code> and <code>codex login</code>.
          bb runs the CLIs you already use.
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
      title: "Start a lead thread",
      lead: "Any thread can lead. Start one with the agent you want in charge.",
      body: (
        <Substeps>
          <li>
            Start a new thread. Pick <strong>Claude Code</strong> and{" "}
            <strong>Worktree</strong>.
          </li>
          <li>
            Paste the prompt from <strong>Copy for agent</strong>, and describe
            your task below it.
          </li>
        </Substeps>
      ),
      doneWhen: "Claude Code is working on a new branch in its own worktree.",
    },
    {
      id: "step-2",
      title: "Spawn a Codex subthread",
      lead: "The lead starts Codex as a subthread, with its own prompt, in the same worktree.",
      body: (
        <>
          <CommandBlock label="What the agent runs" command={SPAWN} />
          <ProductShot
            src="/guides/claude-code-and-codex-together/subthread-sidebar.png"
            alt="The sidebar with a Claude Code thread, Rate limit upload, and its Codex subthread, Review upload rate limiter, nested under it"
          />
        </>
      ),
      doneWhen: "the Codex thread shows up under the Claude Code thread.",
    },
    {
      id: "step-3",
      title: "Watch them side by side",
      lead: "Open the subthread next to its parent and follow both at once.",
      body: (
        <>
          <p>
            Choose <strong>Open in split</strong> from the subthread's menu, or
            drag it into the window.
          </p>
          <ProductShot
            src="/guides/claude-code-and-codex-together/split-view.png"
            alt="bb with the Claude Code thread and its Codex subthread open side by side in a split"
          />
        </>
      ),
      doneWhen: "both threads are open side by side.",
    },
    {
      id: "step-4",
      title: "Let them talk",
      lead: "Agents message each other the way you message them: mid-turn, or queued for later.",
      body: (
        <>
          <CommandBlock
            label="What the agent runs"
            command={
              'bb thread tell <codex-thread-id> \\\n    "Can the cleanup timer drop a window that is still active?"'
            }
          />
          <ProductShot
            src="/guides/claude-code-and-codex-together/agent-message.png"
            alt="The Codex thread showing a Message from Rate limit upload, followed by Codex's answer"
          />
          <p>
            Type in either thread to step in yourself. Your message reaches it
            the same way.
          </p>
        </>
      ),
      doneWhen: (
        <>
          the Codex thread shows a <strong>Message from</strong> the lead, and
          its answer.
        </>
      ),
    },
    {
      id: "step-5",
      title: "Get the results back",
      lead: "When the subthread finishes, its result lands in the lead's thread.",
      body: (
        <>
          <ProductShot
            src="/guides/claude-code-and-codex-together/results-back.png"
            alt="The Claude Code thread showing that Review upload rate limiter finished, followed by Claude's summary of what Codex found"
          />
          <p>
            The lead fixes what's serious, asks for one more pass, and stops
            after two rounds.
          </p>
        </>
      ),
      doneWhen:
        "Claude Code replies with what it built, what each review found, and what's left for you.",
    },
  ],
  sections: [
    {
      id: "more-agents",
      title: "Bring in more agents",
      body: (
        <p>
          Any agent can lead, and any agent can join: Claude Code, Codex,
          Cursor, OpenCode, Pi, and more. Ask for a Cursor thread to write the
          release notes, or a second Claude Code thread to try another approach.
          Each one shows up in your sidebar, under the thread that started it.
        </p>
      ),
    },
  ],
  faq: [
    {
      question: "How do agents know how to reach each other?",
      answer: (
        <p>
          Every thread has the bb CLI and a short guide to it. An agent starts,
          waits for, and messages other threads with the same commands you'd
          use.
        </p>
      ),
    },
    {
      question: "Will agents start other threads on their own?",
      answer: (
        <p>
          They're told not to unless you ask. Say "work together", or name the
          agents you want.
        </p>
      ),
    },
    {
      question: "Can Codex lead and Claude Code review?",
      answer: (
        <p>
          Yes. Any thread can lead. Start a Codex thread and have it spawn a
          reviewer with <code>--provider claude-code</code>.
        </p>
      ),
    },
    {
      question: "Do subthreads share the lead's files?",
      answer: (
        <p>
          When they start in the lead's environment, yes. Pass{" "}
          <code>--new-environment worktree</code> to give a subthread its own
          branch instead.
        </p>
      ),
    },
    {
      question: "Can both agents edit at the same time?",
      answer: (
        <p>
          Not safely in one worktree. Have them take turns, or give each its own
          worktree.
        </p>
      ),
    },
    {
      question: "Does this cost extra?",
      answer: (
        <p>
          bb is free. Each agent uses its own plan or API key, as it does now.
        </p>
      ),
    },
  ],
  closer: {
    title: "Get your agents working together",
    body: "Free and open source. Bring the Claude and ChatGPT plans you already have.",
  },
};
