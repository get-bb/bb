import AiMagicIcon from "@hugeicons/core-free-icons/AiMagicIcon";
import ComputerIcon from "@hugeicons/core-free-icons/ComputerIcon";
import GitBranchIcon from "@hugeicons/core-free-icons/GitBranchIcon";

import { SpawnTimeline } from "../../compare/compare-visuals";
import { PromptBlock, Substeps } from "../guide-blocks";
import { withIntake } from "../prompt-intake";
import type { Guide } from "../guide-types";
import {
  NESTED_SHOT,
  SPLIT_SHOT,
  TALK_SHOT,
  TEAM_FAQ,
  TEAM_TROUBLESHOOTING,
} from "./agent-teams";

const AGENT_PROMPT = withIntake(
  [
    { label: "Task", hint: "what to build or fix" },
    {
      label: "Reviewer",
      hint: "a different agent from the one you paste this into, e.g. Codex",
    },
  ],
  `Build the task, have a different agent review it in its own thread, talk it through with the reviewer, and stop after two review rounds.
Guide: https://getbb.app/guides/orchestrate-coding-agents

You're in a bb thread, so the bb CLI is on your PATH. Do these steps in order and run each check. If a check fails, stop and tell me what you saw. Don't push, open a pull request, or merge unless I ask.

1. Get a branch. If you're on the repo's default branch, create a new branch first. Run \`BASE=$(git rev-parse HEAD)\` and keep the value.
   Check: \`git branch --show-current\` isn't the default branch.

2. Build the task and commit your work.
   Check: \`git status\` is clean and \`git log -1\` shows your commit.

3. Start the reviewer in its own thread, in this worktree. Use the Reviewer line; if it's blank, use Codex if you're Claude Code, and Claude Code otherwise. Get provider IDs from bb provider list.
   bb thread spawn --json --project "$BB_PROJECT_ID" --environment "$BB_ENVIRONMENT_ID" --parent-self --provider <provider-id> --title "Review: <task>" --prompt "Task: <task>. Review git diff <BASE>..HEAD read-only. Don't edit files or commit. List each issue as serious or minor, with file and line."
   Check: the spawn returns a thread ID. If the reviewer fails to start, stop and ask me to sign in to that agent on this computer.

4. Wait for the review and read it:
   bb thread wait <reviewer-thread-id>
   bb thread output <reviewer-thread-id>
   Check: the output lists issues or says there are none.

5. If the review found no serious issues, skip to step 6. Otherwise:
   - If a finding is unclear, ask: bb thread tell <reviewer-thread-id> "<your question>", then read the answer with bb thread wait and bb thread output. Questions don't count as review rounds.
   - Fix every serious issue and commit.
   - Ask for one more pass: bb thread tell <reviewer-thread-id> "I fixed the serious issues in the latest commit. Review git diff <BASE>..HEAD again, read-only."
   Check: bb thread wait and bb thread output return the second review.

6. Stop after the second review, even if issues remain. Leave the reviewer's thread open so I can read it; don't archive it.

Reply with what you built, what each review found, what you fixed, and what's left for me.`,
);

export const ORCHESTRATE_CODING_AGENTS: Guide = {
  slug: "orchestrate-coding-agents",
  title: "Orchestrate your coding agents",
  description:
    "Have one agent build and another review, keep a manager for the work you repeat, and fan out big changes to many workers. Every agent has its own thread, so you can step in anywhere or just talk to the one in charge.",
  concept: <SpawnTimeline />,
  picker: null,
  handoffNote:
    "Fill in your task at the top, or leave it and your agent asks. It builds it, brings in a second agent to review, and stops after two rounds.",
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
            Paste the prompt from <strong>Copy for agent</strong>, and fill in
            your task and reviewer at the top.
          </li>
        </Substeps>
      ),
      shot: {
        src: "/guides/orchestrate-coding-agents/window-start.png",
        alt: "A new bb thread with Opus 5.5, acme-web, and Worktree picked. The guide's prompt is pasted with the task filled in at the top: add per-user rate limiting to the upload endpoint, with a test, and Codex as the reviewer.",
      },
      options: [],
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
            <li>
              Walk it through the job once, like where new issues land and how
              you rank them, and correct it as you go.
            </li>
            <li>
              Ask it to save the job as a skill, a saved set of instructions it
              reuses.
            </li>
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
            alt: "The Fix emoji filenames thread being dragged onto Issue triage in the bb sidebar, with Issue triage outlined as the drop target. The Issue triage thread is open on its report for three new issues: one P0, one P1, and one P2, each with an owner.",
          },
        },
      ],
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
        alt: "bb's Installed plugins settings filtered to Workflows, with its switch on",
      },
      options: [],
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
