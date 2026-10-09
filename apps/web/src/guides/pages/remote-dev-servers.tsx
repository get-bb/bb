import { RemoteServersConcept } from "../concepts";
import {
  CommandBlock,
  FileBlock,
  PromptBlock,
  Substeps,
  Ui,
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

If a step fails, stop and tell me what you saw. Don't open firewall ports, send localhost links, or share ports I didn't ask for.

1. Check what's needed first. If \`bb connect status\` shows remote access off, ask me to turn on bb connect in Settings. If \`bb machine list\` doesn't show the machine, run \`bb terminal create --thread "$BB_THREAD_ID" --title "Add machine" --command "bb machine create --provider manual"\`, take the install command from \`bb terminal output <terminal-id>\`, and run it on the machine over SSH, or send it to me if you can't reach it.
2. If \`bb project show "$BB_PROJECT_ID"\` has no source on the machine, run \`bb project source add "$BB_PROJECT_ID" --clone --machine <machine>\`.
3. For each branch, start a thread on the machine that starts its own server, all at once:
   bb thread spawn --json --project "$BB_PROJECT_ID" --machine <machine> --new-environment worktree --base-branch <origin/branch, or the local branch if there's no remote> --title "<branch>" --prompt "Start this branch's dev server. Pick a free port, save it as WEB_PORT in .env.local (don't commit it), and run <dev server command> with HOST=127.0.0.1 and PORT set to that port in a bb terminal titled Dev server. Reply with the port once it's listening on 127.0.0.1, or with the error."
4. Wait for each thread with \`bb thread wait\` and read its port with \`bb thread output\`. If a server listens on all interfaces, stop and ask me before changing the app's code.
5. Share each port with \`bb connect expose <port> --host <machine>\`, and check that \`bb connect shares --host <machine>\` lists them all.

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
  agentPrompt: AGENT_PROMPT,
  requirement:
    "a Linux or macOS machine you can SSH into, or Windows with Node.js 22.19+, and a free getbb.app account",
  steps: [
    {
      id: "step-1",
      title: "Add a machine",
      lead: "Run servers on a box with room for all of them, not on your laptop. bb keeps it connected through reboots and updates.",
      body: (
        <Substeps>
          <li>
            Open <Ui icon="settings">Settings → Machines</Ui> and choose{" "}
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
            <Ui icon="settings">Settings → Machines</Ui>.
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
              Open <Ui icon="settings">Settings → Projects</Ui> and choose your
              project.
            </li>
            <li>
              Under <strong>Checkouts</strong>, choose <strong>Set up</strong>{" "}
              next to the new machine.
            </li>
          </Substeps>
          <p>
            Then commit a setup script at the repo root. bb runs it in every new
            worktree, so each branch installs its dependencies and picks free
            ports. Here's an example for a pnpm project; change the install
            command and ports to fit yours:
          </p>
          <FileBlock name="Example: .bb-env-setup.sh" contents={SETUP_SCRIPT} />
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
              Open the side panel <Ui icon="side-panel" /> (⌘ J), choose{" "}
              <Ui icon="plus" />, then <strong>Start terminal</strong>.
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
              Open <Ui icon="settings">Settings → bb connect</Ui> and choose{" "}
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
            <Ui icon="settings">Settings → bb connect</Ui>, where you can copy
            it or stop sharing when the branch is done. Open each link on your
            phone to check its branch.
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
            In <Ui icon="settings">Settings → Machines</Ui>, open its menu and
            choose <strong>Reconnect</strong>.
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
          , then add a Modal machine in{" "}
          <Ui icon="settings">Settings → Machines</Ui>.
        </p>
      ),
    },
    {
      question: "How do I keep a machine from running too many agents?",
      answer: (
        <p>
          The built-in{" "}
          <a href="/marketplace/concurrency-limit">Concurrency limit</a> plugin
          does this by default: each machine runs one thread per processor, and
          new turns wait until a running thread finishes. To change a machine's
          limit, open <Ui icon="settings">Settings → Concurrency limit</Ui>.
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
