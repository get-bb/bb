import AiMagicIcon from "@hugeicons/core-free-icons/AiMagicIcon";
import ComputerIcon from "@hugeicons/core-free-icons/ComputerIcon";
import GitBranchIcon from "@hugeicons/core-free-icons/GitBranchIcon";

import { ScheduleConcept } from "../concepts";
import { Substeps } from "../guide-blocks";
import { withIntake } from "../prompt-intake";
import type { Guide } from "../guide-types";

const AGENT_PROMPT = withIntake(
  [
    { label: "Job", hint: "what the agent or script should do" },
    { label: "When", hint: "e.g. weekdays at 9am, with your timezone" },
    {
      label: "Results",
      hint: "one thread for reports, or a new worktree each run for code changes",
    },
    {
      label: "Agent or script",
      hint: "an agent with a prompt, or a script that only wakes an agent when there is work",
    },
  ],
  `Set up a bb automation for this project and verify a real run.
Guide: https://getbb.app/guides/run-an-agent-on-a-schedule

Do every step yourself, with a Check after each step. If a check fails, stop and report the command, error, and next action. Suggest morning issue triage on weekdays at 9am, with all results in a dedicated thread. Don't guess my timezone or create extra example jobs.

1. Read bb guide automations and bb automation create --help. Run bb plugin list; install Automations with bb plugin install automations if absent, or bb plugin enable automations if disabled. Read bb status --json, bb machine list, and bb provider models <provider> --json. Resolve this project's real ID and a signed-in provider/model. Confirm the bb server and execution machine will stay awake at the scheduled time.
   Check: Automations is enabled, the execution machine is connected, and the chosen model is listed.

2. Prepare the destination. For reports, use the thread I named or create a dedicated thread with bb thread spawn --project <project-id> --environment <environment-id> --provider <provider> --model <model> --permission-mode auto --title <job-name> --prompt "This thread will receive scheduled reports. Reply ready." For code changes, use --new-environment worktree on the automation instead of --target-thread. Read repository instructions and define the exact job, required credentials, output, and allowed changes. For triage, read issues without posting or changing labels, and include dated findings and issue links.
   Check: the destination thread is idle and runnable, or the project supports worktrees; required commands and credentials work on the execution machine.

3. Run bb automation list --project <project-id> and reuse a matching automation instead of making a duplicate. Create the job paused with bb automation create --project <project-id> --name <job-name> --disabled, exactly one of --cron <expression> --timezone <IANA-zone>, --at <future-ISO-time-with-offset>, or --in <duration>, and --prompt <job> --provider <provider> --model <model> --permission-mode auto. Add --target-thread <thread-id> for the report thread, or --new-environment worktree for separate code runs. For a deterministic script job, use --script-file <path> and --working-directory <server-path> instead of agent flags; scripts run on the bb server.
   Check: bb automation show <automation-id> --project <project-id> matches the requested job, schedule, timezone, and destination.

4. Run bb automation run <automation-id> --project <project-id> once. Inspect bb automation runs <automation-id> --project <project-id> and the actual thread output; for scripts, read runs --output <run-id>. Wait for completion using the available thread commands. Don't mistake a queued run for a finished job. For a recurring job, resume it with bb automation resume <automation-id> --project <project-id>. For a one-off, explain that the manual test performed the job and ask whether the future run is still wanted before resuming it.
   Check: the real output satisfies the job, and show reports the intended enabled state and next run time. If the test fails, leave it paused and diagnose the run error.

5. If I want notifications, install or enable Push notifications, inspect bb push-notifications status, and enable the requested channel with bb plugin config push-notifications set <webEnabled|desktopEnabled|mobileEnabled> true. Run bb push-notifications test web or desktop for that client. If browser permission or mobile pairing needs my interaction, stop and give me the exact Settings step.
   Check: I confirm the test arrived on my chosen device; a successful broadcast alone doesn't prove delivery.

Reply with the automation ID, schedule and timezone, next run, result thread, and verified output. Include the run, pause, and resume commands. Don't promise an alert for every missed or disabled automation.`,
);

