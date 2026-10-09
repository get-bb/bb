import type { ReactNode } from "react";

import { SwitchConcept } from "../concepts";
import { CopyPromptButton, Substeps, Ui } from "../guide-blocks";
import type { Guide, GuideMeta } from "../guide-types";

const GUIDE_URL = "https://getbb.app/guides/switch-to-bb";
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
  conversations: string;
  keepsWorking: string;
  setupStep: ReactNode;
};

export const SWITCH_TOOLS: SwitchTool[] = [
  {
    id: "claude",
    name: "Claude Code",
    conversations:
      "Claude Code keeps each conversation as a .jsonl file in ~/.claude/projects/, in a folder named after the path it ran in.",
    keepsWorking: "Claude Code keeps working while you try bb.",
    setupStep: GENERIC_SETUP_STEP,
  },
  {
    id: "codex-app",
    name: "Codex",
    conversations:
      "Codex keeps each conversation as a .jsonl file under ~/.codex/sessions/. The first line's payload.cwd is the folder it ran in.",
    keepsWorking: "Codex keeps working while you try bb.",
    setupStep: GENERIC_SETUP_STEP,
  },
  {
    id: "conductor",
    name: "Conductor",
    conversations:
      "Conductor runs Claude Code or Codex in its workspaces, so look in ~/.claude/projects/ and ~/.codex/sessions/ for this folder's path.",
    keepsWorking: "Conductor keeps working while you try bb.",
    setupStep: (
      <>
        Move Conductor's setup script into a <code>.bb-env-setup.sh</code> at
        the repo root, and its Files to copy list into a{" "}
        <code>.worktreeinclude</code>.
      </>
    ),
  },
  {
    id: "cursor",
    name: "Cursor",
    conversations:
      "Cursor saves agent transcripts in ~/.cursor/projects/<project>/agent-transcripts/. Only read those files; never open Cursor's state.vscdb databases.",
    keepsWorking: "Cursor keeps working while you try bb.",
    setupStep: (
      <>
        Move the setup commands from <code>.cursor/worktrees.json</code> into a{" "}
        <code>.bb-env-setup.sh</code> at the repo root, and list files like{" "}
        <code>.env</code> in a <code>.worktreeinclude</code>.
      </>
    ),
  },
  {
    id: "superset",
    name: "Superset",
    conversations:
      "Superset runs Claude Code or Codex in its worktrees, so look in ~/.claude/projects/ and ~/.codex/sessions/ for this folder's path.",
    keepsWorking: "Superset keeps working while you try bb.",
    setupStep: (
      <>
        Move the setup list from <code>.superset/config.json</code> into a{" "}
        <code>.bb-env-setup.sh</code> at the repo root, and list files each
        worktree needs, like <code>.env</code>, in a{" "}
        <code>.worktreeinclude</code>.
      </>
    ),
  },
  {
    id: "t3-code",
    name: "T3 Code",
    conversations:
      "T3 Code's Codex conversations are .jsonl files under ~/.codex/sessions/ with the originator t3code_desktop. The first line's payload.cwd is the folder it ran in.",
    keepsWorking: "T3 Code keeps working while you try bb.",
    setupStep: (
      <>
        Move the scripts that run on worktree creation from <code>t3.json</code>{" "}
        into a <code>.bb-env-setup.sh</code> at the repo root, and list files
        like <code>.env</code> in a <code>.worktreeinclude</code>.
      </>
    ),
  },
  {
    id: "vibe-kanban",
    name: "Vibe Kanban",
    conversations:
      "Vibe Kanban runs Claude Code or Codex in each attempt's worktree, so look in ~/.claude/projects/ and ~/.codex/sessions/ for this folder's path.",
    keepsWorking:
      "Your local Vibe Kanban workspaces keep running while you try bb.",
    setupStep: (
      <>
        Put Vibe Kanban's setup script in a <code>.bb-env-setup.sh</code> at the
        repo root, and list files each worktree needs, like <code>.env</code>,
        in a <code>.worktreeinclude</code>.
      </>
    ),
  },
];

export function switchTool(id: string | null): SwitchTool | null {
  return SWITCH_TOOLS.find((tool) => tool.id === id) ?? null;
}

const ANY_TOOL_CONVERSATIONS =
  "Claude Code keeps conversations in ~/.claude/projects/, Codex in ~/.codex/sessions/, and Cursor in ~/.cursor/projects/<project>/agent-transcripts/. Tools like Conductor, Superset, T3 Code, and Vibe Kanban run Claude Code or Codex, so their conversations are in those folders too.";

