import type { ReactNode } from "react";

import { CommandBlock, ProductShot } from "../guide-blocks";
import type { GuideFaq, GuideSection, GuideStep } from "../guide-types";

export function spawnCommand(provider: string): string {
  return `bb thread spawn --project "$BB_PROJECT_ID" \\
    --environment "$BB_ENVIRONMENT_ID" --parent-self \\
    --provider ${provider} --prompt "Review this branch read-only..."`;
}

export const SUBTHREAD_SHOT = (
  <ProductShot
    src="/guides/claude-code-and-codex-together/subthread-sidebar.png"
    alt="The sidebar with a Claude Code thread, Rate limit upload, and its Codex subthread, Review upload rate limiter, nested under it"
  />
);

const TALK_SHOT = (
  <ProductShot
    src="/guides/claude-code-and-codex-together/talk-it-through.png"
    alt="Claude Code and its Codex subthread side by side. Claude Code asks Codex about the cleanup timer, Codex answers, and Claude Code sums up the answer once Codex finishes."
  />
);

const TELL_COMMAND = (
  <CommandBlock
    label="What the agent runs"
    command={
      'bb thread tell <thread-id> \\\n    "Can the cleanup timer drop a window that is still active?"'
    }
  />
);

export function talkStep(id: string, doneWhen: ReactNode): GuideStep {
  return {
    id,
    title: "Let them talk it through",
    lead: "Agents message each other the way you message them, and the lead hears back when its subthread finishes.",
    body: (
      <>
        {TELL_COMMAND}
        {TALK_SHOT}
        <p>
          The lead fixes what's serious, asks for one more pass, and stops after
          two rounds. Type in either thread to step in yourself.
        </p>
      </>
    ),
    doneWhen,
  };
}

export const WHEN_IT_PAYS: GuideSection = {
  id: "when-it-pays",
  title: "Bring in another agent when it pays",
  body: (
    <>
      <p>
        For most changes, one agent does better than a crowd. A second agent
        pays off in two places:
      </p>
      <ul className="gd-list">
        <li>
          <strong>Review.</strong> An agent on another model reads the change
          with fresh eyes.
        </li>
        <li>
          <strong>Plan, then hand off.</strong> When the hard part is deciding,
          have your strongest model interview you and write the plan. Then hand
          the straightforward build to a faster, cheaper model.
        </li>
      </ul>
    </>
  ),
};

export const TEAM_TROUBLESHOOTING: GuideFaq[] = [
  {
    question: "Why didn't the lead start a subthread?",
    answer: (
      <p>
        Agents don't start or message other threads unless you ask. Name the
        agent you want and what it should do, or paste the prompt from{" "}
        <strong>Copy for agent</strong>.
      </p>
    ),
  },
  {
    question: "Why did the subthread fail right away?",
    answer: (
      <p>
        Usually its agent isn't signed in on that machine. Sign in once in a
        terminal there, with <code>claude</code> or <code>codex login</code>,
        then run <code>bb thread retry &lt;thread-id&gt;</code>.
      </p>
    ),
  },
  {
    question: "Why isn't the subthread under the lead?",
    answer: (
      <p>
        It was started without <code>--parent-self</code>. Drag it onto the lead
        in the sidebar, or run{" "}
        <code>
          bb thread update &lt;thread-id&gt; --parent-thread &lt;lead-id&gt;
        </code>
        . The lead only hears back from its own subthreads.
      </p>
    ),
  },
  {
    question: "Why didn't the lead hear back?",
    answer: (
      <p>
        The lead hears when a subthread finishes, fails, is interrupted, or
        waits on a question, as long as the subthread is nested under it. If the
        lead runs <code>bb thread wait</code>, it gives up after 20 minutes. For
        longer work, add <code>--timeout 1h</code>.
      </p>
    ),
  },
  {
    question: "Why is a subthread waiting?",
    answer: (
      <p>
        It's asking a question or waiting for permission to run something, and
        the lead is told. Open the subthread and answer it.
      </p>
    ),
  },
  {
    question: "Did my agent's message get through?",
    answer: (
      <p>
        A message reaches a running agent mid-turn. If that agent is waiting on
        a question, bb holds the message and delivers it once the question is
        answered, so there's no need to send it again.
      </p>
    ),
  },
  {
    question: "Why did both agents change the same files?",
    answer: (
      <p>
        A subthread in the lead's worktree shares its files. Keep the reviewer
        read-only, have them take turns, or give the subthread its own branch
        with <code>--new-environment worktree</code>.
      </p>
    ),
  },
  {
    question: "Why can't the reviewer see the lead's changes?",
    answer: (
      <p>
        It's working in another worktree. Start it in the lead's worktree with{" "}
        <code>--environment "$BB_ENVIRONMENT_ID"</code>, as in the command
        above.
      </p>
    ),
  },
  {
    question: "Why was a subthread interrupted?",
    answer: (
      <p>
        Its machine went to sleep, lost its connection, or restarted bb, and the
        lead is told which. Once the machine is back, run{" "}
        <code>bb thread retry &lt;thread-id&gt;</code>. To keep a Mac or Windows
        PC awake, run <code>bb keep-awake enable</code>.
      </p>
    ),
  },
  {
    question: "How do I stop a subthread?",
    answer: (
      <p>
        Run <code>bb thread stop &lt;thread-id&gt;</code>, or stop it in its
        thread. It keeps its history and worktree. bb doesn't tell the lead, so
        let it know.
      </p>
    ),
  },
  {
    question: "How do agents know how to reach each other?",
    answer: (
      <p>
        Every thread has the bb CLI and a short guide to it. An agent starts,
        waits for, and messages other threads with the same commands you'd use.
      </p>
    ),
  },
];

export const TEAM_COST: GuideFaq = {
  question: "Does this cost extra?",
  answer: (
    <p>bb is free. Each agent uses its own plan or API key, as it does now.</p>
  ),
};
