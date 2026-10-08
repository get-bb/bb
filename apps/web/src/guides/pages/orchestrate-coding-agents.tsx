import AiMagicIcon from "@hugeicons/core-free-icons/AiMagicIcon";
import ComputerIcon from "@hugeicons/core-free-icons/ComputerIcon";
import GitBranchIcon from "@hugeicons/core-free-icons/GitBranchIcon";

import { SpawnTimeline } from "../../compare/compare-visuals";
import { PromptBlock, Substeps } from "../guide-blocks";
import type { Guide } from "../guide-types";
import {
  NESTED_SHOT,
  SPLIT_SHOT,
  TALK_SHOT,
  TEAM_FAQ,
  TEAM_TROUBLESHOOTING,
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

6. Stop after the second review, even if issues remain. If the first review found nothing serious, stop after it. Leave the reviewer's thread open so I can read it; don't archive it.

Reply with what you built, what each review found, what you fixed, and what's left for me. Don't push, open a PR, or merge unless I ask.`;

export const ORCHESTRATE_CODING_AGENTS: Guide = {
  slug: "orchestrate-coding-agents",
  title: "Orchestrate your coding agents",
  description:
    "Have one agent build and another review, keep a manager for the work you repeat, and fan big changes out to many workers. Every agent has its own thread, so you can see what each one is doing and step in.",
  concept: <SpawnTimeline />,
  picker: null,
  handoffNote:
    "Paste it into a thread with your task. Your agent builds it, brings in a second agent to review, and stops after two review rounds.",
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
      title: "Start a thread with your task",
      lead: "Pick the agent you want building it. It writes the code, brings in a reviewer, and reports back to you.",
      body: (
        <Substeps>
          <li>
            Choose <strong>New thread</strong>, pick the agent, and choose{" "}
            <strong>Worktree</strong> so the work gets its own branch.
          </li>
          <li>
            Paste the prompt from <strong>Copy for agent</strong>, and describe
            your task below it.
          </li>
        </Substeps>
      ),
      shot: {
        src: "/guides/orchestrate-coding-agents/window-start.png",
        alt: "A new bb thread with Opus 5.5, acme-web, and Worktree picked. The guide's prompt is pasted, ending with the task: add per-user rate limiting to the upload endpoint, with a test.",
      },
      options: [],
      doneWhen: "the agent is working on a new branch in its own worktree.",
    },
    {
      id: "step-2",
      title: "Get a second opinion from another agent",
      lead: "An agent on a different model reads the change with fresh eyes and catches what the first one missed. You don't copy anything between them.",
      body: (
        <p>
          Once its work is committed, your agent starts the reviewer in a thread
          of its own, on the same branch, and nests it under yours in the
          sidebar. You can ask for any agent by name, like “Have Codex review
          this” or “Ask Cursor to write the release notes.”
        </p>
      ),
      shot: NESTED_SHOT,
      options: [],
      doneWhen: "the reviewer's thread shows up under yours in the sidebar.",
    },
    {
      id: "step-3",
      title: "Watch them talk it through",
      lead: "The agents message each other the way you message them. Your agent hears back as soon as a review is done, fixes what's serious, and asks for one more pass.",
      body: (
        <Substeps>
          <li>
            In the sidebar, open the reviewer's <strong>⋯</strong> menu and
            choose <strong>Open in split</strong>.
          </li>
          <li>Type in either thread to step in yourself.</li>
        </Substeps>
      ),
      shot: SPLIT_SHOT,
      options: [
        {
          title: "Ask the reviewer a question through your agent",
          body: (
            <p>
              Ask your agent to check something with the reviewer, like “Ask the
              reviewer whether the memory growth is worth fixing before this
              merges.” It asks, waits for the answer, and tells you what it
              said.
            </p>
          ),
          shot: TALK_SHOT,
        },
      ],
      doneWhen:
        "your agent replies with what each review found, what it fixed, and what's left for you.",
    },
    {
      id: "step-4",
      title: "Keep a manager for work you repeat",
      lead: "A manager is a thread you keep for one job, like triaging new issues. Correct it once, and it does the job your way from then on.",
      body: (
        <>
          <Substeps>
            <li>
              Start a thread and name it after the job, like{" "}
              <strong>Issue triage</strong>.
            </li>
            <li>Walk it through the job once, and correct it as you go.</li>
            <li>Ask it to save the job as a skill.</li>
          </Substeps>
          <PromptBlock
            name="Ask the manager"
            prompt="Save how you triage issues as a skill called issue-triage in this repo. Run it every time I ask for triage, and update it whenever I correct you."
          />
        </>
      ),
      shot: {
        src: "/guides/orchestrate-coding-agents/window-manager.png",
        alt: "The Issue triage thread in bb. After a correction that anything broken by a deploy is P0, the agent says it saved the issue-triage skill with the correction as a rule, and will update it each time it's corrected.",
      },
      options: [
        {
          title: "Hand it work by dragging",
          body: (
            <p>
              Drag any thread onto the manager in the sidebar to nest it there,
              then ask the manager to take the next step, like opening a pull
              request and watching CI. It doesn't have to be the agent that did
              the work.
            </p>
          ),
          shot: {
            src: "/guides/orchestrate-coding-agents/window-drag.png",
            alt: "The Fix emoji filenames thread being dragged onto Issue triage in the bb sidebar, with Issue triage outlined as the drop target",
          },
        },
      ],
      doneWhen:
        "asking the manager for triage runs its skill and applies your corrections.",
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
            Open <strong>Automations</strong> to see its schedule and runs, or
            switch it off.{" "}
            <a href="/guides/run-an-agent-on-a-schedule">
              Run an agent on a schedule
            </a>{" "}
            covers testing a run and notifications.
          </p>
        </>
      ),
      shot: {
        src: "/guides/orchestrate-coding-agents/window-automation.png",
        alt: "The Weekday issue triage automation in bb: 9AM Mon-Fri in acme-web, posting to an existing thread with the prompt “Run your issue-triage skill on this morning's new issues,” and one successful run",
      },
      options: [],
      doneWhen:
        "the test run's report lands in the manager's thread, and the automation shows its next run.",
    },
    {
      id: "step-6",
      title: "Fan out a big change with a workflow",
      lead: "For a big, repetitive change, like fixing one lint rule across a whole codebase, a workflow starts a worker for each part of the job and checks the results.",
      body: (
        <>
          <Substeps>
            <li>
              Open <strong>Settings → Installed plugins</strong> and turn on{" "}
              <strong>Workflows</strong>. It's off by default.
            </li>
            <li>Ask your agent for a workflow by name.</li>
          </Substeps>
          <PromptBlock
            name="Example"
            prompt="Use a workflow to fix every no-floating-promises lint error. Start one Codex worker per top-level folder, then have a Claude Code worker check each folder's fixes. Open one PR when every check passes."
          />
          <p>
            The run shows in the thread with each worker's progress. Stop it
            from its card above the message box.
          </p>
        </>
      ),
      shot: {
        src: "/guides/orchestrate-coding-agents/window-workflows.png",
        alt: "bb's Installed plugins settings filtered to Workflows, with its switch off",
      },
      options: [],
      doneWhen:
        "your agent starts the workflow and its run shows in the thread.",
    },
  ],
  troubleshooting: [
    ...TEAM_TROUBLESHOOTING,
    {
      question: "My manager forgot a correction",
      answer: (
        <ol>
          <li>
            Long threads get compacted, and older details can drop out of the
            conversation.
          </li>
          <li>
            Ask the manager to add the correction to its skill, so it holds on
            every run.
          </li>
        </ol>
      ),
    },
    {
      question: "My manager didn't run this morning",
      answer: (
        <ol>
          <li>
            Open the automation in <strong>Automations</strong>, check that it's
            on, and read its <strong>Runs</strong>.
          </li>
          <li>
            Check that bb and the computer were awake at that time. The run
            happens once they're back.
          </li>
          <li>
            <a href="/guides/run-an-agent-on-a-schedule">
              Run an agent on a schedule
            </a>{" "}
            covers more fixes.
          </li>
        </ol>
      ),
    },
    {
      question: "My agent won't start a workflow",
      answer: (
        <ol>
          <li>
            Turn on <strong>Workflows</strong> in{" "}
            <strong>Settings → Installed plugins</strong>.
          </li>
          <li>
            Ask for a workflow by name. Agents don't start one unless you ask.
          </li>
        </ol>
      ),
    },
  ],
  faq: [
    ...TEAM_FAQ,
    {
      question: "What's the difference between a manager and a workflow?",
      answer: (
        <p>
          A manager is one thread you keep for a job and talk to over days. A
          workflow is a single run that splits one big job across many workers
          and finishes.
        </p>
      ),
    },
  ],
  closer: {
    title: "Hand off the work you repeat",
    body: "Free and open source. Bring the Claude and ChatGPT plans you already have.",
  },
};
