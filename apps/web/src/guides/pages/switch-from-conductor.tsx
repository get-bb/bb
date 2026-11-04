import { SwitchConcept } from "../concepts";
import { CopyPromptButton, Substeps, Ui } from "../guide-blocks";
import type { Guide } from "../guide-types";
import { withIntake } from "../prompt-intake";
import { AGENTS_FAQ, COST_FAQ } from "../shared/faq";
import {
  CLAUDE_HANDOFF_SHOT,
  THREAD_FAILS_TROUBLESHOOTING,
  missingConversationTroubleshooting,
  whatComesAlongFaq,
} from "../shared/switch";
import { meta } from "./switch-from-conductor.meta";

const ANNOUNCEMENT_URL = "https://www.conductor.build/announcement";

const HANDOFF_PROMPT = `Pick up the work Conductor was doing in this folder and keep going here. 1. Read git log, git status, and git diff against the base branch, and the pull request for this branch if there is one (gh pr view --comments; skip it if gh can't find one). 2. Find the latest Claude Code or Codex conversation for this folder in ~/.claude/projects/ or ~/.codex/sessions/, and only read it. 3. Write me a short handoff: the goal, what's done, the decisions made, and what's left. Wait for my OK before changing anything, and don't push.`;

const AGENT_PROMPT = withIntake(
  [
    {
      label: "Repos",
      hint: "every repo with workspaces in ~/conductor/workspaces/, or only the ones I name",
    },
    {
      label: "Workspaces",
      hint: "all of each repo's Conductor workspaces, or only the ones I name",
    },
    {
      label: "Scripts",
      hint: "move Conductor's setup and archive scripts into bb: yes or no",
    },
  ],
  `Move my Conductor workspaces into bb. Each workspace keeps its folder, branch, and uncommitted changes, and gets its own bb thread that picks up where Conductor left off.
Guide: https://getbb.app/guides/switch-from-conductor

Defaults: every repo, all workspaces, Scripts yes. Don't move, delete, or archive any workspace, don't open Conductor's app data in ~/Library/Application Support/com.conductor.app, and don't commit or push. Folder and branch names can contain spaces and quotes, so pass every value to a command as a quoted shell variable. If a command fails, stop and tell me the command, the error, and what you'd try next.

Part 1: do these steps for each repo.
1. Find the repo's main checkout: run git -C "$workspace" worktree list --porcelain in any of its Conductor workspaces; the first entry is the main checkout. Older repos keep their workspaces in .conductor/ inside the repo, so if ~/conductor/workspaces/ has nothing for a repo I named, ask me where it is.
2. Find its bb project: in bb project list --json, a project whose sources[].path is the main checkout. If there isn't one, add it with bb project create --name "$repo" --root "$checkout" --machine "$host" --json, where $host is environment.hostId from bb thread get --self --json.
   Check: bb project list --json now shows the main checkout.
3. List its Conductor workspaces from git worktree list --porcelain, leaving out the main checkout and folders bb already has (bb environment list --project "$project" --json lists their paths). Show each folder with its branch, whether it has uncommitted changes, and its pull request if any (gh pr list --head "$branch" --state all; if gh can't look it up, say so and carry on).
4. For each workspace I chose, write this prompt to a file in $BB_THREAD_STORAGE:
   "${HANDOFF_PROMPT}"
   Build the inputs JSON with a JSON tool, for example inputs=$(jq -n --arg path "$folder" '{kind:"existing",path:$path}'), then start a thread in that folder:
   bb thread spawn --project "$project" --environment-provider git-worktree --environment-inputs "$inputs" --provider "$provider" --title "$branch" --prompt-file "$file" --json
   where $provider is thread.providerId from bb thread get --self --json.
   Check: bb environment list --project "$project" --json shows that folder.
5. If Scripts is yes, read .conductor/settings.toml and .conductor/settings.local.toml in the main checkout, or conductor.json if neither exists, and write the results in the main checkout:
   - setup goes in .bb-env-setup.sh, which bb runs in each new worktree.
   - archive goes in .bb-env-teardown.sh, which bb runs before it removes a worktree it made.
   - If .bb-env-setup.sh or .bb-env-teardown.sh already exists, show me the current file next to your version and ask before changing it.
   - file_include_globs goes in .worktreeinclude. Keep an existing .worktreeinclude as it is; bb reads the same file. If neither is set, Conductor copied .env* files, so write .env* there.
   - Replace $CONDUCTOR_WORKSPACE_PATH with $PWD, $CONDUCTOR_WORKSPACE_NAME with $(basename "$PWD"), $CONDUCTOR_ROOT_PATH with $(git worktree list --porcelain | sed -n '1s/^worktree //p'), and $CONDUCTOR_DEFAULT_BRANCH with the default branch name.
   - bb doesn't assign ports, so drop port flags like --port $CONDUCTOR_PORT. If a server then falls back to a fixed port, tell me, since two workspaces running it at once would collide.
   - Don't write run scripts anywhere. List them for me.
   - List the names in [environment_variables] for me to add in Settings → Environment variables, without their values.
   - These scripts get committed and shared with everyone on the repo. Never copy tokens, passwords, or other secrets into them, and tell me which lines came from settings.local.toml, which is personal, before you write them.
   Check: bash -n passes on each script. Show me the diff, and remind me that new worktrees pick these files up once I commit them to the base branch.

Part 2: Conductor Cloud. Ask me whether I used it. If I did:
6. Cloud workspaces live on Conductor's servers, not this computer, and Conductor Cloud goes read-only on November 13, 2026 and starts deleting data on November 20, so this can't wait. Ask me to right-click each one in Conductor and choose Transfer to local, wait until I say they're done, then do steps 3 and 4 for them.
7. Ask where I want work that ran in the cloud to run in bb, with one line on each option:
   - This computer, reachable from my phone and any browser with bb connect. Free, but it stops when the computer sleeps. Setup: https://getbb.app/guides/work-from-anywhere
   - An always-on computer or server I add in Settings → Machines.
   - A sandbox plugin. List the ones bb plugin search sandbox shows, such as Modal Sandbox, with one line each from its own description, and say whether it bills an account of mine.
   Set up only what I pick, after I say yes. For a plugin, install it with bb plugin install and tell me where in Settings to connect my account.

Part 3: a Run button. If any repo had run scripts, ask me whether I want a Run button in bb for them, and suggest yes. If I do:
8. Build a small bb plugin. Use the bb-plugin-authoring skill that ships with bb and bb plugin new --help, and scaffold it with bb plugin new run-button in a folder I approve.
   - It adds a Run button to the thread header that opens a terminal in the thread's folder and starts that repo's run command there.
   - Keep each repo's commands in the plugin's settings, filled in from the Conductor run scripts without their port flags.
   - Build it with bb plugin build and install it with bb plugin install <folder>.
   Check: start a terminal in one of the moved threads the same way the button does, and confirm the dev server responds. Then ask me to press Run once to try it, and tell me how to change a command later.

Reply with a table of each repo, workspace, branch, uncommitted changes, and bb thread, without project IDs or folder paths, then the files you wrote, what you set up for Cloud and the Run button, what's left for me, and anything you skipped and why.`,
);

