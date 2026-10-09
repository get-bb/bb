import AiMagicIcon from "@hugeicons/core-free-icons/AiMagicIcon";
import ComputerIcon from "@hugeicons/core-free-icons/ComputerIcon";
import GitBranchIcon from "@hugeicons/core-free-icons/GitBranchIcon";

import { ScheduleConcept } from "../concepts";
import { Substeps, Ui } from "../guide-blocks";
import { withIntake } from "../prompt-intake";
import type { Guide, GuideMeta } from "../guide-types";

const AGENT_PROMPT = withIntake(
  [
    { label: "Job", hint: "what should happen on each run" },
    { label: "When", hint: "e.g. weekdays at 9am, with your timezone" },
    {
      label: "Results",
      hint: "one thread for reports, or a new worktree each run for code changes",
    },
    {
      label: "Agent or script",
      hint: "an agent with a prompt, or a script that checks first and starts an agent only when there's work",
    },
    { label: "Notifications", hint: "yes or no" },
  ],
  `Set up a bb automation for this project and verify a real run.
Guide: https://getbb.app/guides/run-an-agent-on-a-schedule

You're in a bb thread, so the bb CLI is on your PATH. Do every step yourself, with a Check after each step. If a check fails, stop and tell me the command, the error, and what you'd do next. For Job, suggest morning issue triage on weekdays at 9am with all reports in one thread. Don't guess my timezone or create extra example jobs.

1. Get ready. Read bb guide automations and bb automation create --help. Run bb plugin list; install Automations with bb plugin install automations if it's missing, or bb plugin enable automations if it's off. Read bb status --json and bb machine list to get this project's ID and the machine that will run the job. For an agent job, pick a signed-in provider and a model from bb provider models <provider> --json. Run bb keep-awake status; if it's off, or the machine is a laptop, tell me a run that comes due while it sleeps starts once it wakes.
   Check: Automations is on, the machine is connected, and for an agent job the model is listed.

2. Don't duplicate. Run bb automation list --project <project-id>. If a matching automation exists, reuse it and skip to step 4.
   Check: you know whether you're creating a new automation or reusing one.

3. Create it paused.
   - Agent job: write the prompt the job runs. For triage, read issues without commenting or changing labels, and post dated findings with issue links. For code changes, add "Don't push, open pull requests, or merge unless this prompt says so." Create it with bb automation create --project <project-id> --name '<name>' --disabled, one schedule (--cron '<expression>' --timezone <IANA zone>, or --at <future ISO time with offset>, or --in <duration>), and --prompt '<prompt>' --provider <provider> --model <model> --permission-mode auto. Single-quote the prompt so the shell doesn't expand anything in it.
     For reports in one thread, first create that thread: bb thread spawn --project <project-id> --environment <environment-id> --provider <provider> --model <model> --permission-mode auto --title '<name>' --prompt 'This thread will receive scheduled reports. Reply ready.' and add --target-thread <thread-id>. For code changes, add --new-environment worktree instead.
   - Script job: write the script to a file and create it with --script-file <path> and --working-directory project (or automation-storage, or an absolute path on the bb server) instead of the agent flags. Scripts run on the bb server and get $BB_CLI and $BB_PROJECT_ID. When the script finds work, it starts an agent with "$BB_CLI" thread spawn --project "$BB_PROJECT_ID" --provider <provider> --new-environment worktree --prompt '<what to do>'. When there's nothing to do, it exits without printing anything, which counts as a skipped run.
   Check: bb automation show <automation-id> --project <project-id> matches the job, schedule, timezone, and where results go.

4. Test it once. Run bb automation run <automation-id> --project <project-id>. Get the run from bb automation runs <automation-id> --project <project-id> --json. For an agent run, wait with bb thread wait <thread-id>, then read bb thread output <thread-id>. For a script run, read bb automation runs <automation-id> --project <project-id> --output <run-id>. A queued or running entry isn't a finished run.
   Check: the real output does the job. If it doesn't, leave the automation paused and tell me what went wrong.

5. Turn it on. For a recurring job, run bb automation resume <automation-id> --project <project-id>. For a one-time job, tell me the test already did the job, and ask whether I still want the scheduled run before resuming it.
   Check: bb automation show reports it on, with the next run time.

6. Only if Notifications is yes: check bb plugin config push-notifications, and turn on only a channel that's off with bb plugin config push-notifications set <webEnabled|desktopEnabled|mobileEnabled> true. Run bb push-notifications test web or desktop. If browser permission or phone pairing needs me, stop and give me the exact Settings step.
   Check: I confirm the test arrived on my device. A successful send alone doesn't prove it arrived.

Reply with the automation ID, schedule and timezone, next run, where results go, and what the test run produced.`,
);

