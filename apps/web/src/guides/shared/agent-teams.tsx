import { Ui } from "../guide-blocks";
import type { GuideFaq, GuideShot } from "../guide-types";
import { AGENTS_FAQ, COST_FAQ, SLEEP_TROUBLESHOOTING } from "./faq";

export const NESTED_SHOT: GuideShot = {
  src: "/guides/claude-code-and-codex-together/window-nested.webp",
  alt: "bb with the Claude Code thread Rate limit uploads open. Its tests pass, it commits, the Codex review finishes, and it reports what Codex found. In the sidebar, the Codex thread Review upload rate limiting is nested under it.",
  width: 2048,
  height: 1280,
};

export const SPLIT_SHOT: GuideShot = {
  src: "/guides/claude-code-and-codex-together/window-split-oneround.webp",
  alt: "bb in split view: on the left, the Claude Code thread sums up what it built, what Codex's single review found, and what it fixed; on the right, the Codex reviewer's child thread lists one serious and two minor issues.",
  width: 2048,
  height: 1280,
};

export const TALK_SHOT: GuideShot = {
  src: "/guides/claude-code-and-codex-together/window-talk.webp",
  alt: "The Claude Code thread after it asked Codex whether a memory leak needed fixing before merge. It relays Codex's answer: a real leak, but fine as a follow-up, with how to fix it later.",
  width: 2048,
  height: 1280,
};

export const TEAM_TROUBLESHOOTING: [GuideFaq, ...GuideFaq[]] = [
  {
    question: "My agent didn't bring in a reviewer",
    answer: (
      <ol>
        <li>
          Agents only start other threads when you ask. Check that the prompt
          from <strong>Copy for agent</strong> is in your first message.
        </li>
        <li>
          Or ask directly, naming the agent and the job, like “Have Codex review
          this branch, read-only.”
        </li>
      </ol>
    ),
  },
  {
    question: "The reviewer's thread failed right away",
    answer: (
      <ol>
        <li>Open the reviewer's thread and read the error.</li>
        <li>
          Usually that agent isn't signed in on this computer. Sign in to it
          once, like <code>codex login</code> for Codex.
        </li>
        <li>Send the reviewer's thread a message to start it again.</li>
      </ol>
    ),
  },
  {
    question: "My agent never heard back from the reviewer",
    answer: (
      <ol>
        <li>
          Check the sidebar. Your agent only hears from threads nested under its
          own.
        </li>
        <li>
          If the reviewer sits on its own, drag it onto your agent's thread.
        </li>
        <li>
          Then tell your agent the review is ready, so it reads it now instead
          of waiting.
        </li>
      </ol>
    ),
  },
  {
    question: "The reviewer is stuck waiting",
    answer: (
      <ol>
        <li>
          It's asking a question or waiting for permission to run something.
        </li>
        <li>Open its thread and answer it. Your agent is told it's waiting.</li>
      </ol>
    ),
  },
  {
    question: "Both agents changed the same files",
    answer: (
      <ol>
        <li>
          They share one worktree, so they share files. Tell the reviewer to
          stay read-only, as the prompt from <strong>Copy for agent</strong>{" "}
          does.
        </li>
        <li>
          If both need to write, have them take turns, or ask for the second
          agent in its own worktree.
        </li>
      </ol>
    ),
  },
  {
    question: "The reviewer can't see the changes",
    answer: (
      <ol>
        <li>
          It started in a separate worktree, so it can't see work that isn't
          committed.
        </li>
        <li>
          Ask your agent to commit, then start the reviewer in this same
          worktree, as the prompt from <strong>Copy for agent</strong> does.
        </li>
      </ol>
    ),
  },
  {
    question: "The reviewer's thread disappeared",
    answer: (
      <p>
        If it was archived, open{" "}
        <Ui icon="settings">Settings → Archived threads</Ui> and choose{" "}
        <strong>Unarchive</strong>.
      </p>
    ),
  },
  SLEEP_TROUBLESHOOTING,
];

export const TEAM_FAQ: GuideFaq[] = [
  {
    question: "When is a second agent worth it?",
    answer: (
      <>
        <p>For most changes, one agent does fine. A second one pays off for:</p>
        <ul>
          <li>
            <strong>Review.</strong> An agent on another model reads the change
            with fresh eyes.
          </li>
          <li>
            <strong>Plan, then hand off.</strong> Have your strongest model
            interview you and write the plan, then hand the build to a faster,
            cheaper one.
          </li>
        </ul>
      </>
    ),
  },
  AGENTS_FAQ,
  {
    question: "How do agents reach each other?",
    answer: (
      <p>
        Every thread comes with bb's tools and a short guide to them, so an
        agent can start, wait for, and message other threads the way you would.
        A message reaches a busy agent mid-turn, and one sent to an agent that's
        waiting on a question is delivered once you answer.
      </p>
    ),
  },
  {
    question: "Can I step in?",
    answer: (
      <p>
        Yes. Type in either thread at any time, or stop one from its message
        box. A stopped thread keeps its history and worktree. bb doesn't tell
        the other agent you stopped it, so let it know.
      </p>
    ),
  },
  COST_FAQ,
];
