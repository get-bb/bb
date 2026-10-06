import CloudIcon from "@hugeicons/core-free-icons/CloudIcon";
import ComputerIcon from "@hugeicons/core-free-icons/ComputerIcon";
import ServerStack01Icon from "@hugeicons/core-free-icons/ServerStack01Icon";

import { RemoteServersConcept } from "../concepts";
import {
  CommandBlock,
  FileBlock,
  MorePath,
  Note,
  OutputBlock,
  ProductShot,
  Substeps,
} from "../guide-blocks";
import type { Guide } from "../guide-types";

const AGENT_PROMPT = `Run a dev server for each branch I name on a remote bb machine, and share each one at its own getbb.app link.
Guide: https://getbb.app/guides/remote-dev-servers

You're in a bb thread, so the bb CLI is on your PATH. Do these steps in order and run each check. If a check fails, stop and tell me what you saw. If I haven't named the branches, ask me first.

1. Find the machine: run \`bb machine list\`.
   Check: a remote machine shows as connected. If none does, stop and ask me to add one in Settings → Machines. That needs SSH access you don't have.

2. Check the project: run \`bb project list\` and confirm this project has a checkout on that machine with a \`.bb-env-setup.sh\` that installs dependencies.
   Check: both exist. If either is missing, tell me what to add.

3. For each branch, start a worktree thread on that machine from that branch:
   bb thread spawn --json --project <project-id> --machine <machine> --new-environment worktree --base-branch origin/<branch> --title "<branch>" --prompt "You run the dev server for <branch>. Reply ready."
   Check: each spawn returns a thread ID. If a thread fails to start its agent, stop and ask me to sign in to that agent on the machine.

4. Start each thread's dev server in a bb terminal on its own free port, listening on 127.0.0.1. Use the project's dev command and pass its port and host flags:
   bb terminal create --thread <thread-id> --title "Dev server" --command "<dev command with port and host>"
   Check: \`bb terminal output <terminal-id>\` shows the server listening on 127.0.0.1 at the port you chose. If it picked another port or host, fix the command and restart the terminal.

5. Share each port:
   bb connect expose <port> --host <machine>
   Check: \`bb connect shares --host <machine>\` lists every port.

Reply with a table of branch, port, and link. Don't open firewall ports, send localhost links, or share ports I didn't ask for.`;

