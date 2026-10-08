import AiMagicIcon from "@hugeicons/core-free-icons/AiMagicIcon";
import ComputerIcon from "@hugeicons/core-free-icons/ComputerIcon";
import GitBranchIcon from "@hugeicons/core-free-icons/GitBranchIcon";

import { SpawnTimeline } from "../../compare/compare-visuals";
import { ProductShot, PromptBlock, Substeps } from "../guide-blocks";
import type { Guide } from "../guide-types";
import {
  CHILD_THREAD_SHOT,
  TALK_SHOT,
  TEAM_COST,
  TEAM_TROUBLESHOOTING,
  WHEN_IT_PAYS,
} from "./agent-teams";

const AGENT_PROMPT = `Build the task I describe, have a child thread running a different agent review it, talk it through with the reviewer, and stop after two review rounds.
Guide: https://getbb.app/guides/orchestrate-coding-agents

You're in a bb thread, so the bb CLI is on your PATH. Do these steps in order and run each check. If a check fails, stop and tell me what you saw. If I haven't described the task, ask me first.

1. Pick the reviewer. If I named an agent, use it. Otherwise use Codex if you're Claude Code, and Claude Code if you're anything else. Run \`bb provider list\` for the provider IDs.
   Check: the provider ID you picked is in the list.

2. Build the task on this thread's branch and commit your work.
   Check: \`git status\` is clean and \`git log -1\` shows your commit.

3. Start the reviewer as your child thread, in this worktree:
   bb thread spawn --json --project "$BB_PROJECT_ID" --environment "$BB_ENVIRONMENT_ID" --parent-self --provider <provider-id> --title "Review: <task>" --prompt "Review the latest commits on this branch read-only. Don't edit files or commit. List each issue as serious or minor, with file and line."
   Check: the spawn returns a thread ID. If the reviewer fails to start, stop and ask me to sign in to that agent on this machine.

4. Wait for the review and read it:
   bb thread wait <reviewer-thread-id>
   bb thread output <reviewer-thread-id>
   Check: the output lists issues or says there are none.

5. If a finding is unclear, ask the reviewer: bb thread tell <reviewer-thread-id> "<your question>". Fix every serious issue and commit. Then ask for one more pass:
   bb thread tell <reviewer-thread-id> "I fixed the serious issues in the latest commit. Review the branch again, read-only."
   Check: \`bb thread wait\` and \`bb thread output\` return a second review.

6. Stop after the second review, even if issues remain. If the first review found nothing serious, stop after it.

Reply with what you built, what each review found, what you fixed, and what's left for me. Don't push, open a PR, or merge unless I ask.`;

