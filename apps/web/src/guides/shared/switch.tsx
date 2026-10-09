import type { ReactNode } from "react";

import { SwitchConcept } from "../concepts";
import { CopyPromptButton, Substeps, Ui } from "../guide-blocks";
import type { Guide, GuideMeta, GuideShot } from "../guide-types";
import { AGENTS_FAQ, COST_FAQ } from "./faq";

const CLAUDE_HANDOFF_SHOT: GuideShot = {
  src: "/guides/switch-to-bb/window-handoff.png",
  alt: "A bb thread where the agent found the latest Claude Code conversation for the folder and wrote a handoff: finish the 5 MB upload limit, with the goal, what's done, decisions, and the tests left, then asks for an OK to continue",
  width: 2048,
  height: 1280,
};

function askingHandoffShot(file: string, conversation: string): GuideShot {
  return {
    src: `/guides/switch-to-bb/${file}`,
    alt: `A bb thread where the agent asks which work to bring over, suggests ${conversation} for the folder, and writes a handoff for the 5 MB upload limit: the goal, what's done, decisions, and the tests left`,
    width: 2048,
    height: 1280,
  };
}

const GENERIC_SETUP_STEP = (
  <>
    Put your setup commands in a <code>.bb-env-setup.sh</code> at the repo root,
    and list files each worktree needs, like <code>.env</code>, in a{" "}
    <code>.worktreeinclude</code>.
  </>
);

export type SwitchTool = {
  id: string;
  slug: string;
  name: string;
  conversations: string;
  keepsWorking: string;
  setupStep: ReactNode;
  handoffShot: GuideShot;
};

export const SWITCH_TOOLS = {
  claude: {
    id: "claude",
    slug: "switch-from-claude-code",
    name: "Claude Code",
    conversations:
      "Claude Code keeps each conversation as a .jsonl file in ~/.claude/projects/, in a folder named after the path it ran in.",
    keepsWorking: "Claude Code keeps working while you try bb.",
    setupStep: GENERIC_SETUP_STEP,

    handoffShot: CLAUDE_HANDOFF_SHOT,
  },
  "codex-app": {
    id: "codex-app",
    slug: "switch-from-codex",
    name: "Codex",
    conversations:
      "Codex keeps each conversation as a .jsonl file under ~/.codex/sessions/. The first line's payload.cwd is the folder it ran in.",
    keepsWorking: "Codex keeps working while you try bb.",
    setupStep: GENERIC_SETUP_STEP,

    handoffShot: askingHandoffShot(
      "window-handoff-codex.png",
      "the latest prior conversation",
    ),
  },
  conductor: {
    id: "conductor",
    slug: "switch-from-conductor",
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

    handoffShot: CLAUDE_HANDOFF_SHOT,
  },
  cursor: {
    id: "cursor",
    slug: "switch-from-cursor",
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

    handoffShot: askingHandoffShot(
      "window-handoff-cursor.png",
      "the latest Cursor conversation",
    ),
  },
  superset: {
    id: "superset",
    slug: "switch-from-superset",
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

    handoffShot: CLAUDE_HANDOFF_SHOT,
  },
  "t3-code": {
    id: "t3-code",
    slug: "switch-from-t3-code",
    name: "T3 Code",
    conversations:
      "T3 Code runs Codex, Claude Code, or OpenCode, so look in ~/.codex/sessions/, ~/.claude/projects/, and OpenCode's ~/.local/share/opencode/ for this folder's path.",
    keepsWorking: "T3 Code keeps working while you try bb.",
    setupStep: (
      <>
        Move the scripts that run on worktree creation from <code>t3.json</code>{" "}
        into a <code>.bb-env-setup.sh</code> at the repo root, and list files
        like <code>.env</code> in a <code>.worktreeinclude</code>.
      </>
    ),

    handoffShot: askingHandoffShot(
      "window-handoff-t3-code.png",
      "the latest OpenCode conversation",
    ),
  },
  "vibe-kanban": {
    id: "vibe-kanban",
    slug: "switch-from-vibe-kanban",
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

    handoffShot: CLAUDE_HANDOFF_SHOT,
  },
} satisfies Record<string, SwitchTool>;

