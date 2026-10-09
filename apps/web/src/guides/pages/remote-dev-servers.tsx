import CloudIcon from "@hugeicons/core-free-icons/CloudIcon";
import ComputerIcon from "@hugeicons/core-free-icons/ComputerIcon";
import ServerStack01Icon from "@hugeicons/core-free-icons/ServerStack01Icon";

import { RemoteServersConcept } from "../concepts";
import {
  CommandBlock,
  FileBlock,
  PromptBlock,
  Substeps,
} from "../guide-blocks";
import { withIntake } from "../prompt-intake";
import type { Guide, GuideMeta } from "../guide-types";

const AGENT_PROMPT = withIntake(
  [
    { label: "Branches", hint: "the branches to preview" },
    { label: "Machine", hint: "the remote machine to run them on" },
    { label: "Dev server command", hint: "e.g. pnpm dev" },
  ],
  `Run a dev server for each branch on a remote bb machine, and share each one at its own getbb.app link.
Guide: https://getbb.app/guides/remote-dev-servers

You're in a bb thread, so the bb CLI is on your PATH. Do these steps in order and run each check. If a check fails, stop and tell me what you saw. Don't open firewall ports, send localhost links, or share ports I didn't ask for.

1. Find or add the machine. Run \`bb machine list\`. If the machine isn't there, add it without blocking this thread: bb terminal create --thread "$BB_THREAD_ID" --title "Add machine" --command "bb machine create --provider manual", then read the one-time install command from bb terminal output <terminal-id> and run it on that machine over SSH.
   Check: \`bb machine list\` shows the machine as connected. If you can't reach it over SSH, stop and send me the install command to run there.

2. Put the project on the machine, unless it already has a source there:
   bb project source add "$BB_PROJECT_ID" --clone --machine <machine>
   Check: \`bb project show "$BB_PROJECT_ID"\` lists a source on the machine.

3. For each branch, start a worktree thread on that machine:
   bb thread spawn --json --project "$BB_PROJECT_ID" --machine <machine> --new-environment worktree --base-branch <origin/branch, or the local branch if the repo has no remote> --title "<branch>" --prompt "You run the dev server for <branch>. Reply ready."
   Check: each spawn returns a thread ID. If a thread fails to start its agent, stop and ask me to sign in to that agent on the machine.

4. Give each branch its own ports. In each branch's worktree, if there's no \`.env.local\`, pick two free ports and write WEB_PORT and API_PORT to \`.env.local\` there. Don't commit it. (A committed \`.bb-env-setup.sh\` that does this only runs for branches that already contain it.)
   Check: every worktree's \`.env.local\` has different ports.

5. Start each dev server in a bb terminal, listening on 127.0.0.1 at its WEB_PORT, using the Dev server command line. Pass the host and port as environment variables, since many dev commands ignore extra flags (npm scripts need \`--\` before flags):
   bb terminal create --thread <thread-id> --title "Dev server" --command 'set -a; . ./.env.local; set +a; HOST=127.0.0.1 PORT="$WEB_PORT" <dev server command>'
   Check: \`bb terminal output <terminal-id>\` shows the server listening on 127.0.0.1 at that port, not on all interfaces. If it isn't, stop and ask me before changing the app's code.

6. Share each WEB_PORT. Run \`bb connect status\` first; if remote access is off, stop and ask me to turn on bb connect in Settings. Then:
   bb connect expose <port> --host <machine>
   Check: \`bb connect shares --host <machine>\` lists every port.

Reply with a table of branch, port, and link.`,
);

const SETUP_SCRIPT = `#!/usr/bin/env bash
set -euo pipefail
pnpm install
free_port() { node -e 'const s=require("net").createServer().listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})'; }
printf 'WEB_PORT=%s\\nAPI_PORT=%s\\n' "$(free_port)" "$(free_port)" > .env.local`;

export const meta: GuideMeta = {
  slug: "remote-dev-servers",
  title: "Run a dev server for every branch",
  nav: { group: "Remote & mobile", label: "Run dev servers", order: 5 },
  canonical: null,
};