export const ORCHESTRATE_CODING_AGENTS: Guide = {
  slug: "orchestrate-coding-agents",
  title: "Orchestrate your coding agents",
  description:
    "Let agents hand work to each other across Claude Code, Codex, and more. Every agent has its own thread, so you can see what each one is doing and step in.",
  concept: <SpawnTimeline />,
  picker: null,
  handoffNote:
    "Paste it into a thread with your task. Your agent brings in a second agent to review, and stops after two review rounds.",
  agentPrompt: AGENT_PROMPT,
  needs: [
    {
      title: "bb on your computer",
      icon: ComputerIcon,
      body: "A Mac with Apple Silicon, Windows, or Linux (alpha).",
    },
    {
      title: "Two or more agents",
      icon: AiMagicIcon,
      body: "Claude Code, Codex, Cursor, Pi, or others, each signed in once. bb runs the CLIs you already use.",
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
      title: "Start the parent thread",
      lead: "Any agent can be the parent. Start a thread with the one you want in charge.",
      body: (
        <>
          <Substeps>
            <li>
              Choose <strong>New thread</strong>. Pick an agent, and choose{" "}
              <strong>Worktree</strong> so the work gets its own branch.
            </li>
            <li>
              Paste the prompt from <strong>Copy for agent</strong>, and
              describe your task below it.
            </li>
          </Substeps>
          <ProductShot
            src="/guides/orchestrate-coding-agents/new-thread.png"
            alt="A new bb thread with Claude Code and Worktree picked, and the guide's prompt pasted with a task below it"
          />
        </>
      ),
      doneWhen:
        "the parent thread is working on a new branch in its own worktree.",
    },
    {
      id: "step-2",
      title: "Bring in a second agent",
      lead: "The parent thread starts another agent as its child thread, with its own prompt, in the same worktree.",
      body: (
        <>
          <p>
            The prompt asks for a reviewer on a different agent. You can also
            just say who you want, like “Have Codex review this” or “Ask Cursor
            to write the release notes.” Any agent you've signed in to works.
          </p>
          {CHILD_THREAD_SHOT}
        </>
      ),
      doneWhen:
        "the child thread shows up under the parent thread in your sidebar.",
    },
    {
      id: "step-3",
      title: "Watch them talk it through",
      lead: "Agents message each other the way you message them, and the parent thread hears back when its child thread finishes.",
      body: (
        <>
          <p>
            Choose <strong>Open in split</strong> from the child thread's menu
            to follow both threads at once.
          </p>
          {TALK_SHOT}
          <p>
            The parent thread fixes what's serious, asks for one more pass, and
            stops after two rounds. Type in either thread to step in yourself.
          </p>
        </>
      ),
      doneWhen:
        "the parent thread replies with what each review found and what's left for you.",
    },
    {
      id: "step-4",
      title: "Keep a manager for work you repeat",
      lead: "A manager is a long-running thread that owns one job, like triaging new issues. Tell it what it got wrong, and it changes how it does the job.",
      body: (
        <>
          <Substeps>
            <li>
              Start a thread for the job, and name it after the job, like{" "}
              <strong>Issue triage</strong>.
            </li>
            <li>Walk it through the job once, and correct it as you go.</li>
            <li>Ask it to save the job as a skill.</li>
          </Substeps>
          <PromptBlock
            name="Ask the manager"
            prompt="Save how you triage issues as a bb skill called issue-triage. Run it every time I ask for triage, and update it whenever I correct you."
          />
          <p>
            Once it's reliable, have it start child threads for the follow-up
            work, like fixing an issue and opening a PR.
          </p>
        </>
      ),
      doneWhen:
        "asking the manager to run its issue-triage skill does the whole job.",
    },
    {
      id: "step-5",
      title: "Wake it every morning",
      lead: "An automation messages the manager on a schedule, so every run lands in the same thread and builds on the last.",
      body: (
        <>
          <p>Ask the manager to schedule itself.</p>
          <PromptBlock
            name="Ask the manager"
            prompt="Every weekday at 9am my time, have an automation message this thread and ask you to run your issue-triage skill. Run it once now to test it."
          />
          <p>
            <a href="/guides/run-an-agent-on-a-schedule">
              Run an agent on a schedule
            </a>{" "}
            covers testing a run, notifications, and one-off runs.
          </p>
        </>
      ),
      doneWhen:
        "the test run's report lands in the manager's thread, and the automation shows its next run.",
    },
  ],
  sections: [
    WHEN_IT_PAYS,
    {
      id: "drag-to-manager",
      title: "Drag work onto a manager",
      body: (
        <p>
          Drag any thread onto a manager in the sidebar to nest it there, then
          ask the manager to take the next part. It doesn't have to be the agent
          that started the work. Keep a manager that opens a PR for every thread
          you drop on it, waits for CI, and tells you when it passes.
        </p>
      ),
    },
    {
      id: "workflows",
      title: "Fan out with a workflow",
      body: (
        <>
          <p>
            For a big, repetitive change, like fixing one lint rule across a
            whole codebase, ask your agent for a workflow. It writes a short
            script that starts a worker for each part of the job, picks the
            agent and model for each worker, and checks the results. You can
            follow every worker from the thread, and stop the run.
          </p>
          <p>
            Workflows is off by default. Turn it on in{" "}
            <strong>Settings → Installed plugins</strong>, then ask for a
            workflow by name.
          </p>
          <PromptBlock
            name="Example"
            prompt="Use a workflow to fix every no-floating-promises lint error. Start one Codex worker per top-level folder, then have a Claude Code worker check each folder's fixes. Open one PR when every check passes."
          />
        </>
      ),
    },
  ],
  faqTitle: "Troubleshooting FAQ",
  faq: [
    ...TEAM_TROUBLESHOOTING,
    {
      question: "Why did my manager forget a correction?",
      answer: (
        <p>
          Long threads get compacted, and older details can drop out. Keep the
          job in a skill, and ask the manager to update the skill when you
          correct it.
        </p>
      ),
    },
    {
      question: "Why didn't my manager run this morning?",
      answer: (
        <p>
          If the bb server or the manager's machine was asleep, the job runs
          once they're back. Open the automation in <strong>Automations</strong>{" "}
          and check its <strong>Runs</strong> to see what happened.{" "}
          <a href="/guides/run-an-agent-on-a-schedule">
            Run an agent on a schedule
          </a>{" "}
          covers more fixes.
        </p>
      ),
    },
    {
      question: "Why won't my agent start a workflow?",
      answer: (
        <p>
          Workflows is off by default, and agents start one only when you ask.
          Turn it on in <strong>Settings → Installed plugins</strong>, then ask
          for a workflow by name.
        </p>
      ),
    },
    {
      question: "Can any agent be the parent thread?",
      answer: (
        <p>
          Yes. Start the parent thread with any agent, and ask it to bring in
          others by name.
        </p>
      ),
    },
    TEAM_COST,
  ],
  closer: {
    title: "Hand off the work you repeat",
    body: "Free and open source. Bring the Claude and ChatGPT plans you already have.",
  },
};