export function switchPrompt(tool: SwitchTool): string {
  const from = tool.name;
  const url = `https://getbb.app/guides/${tool.slug}`;
  return `Pick up a task I was working on in ${from}, in this folder, and keep going here. First, ask me which work I want to bring over, and suggest the latest conversation you find for this folder.
Guide: ${url}

1. See where the work stands: git log, git status, and git diff against the base branch. If I named a pull request, read it and its comments with gh pr view <url> --comments.
2. Find the conversation where the task was being done, if there is one. ${tool.conversations} Pick the latest one for this folder or branch, skipping this conversation and any that only hit errors, and only read it.
3. Write me a short handoff: the goal, what's done, the decisions made, and what's left. Wait for my OK.
4. Continue with what's left. Don't change anything outside this folder, and don't push.`;
}

export function switchGuide(meta: GuideMeta, tool: SwitchTool): Guide {
  const oldTool = tool.name;
  return {
    ...meta,
    description: `Pick up where ${oldTool} left off. Open the task where it was, and your agent reads the old conversation, tells you where things stand, and keeps going.`,
    heroTop: <SwitchConcept tool={tool.id} />,
    concept: null,
    agentPrompt: switchPrompt(tool),
    requirement: null,
    steps: [
      {
        id: "project",
        title: "Add your project",
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
        id: "thread",
        title: "Create a new thread",
        lead: `Start where ${oldTool} left off, so its branch and changes come along.`,
        body: (
          <p>
            Choose <strong>New thread</strong>, then choose the repo and the
            folder {oldTool} worked in.
          </p>
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
        id: "prompt",
        title: "Paste the prompt",
        lead: null,
        body: (
          <Substeps>
            <li>
              Paste the prompt from <CopyPromptButton /> and send it. Your agent
              asks which work you want to bring over, then writes a handoff: the
              goal, what's done, and what's left. Reply to correct it, or say
              go.
            </li>
            <li>Do the same for each task you want to bring over.</li>
          </Substeps>
        ),
        shot: tool.handoffShot,
        options: [],
      },
    ],
    troubleshooting: [
      {
        question: "I can't find my old folder",
        answer: (
          <ol>
            <li>
              Choose <strong>Worktree</strong>, then{" "}
              <strong>Existing worktree</strong>. It lists the Git worktrees of
              the repo you picked, so check that you picked the right repo.
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
              Your agent looks for {oldTool}'s conversations on this computer.
              If they were deleted or ran elsewhere, there's nothing to read.
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
        question: `Will bb change anything in ${tool.name}?`,
        answer: (
          <p>
            No. bb works in your worktrees where they are and doesn't move
            anything, and archiving a bb thread never deletes a worktree bb
            didn't create. Bring over one task at a time, whenever you're ready.{" "}
            {tool.keepsWorking}
          </p>
        ),
      },
      {
        question: "What comes along?",
        answer: (
          <p>
            Your repos, branches, uncommitted changes, and open pull requests.
            Claude Code and Codex in bb use the same CLAUDE.md, AGENTS.md,
            skills, MCP servers, and sign-ins they use now. Your old chats stay
            in {oldTool}; each bb thread reads the one it continues.
          </p>
        ),
      },
      {
        question: "Do my setup scripts come along?",
        answer: <p>{tool.setupStep}</p>,
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
      COST_FAQ,
      AGENTS_FAQ,
    ],
    closer: {
      title: "Get more done with the agents you already use",
      body: "Run more agents at once, see which one needs you, and let them hand work to each other. Free and open source, on the subscriptions you already have.",
    },
  };
}
