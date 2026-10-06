import ComputerIcon from "@hugeicons/core-free-icons/ComputerIcon";
import SmartPhone01Icon from "@hugeicons/core-free-icons/SmartPhone01Icon";
import UserAccountIcon from "@hugeicons/core-free-icons/UserAccountIcon";

import { AnywhereConcept } from "../concepts";
import { CommandBlock, Note, ProductShot, Substeps } from "../guide-blocks";
import type { Guide } from "../guide-types";

const AGENT_PROMPT = `Get this bb ready for me to use from my phone, and keep this computer awake while I'm away.
Guide: https://getbb.app/guides/work-from-anywhere

You're in a bb thread, so the bb CLI is on your PATH. Do these steps in order and run each check. If a check fails, stop and tell me what you saw.

1. Check the account: run \`bb account status\`.
   Check: it shows a signed-in getbb.app account. If not, run \`bb account login\`, send me the link and code it prints, and stop until I approve it.

2. Check remote access: run \`bb connect status\`.
   Check: it shows connected and an https://<handle>.getbb.app address. If remote access is off, run \`bb connect on\` and check again.

3. Keep this computer awake: run \`bb keep-awake enable\`, then \`bb keep-awake status\`.
   Check: it shows Keep Awake enabled. If the command isn't found, run \`bb plugin enable keep-awake\` and try again.

Reply with my getbb.app address and whether Keep Awake is on. Remind me that closing a laptop's lid still puts it to sleep. Don't change any other settings.`;