export const guide: Guide = {
  ...meta,
  description:
    "Conductor is joining Meta. Move your Conductor workspaces to bb with one prompt and pick up right where you left off.",
  heroTop: <SwitchConcept tool="conductor" />,
  concept: null,
  agentPrompt: AGENT_PROMPT,
  requirement: null,
  steps: [
    {
      id: "prompt",
      title: "Paste the prompt",
      lead: "Your agent finds your Conductor workspaces, opens each one in its own bb thread, and moves your scripts.",
      body: (
        <Substeps>
          <li>
            Open bb and choose <strong>New thread</strong>.
          </li>
          <li>
            Paste the prompt from <CopyPromptButton /> and send it.
          </li>
          <li>
            Answer the agent's questions about which repos, workspaces, and
            scripts to move, then confirm the plan.
          </li>
        </Substeps>
      ),
      shot: {
        src: "/guides/switch-from-conductor/window-moved-workspaces.webp",
        alt: "A bb thread where the agent reports that three Conductor workspaces are in bb, with a table of repo, workspace, branch, uncommitted changes, and each new bb thread, and the new threads listed in the sidebar",
        width: 2048,
        height: 1280,
      },
      options: [],
    },
    {
      id: "pick-up",
      title: "Pick up each task",
      lead: null,
      body: (
        <Substeps>
          <li>Open one of the new threads.</li>
          <li>
            Read the agent's summary of the task: the goal, what's done, and
            what's left.
          </li>
          <li>
            Correct anything that's wrong, then tell the agent to continue.
          </li>
        </Substeps>
      ),
      shot: CLAUDE_HANDOFF_SHOT,
      options: [],
    },
  ],
  troubleshooting: [
    {
      question: "My Conductor workspaces aren't listed",
      answer: (
        <ol>
          <li>
            bb finds them through the folder Conductor uses for the repo. In{" "}
            <Ui icon="settings">Settings → Projects</Ui>, check that the project
            points at that folder, not another clone.
          </li>
          <li>
            Conductor keeps workspaces in{" "}
            <code>~/conductor/workspaces/&lt;repo&gt;/</code>, or in{" "}
            <code>.conductor/</code> inside older repos.
          </li>
          <li>
            Cloud workspaces aren't on your Mac. In Conductor, right-click one
            and choose <strong>Transfer to local</strong> first.
          </li>
        </ol>
      ),
    },
    missingConversationTroubleshooting("Conductor"),
    THREAD_FAILS_TROUBLESHOOTING,
    {
      question: "My dev server needs CONDUCTOR_PORT",
      answer: (
        <ol>
          <li>
            bb doesn't assign ports, so drop the port flag. Many dev servers
            then pick a free port on their own. If yours always uses the same
            one, ask your agent to start it on a free port.
          </li>
          <li>
            To open it from another device, see{" "}
            <a href="/guides/remote-dev-servers">remote dev servers</a>.
          </li>
        </ol>
      ),
    },
  ],
  faq: [
    {
      question: "Is Conductor shutting down?",
      answer: (
        <p>
          Conductor{" "}
          <a href={ANNOUNCEMENT_URL} rel="noreferrer" target="_blank">
            announced
          </a>{" "}
          on November 4, 2026 that it's joining Meta. New downloads and sign-ups
          are closed. The Mac app keeps working until it winds down in early
          2027. Conductor Cloud goes read-only on November 13 and starts
          deleting data on November 20. Your workspaces can move to bb today
          with one prompt, and bb is open source, so it stays yours.
        </p>
      ),
    },
    {
      question: "What about my Conductor Cloud workspaces?",
      answer: (
        <p>
          The prompt walks you through them. Before November 13, right-click
          each one in Conductor and choose <strong>Transfer to local</strong>,
          and your agent brings it into bb. Then it helps you pick where that
          work runs: your own computer, reachable from your phone, an always-on
          machine, or a cloud sandbox like Modal Sandbox.
        </p>
      ),
    },
    {
      question: "Will bb change anything in Conductor?",
      answer: (
        <p>
          No. bb works in your workspaces where they are and doesn't move
          anything, and archiving a bb thread never deletes a folder bb didn't
          create. Once a workspace is in bb, finish it there and don't archive
          it in Conductor, since both use the same folder.
        </p>
      ),
    },
    whatComesAlongFaq("Conductor"),
    {
      question: "Do my setup, run, and archive scripts come along?",
      answer: (
        <ul>
          <li>
            Setup moves to a <code>.bb-env-setup.sh</code> at the repo root, and
            archive to a <code>.bb-env-teardown.sh</code>. The prompt does both.
          </li>
          <li>
            Files to copy carry over as they are: bb reads the same{" "}
            <code>.worktreeinclude</code>.
          </li>
          <li>
            For run scripts, the prompt offers to build you a Run button: a
            small bb plugin that starts each repo's dev server from the thread.
          </li>
        </ul>
      ),
    },
    {
      question: "What replaces the CONDUCTOR_ environment variables?",
      answer: (
        <p>
          Scripts run in the workspace folder, so <code>$PWD</code> is the
          workspace path. The prompt rewrites the others for you. Add your own
          variables in <Ui icon="settings">Settings → Environment variables</Ui>
          , for every project or just this one.
        </p>
      ),
    },
    {
      question: "Why is bb the best Conductor alternative?",
      answer: (
        <>
          <p>
            Everything you used Conductor for works in bb: agents in parallel,
            each in its own worktree, with setup and archive scripts, diffs, and
            pull requests. Then bb goes further:
          </p>
          <ul>
            <li>
              Agents can use bb just like you can. They start threads, message
              each other, and hear back when work finishes.
            </li>
            <li>
              Every agent works: Claude Code, Codex, Pi, and any ACP agent from
              the registry.
            </li>
            <li>
              It runs on Mac, Windows, and Linux, on any computer you own, from
              a laptop to an always-on server.
            </li>
            <li>You can check in from your phone or any browser, free.</li>
            <li>
              Plugins add what you need, from the marketplace or built by your
              agent.
            </li>
            <li>
              It's free and open source, so your setup never depends on one
              company's plans.
            </li>
          </ul>
          <p>
            Your workspaces move over with one prompt.{" "}
            <a href="/compare/conductor-alternatives">See how bb compares</a>.
          </p>
        </>
      ),
    },
    COST_FAQ,
    AGENTS_FAQ,
  ],
  closer: {
    title: "Get more done with the agents you already use.",
    body: "Run more agents at once, see which one needs you, and let them hand work to each other. Free and open source, on the subscriptions you already have.",
  },
};
