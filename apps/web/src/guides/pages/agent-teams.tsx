import type { ReactNode } from "react";

import { ProductShot } from "../guide-blocks";
import type { GuideFaq, GuideSection, GuideStep } from "../guide-types";

export const CHILD_THREAD_SHOT = (
  <ProductShot
    src="/guides/claude-code-and-codex-together/subthread-sidebar.png"
    alt="The sidebar with a Claude Code thread, Rate limit upload, and its Codex child thread, Review upload rate limiter, nested under it"
  />
);

export const TALK_SHOT = (
  <ProductShot
    src="/guides/claude-code-and-codex-together/talk-it-through.png"
    alt="Claude Code and its Codex child thread side by side. Claude Code asks Codex about the cleanup timer, Codex answers, and Claude Code sums up the answer once Codex finishes."
  />
);

export function talkStep(id: string, doneWhen: ReactNode): GuideStep {
  return {
    id,
    title: "Let them talk it through",
    lead: "Agents message each other the way you message them, and the parent thread hears back when its child thread finishes.",
    body: (
      <>
        {TALK_SHOT}
        <p>
          The parent thread fixes what's serious, asks for one more pass, and
          stops after two rounds. Type in either thread to step in yourself.
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
    question: "Why didn't the parent thread start a child thread?",
    answer: (
      <p>
        Agents don't start or message other threads unless you ask. Name the
        agent you want and what it should do, or paste the prompt from{" "}
        <strong>Copy for agent</strong>.
      </p>
    ),
  },
  {
    question: "Why did the child thread fail right away?",
    answer: (
      <p>
        Usually its agent isn't signed in on that machine. Sign in to that agent
        there once, then choose <strong>Retry</strong> in the child thread.
      </p>
    ),
  },
  {
    question: "Why isn't the child thread under its parent?",
    answer: (
      <p>
        It was started on its own. Drag it onto the parent thread in the
        sidebar. The parent thread only hears back from its own child threads.
      </p>
    ),
  },
  {
    question: "Why didn't the parent thread hear back?",
    answer: (
      <p>
        The parent thread hears when a child thread finishes, fails, is
        interrupted, or waits on a question, as long as the child thread is
        nested under it. Check that it is, and drag it there if not.
      </p>
    ),
  },
  {
    question: "Why is a child thread waiting?",
    answer: (
      <p>
        It's asking a question or waiting for permission to run something, and
        the parent thread is told. Open the child thread and answer it.
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
        A child thread in the parent thread's worktree shares its files. Keep
        the reviewer read-only, have them take turns, or ask for the child
        thread in its own worktree.
      </p>
    ),
  },
  {
    question: "Why can't the reviewer see the parent thread's changes?",
    answer: (
      <p>
        It's working in another worktree. Ask the parent thread to start the
        reviewer in its own worktree, as the prompt from{" "}
        <strong>Copy for agent</strong> does.
      </p>
    ),
  },
  {
    question: "Why was a child thread interrupted?",
    answer: (
      <p>
        Its machine went to sleep, lost its connection, or restarted bb, and the
        parent thread is told which. Once the machine is back, choose{" "}
        <strong>Retry</strong> in the child thread. To keep a Mac or Windows PC
        awake, turn on <strong>Prevent idle sleep</strong> in{" "}
        <strong>Settings → Keep Awake</strong>.
      </p>
    ),
  },
  {
    question: "How do I stop a child thread?",
    answer: (
      <p>
        Open it and stop it from the message box. It keeps its history and
        worktree. bb doesn't tell the parent thread, so let it know.
      </p>
    ),
  },
  {
    question: "How do agents know how to reach each other?",
    answer: (
      <p>
        Every thread comes with bb's tools and a short guide to them, so an
        agent can start, wait for, and message other threads the way you would.
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
