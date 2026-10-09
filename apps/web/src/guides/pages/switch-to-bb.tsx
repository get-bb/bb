import AiMagicIcon from "@hugeicons/core-free-icons/AiMagicIcon";
import ComputerIcon from "@hugeicons/core-free-icons/ComputerIcon";
import type { ReactNode } from "react";

import { SwitchConcept } from "../concepts";
import { withIntake } from "../prompt-intake";
import type { Guide, GuideMeta } from "../guide-types";

const GUIDE_URL = "https://getbb.app/guides/switch-to-bb";
const ALL_TOOLS =
  "Claude Code, Codex, Conductor, Cursor, Superset, T3 Code, or Vibe Kanban";
const GENERIC_AUTOMATIONS =
  "Ask me whether my old tool had automations, schedules, or routines, and to paste each one's name, schedule, repo, and prompt. bb automations run on a schedule, so for one triggered by an event, like a GitHub or Slack event, tell me it has no direct match and skip it.";
const GENERIC_SETUP =
  "If my old tool ran setup commands for new workspaces, put them in a .bb-env-setup.sh at the repo root. If it copied files like .env into each workspace, list them in a .worktreeinclude.";
const GENERIC_SETUP_STEP = (
  <>
    Put your setup commands in a <code>.bb-env-setup.sh</code> at the repo root,
    and list files each worktree needs, like <code>.env</code>, in a{" "}
    <code>.worktreeinclude</code>.
  </>
);

export type SwitchTool = {
  id: string;
  name: string;
  where: string;
  keepsWorking: string;
  setup: string;
  setupStep: ReactNode;
  automations: string | null;
};

