import { ScheduleConcept } from "../concepts";
import { ProductShot, Substeps } from "../guide-blocks";
import type { Guide } from "../guide-types";

const AGENT_PROMPT = `Set up a bb automation for this project and verify a real run.
Guide: https://getbb.app/guides/run-an-agent-on-a-schedule

Do every step yourself, with a Check after each step. If a check fails, stop and report the command, error, and next action. Ask for the job, schedule, timezone, and destination thread if I haven't supplied them. Suggest morning issue triage on weekdays at 9am, with all results in a dedicated thread. Don't guess my timezone or create extra example jobs.

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

Reply with the automation ID, schedule and timezone, next run, result thread, and verified output. Include the run, pause, and resume commands. Don't promise an alert for every missed or disabled automation.`;

export const RUN_AN_AGENT_ON_A_SCHEDULE: Guide = {
  slug: "run-an-agent-on-a-schedule",
  title: "Run an agent on a schedule",
  description:
    "Wake up to triaged issues, test results, or a dependency update. Schedule an agent once or on repeat, or run a script first and only wake the agent when there's work.",
  concept: <ScheduleConcept />,
  picker: null,
  handoffNote:
    "Paste this into a bb thread. Your agent sets up the job, runs it once, and checks the result.",
  agentPrompt: AGENT_PROMPT,
  needs: [],
  steps: [
    {
      id: "step-1",
      title: "Open Automations",
      lead: "Automations lives in the sidebar, next to your threads.",
      body: (
        <>
          <Substeps>
            <li>
              Choose <strong>Automations</strong> in the sidebar.
            </li>
            <li>
              Choose <strong>New automation</strong>, or start from a template
              in <strong>Browse</strong>, like CI failure triage or Dependency
              drift.
            </li>
          </Substeps>
          <ProductShot
            src="/guides/run-an-agent-on-a-schedule/automations-list.png"
            alt="The Automations page in bb, listing four automations with their project, schedule, next run, and an on/off switch"
          />
        </>
      ),
      doneWhen:
        "a new message opens with “Create a new bb automation to” filled in.",
    },
    {
      id: "step-2",
      title: "Describe the job",
      lead: "Finish the sentence: what to do, when, and where the results go. Your agent sets up the automation for you.",
      body: (
        <>
          <ProductShot
            src="/guides/run-an-agent-on-a-schedule/new-automation.png"
            alt="The bb composer with the message: Create a new bb automation to read new and updated GitHub issues every weekday at 9am Pacific. Group bugs and requests, flag regressions, and post a dated summary to one thread. Create it paused so I can test it."
          />
          <p>
            Reports land in one thread, so you can follow what changed. For jobs
            that change code, like a nightly test sweep or a weekly dependency
            update, ask for a new worktree on every run instead.
          </p>
        </>
      ),
      doneWhen: "the automation shows up in Automations, paused.",
    },
    {
      id: "step-3",
      title: "Run it now, then turn it on",
      lead: "You don't have to wait until morning to find out whether it works.",
      body: (
        <>
          <Substeps>
            <li>
              Open the automation and choose <strong>Run now</strong>. It's also
              in the <strong>⋯</strong> menu.
            </li>
            <li>
              Under <strong>Runs</strong>, open the run and read the actual
              report. A running entry means it has started, not finished.
            </li>
            <li>
              Once the report is right, switch the automation on. To change what
              it does, choose <strong>Edit prompt</strong>.
            </li>
          </Substeps>
          <ProductShot
            src="/guides/run-an-agent-on-a-schedule/automation-detail.png"
            alt="The Morning issue triage automation in bb, with its schedule, prompt, model, an on/off switch, and a Run now button under Runs"
          />
        </>
      ),
      doneWhen:
        "the run's thread has a useful report and the automation is on.",
    },
    {
      id: "step-4",
      title: "Get notified when the agent finishes",
      lead: "Open the finished report from a notification, or come back to the thread later.",
      body: (
        <Substeps>
          <li>
            Open <strong>Settings → Push notifications</strong>, enable web or
            desktop delivery, and choose <strong>Allow notifications</strong> if
            prompted.
          </li>
          <li>
            Choose <strong>Send test notification</strong> and check that it
            arrives. Keep the bb tab or desktop app open for that delivery
            channel.
          </li>
        </Substeps>
      ),
      doneWhen: "a test notification appears on the device you'll use.",
    },
  ],
  sections: [
    {
      id: "scripts",
      title: "Run a script first, and only wake an agent when there's work",
      body: (
        <>
          <p>
            An automation can run a script instead of an agent. Scripts run on
            the bb server without a model, so checking every few minutes uses
            none of your plan. When there's nothing new, the script prints
            nothing and the run is skipped. When there is, it starts an agent
            with exactly what to look at.
          </p>
          <p>
            Ask for one in plain words, like “Create a new bb automation to
            check main for a failed CI run every 15 minutes, and if there is
            one, start a Codex thread to find the cause.” Your agent writes the
            script, and you can read it and every run's output on the
            automation's page.
          </p>
          <ProductShot
            src="/guides/run-an-agent-on-a-schedule/script-runs.png"
            alt="A CI failure check automation in bb that runs a script every 15 minutes. One run found a failed CI run and started a Codex thread; two runs found nothing and were skipped."
          />
        </>
      ),
    },
    {
      id: "one-off",
      title: "Run it once, later",
      body: (
        <p>
          Ask for a single run, like “tomorrow at 9am” or “in two hours,” and
          your agent schedules it once. Just sending a message later? Write the
          message, open the composer's <strong>+</strong> menu, choose{" "}
          <strong>Send later…</strong>, pick a time, and choose{" "}
          <strong>Schedule send</strong>. You can do this even when your agent
          has hit its rate limit.
        </p>
      ),
    },
  ],
  faqTitle: "FAQ",
  faq: [
    {
      question: "What can I automate?",
      answer: (
        <>
          <p>Anything you'd ask an agent to do on a schedule. For example:</p>
          <ul>
            <li>Triage new issues every morning and post a summary.</li>
            <li>Run the test suite nightly and fix what broke.</li>
            <li>Update dependencies weekly and open a pull request.</li>
            <li>Watch CI and start an agent when main goes red.</li>
            <li>Write release notes from the week's merged pull requests.</li>
          </ul>
          <p>
            <strong>Browse</strong> in Automations has templates to start from.
          </p>
        </>
      ),
    },
    {
      question:
        "What's the difference between an agent and a script automation?",
      answer: (
        <p>
          An agent automation sends a prompt to the agent and model you pick,
          like Claude Code or Codex, and uses your plan each time it runs. A
          script automation runs a shell script on the bb server with no model,
          so it's free to run often. Scripts can start agent threads when they
          find work, which gives you frequent checks without paying for quiet
          runs.
        </p>
      ),
    },
    {
      question: "Which agents can run an automation?",
      answer: (
        <p>
          Any agent you can use in a bb thread, including Claude Code, Codex,
          Cursor, and OpenCode. The automation's page shows the agent and model
          it uses. Each run uses that agent's subscription, as if you'd started
          the thread yourself.
        </p>
      ),
    },
    {
      question: "How do I change an automation later?",
      answer: (
        <p>
          Open it in <strong>Automations</strong>. Choose{" "}
          <strong>Edit prompt</strong> to change what an agent automation does,
          or <strong>Edit with chat</strong> to have an agent change a script.
          Use the switch to pause or resume it, and the <strong>⋯</strong> menu
          to run it now or delete it. To change the schedule, ask your agent,
          like “Move the morning triage to 8am.”
        </p>
      ),
    },
    {
      question: "How can I tell whether my automation actually works?",
      answer: (
        <p>
          Choose <strong>Run now</strong> on its page, then open the run under{" "}
          <strong>Runs</strong> and read what it produced. Check the actual
          result, not just that the schedule exists. Run now works while the
          automation is paused, and it does the real job, so a test of a
          one-time job may make the scheduled run unnecessary.
        </p>
      ),
    },
    {
      question: "Why did my automation stop running?",
      answer: (
        <p>
          Open it in <strong>Automations</strong> and check its switch and the
          latest runs. If a run can't start, bb retries with a growing delay,
          and three failures in a row pause the automation. An automation that
          posts to a thread is also paused if that thread is archived, deleted,
          or stuck on a failed turn. Fix the cause, choose{" "}
          <strong>Run now</strong> to check it, then switch it back on.
        </p>
      ),
    },
    {
      question: "Why am I getting a new thread every morning?",
      answer: (
        <p>
          A new thread per run is the default. Ask your agent to post every run
          to one thread instead, like “Send the morning triage to this thread.”
          Keep that thread for reports only: if other work is running there when
          the job is due, the scheduled prompt joins it. If the last run is
          still going, the next one waits.
        </p>
      ),
    },
    {
      question: "Can an automation change code or open pull requests?",
      answer: (
        <p>
          Yes. Ask for a new worktree on every run, so each run works on its own
          branch without touching your checkout. The agent works with the
          permissions you choose, like <strong>Approve for me</strong>. Say in
          the prompt whether it should push, open a pull request, or stop and
          leave the change for you to review.
        </p>
      ),
    },
    {
      question: "Will it run while my laptop is asleep?",
      answer: (
        <p>
          The bb server and the machine running the agent need to be awake and
          connected. For overnight work, run bb on a machine that stays on, like
          a desktop or a small server, and{" "}
          <a href="/guides/work-from-anywhere">reach it from anywhere</a>.
          Scheduling a job doesn't wake a sleeping computer.
        </p>
      ),
    },
    {
      question: "What happens if my agent hits its usage limit?",
      answer: (
        <p>
          That run stops like any other thread would, and shows as failed under{" "}
          <strong>Runs</strong>. To save your limits for daytime work, schedule
          heavy jobs overnight, or use a script automation to skip runs when
          there's nothing to do.
        </p>
      ),
    },
    {
      question: "Can I get a notification with the app closed?",
      answer: (
        <p>
          Use the bb mobile app for push delivery with the app closed. Pair it
          in <strong>Settings → Mobile → Add mobile device</strong>, and keep{" "}
          <strong>Mobile notifications</strong> on in{" "}
          <strong>Settings → Push notifications</strong>. Web and desktop
          notifications need an open bb tab or app window. If a test doesn't
          appear, check browser permissions and the device's notification and
          Focus settings.
        </p>
      ),
    },
    {
      question: "Why does my script run show as skipped?",
      answer: (
        <p>
          A script that exits cleanly without printing anything counts as a
          quiet run, shown as skipped. Have it print a short result when there
          is something to report. A script that exits with an error or times out
          is a failed run; open it under <strong>Runs</strong> to read its
          output and errors.
        </p>
      ),
    },
  ],
  closer: {
    title: "Have the report ready by morning",
    body: "Free and open source. Use the agents and machines you already have.",
  },
};
