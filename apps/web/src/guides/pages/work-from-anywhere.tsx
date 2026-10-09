import { AnywhereConcept } from "../concepts";
import { Substeps, Ui } from "../guide-blocks";
import { withIntake } from "../prompt-intake";
import type { Guide, GuideMeta } from "../guide-types";

const AGENT_PROMPT = withIntake(
  [
    { label: "Phone", hint: "iPhone or Android" },
    { label: "Notifications", hint: "yes or no" },
    { label: "Keep this computer awake", hint: "yes or no" },
  ],
  `Get this bb ready for me to use from my phone.
Guide: https://getbb.app/guides/work-from-anywhere

Do these steps in order and run each check. If a check fails, stop and tell me what you saw. Don't change any other settings.

1. Check the account: run \`bb account status\`.
   Check: it shows a signed-in getbb.app account. If not, run \`bb account login\`, send me the link and code it prints, and ask me to approve it and claim a handle, then tell you "done". Then run \`bb account status\` again.

2. Check remote access: run \`bb connect status\`.
   Check: it shows connected and an https://<handle>.getbb.app address. If remote access is off, run \`bb connect on\` and check again.

3. Only if "Keep this computer awake" is yes: run \`bb keep-awake enable\`, then \`bb keep-awake status\`.
   Check: it shows Keep Awake enabled. If the command isn't found, run \`bb plugin enable keep-awake\` and try again.

4. Only if Notifications is yes: tell me to open Settings → Mobile in bb on this computer, install the app for my phone (TestFlight for iPhone, the Android download for Android), choose Add mobile device, and scan the code with the app. Wait until I say "done", then run \`bb push-notifications list\`.
   Check: my phone shows up in the list.

Reply with my getbb.app address and these steps: open it on my phone, sign in with the same getbb.app account, and add it to my Home Screen. Say whether Keep Awake is on, and remind me that closing a laptop's lid still puts it to sleep.`,
);

export const meta: GuideMeta = {
  slug: "work-from-anywhere",
  title: "Keep working from anywhere",
  nav: { group: "Remote & mobile", label: "Work from anywhere", order: 6 },
  canonical: null,
};

