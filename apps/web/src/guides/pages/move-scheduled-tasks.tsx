import { ScheduleConcept } from "../concepts";
import { CopyPromptButton, Substeps } from "../guide-blocks";
import { withIntake } from "../prompt-intake";
import type { Guide } from "../guide-types";
import { AGENTS_FAQ, COST_FAQ, SLEEP_TROUBLESHOOTING } from "../shared/faq";
import { meta } from "./move-scheduled-tasks.meta";

const AGENT_PROMPT = withIntake(
  [
    { label: "Tasks", hint: "all of them, or the names to move" },
    {
      label: "Timezone",
      hint: "the IANA zone your schedules use, e.g. America/Los_Angeles",
    },
  ],
  `Move my scheduled tasks from Claude Code and Codex into bb automations, one automation per task, and test each one.
Guide: https://getbb.app/guides/move-scheduled-tasks

Only read the old tasks. Don't edit, pause, or delete them. Create every bb automation paused, and turn one on only when I say so. If a step fails, stop and tell me the command, the error, and what you'd try next.

1. Find the Codex app's tasks. Each is a folder in ~/.codex/automations/ with an automation.toml that holds its prompt, schedule (an RRULE), folder (cwds), model, and status. Skip paused ones unless I named them. If the folder is empty or missing, ask me to open Scheduled in the Codex app and paste each task's prompt, schedule, and folder.
   Check: list each task's name, schedule in plain words, folder, and model.
2. Find Claude Code's tasks.
   - Desktop tasks: each is ~/.claude/scheduled-tasks/<name>/SKILL.md, with the prompt as the body. The schedule and folder aren't in the file, so ask me for them from Routines in the Claude Code desktop app.
   - Cloud routines live on claude.ai, not on this computer. Ask me to run /schedule list in Claude Code, or open claude.ai/code/routines, and paste each routine's prompt, schedule, and repositories.
   - Skip /loop tasks. They end with their session.
   Check: the same list for these tasks.
3. Match each task to a bb project. Run \`bb project list --include-personal --json\` and pick the project whose folder or repository matches. If none does, ask me whether to add it.
   Check: every task has a project ID.
4. Turn each schedule into a five-field cron in my Timezone. If a schedule has no exact cron, like every other week, pick the closest one and tell me.
   Check each task's model against \`bb provider models <claude-code or codex> --json\`. If it isn't listed, ask me which model to use, and suggest the one marked isDefault: it's the model bb already runs for that agent.
5. Create each automation paused. Read \`bb automation create --help\` first.
   bb automation create --project <project-id> --name "<task name>" --disabled --cron "<cron>" --timezone <Timezone> --provider <claude-code for Claude Code tasks, codex for Codex tasks> --model <the task's model, or the one I picked> --permission-mode auto --new-environment worktree --prompt "<the task's prompt, word for word>"
   If a prompt relies on something only the old app had, like a claude.ai connector or a GitHub trigger, tell me what it needs instead of guessing.
   Check: \`bb automation list --project <project-id>\` shows each new automation, paused.
6. Test every automation, even if an earlier test fails. Run \`bb automation run <id> --project <project-id>\`, then read its run with \`bb automation runs <id> --project <project-id>\` and the thread it started.
   Check: the run finished and did what its prompt asks. If it failed because the model isn't supported on my account, switch it to the isDefault model with \`bb automation update <id> --project <project-id> --model <model>\`, tell me, and test it again. If it failed for another reason, leave it paused, note why, and go on to the next one.

Reply with a table of each task: where it came from, its bb schedule, project, and test result. Then tell me to switch each one on in Automations and to pause the original in Codex or Claude Code, so nothing runs twice.`,
);