export const meta: GuideMeta = {
  slug: "run-an-agent-on-a-schedule",
  title: "Run an agent on a schedule",
  nav: { group: "Automate", label: "Schedule agents", order: 2 },
  canonical: null,
};

export const guide: Guide = {
  ...meta,
  description:
    "Wake up to triaged issues, test results, or a dependency update. Run an agent once or on repeat, or have a script run first before an agent.",
  concept: <ScheduleConcept />,
  picker: null,
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
            Choose <strong>New automation</strong>. A new thread opens with the
            sentence started for you. Or start from a template in{" "}
            <strong>Browse</strong>.
          </li>
        </Substeps>
      ),
      shot: {
        src: "/guides/run-an-agent-on-a-schedule/window-list.png",
        alt: "The Automations page in bb, listing five automations with their project, schedule, next run, and an on/off switch",
        width: 2048,
        height: 1280,
      },
      options: [],
    },
    {
      id: "step-2",
      title: "Describe the job",
      lead: "Finish the sentence with what to do, when, and where the results go, then send it. Your agent sets it up.",
      body: (
        <>
          <p>
            Reports land in one thread, so you can follow what changed. For jobs
            that change code, like a nightly test sweep, choose{" "}
            <strong>Worktree</strong> in the dropdown under the message box, so
            each run gets its own branch.
          </p>
          <p>
            Does the job need a site you're signed in to, like Linear or your
            analytics?{" "}
            <a href="/guides/agent-browser#sign-ins">
              Import your browser logins
            </a>{" "}
            into bb first.
          </p>
        </>
      ),
      shot: {
        src: "/guides/run-an-agent-on-a-schedule/window-compose.png",
        alt: "The bb message box with: Create a new bb automation to read new and updated GitHub issues every weekday at 9am Pacific. Group bugs and requests, flag regressions, and post a dated summary to one thread. Create it paused so I can test it.",
        width: 2048,
        height: 1280,
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
            width: 2048,
            height: 1280,
          },
        },
        {
          title: "Run it once, later",
          body: (
            <p>
              Ask for a single run, like “tomorrow at 9am, draft release notes
              from this week's pull requests.” It shows as One time in
              Automations.
            </p>
          ),
          shot: {
            src: "/guides/run-an-agent-on-a-schedule/window-once.png",
            alt: "A one-time automation in bb, Draft release notes, scheduled for tomorrow at 9:00 AM, with its prompt and a Run now button",
            width: 2048,
            height: 1280,
          },
        },
        {
          title: "Send one message later",
          body: (
            <p>
              Type the message, open the arrow <Ui icon="send-options" /> next
              to the send button, and choose <strong>Send later…</strong> to
              pick when it goes to this thread.
            </p>
          ),
          shot: {
            src: "/guides/run-an-agent-on-a-schedule/window-send-later.png",
            alt: "A bb thread with a message typed and the menu next to the send button open, showing Save draft and Send later",
            width: 2048,
            height: 1280,
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
        src: "/guides/run-an-agent-on-a-schedule/window-detail-paused.png",
        alt: "The Morning issue triage automation in bb, paused, with its schedule, prompt, model, and a Run now button under Runs",
        width: 2048,
        height: 1280,
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
            Open <Ui icon="settings">Settings → Push notifications</Ui>.
          </li>
          <li>
            Turn on <strong>Web notifications</strong> or{" "}
            <strong>Desktop notifications</strong>, and choose{" "}
            <strong>Allow notifications</strong>.
          </li>
          <li>
            For your phone, keep <strong>Mobile notifications</strong> on and
            pair the bb app in <Ui icon="settings">Settings → Mobile</Ui>. See{" "}
            <a href="/guides/work-from-anywhere">Work from anywhere</a>.
          </li>
          <li>
            Check that a notification arrives the next time a run finishes.
          </li>
        </Substeps>
      ),
      shot: {
        src: "/guides/run-an-agent-on-a-schedule/window-notify.png",
        alt: "bb's Push notifications settings, with mobile, web, and desktop notifications on and an Allow notifications button",
        width: 2048,
        height: 1280,
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
            <Ui icon="settings">Settings → Mobile</Ui>.
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
