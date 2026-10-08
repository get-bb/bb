import CloudIcon from "@hugeicons/core-free-icons/CloudIcon";
import ComputerIcon from "@hugeicons/core-free-icons/ComputerIcon";
import ServerStack01Icon from "@hugeicons/core-free-icons/ServerStack01Icon";

import { RemoteServersConcept } from "../concepts";
import {
  CommandBlock,
  FileBlock,
  MorePath,
  Note,
  ProductShot,
  PromptBlock,
  Substeps,
} from "../guide-blocks";
import type { Guide } from "../guide-types";

const AGENT_PROMPT = `Run a dev server for each branch I name on a remote bb machine, and share each one at its own getbb.app link.
Guide: https://getbb.app/guides/remote-dev-servers

You're in a bb thread, so the bb CLI is on your PATH. Do these steps in order and run each check. If a check fails, stop and tell me what you saw. If I haven't named the branches or the machine, ask me first.

1. Find or add the machine: run \`bb machine list\`. If the machine I named isn't there, run \`bb machine create --provider manual\` and run the one-time command it prints on that machine over SSH.
   Check: \`bb machine list\` shows the machine as connected. If you can't reach it over SSH, stop and send me the command to run there.

2. Add the project to the machine, unless it already has a source there:
   bb project source add "$BB_PROJECT_ID" --clone --machine <machine>
   Then check that the repo has a committed \`.bb-env-setup.sh\` that installs dependencies and writes free ports to \`.env.local\`. If it doesn't, write one from the guide, show it to me, and commit it once I agree.
   Check: \`bb project show "$BB_PROJECT_ID"\` lists a source on the machine.

3. For each branch, start a worktree thread on that machine:
   bb thread spawn --json --project "$BB_PROJECT_ID" --machine <machine> --new-environment worktree --base-branch origin/<branch> --title "<branch>" --prompt "You run the dev server for <branch>. Reply ready."
   Check: each spawn returns a thread ID. If a thread fails to start its agent, stop and ask me to sign in to that agent on the machine.

4. Start each thread's dev server in a bb terminal, on the ports in its \`.env.local\`, listening on 127.0.0.1:
   bb terminal create --thread <thread-id> --title "Dev server" --command "set -a; . ./.env.local; set +a; <dev command with its port and host flags>"
   Check: \`bb terminal output <terminal-id>\` shows the server listening on 127.0.0.1 at that port.

5. Share each port:
   bb connect expose <port> --host <machine>
   Check: \`bb connect shares --host <machine>\` lists every port.

Reply with a table of branch, port, and link. Don't open firewall ports, send localhost links, or share ports I didn't ask for.`;

const SETUP_SCRIPT = `#!/usr/bin/env bash
set -euo pipefail
pnpm install
free_port() { node -e 'const s=require("net").createServer().listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})'; }
printf 'WEB_PORT=%s\\nAPI_PORT=%s\\n' "$(free_port)" "$(free_port)" > .env.local`;

const TEARDOWN_SCRIPT = `#!/usr/bin/env bash
set -euo pipefail
docker compose down`;