export const RUN_AN_AGENT_ON_A_SCHEDULE: Guide = {
  slug: "run-an-agent-on-a-schedule",
  title: "Run an agent on a schedule",
  description:
    "Wake up to triaged issues, test results, or a dependency update. Run an agent once or on repeat, or have a script check first and wake it only when there's work.",
  concept: <ScheduleConcept />,
  picker: null,
  handoffNote:
    "Fill in the job at the top, or leave it and your agent asks. It sets up the automation, runs it once, and checks the result.",
  agentPrompt: AGENT_PROMPT,
  needs: [
    {
      title: "bb on a computer that stays on",
      icon: ComputerIcon,
      body: "Automations run while bb is running and the computer is awake.",
    },
    {
      title: "An agent you're signed in to",
      icon: AiMagicIcon,
      body: "Claude Code, Codex, or another agent. Scripts don't need one.",
    },
    {
      title: "A project",
      icon: GitBranchIcon,
      body: "The repo the job reads or changes, added to bb.",
    },
  ],
  steps: [
    {
      id: "step-1",
      title: "Open Automations",
      lead: "Every scheduled job lives in one list, with its next run and an on/off switch.",
      body: (
        <Substeps>
          <li>
            Choose <strong>Automations</strong> in the sidebar.
          </li>
          <li>
            Choose <strong>New automation</strong>, or start from a template in{" "}
            <strong>Browse</strong>.
          </li>
        </Substeps>
      ),
      shot: {
        src: "/guides/run-an-agent-on-a-schedule/window-list.png",
        alt: "The Automations page in bb, listing five automations with their project, schedule, next run, and an on/off switch",
      },
      options: [],
    },
    {
      id: "step-2",
      title: "Describe the job",
      lead: "Finish the sentence: what to do, when, and where the results go. Your agent sets it up.",
      body: (
        <p>
          Reports land in one thread, so you can follow what changed. For jobs
          that change code, like a nightly test sweep, ask for a new worktree on
          every run instead.
        </p>
      ),
      shot: {
        src: "/guides/run-an-agent-on-a-schedule/window-compose.png",
        alt: "The bb message box with: Create a new bb automation to read new and updated GitHub issues every weekday at 9am Pacific. Group bugs and requests, flag regressions, and post a dated summary to one thread. Create it paused so I can test it.",
      },
      options: [
        {
          title:
            "Check with a script first, and wake an agent only when there's work",
          body: (
            <p>
              Ask for a script instead, like “every 15 minutes, check main for a
              failed CI run, and if there is one, start a Codex thread to fix
              it.” Scripts run without a model, so frequent checks use none of
              your plan. Quiet runs show as skipped.
            </p>
          ),
          shot: {
            src: "/guides/run-an-agent-on-a-schedule/window-script.png",
            alt: "A CI failure check automation in bb that runs a script every 15 minutes. One run found a failed CI run and started a Codex thread; two runs found nothing and were skipped.",
          },
        },
        {
          title: "Run it once, later",
          body: (
            <p>
              Ask for a single run, like “tomorrow at 9am, draft release notes
              from this week's pull requests.” It shows as One time in
              Automations. Just want to send a message later? Use{" "}
              <strong>+ → Send later…</strong> in the message box.
            </p>
          ),
          shot: {
            src: "/guides/run-an-agent-on-a-schedule/window-once.png",
            alt: "A one-time automation in bb, Draft release notes, scheduled for tomorrow at 9:00 AM, with its prompt and a Run now button",
          },
        },
      ],
    },
    {
      id: "step-3",
      title: "Run it now, then turn it on",
      lead: "You don't have to wait until morning to find out whether it works.",
      body: (
        <Substeps>
          <li>
            Open the automation and choose <strong>Run now</strong>.
          </li>
          <li>
            Under <strong>Runs</strong>, open the run and read the report.
          </li>
          <li>
            Once it's right, switch the automation on. To change what it does,
            choose <strong>Edit prompt</strong>.
          </li>
        </Substeps>
      ),
      shot: {
        src: "/guides/run-an-agent-on-a-schedule/window-detail.png",
        alt: "The Morning issue triage automation in bb, with its schedule, prompt, model, an on/off switch, and a Run now button under Runs",
      },
      options: [],
    },
    {
      id: "step-4",
      title: "Get notified when it finishes",
      lead: "Open the report from a notification, or come back to the thread later.",
      body: (
        <Substeps>
          <li>
            Open <strong>Settings → Push notifications</strong>.
          </li>
          <li>
            Turn on <strong>Web notifications</strong> or{" "}
            <strong>Desktop notifications</strong>, and choose{" "}
            <strong>Allow notifications</strong>.
          </li>
          <li>
            For your phone, keep <strong>Mobile notifications</strong> on and
            pair the bb app in <strong>Settings → Mobile</strong>.
          </li>
          <li>
            Check that a notification arrives the next time a run finishes.
          </li>
        </Substeps>
      ),
      shot: {
        src: "/guides/run-an-agent-on-a-schedule/window-notify.png",
        alt: "bb's Push notifications settings, with mobile, web, and desktop notifications on and an Allow notifications button",
      },
      options: [],
    },
  ],
  troubleshooting: [
    {
      question: "My automation didn't run",
      answer: (
        <ol>
          <li>
            Open it in <strong>Automations</strong> and check that its switch is
            on and the next run time is right.
          </li>
          <li>
            Check that bb and the computer running the agent were awake at that
            time. Scheduling doesn't wake a sleeping computer.
          </li>
          <li>
            Choose <strong>Run now</strong>. If that works, the schedule or the
            computer was the problem.
          </li>
        </ol>
      ),
    },
    {
      question: "My automation turned itself off",
      answer: (
        <ol>
          <li>
            Open its latest runs. Three failures in a row pause an automation.
          </li>
          <li>
            It also pauses if the thread it posts to was archived, deleted, or
            stuck on a failed turn.
          </li>
          <li>
            Fix the cause, choose <strong>Run now</strong> to check it, then
            switch it back on.
          </li>
        </ol>
      ),
    },
    {
      question: "A run failed",
      answer: (
        <ol>
          <li>
            Open the run under <strong>Runs</strong> and read its error.
          </li>
          <li>
            If the agent hit its usage limit, schedule heavy jobs overnight or
            use a script to skip runs with nothing to do.
          </li>
          <li>
            If the agent isn't signed in on that computer, sign in once, then
            choose <strong>Run now</strong>.
          </li>
        </ol>
      ),
    },
    {
      question: "I get a new thread every morning",
      answer: (
        <p>
          That's the default. Ask your agent to post every run to one thread,
          like “send the morning triage to this thread.” Keep that thread for
          reports only.
        </p>
      ),
    },
    {
      question: "Every script run shows as skipped",
      answer: (
        <p>
          A script that exits without printing anything counts as skipped. Have
          it print a short result when there's something to report. A script
          that exits with an error or times out shows as failed; open the run to
          read its output.
        </p>
      ),
    },
    {
      question: "The notification never arrived",
      answer: (
        <ol>
          <li>
            Web and desktop notifications need an open bb tab or app window.
          </li>
          <li>
            Check the browser's notification permission and your device's Focus
            settings.
          </li>
          <li>
            For notifications with the app closed, pair the bb mobile app in{" "}
            <strong>Settings → Mobile</strong>.
          </li>
        </ol>
      ),
    },
  ],
  faq: [
    {
      question: "What can I automate?",
      answer: (
        <ul>
          <li>Triage new issues every morning and post a summary.</li>
          <li>Run the test suite nightly and fix what broke.</li>
          <li>Update dependencies weekly and open a pull request.</li>
          <li>Watch CI and start an agent when main goes red.</li>
          <li>Write release notes from the week's merged pull requests.</li>
        </ul>
      ),
    },
    {
      question: "What's the difference between an agent and a script?",
      answer: (
        <p>
          An agent automation sends a prompt to the agent and model you pick,
          and uses your plan each run. A script runs on the bb server with no
          model, so it's free to run often, and it can start agent threads when
          it finds work.
        </p>
      ),
    },
    {
      question: "Which agents can run an automation?",
      answer: (
        <p>
          Any agent you can use in a bb thread, including Claude Code, Codex,
          Cursor, and OpenCode. Each run uses that agent's subscription.
        </p>
      ),
    },
    {
      question: "How do I change an automation later?",
      answer: (
        <p>
          Open it in <strong>Automations</strong>. Choose{" "}
          <strong>Edit prompt</strong> for an agent automation, or{" "}
          <strong>Edit with chat</strong> for a script. To change the schedule,
          ask your agent, like “move the morning triage to 8am.”
        </p>
      ),
    },
    {
      question: "Can an automation change code or open pull requests?",
      answer: (
        <p>
          Yes. Ask for a new worktree on every run, so each run gets its own
          branch, and say in the prompt whether it should push, open a pull
          request, or leave the change for you.
        </p>
      ),
    },
  ],
  closer: {
    title: "Have the report ready by morning",
    body: "Free and open source. Use the agents and machines you already have.",
  },
};
