import type { ReactNode } from "react";

import { SwitchConcept } from "../concepts";
import { CopyPromptButton, Substeps } from "../guide-blocks";
import type { Guide, GuideFaq, GuideMeta } from "../guide-types";
import { AGENTS_FAQ, COST_FAQ, SLEEP_TROUBLESHOOTING } from "./faq";

export type MoveTasksTool = {
  id: string;
  slug: string;
  name: string;
  app: string;
  modelsCommand: string;
  providerFlag: string;
  tasks: string;
  description: string;
  find: string;
  pause: string;
  checkOriginals: ReactNode;
  troubleshooting: GuideFaq[];
  faq: GuideFaq[];
};

function movePrompt(tool: MoveTasksTool): string {
  return `Move my ${tool.name} ${tool.tasks} into bb automations, one automation each, then switch each one over: test it, turn it on in bb, and pause the original so nothing runs twice. Work everything out from my files. Only ask me when something is missing or a step fails twice.
Guide: https://getbb.app/guides/${tool.slug}

Move every active one. Use this computer's timezone for every schedule: the part of \`readlink /etc/localtime\` after zoneinfo/.

${tool.find}
2. Match each one to a bb project. Run \`bb project list --include-personal --json\` and pick the project whose source path matches its folder. If none does, add the folder with \`bb project create --name <folder name> --root <folder>\`.
   Check: every one has a project ID.
3. Turn each schedule into a five-field cron in my timezone. If there's no exact cron, like every other week, use the closest one and note it.
   Check each model against \`${tool.modelsCommand}\`. If it isn't listed, use the one marked isDefault and note it.
4. Create each automation paused. Read \`bb automation create --help\` first.
   bb automation create --project <project-id> --name "<name>" --disabled --cron "<cron>" --timezone <timezone> ${tool.providerFlag} --model <model> --permission-mode auto <where> --prompt "<the prompt, word for word>"
   For <where>: if it ran in a worktree, use --new-environment worktree. If it ran in its folder, use --environment <that folder>, the project source path from \`bb project list\`.
   If a prompt relies on something only ${tool.name} had, like a connector or an event trigger, note what it needs.
   Check: \`bb automation list --project <project-id>\` shows each new automation, paused.
5. Test every automation, even if an earlier test fails. Run \`bb automation run <id> --project <project-id>\`, then read its run with \`bb automation runs <id> --project <project-id>\` and the thread it started.
   Check: the run finished and did what its prompt asks. If it failed because the model isn't supported on my account, switch it to the isDefault model with \`bb automation update <id> --project <project-id> --model <model>\` and test it again. If it still fails, leave it paused in bb, leave the original running, note why, and go on to the next one.
6. Switch over each one whose test passed.
   Turn it on: \`bb automation resume <id> --project <project-id>\`.
${tool.pause}
   Check: a minute later, read the original again. If it's active again, note that I need to pause it in ${tool.app}.

Reply with a table: name, its old schedule, its bb schedule, project, test result, and whether it's switched over. Then list anything I still need to do.`;
}

export function moveTasksGuide(meta: GuideMeta, tool: MoveTasksTool): Guide {
  return {
    ...meta,
    description: tool.description,
    heroTop: <SwitchConcept tool={tool.id} />,
    concept: null,
    agentPrompt: movePrompt(tool),
    requirement: null,
    steps: [
      {
        id: "step-1",
        title: "Paste the prompt",
        lead: `Your agent finds your ${tool.tasks}, moves each one, tests it, and switches it over.`,
        body: (
          <Substeps>
            <li>
              Choose <strong>New thread</strong> and pick any project.
            </li>
            <li>
              Paste the prompt from <CopyPromptButton /> and send it.
            </li>
          </Substeps>
        ),
        shot: {
          src: `/guides/${tool.slug}/window-compose.webp`,
          alt: `A new bb thread in acme-web with the prompt for moving ${tool.name} ${tool.tasks} pasted into the message box`,
          width: 2048,
          height: 1280,
        },
        options: [],
      },
      {
        id: "step-2",
        title: "Check the switch-over",
        lead: `Each one that passed its test is on in bb and paused in ${tool.name}.`,
        body: (
          <Substeps>
            <li>
              Choose <strong>Automations</strong> in the sidebar.
            </li>
            <li>
              Open one to read its test run under <strong>Runs</strong>.
            </li>
            {tool.checkOriginals}
          </Substeps>
        ),
        shot: {
          src: `/guides/${tool.slug}/window-detail-on.webp`,
          alt: `A Daily dependency check automation in bb running ${tool.name}, switched on, with its schedule, prompt, model, and a finished test run under Runs`,
          width: 2048,
          height: 1280,
        },
        options: [],
      },
    ],
    troubleshooting: [
      ...tool.troubleshooting,
      {
        question: "A test run failed",
        answer: (
          <>
            <p>
              The automation stays paused in bb and the original keeps running.
            </p>
            <ol>
              <li>
                Open the automation, then the run under <strong>Runs</strong>,
                and read where it stopped.
              </li>
              <li>
                If the prompt relied on a connector, add that service to the
                agent on your computer and choose <strong>Run now</strong>.
              </li>
              <li>
                Once it passes, ask your agent to switch it over.
              </li>
            </ol>
          </>
        ),
      },
      SLEEP_TROUBLESHOOTING,
    ],
    faq: [
      {
        question: "What comes over?",
        answer: (
          <p>
            The prompt, word for word, the schedule, the project, the model, and
            where it runs. If your account can't use that model in bb, your
            agent uses bb's default for that agent and tells you. Past runs stay
            in {tool.name}.
          </p>
        ),
      },
      {
        question: `What does my agent change in ${tool.name}?`,
        answer: (
          <p>
            Only one thing: it pauses each original after its bb automation
            passes a test, so nothing runs twice. It backs up the file first
            and leaves the prompt and schedule alone, so you can switch an
            original back on in {tool.app}.
          </p>
        ),
      },
      ...tool.faq,
      AGENTS_FAQ,
      COST_FAQ,
    ],
    closer: {
      title: "Keep your scheduled work in one place",
      body: "Free and open source. Every automation, from any agent, in one list.",
    },
  };
}