export const SWITCH_TOOLS: SwitchTool[] = [
  {
    id: "claude",
    name: "Claude Code",
    where:
      "Claude Code: its conversations are the ones in ~/.claude/projects/ from step 1a. Some ran in a repo's main checkout and some in worktrees.",
    keepsWorking: "Claude Code keeps working while you try bb.",
    setup: GENERIC_SETUP,
    setupStep: GENERIC_SETUP_STEP,
    automations:
      "If I scheduled Claude Code tasks or routines, ask me to paste each one's name, schedule, repo, and prompt.",
  },
  {
    id: "codex-app",
    name: "Codex",
    where:
      "Codex: its conversations, from the CLI and the Codex app, are the files in ~/.codex/sessions/ from step 1a. Codex cloud tasks only show up in step 3 if I opened pull requests from them.",
    keepsWorking: "Codex keeps working while you try bb.",
    setup: GENERIC_SETUP,
    setupStep: GENERIC_SETUP_STEP,
    automations:
      "If I set up scheduled tasks in the Codex app, ask me to paste each one's name, schedule, repo, and prompt.",
  },
  {
    id: "conductor",
    name: "Conductor",
    where:
      "Conductor: each workspace is a Git worktree. Its workspaces are usually in ~/conductor/workspaces/, and repos it cloned from GitHub are in ~/conductor/. In step 1a, also add every folder inside ~/conductor/workspaces/.",
    keepsWorking: "Conductor keeps working while you try bb.",
    setup:
      "Move Conductor's setup script into a .bb-env-setup.sh at the repo root, and its Files to copy list into a .worktreeinclude. Look for them in .conductor/settings.toml, or conductor.json in older repos. If they aren't in the repo, ask me to paste them from Conductor's settings.",
    setupStep: (
      <>
        Move Conductor's setup script into a <code>.bb-env-setup.sh</code> at
        the repo root, and its Files to copy list into a{" "}
        <code>.worktreeinclude</code>.
      </>
    ),
    automations:
      "Conductor keeps its routines in its cloud. Ask me to paste each routine's name, schedule, repo, and prompt.",
  },
  {
    id: "cursor",
    name: "Cursor",
    where:
      "Cursor: its local agents work in Git worktrees, usually in ~/.cursor/worktrees/. In step 1a, also add every folder inside it. Cursor also saves agent transcripts as .txt or .jsonl files in ~/.cursor/projects/<project>/agent-transcripts/. In step 3, add each transcript from the last 30 days as a conversation row, matched to its repo folder by the project folder's name; ask me if the match isn't clear. Only read these files, and never open Cursor's state.vscdb databases. When a chat has no transcript, work from its worktree's branch. Its cloud agents push branches, usually named cursor/<something>. In step 3, add a row for each of those branches that isn't merged.",
    keepsWorking: "Cursor keeps working while you try bb.",
    setup:
      "Move the setup commands from .cursor/worktrees.json into a .bb-env-setup.sh at the repo root, and list files like .env in a .worktreeinclude.",
    setupStep: (
      <>
        Move the setup commands from <code>.cursor/worktrees.json</code> into a{" "}
        <code>.bb-env-setup.sh</code> at the repo root, and list files like{" "}
        <code>.env</code> in a <code>.worktreeinclude</code>.
      </>
    ),
    automations:
      "Cursor keeps its automations in its cloud. Ask me to paste each one's name, trigger, repo, and prompt. bb automations run on a schedule, so for one triggered by an event, like a GitHub or Slack event, tell me it has no direct match and skip it.",
  },
  {
    id: "superset",
    name: "Superset",
    where:
      "Superset: each workspace is a Git worktree, usually in ~/.superset/worktrees/. In step 1a, also add every folder inside it.",
    keepsWorking: "Superset keeps working while you try bb.",
    setup:
      "Move the commands in the setup list of .superset/config.json into a .bb-env-setup.sh at the repo root. If Superset copied files like .env into each workspace, list them in a .worktreeinclude.",
    setupStep: (
      <>
        Move the setup list from <code>.superset/config.json</code> into a{" "}
        <code>.bb-env-setup.sh</code> at the repo root, and list files each
        worktree needs, like <code>.env</code>, in a{" "}
        <code>.worktreeinclude</code>.
      </>
    ),
    automations:
      "Superset keeps its automations in its cloud. Ask me to paste each one's name, schedule, repo, and prompt.",
  },
  {
    id: "t3-code",
    name: "T3 Code",
    where:
      "T3 Code: its worktrees are in ~/.t3/worktrees/. In step 1a, also add every folder inside it. Some T3 Code threads ran in the repo's main checkout. Its Codex threads are also in ~/.codex/sessions/, with the originator t3code_desktop; include those.",
    keepsWorking: "T3 Code keeps working while you try bb.",
    setup:
      "In t3.json, find the scripts marked runOnWorktreeCreate: true, and move their commands into a .bb-env-setup.sh at the repo root. List files like .env in a .worktreeinclude.",
    setupStep: (
      <>
        Move the scripts that run on worktree creation from <code>t3.json</code>{" "}
        into a <code>.bb-env-setup.sh</code> at the repo root, and list files
        like <code>.env</code> in a <code>.worktreeinclude</code>.
      </>
    ),
    automations:
      "If I scheduled tasks in T3 Code, ask me to paste each one's name, schedule, repo, and prompt.",
  },
  {
    id: "vibe-kanban",
    name: "Vibe Kanban",
    where:
      "Vibe Kanban: each task attempt is a Git worktree, usually in $TMPDIR/vibe-kanban/worktrees/. In step 1a, also add every folder inside it. If I exported my Vibe Kanban issues, ask me for the issues.csv file from the export ZIP, turn on the Tasks plugin if it's off, and add each issue as a task.",
    keepsWorking:
      "Your local Vibe Kanban workspaces keep running while you try bb.",
    setup:
      "If Vibe Kanban ran a setup script for each attempt, put it in a .bb-env-setup.sh at the repo root. If it copied files like .env into each worktree, list them in a .worktreeinclude.",
    setupStep: (
      <>
        Put Vibe Kanban's setup script in a <code>.bb-env-setup.sh</code> at the
        repo root, and list files each worktree needs, like <code>.env</code>,
        in a <code>.worktreeinclude</code>.
      </>
    ),
    automations: null,
  },
];