export const guide: Guide = {
  ...meta,
  description:
    "Every agent's branch gets its own dev server and port, reloading as the agent codes. Open any of them from your phone at a private link only you can open.",
  concept: <RemoteServersConcept />,
  picker: null,
  handoffNote:
    "Fill in your branches and machine at the top, or leave them and your agent asks. It runs every step and stops if it needs you.",
  agentPrompt: AGENT_PROMPT,
  needs: [
    {
      title: "A machine for your servers",
      icon: ServerStack01Icon,
      body: "Any Linux or macOS computer you can SSH into, or Windows with Node.js 22.19+. Your own computer works too.",
    },
    {
      title: "A getbb.app account",
      icon: CloudIcon,
      body: "Free. It gives every shared port a private link that only you can open.",
    },
    {
      title: "A bb that stays on",
      icon: ComputerIcon,
      body: "Machines connect to your bb server, so keep the computer running it awake.",
    },
  ],
  steps: [
    {
      id: "step-1",
      title: "Add a machine",
      lead: "Run servers on a box with room for all of them, not on your laptop. bb keeps it connected through reboots and updates.",
      body: (
        <Substeps>
          <li>
            Open <strong>Settings → Machines</strong> and choose{" "}
            <strong>Add a machine</strong>.
          </li>
          <li>
            If bb asks how machines should reach it, sign in to bb connect, or
            choose <strong>Manual</strong> and enter an address the machine can
            reach.
          </li>
          <li>
            Choose <strong>macOS or Linux</strong> or <strong>Windows</strong>,
            choose <strong>Copy</strong>, and run the command on the machine
            over SSH.
          </li>
          <li>Sign in to your agents on that machine once.</li>
          <li>
            Check that the machine shows as Online in{" "}
            <strong>Settings → Machines</strong>.
          </li>
        </Substeps>
      ),
      shot: {
        src: "/guides/remote-dev-servers/window-add-machine.png",
        alt: "The Add a machine dialog in bb's Machines settings, with a macOS or Linux install command, a Copy button, and Waiting for the machine to connect",
        width: 2048,
        height: 1280,
      },
      options: [],
    },
    {
      id: "step-2",
      title: "Put your project on it",
      lead: "Give the machine its own copy of the repo, and give every branch its own ports.",
      body: (
        <>
          <Substeps>
            <li>
              Open <strong>Settings → Projects</strong> and choose your project.
            </li>
            <li>
              Under <strong>Checkouts</strong>, choose <strong>Set up</strong>{" "}
              next to the new machine.
            </li>
          </Substeps>
          <p>
            Then commit a setup script at the repo root. bb runs it in every new
            worktree, so each branch installs its dependencies and picks free
            ports:
          </p>
          <FileBlock name=".bb-env-setup.sh" contents={SETUP_SCRIPT} />
        </>
      ),
      shot: {
        src: "/guides/remote-dev-servers/window-checkouts.png",
        alt: "A project's settings in bb, with a Checkouts section listing where the project lives on each machine",
        width: 2048,
        height: 1280,
      },
      options: [],
    },
    {
      id: "step-3",
      title: "Start a thread per branch",
      lead: "Each thread gets its own worktree on the machine, so servers never step on each other.",
      body: (
        <Substeps>
          <li>
            Choose <strong>New thread</strong>, pick the project, and choose{" "}
            <strong>Worktree</strong>. If the project is on more than one
            machine, pick the new one.
          </li>
          <li>
            In <strong>Branch from</strong>, pick the branch, and describe the
            work.
          </li>
          <li>Repeat for each branch.</li>
        </Substeps>
      ),
      shot: {
        src: "/guides/remote-dev-servers/window-new-thread.png",
        alt: "A new bb thread in acme-web with Worktree chosen and the Branch from list open, showing main and feature branches",
        width: 2048,
        height: 1280,
      },
      options: [],
    },
    {
      id: "step-4",
      title: "Run each dev server",
      lead: "A bb terminal runs in the thread's worktree and keeps going after you close the tab.",
      body: (
        <>
          <Substeps>
            <li>
              In the thread's side panel, choose <strong>+</strong>, then{" "}
              <strong>Start terminal</strong>.
            </li>
            <li>Start the server on the ports the setup script picked:</li>
          </Substeps>
          <CommandBlock
            command={
              'set -a; . ./.env.local; set +a\npnpm dev --host 127.0.0.1 --port "$WEB_PORT"'
            }
          />
          <p>Or ask the thread's agent to start it for you.</p>
        </>
      ),
      shot: {
        src: "/guides/remote-dev-servers/window-terminal.png",
        alt: "A bb thread with its side panel open on a Dev server terminal, showing a server running on 127.0.0.1 port 3001",
        width: 2048,
        height: 1280,
      },
      options: [],
    },
    {
      id: "step-5",
      title: "Open it from anywhere",
      lead: "bb connect gives each port a private getbb.app link, and live reload works through it.",
      body: (
        <>
          <Substeps>
            <li>
              Open <strong>Settings → bb connect</strong> and choose{" "}
              <strong>Sign in to your bb account</strong>, if you haven't.
            </li>
            <li>Ask the thread's agent to share its port:</li>
          </Substeps>
          <PromptBlock
            name="Ask the agent"
            prompt="Share port 3001 on this machine with bb connect and give me the link."
          />
          <p>
            It replies with a link like{" "}
            <code>https://my-server--3001.getbb.app</code>. Every link is listed
            under <strong>Shared ports</strong> in{" "}
            <strong>Settings → bb connect</strong>, where you can copy it or
            stop sharing when the branch is done. Open each link on your phone
            to check its branch.
          </p>
        </>
      ),
      shot: {
        src: "/guides/remote-dev-servers/window-connect-signed-in.png",
        alt: "bb connect in bb's settings, connected at bb-demo.getbb.app, with port 3001 listed under Shared ports",
        width: 2048,
        height: 1280,
      },
      options: [],
    },
  ],
  troubleshooting: [
    {
      question: "The link shows a connection error",
      answer: (
        <ol>
          <li>
            Open the thread's <strong>Dev server</strong> terminal and check
            that the server is still running.
          </li>
          <li>
            Start it on <code>127.0.0.1</code>, at the same port you shared. bb
            connect can't reach a server bound to another address.
          </li>
          <li>Reload the link.</li>
        </ol>
      ),
    },
    {
      question: "Two branches fight over the same port",
      answer: (
        <ol>
          <li>
            Commit <code>.bb-env-setup.sh</code> from step 2, so each new
            worktree picks its own free ports.
          </li>
          <li>
            Start each server with the ports in its <code>.env.local</code>, not
            a hard-coded one.
          </li>
          <li>Worktrees made before the script need a new thread.</li>
        </ol>
      ),
    },
    {
      question: "The thread failed while setting up its worktree",
      answer: (
        <ol>
          <li>
            Open the thread and read the{" "}
            <strong>.bb-env-setup.sh failed</strong> output.
          </li>
          <li>
            Fix the script, commit it, and start a new thread. bb removes a
            worktree whose setup fails.
          </li>
          <li>
            Make optional steps non-fatal inside the script if the worktree
            should open anyway.
          </li>
        </ol>
      ),
    },
    {
      question: "A new worktree is missing .env or other files",
      answer: (
        <ol>
          <li>
            List them in a <code>.worktreeinclude</code> file at the repo root,
            one pattern per line.
          </li>
          <li>
            Put the files in the project's checkout on that machine. bb copies
            them from there into each new worktree.
          </li>
          <li>Start a new thread.</li>
        </ol>
      ),
    },
    {
      question: "The machine shows as disconnected",
      answer: (
        <ol>
          <li>Check that the machine is on and online.</li>
          <li>
            In <strong>Settings → Machines</strong>, open its menu and choose{" "}
            <strong>Reconnect</strong>.
          </li>
          <li>
            Run the command it shows on the machine. Its threads and worktrees
            are kept.
          </li>
        </ol>
      ),
    },
    {
      question: "My app's sign-in redirects to localhost",
      answer: (
        <ol>
          <li>
            Set the share link, like{" "}
            <code>https://my-server--3001.getbb.app</code>, as your app's base
            URL.
          </li>
          <li>Add it as an allowed redirect URL in your auth provider.</li>
          <li>Restart the dev server.</li>
        </ol>
      ),
    },
    {
      question: "My app's cookies don't stick",
      answer: (
        <p>
          bb connect drops cookies that set a <code>Domain</code> attribute or
          are named <code>better-auth.*</code> or <code>bb-connect.*</code>. Use
          host-only cookies with other names.
        </p>
      ),
    },
  ],
  faq: [
    {
      question: "Does live reload work through the link?",
      answer: (
        <p>
          Yes. bb connect passes WebSockets through, so hot reload works as it
          does on localhost.
        </p>
      ),
    },
    {
      question: "Who can open the link?",
      answer: (
        <p>
          Only you, signed in to your getbb.app account. It isn't public, so
          webhooks and other services can't call it.
        </p>
      ),
    },
    {
      question: "Does it work with my company VPN or Tailscale?",
      answer: (
        <p>
          Yes. Your machines connect out to bb, so you don't open any ports. If
          your work keeps dev servers on a private network, skip the shared
          links and open each server over your VPN or tailnet instead.
        </p>
      ),
    },
    {
      question: "Can my team share these servers?",
      answer: (
        <>
          <p>
            Yes. Run one bb on an always-on machine, like a Linux VM, with{" "}
            <code>npx bb-app@latest</code>, and add your machines to it.
            Everyone then sees the same projects, threads, and terminals. To let
            your Tailscale ACLs decide who gets in, ask an agent on it:
          </p>
          <PromptBlock
            name="Ask the agent"
            prompt="Serve bb on this machine over HTTPS with Tailscale Serve, and set bb's app URL to the tailnet address."
          />
          <p>
            Everyone with access can run commands on every machine, so share it
            only with people you trust.
          </p>
        </>
      ),
    },
    {
      question: "Don't have a machine?",
      answer: (
        <p>
          bb can run machines in your own Modal account. Install the{" "}
          <a href="/marketplace/environment-modal-sandbox">
            Modal Sandbox plugin
          </a>
          , then add a Modal machine in <strong>Settings → Machines</strong>.
        </p>
      ),
    },
    {
      question: "How do I keep a machine from running too many agents?",
      answer: (
        <p>
          Install the{" "}
          <a href="/marketplace/concurrency-limit">Concurrency limit</a> plugin.
          It holds new turns until a running thread finishes, with a limit for
          each machine.
        </p>
      ),
    },
    {
      question: "What happens to a server when I archive its thread?",
      answer: (
        <p>
          Five minutes later, bb removes the worktree and stops everything
          running in it, including the dev server. The branch is kept. Commit a{" "}
          <code>.bb-env-teardown.sh</code> to clean up anything outside the
          worktree, like Docker containers.
        </p>
      ),
    },
    {
      question: "What does it cost?",
      answer: (
        <p>
          bb and bb connect are free. You pay for your machines and agents as
          you do now.
        </p>
      ),
    },
  ],
  closer: {
    title: "Preview every branch",
    body: "Free and open source. Bring the machines and AI plans you already have.",
  },
};
