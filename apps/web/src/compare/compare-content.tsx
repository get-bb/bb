import type { ReactNode } from "react";

import { WINDOWS_DOWNLOAD_URL } from "../landing/site";
import type { CompareCell, CompareFaq, Comparison, Mark } from "./comparisons";

export function cell(mark: Mark | null, text = "", pro = false): CompareCell {
  return { mark, value: "", text, href: null, pro };
}

export function linkedCell(
  mark: Mark | null,
  text: string,
  href: string,
): CompareCell {
  return { mark, value: "", text, href, pro: false };
}

export function price(value: string, text: string): CompareCell {
  return { mark: null, value, text, href: null, pro: false };
}

export const FAQ_GET_STARTED: CompareFaq = {
  question: "How do I get started?",
  answer: (
    <ol>
      <li>
        Download bb for <a href="/download/macos">macOS</a> (Apple Silicon),{" "}
        <a href={WINDOWS_DOWNLOAD_URL}>Windows</a>, or{" "}
        <a href="/download/linux">Linux</a> (alpha). On an Intel Mac, run{" "}
        <code>npx bb-app@latest</code>, which needs Node.js 22.19 or later.
      </li>
      <li>
        Install and sign in to a coding agent, like Claude Code, Codex, Cursor,
        or OpenCode.
      </li>
      <li>Open bb, add your project folder, and type your first request.</li>
    </ol>
  ),
};

export const FAQ_CUSTOMIZE: CompareFaq = {
  question: "Can I customize bb with plugins or scripts?",
  answer: (
    <p>
      Yes. bb works out of the box, with worktrees, diff review, automations,
      and the mobile app ready from your first thread. When you want more,
      install plugins from the <a href="/marketplace">marketplace</a> or ask an
      agent to build one. Plugins can add panels, commands, and new agents, and
      they work in the mobile app too. Everything in the app is also in the bb
      CLI and HTTP API, so scripts and other agents can start, message, and
      manage threads.
    </p>
  ),
};

export const FAQ_REVIEW: CompareFaq = {
  question: "Can I review and merge an agent’s changes in bb?",
  answer: (
    <p>
      Yes, without leaving the thread. Select lines in its diff and choose Add
      to chat to send feedback. Once the agent opens a pull request, the thread
      shows its checks and a Merge button. The GitHub plugin adds Review with
      agent to any PR.
    </p>
  ),
};

export function faqSchedule(contrast: ReactNode): CompareFaq {
  return {
    question: "Can bb run agents on a schedule?",
    answer: (
      <p>
        Yes, free. Automations start an agent thread or run a script on a
        repeating schedule, once at a set time, or after a delay. {contrast}{" "}
        Pick the agent, model, and permission mode, and give each run its own
        worktree if you like.
      </p>
    ),
  };
}

export function faqFree(contrast: ReactNode): CompareFaq {
  return {
    question: "Is bb free and open source?",
    answer: (
      <p>
        Yes, for one person or a whole team. The mobile app, remote machines,
        automations, and plugins are all included{contrast}. You pay only for
        the agent plans or API keys you already use, from any provider. The code
        is on <a href="https://github.com/get-bb/bb">GitHub</a> under the MIT
        license.
      </p>
    ),
  };
}

export const FAQ_SUBSCRIPTIONS: CompareFaq = {
  question: "Can I use my existing AI subscriptions with bb?",
  answer: (
    <p>
      Yes. bb runs the agents you already use, signed in the way you already pay
      for them: a Claude Pro or Max plan, a ChatGPT plan for Codex, a Cursor
      plan, API keys, or any other provider’s plan. Your existing setup comes
      along too (CLAUDE.md, skills, MCP servers, and agent settings).
    </p>
  ),
};

export function faqUsageLimit(contrast: ReactNode): CompareFaq {
  return {
    question: "Can bb switch accounts when I hit a usage limit?",
    answer: (
      <p>
        Yes, with Account Pooler, an experimental plugin built into bb. Turn it
        on and add the Claude Code and Codex accounts you own. When one account
        hits its limit, bb moves the thread’s requests to the next one, so it
        keeps running. {contrast}
      </p>
    ),
  };
}

export const FAQ_AGENTS: CompareFaq = {
  question: "Which coding agents does bb support?",
  answer: (
    <p>
      Claude Code, Codex, Cursor, and OpenCode, plus Pi, Grok Build, omp, and
      Hermes Agent. In Settings, add any other agent that supports the Agent
      Client Protocol (ACP), an open standard for connecting coding agents to
      apps, like Gemini CLI or Devin. You can also add one with a plugin. Each
      thread can use a different agent.
    </p>
  ),
};