export function switchPrompt(tool: SwitchTool | null): string {
  const from = tool ? tool.name : "my old tool";
  const url = tool ? `${GUIDE_URL}?from=${tool.id}` : GUIDE_URL;
  return `Pick up the task I was working on in ${from}, in this folder, and keep going here. If it isn't clear which task, ask me first.
Guide: ${url}

1. See where the work stands: git log, git status, and git diff against the base branch. If I named a pull request, read it and its comments with gh pr view <url> --comments.
2. Find the conversation where the task was being done, if there is one. ${tool ? tool.conversations : ANY_TOOL_CONVERSATIONS} Pick the latest one for this folder or branch, skipping this conversation and any that only hit errors, and only read it.
3. Write me a short handoff: the goal, what's done, the decisions made, and what's left. Wait for my OK.
4. Continue with what's left. Don't change anything outside this folder, and don't push.`;
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
    description: `Pick up where ${oldTool} left off. Open the task where it was, and your agent reads the old conversation, tells you where things stand, and keeps going.`,
    concept: <SwitchConcept selected={tool ? tool.id : null} />,
    picker: tool
      ? null
      : {
          label: "Switching from",
          placeholder: "Pick your tool",
          selected: "",
          options: [
            { id: "", label: "Pick your tool" },
            ...SWITCH_TOOLS.map((item) => ({ id: item.id, label: item.name })),
          ],
        },
    agentPrompt: switchPrompt(tool),
    requirement: `bb on the computer where ${oldTool} keeps your work`,
    steps: [
      {
        id: "repos",
        title: "Add your repos",
        lead: "bb finds the repos you've been working in.",
        body: (
          <Substeps>
            <li>
              Open bb. In setup's <strong>Projects</strong> step, check the
              repos you work in, or choose{" "}
              <strong>Add a folder that isn't listed</strong>.
            </li>
            <li>
              Already set up? Open <Ui icon="settings">Settings → Projects</Ui>{" "}
              and choose <strong>Add a project</strong>.
            </li>
          </Substeps>
        ),
        shot: {
          src: "/guides/switch-to-bb/window-projects.png",
          alt: "bb's Settings → Projects page listing the acme-web project, with an Add a project button",
          width: 2048,
          height: 1280,
        },
        options: [],
      },
      {
        id: "open",
        title: "Open the task where you left off",
        lead: `Start a thread in the folder ${oldTool} was working in, so your branch and unsaved changes are right there.`,
        body: (
          <Substeps>
            <li>
              Choose <strong>New thread</strong>, pick the repo, and choose{" "}
              <strong>Worktree</strong>.
            </li>
            <li>
              In the branch menu, choose <strong>Existing worktree</strong> and
              pick the folder {oldTool} used. If the work was in the repo's main
              folder, choose <strong>Project checkout</strong> instead.
            </li>
          </Substeps>
        ),
        shot: {
          src: "/guides/switch-to-bb/window-existing-worktree.png",
          alt: "A new bb thread on acme-web with Worktree picked and the branch menu open on Existing worktree, listing a lisbon workspace on the fix/upload-size-limit branch",
          width: 2048,
          height: 1280,
        },
        options: [],
      },
      {
        id: "handoff",
        title: "Hand it to your agent",
        lead: "It catches up on the old conversation, then keeps going once you agree.",
        body: (
          <Substeps>
            <li>
              Paste the prompt from <CopyPromptButton /> and send it. Your agent
              asks which task, if it isn't clear.
            </li>
            <li>
              Read its handoff: the goal, what's done, the decisions made, and
              what's left. Reply to correct it, or say go.
            </li>
            <li>Do the same for each task you want to bring over.</li>
          </Substeps>
        ),
        shot: {
          src: "/guides/switch-to-bb/window-handoff.png",
          alt: "A bb thread where the agent found the latest Claude Code conversation for the folder and wrote a handoff: finish the 5 MB upload limit, with the goal, what's done, decisions, and the tests left, then asks for an OK to continue",
          width: 2048,
          height: 1280,
        },
        options: [],
      },
    ],
    troubleshooting: [
      {
        question: "My old worktree isn't in the list",
        answer: (
          <ol>
            <li>
              The list shows the Git worktrees of the repo you picked. Check
              that you picked the right repo.
            </li>
            <li>
              If the folder isn't a Git worktree, add it as a project in{" "}
              <strong>Settings → Projects</strong> and start the thread there.
            </li>
          </ol>
        ),
      },
      {
        question: "The agent couldn't find the old conversation",
        answer: (
          <ol>
            <li>
              Conversations are read from where Claude Code and Codex keep them
              on this computer. If they were deleted or ran elsewhere, there's
              nothing to read.
            </li>
            <li>
              It then works from the branch or pull request. Tell it what was
              left to do.
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
        question: "What comes along?",
        answer: (
          <p>
            Your repos, branches, uncommitted changes, and open pull requests,
            plus CLAUDE.md, AGENTS.md, skills, MCP servers, and agent sign-ins,
            since bb runs the same agents. Your old chats stay in {oldTool};
            each bb thread reads the one it continues.
          </p>
        ),
      },
      {
        question: "Do I have to move everything at once?",
        answer: (
          <p>
            No. Bring over one task at a time, whenever you're ready. {oldTool}{" "}
            keeps working alongside bb.
          </p>
        ),
      },
      {
        question: "Do my setup scripts come along?",
        answer: tool ? <p>{tool.setupStep}</p> : <p>{GENERIC_SETUP_STEP}</p>,
      },
      {
        question: "Do my automations come along?",
        answer: (
          <p>
            Not on their own. Recreate each one in{" "}
            <a href="/guides/run-an-agent-on-a-schedule">bb automations</a>:
            paste its schedule and prompt, and your agent sets it up.
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