export const WORK_FROM_ANYWHERE: Guide = {
  slug: "work-from-anywhere",
  title: "Keep working from anywhere",
  description:
    "Your agents keep running on your computer while you're out. Check in, answer them, and start new work from your phone or any browser.",
  concept: <AnywhereConcept />,
  handoffNote:
    "Paste it into any bb thread on this computer. Your agent sets it up and sends you your address.",
  agentPrompt: AGENT_PROMPT,
  needs: [
    {
      title: "A computer that stays on",
      icon: ComputerIcon,
      body: "bb on macOS, Windows, or Linux (alpha). It runs your bb server and your agents.",
    },
    {
      title: "A getbb.app account",
      icon: UserAccountIcon,
      body: "Free. It gives your bb a private address.",
    },
    {
      title: "Your phone",
      icon: SmartPhone01Icon,
      body: "Any browser works. Add the iOS or Android app for notifications.",
    },
  ],
  steps: [
    {
      id: "step-1",
      title: "Turn on bb connect",
      lead: "Your bb gets a private getbb.app address you can open from anywhere.",
      body: (
        <>
          <Substeps>
            <li>
              Open <strong>Settings → Mobile</strong> and choose{" "}
              <strong>Set up bb connect</strong>.
            </li>
            <li>Sign in to your getbb.app account and claim a handle.</li>
          </Substeps>
          <ProductShot
            src="/guides/work-from-anywhere/bb-connect-settings.png"
            alt="bb's Mobile apps settings, with a Set up bb connect button and the iOS TestFlight beta"
          />
          <CommandBlock label="Or from the CLI" command="bb account login" />
        </>
      ),
      doneWhen: (
        <>
          <code>bb connect status</code> shows connected and your{" "}
          <code>https://&lt;handle&gt;.getbb.app</code> address.
        </>
      ),
    },
    {
      id: "step-2",
      title: "Keep your computer awake",
      lead: "Your agents keep working while you're away.",
      body: (
        <>
          <CommandBlock
            command={"bb keep-awake enable\nbb keep-awake status"}
          />
          <Note title="Closing the lid still sleeps a laptop." warn>
            For agents that never stop, run bb on a desktop or mini PC that
            stays on.
          </Note>
        </>
      ),
      doneWhen: (
        <>
          <code>bb keep-awake status</code> shows Keep Awake enabled.
        </>
      ),
    },
    {
      id: "step-3",
      title: "Open bb on your phone",
      lead: "Pick up any thread where you left it.",
      body: (
        <Substeps>
          <li>
            Open your <code>https://&lt;handle&gt;.getbb.app</code> address on
            your phone.
          </li>
          <li>Sign in with the same getbb.app account.</li>
          <li>Add it to your Home Screen.</li>
        </Substeps>
      ),
      doneWhen: "your threads load on your phone.",
    },
    {
      id: "step-4",
      title: "Get notified",
      lead: "Know when an agent finishes or needs you, even with the app closed.",
      body: (
        <>
          <Substeps>
            <li>
              In <strong>Settings → Mobile</strong>, join the iOS TestFlight
              beta or download the Android app.
            </li>
            <li>
              On the same page, choose <strong>Add mobile device</strong>.
            </li>
            <li>
              In the app, choose <strong>Connect with bb connect</strong> and
              scan the code.
            </li>
          </Substeps>
          <CommandBlock
            label="Or make a pairing code from the CLI"
            command="bb connect machine-code"
          />
        </>
      ),
      doneWhen: "the app shows your threads and you've allowed notifications.",
    },
  ],
  sections: [
    {
      id: "how-it-connects",
      title: "How bb connects your devices",
      body: (
        <ul className="gd-list">
          <li>
            <strong>The server.</strong> One computer runs it, usually the first
            one you set bb up on. It keeps your threads, settings, and history,
            and everything else connects to it. While it's asleep or off,
            nothing can reach bb.
          </li>
          <li>
            <strong>Machines.</strong> Every computer that runs agents runs a
            small background program, the host daemon, that connects to the
            server. The server's own computer is a machine too.
          </li>
          <li>
            <strong>Apps.</strong> The desktop app, the mobile app, and your
            getbb.app address in any browser all open the same server. Your
            agents run on machines, not in the app you're looking at.
          </li>
        </ul>
      ),
    },
  ],
  faqTitle: "Troubleshooting FAQ",
  faq: [
    {
      question: "Which of my computers is the server?",
      answer: (
        <p>
          Run <code>bb machine list</code>: the Role column says{" "}
          <code>server</code>. In the app, <strong>Settings → Machines</strong>{" "}
          marks it with a server badge.
        </p>
      ),
    },
    {
      question: "What happens to my agents when my laptop sleeps?",
      answer: (
        <p>
          If your laptop is the server, your phone and other machines can't
          reach bb until it wakes, and their running agents may stop. If it's
          only a machine, just its agents stop. Turn on Keep Awake, or set up bb
          on a computer that stays on and add your laptop as a machine.
        </p>
      ),
    },
    {
      question: "I set up bb on two computers. Why don't they share threads?",
      answer: (
        <p>
          Each setup runs its own server with its own threads. To use one bb
          everywhere, keep the server on the computer that stays on, and add the
          other one from <strong>Settings → Machines</strong>. Its host daemon
          then connects to that server, and new threads can run on either
          computer.
        </p>
      ),
    },
    {
      question: "Does quitting the desktop app stop my agents?",
      answer: (
        <p>
          On the server's computer, yes. Quitting the app stops its server and
          host daemon, so agents, automations, and remote access stop until you
          open it again. On a Mac, closing the window keeps bb running.
        </p>
      ),
    },
    {
      question: "Why does my phone say disconnected when my computer is on?",
      answer: (
        <p>
          The bb connect tunnel can drop for a moment, and bb reconnects on its
          own while the server runs. If it stays disconnected, run{" "}
          <code>bb connect status</code> on the server's computer and check it
          hasn't gone to sleep.
        </p>
      ),
    },
    {
      question: "Why does a machine show as disconnected?",
      answer: (
        <p>
          Its computer is off, asleep, or offline, or its access to the server
          went stale. If it stays disconnected while it's on, run{" "}
          <code>bb machine reconnect &lt;name&gt;</code> and run the command it
          prints on that machine. Its threads and worktrees are kept.
        </p>
      ),
    },
    {
      question: "Why is a machine stuck updating?",
      answer: (
        <p>
          Machines update themselves to match the server's version. If an update
          failed, retry it from <strong>Settings → Machines</strong> or with{" "}
          <code>bb machine retry-update &lt;name&gt;</code>.
        </p>
      ),
    },
    {
      question: "Where are bb's logs?",
      answer: (
        <p>
          In the desktop app, choose{" "}
          <strong>View → Server &amp; Daemon Logs</strong>. Otherwise, open{" "}
          <code>logs/server-stdio.log</code> and{" "}
          <code>logs/host-daemon-stdio.log</code> in bb's data folder:{" "}
          <code>~/.bb</code>, or <code>~/.bb-machines/&lt;server&gt;</code> on a
          machine you added.
        </p>
      ),
    },
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
      question: "Do my terminal sessions show up?",
      answer: (
        <p>
          No. bb runs your signed-in <code>claude</code> and <code>codex</code>{" "}
          CLIs, but it doesn't attach to sessions already open in a terminal.
          Start the work in bb.
        </p>
      ),
    },
    {
      question: "Who can open my getbb.app address?",
      answer: (
        <p>
          Only you, signed in to your getbb.app account, and machines you've
          added. To shut it off, choose <strong>Disconnect</strong> on that bb
          in your getbb.app dashboard.
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
