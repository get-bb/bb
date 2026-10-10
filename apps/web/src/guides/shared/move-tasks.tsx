import type { ReactNode } from "react";

import { SwitchConcept } from "../concepts";
import { CopyPromptButton, Substeps } from "../guide-blocks";
import { withIntake } from "../prompt-intake";
import type { Guide, GuideFaq, GuideMeta } from "../guide-types";
import { AGENTS_FAQ, COST_FAQ, SLEEP_TROUBLESHOOTING } from "./faq";

export type MoveTasksTool = {
  id: string;
  slug: string;
  name: string;
  provider: string;
  tasks: string;
  description: string;
  find: string;
  findSteps: ReactNode;
  pauseSteps: ReactNode;
  troubleshooting: GuideFaq[];
  faq: GuideFaq[];
};

const MODEL_STEP = `Check each task's model against \`bb provider models <provider> --json\`. If it isn't listed, ask me which model to use, and suggest the one marked isDefault: it's the model bb already runs for that agent.`;

function movePrompt(tool: MoveTasksTool): string {
  return withIntake(
    [
      { label: "Tasks", hint: `all of my ${tool.tasks}, or the names to move` },
      {
        label: "Timezone",
        hint: "the IANA zone the schedules use, e.g. America/Los_Angeles",
      },
    ],
    `Move my ${tool.name} ${tool.tasks} into bb automations, one automation each, and test each one.
Guide: https://getbb.app/guides/${tool.slug}

Only read the old ${tool.tasks}. Don't edit, pause, or delete them. Create every bb automation paused, and turn one on only when I say so. If a step fails, stop and tell me the command, the error, and what you'd try next.

${tool.find}
2. Match each one to a bb project. Run \`bb project list --include-personal --json\` and pick the project whose folder or repository matches. If none does, ask me whether to add it.
   Check: every one has a project ID.
3. Turn each schedule into a five-field cron in my Timezone. If a schedule has no exact cron, like every other week, pick the closest one and tell me.
   ${MODEL_STEP.replace("<provider>", tool.provider)}
4. Create each automation paused. Read \`bb automation create --help\` first.
   bb automation create --project <project-id> --name "<name>" --disabled --cron "<cron>" --timezone <Timezone> --provider ${tool.provider} --model <the model, or the one I picked> --permission-mode auto --new-environment worktree --prompt "<the prompt, word for word>"
   If a prompt relies on something only ${tool.name} had, like a connector or an event trigger, tell me what it needs instead of guessing.
   Check: \`bb automation list --project <project-id>\` shows each new automation, paused.
5. Test every automation, even if an earlier test fails. Run \`bb automation run <id> --project <project-id>\`, then read its run with \`bb automation runs <id> --project <project-id>\` and the thread it started.
   Check: the run finished and did what its prompt asks. If it failed because the model isn't supported on my account, switch it to the isDefault model with \`bb automation update <id> --project <project-id> --model <model>\`, tell me, and test it again. If it failed for another reason, leave it paused, note why, and go on to the next one.

Reply with a table: name, its old schedule, its bb schedule, project, and test result. Then tell me to switch each one on in Automations and to pause the original in ${tool.name}, so nothing runs twice.`,
  );
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
        lead: `Your agent finds your ${tool.tasks} and asks for anything it can't read.`,
        body: (
          <Substeps>
            <li>
              Choose <strong>New thread</strong> and pick the project they work
              on.
            </li>
            <li>
              Paste the prompt from <CopyPromptButton /> and send it.
            </li>
            {tool.findSteps}
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
        title: "Check the new automations",
        lead: "Each one becomes a paused automation with the same prompt, schedule, and model.",
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
        lead: `Turn each one on in bb, then pause the original in ${tool.name} so it doesn't run twice.`,
        body: (
          <Substeps>
            <li>
              Open an automation, read its test run under <strong>Runs</strong>,
              and switch it on.
            </li>
            {tool.pauseSteps}
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
      ...tool.troubleshooting,
      {
        question: "A test run failed",
        answer: (
          <ol>
            <li>
              Open the automation, then the run under <strong>Runs</strong>, and
              read where it stopped.
            </li>
            <li>
              If the model isn't available to your account, pick another model
              and choose <strong>Run now</strong> again.
            </li>
            <li>
              If the prompt relied on a connector, add that service to the agent
              on your computer and run it again.
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
            The prompt, word for word, the schedule, the project, and the model.
            If your account can't use that model in bb, your agent asks which
            one to use. Past runs stay in {tool.name}.
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

export const MOVE_TASKS_TOOLS = {
  claude: {
    id: "claude",
    slug: "move-claude-code-routines",
    name: "Claude Code",
    provider: "claude-code",
    tasks: "routines",
    description:
      "Bring your Claude Code routines into bb automations, local and cloud. Your agent recreates each one paused with the same prompt and schedule, and tests it before you switch over.",
    find: `1. Find my routines.
   - Local routines are Desktop scheduled tasks. Each is ~/.claude/scheduled-tasks/<name>/SKILL.md, with the prompt as the body. Its schedule, folder, and model aren't in the file, so ask me for them: I can read them on Routines in the Claude Code desktop app.
   - Cloud routines live on my claude.ai account, not this computer. Ask me to run /schedule list in Claude Code, or open claude.ai/code/routines, and paste each routine's prompt, schedule, repositories, and model.
   - Skip /loop tasks. They end with their session.
   Check: list each routine's name, local or cloud, schedule in plain words, folder or repository, and model.`,
    findSteps: (
      <>
        <li>
          For local routines, it asks for each one's schedule and folder. Find
          them on <strong>Routines</strong> in the Claude Code desktop app.
        </li>
        <li>
          For cloud routines, run <code>/schedule list</code> in Claude Code, or
          open claude.ai/code/routines, and paste each routine's prompt and
          schedule.
        </li>
      </>
    ),
    pauseSteps: (
      <>
        <li>
          For a local routine, open it on <strong>Routines</strong> in the
          Claude Code desktop app and set it to <strong>Paused</strong>.
        </li>
        <li>
          For a cloud routine, turn off the switch at the top of its page at
          claude.ai/code/routines.
        </li>
      </>
    ),
    troubleshooting: [
      {
        question: "A local routine came over without its schedule",
        answer: (
          <p>
            Claude Code keeps only a local routine's prompt in its{" "}
            <code>SKILL.md</code> file. Open <strong>Routines</strong> in the
            Claude Code desktop app, read its schedule and folder, and tell your
            agent.
          </p>
        ),
      },
      {
        question: "My agent can't see my cloud routines",
        answer: (
          <p>
            Cloud routines live on your claude.ai account, so your agent can't
            read them from your computer. Run <code>/schedule list</code> in
            Claude Code, or open claude.ai/code/routines, and paste each one
            into the thread.
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
            Each run gets its own worktree on a new branch, the way cloud
            routines push to <code>claude/</code> branches. Nothing is pushed
            unless the prompt says to.
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
    provider: "codex",
    tasks: "scheduled tasks",
    description:
      "Bring your Codex scheduled tasks into bb automations. Your agent recreates each one paused with the same prompt and schedule, and tests it before you switch over.",
    find: `1. Find my scheduled tasks. If ~/.codex/automations/ has task folders, read each automation.toml: its prompt, schedule (an RRULE), project folders (cwds), model, and status. Skip paused ones unless I named them. Otherwise, ask me to ask Codex in a chat in the ChatGPT desktop app to list my scheduled tasks with each one's prompt, schedule, project, model, and whether it runs in the local project or a worktree, and paste the list here.
   A scheduled task inside a chat returns to that chat's context each run. For each of those, ask whether to have bb re-prompt one thread instead: use --target-thread <thread-id> in step 4, without --new-environment.
   Check: list each task's name, schedule in plain words, project, and model.`,
    findSteps: (
      <li>
        If it asks for your scheduled tasks, ask Codex in a chat in the ChatGPT
        desktop app to list them with each one's prompt, schedule, project, and
        model, and paste the list into the bb thread.
      </li>
    ),
    pauseSteps: (
      <li>
        In the ChatGPT desktop app, open <strong>Scheduled</strong> and pause
        the original, or ask Codex in a chat to pause it.
      </li>
    ),
    troubleshooting: [
      {
        question: "My agent didn't find my scheduled tasks",
        answer: (
          <p>
            Ask Codex in a chat in the ChatGPT desktop app to list your
            scheduled tasks with each one's prompt, schedule, project, and
            model, then paste the list into the bb thread.
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
            Each run gets its own worktree by default, like Codex's worktree
            option, so it never touches files you're working on. To run in your
            checkout instead, ask your agent when it sets the automation up.
          </p>
        ),
      },
      {
        question: "What about scheduled tasks inside a chat?",
        answer: (
          <p>
            A bb automation can re-prompt the same thread each run, so it keeps
            that thread's context. Your agent asks which tasks should work that
            way.
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