export const guide: Guide = {
  ...meta,
  description:
    "Your agents keep running on your computer while you're out. Check in, answer them, and start new work from your phone or any browser.",
  concept: <AnywhereConcept />,
  agentPrompt: AGENT_PROMPT,
  requirement: null,
  steps: [
    {
      id: "step-1",
      title: "Turn on bb connect",
      lead: "Your bb gets a private getbb.app address you can open from any device.",
      body: (
        <Substeps>
          <li>
            Open <Ui icon="settings">Settings → bb connect</Ui> and choose{" "}
            <strong>Sign in to your bb account</strong>.
          </li>
          <li>Approve the sign-in on getbb.app and claim a handle.</li>
          <li>
            Keep <strong>Remote access</strong> on.
          </li>
        </Substeps>
      ),
      shot: {
        src: "/guides/work-from-anywhere/window-connect-signed-in.png",
        alt: "bb connect in bb's settings, connected at bb-demo.getbb.app, with port 3001 listed under Shared ports",
        width: 2048,
        height: 1280,
      },
      options: [],
    },
    {
      id: "step-2",
      title: "Keep your computer awake",
      lead: "Your agents keep working while you're away from the desk.",
      body: (
        <>
          <Substeps>
            <li>
              Open <Ui icon="settings">Settings</Ui>, and under{" "}
              <strong>Plugins</strong>, choose <strong>Keep Awake</strong>.
            </li>
            <li>
              Turn on <strong>Prevent idle sleep</strong>. Keep{" "}
              <strong>All hosts</strong>, or choose{" "}
              <strong>Specific hosts</strong> for the computers that run your
              agents.
            </li>
          </Substeps>
          <p>
            Closing a laptop's lid still puts it to sleep. For agents that never
            stop, run bb on a desktop or mini PC that stays on.
          </p>
        </>
      ),
      shot: {
        src: "/guides/work-from-anywhere/window-keep-awake.png",
        alt: "Keep Awake in bb's settings, with Prevent idle sleep on for all hosts",
        width: 2048,
        height: 1280,
      },
      options: [],
    },
    {
      id: "step-3",
      title: "Open bb on your phone",
      lead: "Pick up any thread where you left it, answer your agents, or start new work.",
      body: (
        <Substeps>
          <li>
            Open your <code>https://&lt;handle&gt;.getbb.app</code> address in
            your phone's browser.
          </li>
          <li>Sign in with the same getbb.app account.</li>
          <li>Add it to your Home Screen.</li>
        </Substeps>
      ),
      shot: {
        src: "/guides/work-from-anywhere/window-phone.png",
        alt: "bb at phone width, showing an agent's reply in a thread and an Ask a follow-up box",
        width: 780,
        height: 1688,
      },
      options: [],
    },
    {
      id: "step-4",
      title: "Get notified",
      lead: "Know when an agent finishes or needs you, even with the app closed.",
      body: (
        <Substeps>
          <li>
            Open <Ui icon="settings">Settings → Mobile</Ui>, and choose{" "}
            <strong>Join iOS TestFlight</strong> or{" "}
            <strong>Download Android APK</strong> on your phone.
          </li>
          <li>
            On the same page, choose <strong>Add mobile device</strong>. It
            appears once bb connect is on.
          </li>
          <li>
            In the app, choose <strong>Connect with bb connect</strong>, scan
            the code, and allow notifications.
          </li>
        </Substeps>
      ),
      shot: {
        src: "/guides/work-from-anywhere/window-mobile-signed-in.png",
        alt: "bb's Mobile apps settings, with bb connect ready at bb-demo.getbb.app, an Add mobile device button, and the iOS TestFlight and Android downloads",
        width: 2048,
        height: 1280,
      },
      options: [],
    },
  ],
  troubleshooting: [
    {
      question: "My phone says disconnected while my computer is on",
      answer: (
        <ol>
          <li>
            Wait a moment. bb reconnects on its own while the server runs.
          </li>
          <li>
            Check that the server's computer hasn't gone to sleep, and that{" "}
            <strong>Prevent idle sleep</strong> is on for it.
          </li>
          <li>
            On that computer, open{" "}
            <Ui icon="settings">Settings → bb connect</Ui> and check that{" "}
            <strong>Remote access</strong> is on.
          </li>
        </ol>
      ),
    },
    {
      question: "My agents stopped while I was away",
      answer: (
        <ol>
          <li>
            Check whether the computer slept. Keep Awake doesn't stop a closed
            lid or a chosen Sleep.
          </li>
          <li>
            If the server's computer slept, nothing could reach bb until it
            woke. Open the thread and send a message to continue.
          </li>
          <li>
            For agents that run all day, run bb on a computer that stays on and
            add your laptop as a machine.
          </li>
        </ol>
      ),
    },
    {
      question: "I don't see Add mobile device",
      answer: (
        <ol>
          <li>
            Open <Ui icon="settings">Settings → bb connect</Ui> and sign in to
            your bb account.
          </li>
          <li>
            Turn on <strong>Remote access</strong> and wait for your address to
            show.
          </li>
          <li>
            Go back to <Ui icon="settings">Settings → Mobile</Ui>.
          </li>
        </ol>
      ),
    },
    {
      question: "A machine shows as disconnected",
      answer: (
        <ol>
          <li>Check that its computer is on, awake, and online.</li>
          <li>
            In <Ui icon="settings">Settings → Machines</Ui>, open its menu and
            choose <strong>Reconnect</strong>.
          </li>
          <li>
            Run the command it shows on that machine. Its threads and worktrees
            are kept.
          </li>
        </ol>
      ),
    },
    {
      question: "A machine is stuck updating",
      answer: (
        <ol>
          <li>Machines update themselves to match the server's version.</li>
          <li>
            If an update failed, open its menu in{" "}
            <Ui icon="settings">Settings → Machines</Ui> and choose{" "}
            <strong>Retry update</strong>.
          </li>
          <li>
            If it still fails, check the logs from the next question on that
            machine.
          </li>
        </ol>
      ),
    },
    {
      question: "I need bb's logs",
      answer: (
        <ol>
          <li>
            In the desktop app, choose{" "}
            <strong>View → Server &amp; Daemon Logs</strong>.
          </li>
          <li>
            Otherwise, open <code>logs/server-stdio.log</code> and{" "}
            <code>logs/host-daemon-stdio.log</code> in bb's data folder,{" "}
            <code>~/.bb</code>.
          </li>
          <li>
            On a machine you added, look in{" "}
            <code>~/.bb-machines/&lt;server&gt;</code> instead.
          </li>
        </ol>
      ),
    },
  ],
  faq: [
    {
      question: "Do I need to install anything on my phone?",
      answer: (
        <p>
          No. bb runs in your phone's browser. Add the iOS or Android app only
          if you want notifications.
        </p>
      ),
    },
    {
      question: "How do my devices connect?",
      answer: (
        <ul>
          <li>
            <strong>The server</strong> runs on one computer, usually the first
            one you set bb up on. It keeps your threads, settings, and history.
            While it's asleep or off, nothing can reach bb.
          </li>
          <li>
            <strong>Machines</strong> are the computers that run agents. Each
            one connects to the server. The server's own computer is a machine
            too.
          </li>
          <li>
            <strong>Apps</strong>, like the desktop app, the mobile app, and
            your getbb.app address, all open the same server. Your agents run on
            machines, not in the app you're looking at.
          </li>
        </ul>
      ),
    },
    {
      question: "Which of my computers is the server?",
      answer: (
        <p>
          Open <Ui icon="settings">Settings → Machines</Ui>. The server's
          computer has a server badge.
        </p>
      ),
    },
    {
      question: "I set up bb on two computers. Why don't they share threads?",
      answer: (
        <p>
          Each setup runs its own server. To use one bb everywhere, keep the
          server on the computer that stays on, and add the other one from{" "}
          <Ui icon="settings">Settings → Machines</Ui>. New threads can then run
          on either computer.
        </p>
      ),
    },
    {
      question: "Does quitting the desktop app stop my agents?",
      answer: (
        <p>
          On the server's computer, yes. Agents, automations, and remote access
          stop until you open it again. On a Mac, closing the window keeps bb
          running.
        </p>
      ),
    },
    {
      question: "Do my terminal sessions show up?",
      answer: (
        <p>
          No. bb runs your signed-in agents, like Claude Code and Codex, but it
          doesn't attach to sessions already open in a terminal. Start the work
          in bb.
        </p>
      ),
    },
    {
      question: "Who can open my getbb.app address?",
      answer: (
        <p>
          Only you, signed in to your getbb.app account, and devices you've
          paired. To shut it off, turn off <strong>Remote access</strong>, or
          choose <strong>Disconnect</strong> on that bb in your getbb.app
          dashboard.
        </p>
      ),
    },
    {
      question: "Does bb store my traffic?",
      answer: (
        <p>
          No. bb connect passes it through without recording it. It only caches
          bb's own static files.
        </p>
      ),
    },
    {
      question: "What does it cost?",
      answer: (
        <p>
          bb and bb connect are free. You pay for your agents as you do now.
        </p>
      ),
    },
  ],
  closer: {
    title: "Take your agents with you",
    body: "Free and open source. Your agents keep running on your computer.",
  },
};