export const FAQ_CODEX_TOGETHER: CompareFaq = {
  question: "Can I use Claude Code and Codex together?",
  answer: (
    <p>
      Yes. Ask Claude Code to “start a bb Codex thread to review this branch,
      then fix what it finds.” It starts Codex in the same worktree, waits, and
      applies the fixes. Codex shows up as its own thread, so you can read the
      exact prompt Claude sent, watch it work, and message it mid-run. Any other
      pair works the same way, like Cursor and OpenCode.
    </p>
  ),
};

export function faqTalk(contrast: ReactNode): CompareFaq {
  return {
    question: "Can my coding agents talk to each other?",
    answer: (
      <p>
        Yes, and there’s no coordinator to set up{contrast}. Tell your agents to
        work together and they coordinate on their own: any agent can message
        another thread, whatever the provider, agents answer each other’s
        messages, and an agent hears back automatically when a thread it started
        finishes or fails. The receiving thread shows each message and who sent
        it, and you can step in and message any of them yourself.
      </p>
    ),
  };
}

export const FAQ_PARALLEL: CompareFaq = {
  question: "Can I run multiple coding agents in parallel?",
  answer: (
    <p>
      Yes. Give each thread its own Git worktree so agents don’t overwrite each
      other’s changes. List your .env files and setup commands once, and bb
      prepares every new worktree. By default, bb runs one thread per processor
      core and starts the rest as others finish.
    </p>
  ),
};

export const FAQ_PERMISSIONS: CompareFaq = {
  question: "Can I control what my agents are allowed to do?",
  answer: (
    <p>
      Yes. Pick a permission mode for each thread. Accept Edits applies changes
      inside the project and asks before anything else. Approve for me reviews
      requests automatically and sends high-risk ones to you. Full Access skips
      approvals and can run anything on your machine. Allow or deny approvals
      from your computer or your phone.
    </p>
  ),
};

export function faqPhone(contrast: ReactNode): CompareFaq {
  return {
    question: "Can I control my coding agents from my phone?",
    answer: (
      <p>
        Yes, for free. Use the bb mobile app, a public beta on iPhone through
        TestFlight (Apple’s beta testing app) and in alpha on Android, or open
        bb in any browser through bb Connect, bb’s free remote access.{" "}
        {contrast}
      </p>
    ),
  };
}

export const FAQ_LAPTOP: CompareFaq = {
  question: "Will my agents keep running when I close my laptop?",
  answer: (
    <p>
      Not on that laptop. Agents run on your machine, and closing the lid puts
      it to sleep. On a Mac, switch on Keep Awake, a built-in bb plugin that
      stops idle sleep while bb runs. For long runs, add an always-on desktop or
      server to bb, or run threads in the cloud with a{" "}
      <a href="/marketplace">cloud plugin</a> like Modal Sandbox, which is built
      in (experimental) and starts each thread in an on-demand sandbox in your
      own Modal account.
    </p>
  ),
};

export function faqPlatforms(contrast: ReactNode): CompareFaq {
  return {
    question: "Does bb run on Mac, Windows, and Linux?",
    answer: (
      <p>
        Yes. Download the app for{" "}
        <a href="/download/macos">Apple Silicon Macs</a>,{" "}
        <a href={WINDOWS_DOWNLOAD_URL}>Windows</a>, or{" "}
        <a href="/download/linux">Linux</a> (alpha), or run{" "}
        <code>npx bb-app@latest</code> on an Intel Mac. {contrast}
      </p>
    ),
  };
}

export const FAQ_PRIVACY: CompareFaq = {
  question: "Is my code private with bb?",
  answer: (
    <p>
      Yes: bb runs on your machines, so your code goes only where your agents
      send it, the AI providers you chose. Anonymous usage stats exclude code
      and prompts and can be turned off. The bb Connect relay doesn’t store
      traffic, but isn’t end-to-end encrypted.
    </p>
  ),
};

export function faqTeam(contrast: ReactNode): CompareFaq {
  return {
    question: "Can my team use bb?",
    answer: (
      <p>
        Yes, free at any team size{contrast}. Each person runs bb on their own
        machines with their own agent subscriptions and shares work through Git
        and pull requests as usual. bb doesn’t offer team plans, SSO, or a
        support SLA.
      </p>
    ),
  };
}

export const CLOSER: Comparison["closer"] = {
  title: "Get your agents working together",
  body: "Free and open source. Bring the AI plans you already pay for.",
};