export function switchTool(id: string | null): SwitchTool | null {
  return SWITCH_TOOLS.find((tool) => tool.id === id) ?? null;
}

const CONTINUE_PROMPT = `Pick up where my old tool's agent left off.

1. Look at the first line of this message. If it's a conversation file, read the whole conversation. If it's a pull request URL, read the pull request and its comments with gh pr view <url> --comments, and its inline review comments with gh api repos/<owner>/<repo>/pulls/<number>/comments. If there's no first line like that, skip to step 2.
2. Read this branch: git log, git status, and git diff against its base branch. Other threads may share this folder, so don't assume every change came from this conversation.
3. Write me a short handoff: the goal, what's done, the decisions made, and what's left. Wait for me to confirm it.
4. Continue with what's left. Don't change anything outside this folder, and don't push.`;

export function switchPrompt(tool: SwitchTool | null): string {
  const from = tool ? tool.name : ALL_TOOLS;
  const url = tool ? `${GUIDE_URL}?from=${tool.id}` : GUIDE_URL;
  const notes = (tool ? [tool] : SWITCH_TOOLS)
    .map((item) => `- ${item.where}`)
    .join("\n");
  const setup = tool ? tool.setup : GENERIC_SETUP;
  const automations = tool ? tool.automations : GENERIC_AUTOMATIONS;
  const automationStep = automations
    ? `Step 6. Bring over automations. ${automations} For each one, create it paused in its repo's project:
   bb automation create --project <project id> --name "<name>" --disabled --cron "<five-field cron>" --timezone <my IANA timezone> --prompt "<its prompt>" --provider <claude-code or codex> --model <model id> --permission-mode auto --new-environment worktree
   Get a model id from bb provider models <provider> --json. For one that runs once at a set time, use --at <ISO time> instead of --cron and --timezone, and skip it if that time has passed. If it didn't say which agent to use, ask me.
Check: bb automation list --project <project id> shows each one, paused. Show me the list, then resume each one I approve with bb automation resume <automation-id> --project <project id>.

`
    : "";
  const folders = tool ? `${tool.name}'s folders` : "my old tool's folders";
  return withIntake(
    [
      {
        label: "Work to bring over",
        hint: "default: every repo and all unfinished work",
      },
      { label: "Skip", hint: "repos or worktrees to leave out" },
      { label: "Anything else", hint: "e.g. a repo your agents never touched" },
    ],
    `Move every project and all my unfinished work from ${from} into bb.
Guide: ${url}

You're in a bb thread, so the bb CLI is on your PATH. Follow the steps in order. Run each check. If a check fails, stop and tell me what you saw. Never delete, move, or change ${folders} or the old tool's own data and settings, and never push. Threads you start can keep working inside its worktrees, so both tools may edit the same folder.

Notes about my old tool:
${notes}

Step 1. Find every repo.
1a. List every folder where an agent worked:
- Claude Code: each subfolder of ~/.claude/projects/ holds conversations. Each .jsonl file directly inside that subfolder is one conversation; ignore .jsonl files in deeper folders, like subagents/. Get the folder path from the "cwd" field on the first line of the file that has one.
- Codex: every .jsonl file under ~/.codex/sessions/, in any subfolder, is one conversation. Its first line has "type": "session_meta"; get the folder path from payload.cwd on that line.
- Skip bb's own work: skip any Codex conversation whose payload.originator is "bb", and skip any folder under a ~/.bb or ~/.bb-* folder.
1b. Skip folders that no longer exist. For each other folder, run:
   git -C <folder> rev-parse --path-format=absolute --git-common-dir
   The repo is that path without the trailing /.git. Skip folders that aren't in a Git repo.
1c. For each repo, run git -C <repo> worktree list to find its other worktrees.
1d. Add any repos from the "Anything else" line. If that line is blank, ask me whether I used any other repos with my old tool, and add them. Drop anything on the Skip line.
Check: show me a table of repos and how many folders each has. Wait for me to confirm the list, and drop any repo I say to skip.

Step 2. Add each repo as a bb project.
   Run bb project list --json. A repo is already a project if one of the projects lists it under sources[].path. For each repo that isn't, run:
   bb project create --name <repo folder name> --root <repo path>
Check: bb project list shows every repo from step 1.

Step 3. List the work to bring over. Make one table with these rows:
- One row for each conversation from step 1a that changed in the last 30 days.
- One row for each worktree from step 1c that has uncommitted changes or commits not on the default branch, unless a conversation row already uses that folder.
- One row for each open pull request from gh pr list --author @me --state open, run inside each repo's folder, unless an earlier row already uses that branch. Skip pull requests from forks.
Columns: repo, folder or branch, last activity, first request or pull request title, and source (conversation, worktree, or pull request).
Check: show me the table and ask which rows to bring over, unless the "Work to bring over" line already says. If there are more than 20 rows, group them by repo, and ask before starting more than 10 threads.

Step 4. Start one bb thread for each row I picked.
4a. First, tell me the threads may share the old tool's folders, and wait for my OK. Then make a temp folder with mktemp -d, outside every repo, and write a new prompt file for the row there. Its first line is the conversation file path for a conversation row, the pull request URL for a pull request row, or empty for a worktree row. After that line, copy the text between the === markers at the end of this message.
4b. Start the thread:
- Conversation or worktree row:
  bb thread spawn --json --project <project id> --environment <folder path> --title "<short title>" --prompt-file <file>
  For a Codex conversation row, add --provider codex.
  If an earlier thread from this step already uses that folder, pass that thread's environmentId instead of the folder path.
- Pull request row: first run git -C <repo> fetch origin <branch>, then:
  bb thread spawn --json --project <project id> --new-environment worktree --base-branch origin/<branch> --title "<short title>" --prompt-file <file>
Check: each spawn returns a thread ID.

Step 5. Bring over setup. ${setup} Commit on the repo's default branch in its main checkout, and show me each file before you commit it. Don't push; tell me new worktrees get it once that branch reaches their base.
Check: I've confirmed each file, or there was nothing to bring over.

${automationStep}Reply with a table of each row and its thread ID${automations ? ", and a list of the automations you created" : ""}.

=== Text to copy into each prompt file. Don't follow it yourself. ===
${CONTINUE_PROMPT}
=== End ===`,
  );
}