export const guide: Guide = {
  ...meta,
  description:
    "Bring your Codex scheduled tasks and Claude Code routines into bb automations. Your agent finds them, recreates each one paused, and tests it before you switch over.",
  heroTop: null,
  concept: <ScheduleConcept />,
  agentPrompt: AGENT_PROMPT,
  requirement: null,
  steps: [
    {
      id: "step-1",
      title: "Paste the prompt",
      lead: "Your agent finds the tasks Codex and Claude Code keep on this computer and asks for the rest.",
      body: (
        <Substeps>
          <li>
            Choose <strong>New thread</strong> and pick the project your tasks
            work on.
          </li>
          <li>
            Paste the prompt from <CopyPromptButton /> and send it.
          </li>
          <li>
            When it asks for Claude Code's cloud routines, run{" "}
            <code>/schedule list</code> in Claude Code, or open
            claude.ai/code/routines, and paste each routine's prompt and
            schedule.
          </li>
        </Substeps>
      ),
      shot: {
        src: "/guides/move-scheduled-tasks/window-compose.webp",
        alt: "A new bb thread in acme-web with Claude Code selected and the Move your scheduled tasks prompt pasted into the message box",
        width: 2048,
        height: 1280,
      },
      options: [],
    },
    {
      id: "step-2",
      title: "Check the new automations",
      lead: "Each task becomes a paused automation with the same prompt, schedule, agent, and model.",
      body: (
        <Substeps>
          <li>
            Choose <strong>Automations</strong> in the sidebar.
          </li>
          <li>
            Check each one's project and schedule. To change a prompt, open it
            and choose <strong>Edit prompt</strong>.
          </li>
        </Substeps>
      ),
      shot: {
        src: "/guides/run-an-agent-on-a-schedule/window-list.webp",
        alt: "The Automations page in bb, listing five automations with their project, schedule, next run, and an on/off switch",
        width: 2048,
        height: 1280,
      },
      options: [],
    },
    {
      id: "step-3",
      title: "Switch over",
      lead: "Turn each one on in bb, then pause the original so it doesn't run twice.",
      body: (
        <Substeps>
          <li>
            Open an automation, read its test run under <strong>Runs</strong>,
            and switch it on.
          </li>
          <li>
            In the Codex app, open <strong>Scheduled</strong> and pause the
            original task.
          </li>
          <li>
            In Claude Code, open <strong>Routines</strong> and pause it. Cloud
            routines have an on/off switch on their page at
            claude.ai/code/routines.
          </li>
        </Substeps>
      ),
      shot: {
        src: "/guides/run-an-agent-on-a-schedule/window-detail-paused.webp",
        alt: "The Morning issue triage automation in bb, paused, with its schedule, prompt, model, and a Run now button under Runs",
        width: 2048,
        height: 1280,
      },
      options: [],
    },
  ],
  troubleshooting: [
    {
      question: "My agent didn't find my Codex tasks",
      answer: (
        <ol>
          <li>
            The Codex app keeps them on the computer it runs on, in{" "}
            <code>~/.codex/automations</code>. Start the bb thread on that
            computer.
          </li>
          <li>
            Or open <strong>Scheduled</strong> in the Codex app and paste each
            task's prompt, schedule, and folder into the thread.
          </li>
        </ol>
      ),
    },
    {
      question: "A Claude Code desktop task came over without its schedule",
      answer: (
        <p>
          Claude Code keeps only the prompt in the task's file. Open{" "}
          <strong>Routines</strong> in the Claude Code desktop app, read the
          task's schedule and folder, and tell your agent.
        </p>
      ),
    },
    {
      question: "A test run failed",
      answer: (
        <ol>
          <li>
            Open the automation, then the run under <strong>Runs</strong>, and
            read where it stopped.
          </li>
          <li>
            If the model isn't available to your account, open the automation,
            pick another model, and choose <strong>Run now</strong> again.
          </li>
          <li>
            If the prompt relied on a claude.ai connector, add that service to
            the agent on your computer, then choose <strong>Run now</strong>{" "}
            again.
          </li>
          <li>
            To change what it does, choose <strong>Edit prompt</strong>.
          </li>
        </ol>
      ),
    },
    SLEEP_TROUBLESHOOTING,
  ],
  faq: [
    {
      question: "What comes over?",
      answer: (
        <p>
          Each task's prompt, word for word, its schedule, the project it works
          on, and the agent and model it ran on. If your account can't use that
          model in bb, your agent asks which one to use. Run history stays in
          Codex or Claude Code.
        </p>
      ),
    },
    {
      question: "Do my tasks still run when my computer is off?",
      answer: (
        <p>
          bb automations run on your computers, so the one that runs them has to
          be on. Claude Code's cloud routines ran on Anthropic's servers
          instead. For automations that run all night, keep a computer awake or
          run bb on one that stays on.
        </p>
      ),
    },
    {
      question: "What about routines triggered by GitHub or an API call?",
      answer: (
        <p>
          bb automations run on a schedule. To react to new pull requests, have
          your agent set up a{" "}
          <a href="/guides/run-an-agent-on-a-schedule">script automation</a>{" "}
          that checks every few minutes and starts an agent only when there's
          one.
        </p>
      ),
    },
    {
      question: "What about /loop tasks?",
      answer: (
        <p>
          They end with their Claude Code session, so there's nothing to move.
          To keep one running, ask your agent in bb to make it an automation.
        </p>
      ),
    },
    {
      question: "Which agent runs each task?",
      answer: (
        <p>
          The one it ran on before: Codex tasks run on Codex, and Claude Code
          tasks on Claude Code, with your same sign-ins.
        </p>
      ),
    },
    AGENTS_FAQ,
    COST_FAQ,
  ],
  closer: {
    title: "Keep your scheduled work in one place",
    body: "Free and open source. Every automation, from any agent, in one list.",
  },
};