export const REMOTE_DEV_SERVERS: Guide = {
  slug: "remote-dev-servers",
  title: "Run a dev server for every branch",
  description:
    "Put your project on a remote machine, run each branch's server in its own bb terminal, and open every one at a private link from your laptop or phone.",
  blurb: "Run each branch's server on a remote machine, each at its own link.",
  meta: "5 steps · You do steps 1 and 2 once, then your agent does the rest",
  concept: <RemoteServersConcept />,
  overviewNote:
    "Set it up once. After that, ask any agent to start a server and send you the link.",
  handoffNote:
    "After steps 1 and 2, paste it into a bb thread on your project. The agent does the rest, checks each step, and stops when it needs you.",
  agentPrompt: AGENT_PROMPT,
  needs: [
    {
      title: "bb connect",
      icon: CloudIcon,
      body: (
        <>
          Sign in from <strong>Settings → bb connect</strong>, or run{" "}
          <code>bb account login</code>. It's free and serves your links.
        </>
      ),
    },
    {
      title: "A bb that stays on",
      icon: ComputerIcon,
      body: "Remote machines connect to your bb server. If it's a laptop that sleeps, nothing reaches it until it wakes.",
    },
    {
      title: "A remote machine",
      icon: ServerStack01Icon,
      body: (
        <>
          Any Linux or macOS computer you can SSH into, or Windows with Node.js
          22.19+ and Git for Windows. No machine? Use a{" "}
          <a href="#modal">Modal sandbox</a>.
        </>
      ),
    },
  ],
  steps: [
    {
      id: "step-1",
      title: "Add a remote machine",
      who: "you",
      lead: "Install bb's host daemon on the machine. It runs as a service, starts again after a reboot, and updates itself.",
      body: (
        <>
          <Substeps>
            <li>
              Open <strong>Settings → Machines</strong> and choose{" "}
              <strong>Add a machine</strong>.
            </li>
            <li>
              Pick <strong>macOS or Linux</strong> or <strong>Windows</strong>,
              and copy the one-line installer.
            </li>
            <li>Run it on the remote machine over SSH.</li>
            <li>
              Sign in to the agents you use there once, with <code>claude</code>{" "}
              or <code>codex login</code>. Open a shell on the machine from bb:
            </li>
          </Substeps>
          <ProductShot
            src="/guides/remote-dev-servers/add-a-machine.png"
            alt="The Add a machine dialog with the macOS or Linux installer command and a Copy button"
            caption={
              <>
                Copy the installer from <strong>Add a machine</strong>. It
                expires after 15 minutes.
              </>
            }
            ring={{ left: 81.8, top: 65.5, width: 11.3, height: 10.2 }}
          />
          <CommandBlock command="bb terminal create --machine bb-worker-1 --cwd ~ --attach" />
          <p>Then check that the machine connected:</p>
          <CommandBlock command="bb machine list" />
          <OutputBlock>
            {
              "Name         Role    ID               Type        Status     Provider       Last seen\n-----------  ------  ---------------  ----------  ---------  -------------  ---------\nMacBook Air  server  host_2tncec6ueq  persistent  connected  user-enrolled  just now\nbb-worker-1          host_tf5jtfdeua  persistent  "
            }
            <b>connected</b>
            {"  user-enrolled  just now"}
          </OutputBlock>
          <MorePath id="modal" title="No machine? Use a Modal sandbox">
            <p>
              Modal Sandbox is built into bb and runs machines in your own{" "}
              <a href="https://modal.com" target="_blank" rel="noreferrer">
                Modal
              </a>{" "}
              account. Add your Modal token in its plugin settings, then create
              a machine from it. Sandboxes hibernate after 15 idle minutes,
              which stops their servers. Set{" "}
              <strong>Hibernate after idle</strong> to <code>0</code> to keep
              one running, up to Modal's 24-hour limit.
            </p>
            <CommandBlock command="bb machine create --provider modal-sandbox" />
          </MorePath>
        </>
      ),
      doneWhen: (
        <>
          your machine shows as <code>connected</code> and your agents are
          signed in there.
        </>
      ),
    },
    {
      id: "step-2",
      title: "Add your project",
      who: "you",
      lead: "Point a bb project at the repo on that machine, and tell bb how to set up each new worktree.",
      body: (
        <>
          <Substeps>
            <li>
              Choose <strong>New project</strong> in the project picker, and
              pick the remote machine.
            </li>
            <li>
              Browse to the repo's folder. Already have the project? Add a path
              for that machine in its settings.
            </li>
          </Substeps>
          <ProductShot
            src="/guides/remote-dev-servers/new-project-machine.png"
            alt="The Add project dialog with its machine menu open and bb-worker-1 selected"
            caption={
              <>
                <strong>Add project</strong> browses folders on the machine you
                pick.
              </>
            }
            ring={{ left: 5.2, top: 29.6, width: 89.6, height: 5.8 }}
          />
          <p>
            Commit a setup script at the repo root. bb runs it in every new
            worktree before the agent starts:
          </p>
          <FileBlock
            name=".bb-env-setup.sh"
            contents={"#!/usr/bin/env bash\nset -euo pipefail\npnpm install"}
          />
          <Note title="Untracked files?">
            List the ones each worktree needs, like <code>.env</code>, in a{" "}
            <code>.worktreeinclude</code> file at the repo root. bb copies them
            in.
          </Note>
        </>
      ),
      doneWhen: "the project lists the remote machine in its settings.",
    },
    {
      id: "step-3",
      title: "Start a thread per branch",
      who: "agent",
      lead: "Each thread gets its own Git worktree on the machine, so servers never step on each other.",
      body: (
        <>
          <Substeps>
            <li>
              Start a new thread, pick the remote machine, and choose{" "}
              <strong>Worktree</strong>.
            </li>
            <li>Repeat for each branch.</li>
          </Substeps>
          <CommandBlock
            label="Or from the CLI"
            command={
              'bb thread spawn --project <project-id> --machine bb-worker-1 \\\n    --new-environment worktree --base-branch origin/feat/checkout \\\n    --prompt "..."'
            }
          />
          <p>
            <code>--base-branch</code> starts the worktree from an existing
            branch. Find the project ID with <code>bb project list</code>.
          </p>
        </>
      ),
      doneWhen: (
        <>
          <code>bb status</code> in each thread shows a worktree environment.
        </>
      ),
    },
    {
      id: "step-4",
      title: "Run each dev server",
      who: "agent",
      lead: "A bb terminal is a real shell on the machine. It keeps running after you close the tab or the agent finishes.",
      body: (
        <>
          <Substeps>
            <li>
              In the thread's side panel, choose <strong>+</strong>, then{" "}
              <strong>Start terminal</strong>.
            </li>
            <li>Start the server on a port no other thread uses:</li>
          </Substeps>
          <ProductShot
            src="/guides/remote-dev-servers/start-terminal.png"
            alt="A thread's side panel with a Dev server tab, and a new tab listing Start terminal"
            caption={
              <>
                <strong>Start terminal</strong> opens a shell in the thread's
                worktree, next to its other tabs.
              </>
            }
            ring={{ left: 2.2, top: 34.4, width: 21, height: 11.6 }}
          />
          <CommandBlock command="PORT=3001 pnpm dev" />
          <CommandBlock
            label="Or from the CLI"
            command={
              'bb terminal create --thread <thread-id> \\\n    --title "Dev server" --command "PORT=3001 pnpm dev"'
            }
          />
          <Note title="One port per server, on 127.0.0.1." warn>
            bb doesn't assign ports, so give each server its own (3001, 3002,
            and so on). If a link later shows a connection error, start the
            server with <code>--host 127.0.0.1</code>.
          </Note>
        </>
      ),
      doneWhen: (
        <>
          the terminal shows the server listening on <code>127.0.0.1:3001</code>
          .
        </>
      ),
    },
    {
      id: "step-5",
      title: "Share each port",
      who: "agent",
      lead: "bb connect gives every port its own link. No firewall rules, no DNS. The machine connects out.",
      body: (
        <>
          <CommandBlock command="bb connect expose 3001" />
          <OutputBlock>
            <b>https://bb-worker-1--3001.getbb.app</b>
          </OutputBlock>
          <p>
            Run it from the thread that started the server, or add{" "}
            <code>--host &lt;machine&gt;</code>. Links open only for people
            signed in to your getbb.app account. When a branch is done, run{" "}
            <code>bb connect unexpose 3001</code>.
          </p>
        </>
      ),
      doneWhen: (
        <>
          <code>bb connect shares --host bb-worker-1</code> lists every port.
        </>
      ),
    },
  ],
  sections: [
    {
      id: "team",
      title: "Share with your team",
      body: (
        <>
          <p>
            Run one bb for everyone. Put the bb server on an always-on machine,
            pair it with a getbb.app account your team signs in to, and add your
            machines. Everyone sees the same threads, can step into a
            colleague's thread, and can open every link.
          </p>
          <Note title="Everyone signed in gets a shell on every machine." warn>
            Share it only with people you trust.
          </Note>
        </>
      ),
    },
  ],
  prompts: [
    "Start the dev server on a free port in a bb terminal, share it with bb connect, and send me the link.",
    "Start a worktree thread on bb-worker-1 for each open PR, and run each one's dev server.",
    "List the ports shared on bb-worker-1 and unexpose any whose branch has merged.",
  ],
  faq: [
    {
      question: "How many dev servers can I run?",
      answer: (
        <p>
          bb doesn't set a limit. The machine's CPU and memory do, so add
          another machine when one fills up.
        </p>
      ),
    },
    {
      question: "Can I use this from my phone?",
      answer: (
        <p>
          Yes. Open your getbb.app address in your phone's browser. Terminals
          and links work there too.
        </p>
      ),
    },
    {
      question: "Do the links work for other people?",
      answer: (
        <p>
          Only for people signed in to the same getbb.app account. A team can
          share one bb and one account.
        </p>
      ),
    },
    {
      question: "What happens when I'm done with a branch?",
      answer: (
        <p>
          Archive its threads. bb removes the worktree it created, and runs{" "}
          <code>.bb-env-teardown.sh</code> first if you committed one. Unexpose
          the port too.
        </p>
      ),
    },
    {
      question: "What does it cost?",
      answer: (
        <p>
          bb and bb connect are free. You pay for the remote machine and your
          agents.
        </p>
      ),
    },
  ],
  related: [
    "steer-coding-agents-from-your-phone",
    "claude-code-and-codex-together",
  ],
  closer: {
    title: "Run every branch at once",
    body: "Free and open source. Bring the machines and AI plans you already have.",
  },
};