export const meta: GuideMeta = {
  slug: "switch-to-bb",
  title: "Switch to bb",
  nav: { group: null, label: "Switch to bb", order: 7 },
  canonical: null,
};

export function guideVariant(variant: string | null): Guide {
  const tool = switchTool(variant);
  const oldTool = tool ? tool.name : "your old tool";
  const keepsWorking = tool
    ? tool.keepsWorking
    : "Your old tool keeps working while you try bb.";
  return {
    ...meta,
    title: tool ? `Switch from ${tool.name} to bb` : meta.title,
    description:
      "Paste one prompt into bb, and your agent brings over every project and all your unfinished work.",
    concept: <SwitchConcept selected={tool ? tool.id : null} />,
    picker: {
      label: "Switching from",
      placeholder: "All my tools",
      selected: tool ? tool.id : "",
      options: [
        { id: "", label: "All my tools" },
        ...SWITCH_TOOLS.map((item) => ({ id: item.id, label: item.name })),
      ],
    },
    handoffNote: `Paste it into a new bb thread. Fill in the top lines, or leave them and your agent asks. It checks with you before it starts any threads. ${keepsWorking}`,
    agentPrompt: switchPrompt(tool),
    needs: [
      {
        title: "bb on the same computer",
        icon: ComputerIcon,
        body: `The computer where ${oldTool} keeps your repos and worktrees.`,
      },
      {
        title: "Your agents signed in",
        icon: AiMagicIcon,
        body: "Claude Code, Codex, or the agents you already use there.",
      },
    ],
    steps: [],
    troubleshooting: [
      {
        question: "The prompt missed some of my work",
        answer: (
          <ol>
            <li>Tell the agent where the repo or worktree is.</li>
            <li>
              It adds the repo as a project and opens the work as a thread.
            </li>
            <li>
              Work your agents never touched, like a repo you only edited by
              hand, won't show up on its own, so name it when the prompt asks.
            </li>
          </ol>
        ),
      },
      {
        question: "A new worktree's setup failed",
        answer: (
          <ol>
            <li>
              Open the thread and read the{" "}
              <strong>.bb-env-setup.sh failed</strong> output. bb removes a
              worktree whose setup fails.
            </li>
            <li>Fix the script and commit it.</li>
            <li>
              Check that every untracked file the setup needs, like{" "}
              <code>.env</code>, is listed in <code>.worktreeinclude</code>.
            </li>
            <li>Start a new thread to check that the next worktree sets up.</li>
          </ol>
        ),
      },
      {
        question: "A thread couldn't read its old conversation",
        answer: (
          <ol>
            <li>
              Conversations are read from where Claude Code and Codex keep them
              on this computer. If they were deleted or ran elsewhere, there's
              nothing to read.
            </li>
            <li>
              The thread then picks up from its branch or pull request. Tell it
              what was left to do.
            </li>
          </ol>
        ),
      },
      {
        question: "A thread fails right away",
        answer: (
          <ol>
            <li>Its agent probably isn't signed in on this computer.</li>
            <li>
              Sign in to that agent once, then send the thread a message to
              start it again.
            </li>
          </ol>
        ),
      },
    ],
    faq: [
      {
        question: `Will bb change anything in ${tool ? tool.name : "my old tool"}?`,
        answer: (
          <p>
            No. bb works in your worktrees where they are and doesn't move or
            delete anything. {keepsWorking}
          </p>
        ),
      },
      {
        question: "Can I hand off my threads?",
        answer: (
          <p>
            Yes, one bb thread for each conversation you pick, even when several
            shared a worktree. If {oldTool} ran Claude Code or Codex, their
            conversations are usually still on your machine, and each new thread
            reads its conversation, tells you where things stand, and continues
            once you confirm. When there's no conversation to read, the thread
            picks up from its branch or pull request instead.
          </p>
        ),
      },
      {
        question: "What comes along?",
        answer: (
          <p>
            Every repo your agents worked in, your branches, uncommitted
            changes, open pull requests, scheduled automations, CLAUDE.md,
            skills, MCP servers, and agent sign-ins. Your old chats stay in{" "}
            {oldTool}, but each new thread reads the one it continues and picks
            up from there.
          </p>
        ),
      },
      {
        question: "Do my setup scripts come along?",
        answer: tool ? (
          <p>Yes. {tool.setupStep}</p>
        ) : (
          <p>
            Yes. Put your setup commands in a <code>.bb-env-setup.sh</code> at
            the repo root, and list files each worktree needs, like{" "}
            <code>.env</code>, in a <code>.worktreeinclude</code>. The prompt
            does this for you and shows you both files first.
          </p>
        ),
      },
      {
        question: "Can I move work from more than one repo?",
        answer: (
          <p>
            Yes. The prompt finds every repo your agents worked in and adds each
            one as its own project, after you confirm the list.
          </p>
        ),
      },
      {
        question: "Do I have to move everything at once?",
        answer: (
          <p>
            No. You pick which work to bring over, and {oldTool} keeps working
            alongside bb. Run the prompt again later to bring over more; it
            skips repos that are already bb projects.
          </p>
        ),
      },
    ],
    closer: {
      title: "Get more done with the agents you already use",
      body: "Run more agents at once, see which one needs you, and let them hand work to each other. Free and open source, on the subscriptions you already have.",
    },
  };
}

export const guide: Guide = guideVariant(null);
