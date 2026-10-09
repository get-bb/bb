import { ScheduleConcept } from "../concepts";
import { Substeps, Ui } from "../guide-blocks";
import { withIntake } from "../prompt-intake";
import type { Guide, GuideMeta } from "../guide-types";
import { AGENTS_FAQ } from "../shared/faq";

const AGENT_PROMPT = withIntake(
  [
    {
      label: "Job",
      hint: "what each run does; a script can check first and start an agent only when there's work",
    },
    { label: "When", hint: "e.g. weekdays at 9am, with your timezone" },
    {
      label: "Results",
      hint: "one thread for reports, or a new worktree each run for code changes",
    },
    { label: "Notifications", hint: "yes or no" },
  ],
  `Set up a bb automation for this project and test it once.
Guide: https://getbb.app/guides/run-an-agent-on-a-schedule

Default Job: morning issue triage on weekdays at 9am, with reports in one thread. Ask for my timezone. Pass --project $BB_PROJECT_ID to every bb automation command. If a step fails, stop and tell me the error.

1. Read \`bb automation create --help\`. Turn on the Automations plugin if \`bb plugin list\` shows it's off. For an agent job, pick a model from \`bb provider models <provider> --json\`.
2. If \`bb automation list\` already has this job, reuse it and skip to step 4.
3. Create it paused: \`bb automation create --name '<name>' --disabled\` with \`--cron '<expression>' --timezone <IANA zone>\` or \`--at <ISO time>\`, plus either:
   - Agent: \`--prompt '<prompt>' --provider <provider> --model <model> --permission-mode auto\`. For reports in one thread, start that thread with \`bb thread spawn\` and add \`--target-thread <its ID>\`. For code changes, add \`--new-environment worktree\` and tell it not to push.
   - Script: \`--script-file <path>\`. It starts an agent with \`"$BB_CLI" thread spawn\` only when there's work, and prints nothing otherwise.
4. Test it with \`bb automation run <id>\`, then read the run's thread or output. If it doesn't do the job, leave it paused and tell me why.
5. Turn it on with \`bb automation resume <id>\`, asking me first for a one-time job. If Notifications is yes, send \`bb push-notifications test web\` and ask me to confirm it arrived.

Reply with the automation ID, schedule, next run, and what the test produced.`,
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
  agentPrompt: AGENT_PROMPT,
  requirement: null,
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
      lead: "Describe what to do, when, and where the results go. Your agent sets it up.",
      body: (
        <p>
          Does the job need a site you're signed in to, like Linear or your
          analytics?{" "}
          <a href="/guides/agent-browser#sign-ins">
            Import your browser logins
          </a>{" "}
          into bb first.
        </p>
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
            time. Scheduling doesn't wake a sleeping computer; a missed run
            happens once when it's back.
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
    AGENTS_FAQ,
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