const SCHEDULE_GUIDE = "/guides/run-an-agent-on-a-schedule";

const CLAUDE_TASKS_FILE =
  "~/Library/Application Support/Claude/claude-code-sessions/*/*/scheduled-tasks.json";
const CODEX_DB = "~/.codex/sqlite/codex-dev.db";
const CODEX_DB_SHELL = "$HOME/.codex/sqlite/codex-dev.db";

export const MOVE_TASKS_TOOLS = {
  claude: {
    id: "claude",
    slug: "move-claude-code-routines",
    name: "Claude Code",
    app: "the Claude Code desktop app",
    modelsCommand: "bb provider models claude-code --json",
    providerFlag: "--provider claude-code",
    tasks: "routines",
    description:
      "Turn your Claude Code routines into bb automations. bb recreates each one and tests them before you switch over.",
    find: `1. Find my routines.
   - Local routines: read ${CLAUDE_TASKS_FILE}. Each entry in scheduledTasks has its schedule (cronExpression), enabled, model, folder (cwd, or the first of userSelectedFolders), useWorktree, and filePath: the SKILL.md under ~/.claude/scheduled-tasks/ whose body is the prompt. Skip entries with enabled false, and one-time ones with fireAt instead of cronExpression.
   - Cloud routines live on my claude.ai account. List them with Claude Code's /schedule list, using my claude.ai login: \`claude -p "/schedule list"\`. Get each one's prompt, schedule, repository, and model. Each cloud run gets a fresh clone, so use a worktree for these. If you can't reach them, skip them and say so.
   - Skip /loop tasks. They end with their session.
   Check: list each routine's name, local or cloud, schedule in plain words, folder or repository, worktree or not, and model.`,
    pause: `   Pause the original. For a local routine, copy its scheduled-tasks.json to scheduled-tasks.before-bb.json once, then set only that entry's "enabled" to false with a JSON-aware edit, and read the file back. For a cloud routine, turn it off with /schedule update in \`claude -p\`.`,
    checkOriginals: (
      <li>
        In the Claude Code desktop app, open <strong>Routines</strong>. Each
        original that moved shows <strong>Paused</strong>.
      </li>
    ),
    troubleshooting: [
      {
        question: "My agent couldn't reach my cloud routines",
        answer: (
          <p>
            Cloud routines live on your claude.ai account, and your agent reads
            them with Claude Code's <code>/schedule</code> command. Sign in to
            Claude Code with your claude.ai account, then ask your agent to try
            again. Or run <code>/schedule list</code> yourself and paste each
            one into the thread.
          </p>
        ),
      },
      {
        question: "An original is still running",
        answer: (
          <p>
            The Claude Code desktop app can put a routine back if it was open
            while your agent paused it. Open it on <strong>Routines</strong>{" "}
            and set it to <strong>Paused</strong>. For a cloud routine, turn off
            the switch on its page at claude.ai/code/routines.
          </p>
        ),
      },
    ],
    faq: [
      {
        question: "Do they run when my computer is off?",
        answer: (
          <p>
            Cloud routines run on Anthropic's servers. bb automations run on
            your computers, so the one that runs them has to be on and awake.
            Local routines already worked that way.
          </p>
        ),
      },
      {
        question: "What about routines with a GitHub or API trigger?",
        answer: (
          <p>
            bb automations run on a schedule. To react to new pull requests,
            have your agent set up a{" "}
            <a href={SCHEDULE_GUIDE}>script automation</a> that checks every few
            minutes and starts Claude Code only when there's one.
          </p>
        ),
      },
      {
        question: "Where do the changes go?",
        answer: (
          <p>
            A local routine runs where it did before: in its folder, or in its
            own worktree if you turned that on. A cloud routine gets a worktree
            on a new branch, the way it pushed to <code>claude/</code> branches.
            Nothing is pushed unless the prompt says to.
          </p>
        ),
      },
      {
        question: "What about connectors?",
        answer: (
          <p>
            Cloud routines use the connectors on your claude.ai account. In bb,
            Claude Code uses the MCP servers set up on your computer, so add any
            a routine needs.
          </p>
        ),
      },
      {
        question: "What about /loop tasks?",
        answer: (
          <p>
            They end with their session, so there's nothing to move. To keep one
            running, ask your agent in bb to make it an automation.
          </p>
        ),
      },
    ],
  },
  "codex-app": {
    id: "codex-app",
    slug: "move-codex-scheduled-tasks",
    name: "Codex",
    app: "the ChatGPT desktop app",
    modelsCommand: "bb provider models codex --json",
    providerFlag: "--provider codex",
    tasks: "scheduled tasks",
    description:
      "Turn your Codex scheduled tasks into bb automations. bb recreates each one and tests them before you switch over.",
    find: `1. Find my scheduled tasks. The ChatGPT desktop app keeps them in ${CODEX_DB}. Read it without changing it:
   sqlite3 -readonly -json "${CODEX_DB_SHELL}" "SELECT id, name, prompt, rrule, cwds, model, execution_environment, target_thread_id FROM automations WHERE status = 'ACTIVE'"
   rrule is the schedule, cwds the project folders, and execution_environment is worktree or local. If that table doesn't exist, read each ~/.codex/automations/<id>/automation.toml instead; it has the same fields.
   A task with a target_thread_id runs inside a Codex chat. bb can't continue that chat, so move it as a regular automation and note it.
   Check: list each task's name, schedule in plain words, project folder, local or worktree, and model.`,
    pause: `   Pause the original: back up the database once with \`sqlite3 "${CODEX_DB_SHELL}" ".backup ${CODEX_DB_SHELL.replace(".db", ".before-bb.db")}"\`, then run \`sqlite3 "${CODEX_DB_SHELL}" "UPDATE automations SET status = 'PAUSED' WHERE id = '<task id>'"\`, and read its status back.`,
    checkOriginals: (
      <li>
        In the ChatGPT desktop app, open <strong>Scheduled</strong>. Each
        original that moved is paused.
      </li>
    ),
    troubleshooting: [
      {
        question: "My agent didn't find my scheduled tasks",
        answer: (
          <p>
            It reads them on the computer where you use the ChatGPT desktop app.
            Run the prompt in a bb thread on that computer. Or ask Codex in a
            chat to list your scheduled tasks with each one's prompt, schedule,
            project, and model, and paste the list into the bb thread.
          </p>
        ),
      },
      {
        question: "An original is still running",
        answer: (
          <p>
            In the ChatGPT desktop app, open <strong>Scheduled</strong> and
            pause it, or ask Codex in a chat to pause it.
          </p>
        ),
      },
    ],
    faq: [
      {
        question: "Does bb need the ChatGPT desktop app open?",
        answer: (
          <p>
            No. bb runs its automations itself, on your computer. Like Codex's
            scheduled tasks that use local projects, the computer has to be on
            and awake.
          </p>
        ),
      },
      {
        question: "Local project or worktree?",
        answer: (
          <p>
            Each one runs where it did in Codex: in your local project, or in
            its own worktree if you chose that. A worktree run never touches
            files you're working on.
          </p>
        ),
      },
      {
        question: "What about scheduled tasks inside a chat?",
        answer: (
          <p>
            bb can't continue a ChatGPT chat, so your agent moves each one as a
            regular automation. To keep context between runs, ask your agent to
            point it at one bb thread instead.
          </p>
        ),
      },
      {
        question: "What about tasks triggered by Gmail, Slack, or GitHub?",
        answer: (
          <p>
            bb automations run on a schedule. Have your agent set up a{" "}
            <a href={SCHEDULE_GUIDE}>script automation</a> that checks every few
            minutes and starts Codex only when there's something new.
          </p>
        ),
      },
    ],
  },
} satisfies Record<string, MoveTasksTool>;