export const REMOTE_DEV_SERVERS: Guide = {
  slug: "remote-dev-servers",
  title: "Run a dev server for every branch",
  description:
    "Every agent's branch gets its own dev server and port, reloading as the agent codes. Open any of them from your phone at a private link, no VPN needed.",
  concept: <RemoteServersConcept />,
  picker: null,
  handoffNote:
    "Paste it into a bb thread on your project. Your agent runs every step and stops if it needs you.",
  agentPrompt: AGENT_PROMPT,
  needs: [
    {
      title: "A remote machine",
      icon: ServerStack01Icon,
      body: (
        <>
          Any Linux or macOS computer you can SSH into, or Windows with Node.js
          22.19+. No machine? Use a <a href="#modal">Modal sandbox</a>.
        </>
      ),
    },
    {
      title: "bb connect",
      icon: CloudIcon,
      body: (
        <>
          Sign in from <strong>Settings → bb connect</strong>, or run{" "}
          <code>bb account login</code>. It's free.
        </>
      ),
    },
    {
      title: "A bb that stays on",
      icon: ComputerIcon,
      body: "Remote machines connect to your bb server, so keep it running.",
    },
  ],
  steps: [
    {
      id: "step-1",
      title: "Add a remote machine",
      lead: "bb installs a small service on the machine. It starts again after a reboot and updates itself.",
      body: (
        <>
          <Substeps>
            <li>
              Open <strong>Settings → Machines</strong> and choose{" "}
              <strong>Add a machine</strong>.
            </li>
            <li>Copy the installer and run it on the machine over SSH.</li>
            <li>Sign in to your agents on that machine once.</li>
          </Substeps>
          <ProductShot
            src="/guides/remote-dev-servers/add-a-machine.png"
            alt="The Add a machine dialog with the macOS or Linux installer command and a Copy button"
          />
          <MorePath id="modal" title="No machine? Use a Modal sandbox">
            <p>
              bb can run machines in your own Modal account. Install the{" "}
              <a href="/marketplace/environment-modal-sandbox">
                Modal Sandbox plugin
              </a>{" "}
              from <strong>Plugins</strong>, and add a Modal machine from{" "}
              <strong>Settings → Machines</strong>.
            </p>
          </MorePath>
        </>
      ),
      doneWhen: "the machine shows as connected in Settings → Machines.",
    },
    {
      id: "step-2",
      title: "Add your project",
      lead: "Put the repo on the machine, and give every new worktree its own setup.",
      body: (
        <>
          <p>
            Choose <strong>New project</strong>, pick the remote machine, and
            browse to the repo. Already have the project? Add the machine in its
            settings.
          </p>
          <ProductShot
            src="/guides/remote-dev-servers/new-project-machine.png"
            alt="The Add project dialog with its machine menu open and bb-worker-1 selected"
          />
          <p>
            Commit a setup script at the repo root. bb runs it in every new
            worktree, so each branch picks its own free ports:
          </p>
          <FileBlock name=".bb-env-setup.sh" contents={SETUP_SCRIPT} />
          <p>And a teardown script. bb runs it before it removes a worktree:</p>
          <FileBlock name=".bb-env-teardown.sh" contents={TEARDOWN_SCRIPT} />
        </>
      ),
      doneWhen: "the project lists a source on the remote machine.",
    },
    {
      id: "step-3",
      title: "Start a thread per branch",
      lead: "Each thread gets its own Git worktree on the machine, so servers never step on each other.",
      body: (
        <>
          <Substeps>
            <li>
              Choose <strong>New thread</strong> and <strong>Worktree</strong>.
              If the project is on more than one machine, pick the remote one.
            </li>
            <li>
              In <strong>Branch from</strong>, pick the branch, and describe the
              work.
            </li>
            <li>Repeat for each branch.</li>
          </Substeps>
          <ProductShot
            src="/guides/remote-dev-servers/new-thread-worktree.png"
            alt="A new bb thread with Worktree and Branch from picked, and a task to fix the checkout page and start the dev server"
          />
        </>
      ),
      doneWhen: "each thread shows its own branch and worktree.",
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
            <li>Start the server on the ports its setup picked:</li>
          </Substeps>
          <ProductShot
            src="/guides/remote-dev-servers/start-terminal.png"
            alt="A thread's side panel with a Dev server tab, and a new tab listing Start terminal"
          />
          <CommandBlock
            command={
              'set -a; . ./.env.local; set +a\npnpm dev --host 127.0.0.1 --port "$WEB_PORT"'
            }
          />
        </>
      ),
      doneWhen: (
        <>
          the terminal shows the server listening on <code>127.0.0.1</code> at
          its port.
        </>
      ),
    },
    {
      id: "step-5",
      title: "Share each port",
      lead: "bb connect gives each port its own private link, and live reload works through it.",
      body: (
        <>
          <p>Ask the thread's agent to share the port:</p>
          <PromptBlock
            name="Ask the agent"
            prompt="Share port 3001 on this machine with bb connect and give me the link."
          />
          <p>
            It replies with a link like{" "}
            <code>https://bb-worker-1--3001.getbb.app</code>. Every shared port
            is listed in <strong>Settings → bb connect</strong>, where you can
            copy or stop sharing it when a branch is done.
          </p>
        </>
      ),
      doneWhen: "every branch's port is listed in Settings → bb connect.",
    },
  ],
  sections: [
    {
      id: "team",
      title: "Share with your team",
      body: (
        <>
          <p>
            Teams usually run one bb on an always-on machine and share it.
            Everyone sees the same projects, threads, terminals, and links.
          </p>
          <h3 className="gd-h3">Put bb on an always-on machine</h3>
          <p>
            Use a Linux VM or a desktop that stays on, and start bb there. Then
            add your remote machines to it, as in step 1.
          </p>
          <CommandBlock command="npx bb-app@latest" />
          <h3 className="gd-h3">Give your team access</h3>
          <p>
            Keep bb on your tailnet, and let your Tailscale ACLs decide who gets
            in. Your agent can set it up:
          </p>
          <PromptBlock
            name="Ask the agent"
            prompt="Serve bb on this machine over HTTPS with Tailscale Serve, and set bb's app URL to the tailnet address."
          />
          <Note
            title="Everyone with access can run commands on every machine."
            warn
          >
            Share it only with people you trust.
          </Note>
        </>
      ),
    },
  ],
  faqTitle: "Troubleshooting",
  faq: [
    {
      question: "Why does the link show a connection error?",
      answer: (
        <p>
          The server isn't listening where bb connect looks. Check the dev
          server's terminal tab, and start the server on <code>127.0.0.1</code>{" "}
          at the port you shared.
        </p>
      ),
    },
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
      question: "What if my app's sign-in redirects to localhost?",
      answer: (
        <p>
          Set the share link, like{" "}
          <code>https://bb-worker-1--3001.getbb.app</code>, as your app's base
          URL and as an allowed redirect URL in your auth provider.
        </p>
      ),
    },
    {
      question: "Why don't my app's cookies stick?",
      answer: (
        <p>
          bb connect drops cookies that set a <code>Domain</code> attribute or
          are named <code>better-auth.*</code> or <code>bb-connect.*</code>.
          Other host-only cookies work.
        </p>
      ),
    },
    {
      question: "Can webhooks or other services call the link?",
      answer: (
        <p>No. It opens only for you, signed in to your getbb.app account.</p>
      ),
    },
    {
      question: "Why is a new worktree missing .env or other files?",
      answer: (
        <p>
          List them in a <code>.worktreeinclude</code> file at the repo root. bb
          copies matching files from the project's checkout on that machine, so
          put them there first.
        </p>
      ),
    },
    {
      question: "How do I keep a machine from running too many agents?",
      answer: (
        <p>
          Use the <a href="/marketplace/concurrency-limit">Concurrency limit</a>{" "}
          plugin. It holds new turns until a running thread finishes. Set a
          limit for each machine in its settings.
        </p>
      ),
    },
    {
      question: "Can I run a server without an agent?",
      answer: (
        <p>
          Yes. Open the thread's side panel, choose <strong>+</strong>, then{" "}
          <strong>Start terminal</strong>, and run the server yourself. The
          agent doesn't have to do anything.
        </p>
      ),
    },
  ],
  closer: {
    title: "Preview every branch",
    body: "Free and open source. Bring the machines and AI plans you already have.",
  },
};
