import { FAQ_SUBSCRIPTIONS } from "../../compare/compare-content";
import { FAQ_LIMIT_RESET } from "../../landing/landing-shared";
import { PromptBlock, Substeps } from "../guide-blocks";
import type { Guide } from "../guide-types";
import { withIntake } from "../prompt-intake";
import { meta } from "./codex-claude-code-usage-limits.meta";

const CODEX_PRICING = "https://learn.chatgpt.com/docs/pricing";
const CLAUDE_LIMITS =
  "https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan";
const CLAUDE_COMMANDS =
  "https://code.claude.com/docs/en/commands#built-in-commands";

const AGENT_PROMPT = withIntake(
  [
    { label: "Machine", hint: "the computer running your task" },
    { label: "Agents", hint: "Codex and Claude Code accounts you already use" },
    {
      label: "Task",
      hint: "what you want to continue if one agent is limited",
    },
  ],
  `Help me check my agents’ reported usage and prepare a handoff if one has hit a limit.
Guide: https://getbb.app/guides/codex-claude-code-usage-limits

Do not buy credits, change accounts, change retry settings, or start another agent turn without asking. Do not read credential files or print account emails or tokens. If a check fails, stop and report the command or action, the error, and the next move.

1. Identify the bb server, project, environment and machine for this task. Confirm that they match my answers. Do not change production settings.
   Check: state the machine and project before looking up usage.

2. Inspect the installed Provider usage plugin’s read-only RPC contract with bb plugin rpc list and bb plugin rpc inspect. Follow its published input schema to read usage for the selected machine. Do not use bb settings usage as an aggregate view, and do not inspect or configure Account Pooler.
   Check: report only the providers and usage windows actually returned, with percent used and reset time when present. Treat unavailable or unreported usage as unknown, never as zero or unlimited. If no supported read-only path is available, point me to Settings → Installed plugins → Provider usage and stop.

3. If the other agent reports available allowance, prepare a short handoff containing the task, project or checkout, completed work, relevant files, next step, and anything requiring approval. Do not claim the other agent inherits the conversation. Do not start it yet or let two agents edit the same checkout at once.
   Check: the handoff names the current state and a bounded next step without secrets.

4. Explain the choice: wait for the current provider’s reset, or start a new thread with my other agent and paste the handoff. Switching agents does not increase or reset either provider’s allowance.
   Check: ask before starting any new work, and leave accounts and settings unchanged.

Reply with the machine, each reported window and reset time, any missing information, and the handoff ready to copy.`,
);

export const guide: Guide = {
  ...meta,
  headline: "Hit a usage limit? Keep going with your other agent",
  description:
    "See each agent’s reported usage, then hand work to the other agent in a new thread.",
  heroTop: null,
  requirement: null,
  concept: (
    <div className="gd-usage-check">
      <table>
        <caption>Usage windows · Checked October 21, 2026</caption>
        <thead>
          <tr>
            <th scope="col">Agent</th>
            <th scope="col">Where to check and what resets</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Codex</th>
            <td>
              <a href="https://chatgpt.com/codex/settings/usage">
                Usage dashboard
              </a>{" "}
              or <code>/status</code> in the Codex CLI.
              <br />
              Plus and Standard Business: five-hour estimates. Pro: no five-hour
              limit currently. Weekly limits may apply.{" "}
              <a href={CODEX_PRICING}>Plan details</a>.
            </td>
          </tr>
          <tr>
            <th scope="row">Claude Code</th>
            <td>
              <a href={CLAUDE_COMMANDS}>
                <code>/usage</code> in Claude Code
              </a>
              . Limit messages show reset times.
              <br />
              Pro and Max: five-hour and weekly limits, shared with Claude.{" "}
              <a href={CLAUDE_LIMITS}>Plan details</a>.
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        Use Codex and Claude Code in bb on your own plans. If one reaches its
        limit, start a thread with the other when it has allowance left. Using
        the other agent doesn’t reset either provider’s limits.
      </p>
      <p className="gd-usage-note">
        Plans and windows can change. API-key accounts follow their own billing
        and limits. bb shows the windows your plan reports.
      </p>
    </div>
  ),
  agentPrompt: AGENT_PROMPT,
  steps: [
    {
      id: "step-1",
      title: "Check the usage your accounts report",
      lead: "See the plan, percent used and reset time for each reported window.",
      body: (
        <>
          <Substeps>
            <li>
              Open{" "}
              <strong>Settings → Installed plugins → Provider usage</strong>.
            </li>
            <li>
              Pick the machine running your task to see the accounts signed in
              there.
            </li>
            <li>
              Compare the reported windows for Codex and Claude Code. Missing
              usage doesn’t mean an account has unlimited allowance.
            </li>
          </Substeps>
          <p>
            Provider usage is built into bb and on by default for new
            installations; existing choices are kept. You can also check it from
            the sidebar’s Provider usage card. The screenshot shows example
            values in a local demo.
          </p>
        </>
      ),
      shot: {
        src: "/guides/codex-claude-code-usage-limits/provider-usage.png",
        alt: "Provider usage in bb, with separate usage windows and reset times for the selected machine’s accounts (demo values).",
        width: 2048,
        height: 1280,
      },
      options: [],
    },
    {
      id: "step-2",
      title: "Give the other agent a clear starting point",
      lead: "Use a new thread for the other agent, on its own account and allowance.",
      body: (
        <>
          <Substeps>
            <li>
              Choose <strong>New thread</strong>, your project, and a model from
              the other provider.
            </li>
            <li>
              Give it the task, relevant files, what is already done and the
              next step. A new thread doesn’t inherit the other agent’s
              conversation.
            </li>
            <li>
              Before it edits an existing checkout, make sure the first agent
              has stopped. Review the handoff, then send it.
            </li>
          </Substeps>
          <PromptBlock
            name="Handoff"
            prompt="Continue this task from the current project files. First summarize what is done and what you would do next. Wait for my go before editing."
          />
        </>
      ),
      shot: {
        src: "/guides/switch-to-bb/window-handoff-codex.webp",
        alt: "A bb thread with a handoff for Codex.",
        width: 2048,
        height: 1280,
      },
      options: [],
    },
  ],
  troubleshooting: [
    {
      question: "Why does bb show no usage for my account?",
      answer: (
        <p>
          Some plans do not report usage windows. That is different from a
          failed refresh or an expired sign-in. Check the message in Provider
          usage and the provider’s own usage page. bb doesn’t show unavailable
          usage as zero.
        </p>
      ),
    },
    {
      question: "Why am I seeing a different machine’s accounts?",
      answer: (
        <p>
          Open <strong>Settings → Installed plugins → Provider usage</strong>{" "}
          and pick the computer running the task. The selected machine
          determines which local accounts you see.
        </p>
      ),
    },
    {
      question: "Why did usage stop refreshing?",
      answer: (
        <p>
          Reconnect the selected machine and refresh Provider usage. After a
          failed refresh, bb keeps the last measurements with a notice; those
          figures are not a fresh allowance check.
        </p>
      ),
    },
    {
      ...FAQ_LIMIT_RESET,
      answer: (
        <>
          {FAQ_LIMIT_RESET.answer}
          <p>
            By default bb waits up to 6 hours for a reset. For a weekly limit,
            raise <strong>Maximum automatic wait</strong> in{" "}
            <strong>Settings → Installed plugins → Provider retry</strong>. The
            machine running the agent needs to stay available.
          </p>
        </>
      ),
    },
  ],
  faq: [
    FAQ_SUBSCRIPTIONS,
    {
      question:
        "Does using both agents give me more Codex or Claude Code usage?",
      answer: (
        <p>
          No. Each provider keeps its own limits. Using both means starting work
          with another agent on an account you already have, if that account has
          allowance available. bb doesn’t increase or reset either limit.
        </p>
      ),
    },
    {
      question: "Are Codex limits always five hours?",
      answer: (
        <p>
          No. As of October 21, 2026, OpenAI lists five-hour estimates for Plus
          and Standard Business, while Pro currently has no five-hour limit.
          Weekly limits may apply. Check your{" "}
          <a href="https://chatgpt.com/codex/settings/usage">
            Codex usage dashboard
          </a>{" "}
          and <a href={CODEX_PRICING}>OpenAI’s current plan details</a>.
        </p>
      ),
    },
    {
      question: "Does Claude Code share limits with Claude?",
      answer: (
        <p>
          Yes. <a href={CLAUDE_LIMITS}>Anthropic’s Pro and Max guidance</a> says
          usage is shared across Claude and Claude Code, with five-hour and
          weekly limits. Check{" "}
          <a href={CLAUDE_COMMANDS}>
            <code>/usage</code>
          </a>{" "}
          in Claude Code for your plan.
        </p>
      ),
    },
    {
      question: "Can I keep the same conversation when I change agents?",
      answer: (
        <p>
          This guide uses a new thread and an explicit handoff. Give the next
          agent the task, current files and next step; do not assume it can see
          the previous conversation.
        </p>
      ),
    },
    {
      question: "Where do these details come from?",
      answer: (
        <p>
          Provider documentation was checked October 21, 2026:{" "}
          <a href={CODEX_PRICING}>OpenAI’s Codex limits</a>,{" "}
          <a href={CLAUDE_LIMITS}>Anthropic’s plan limits</a> and{" "}
          <a href={CLAUDE_COMMANDS}>Claude Code commands</a>. bb’s display and
          retry behavior are documented in{" "}
          <a href="https://github.com/get-bb/bb/blob/405592c0b7/plugins/provider-usage/README.md">
            Provider usage
          </a>{" "}
          and{" "}
          <a href="https://github.com/get-bb/bb/blob/405592c0b7/plugins/provider-retry/PLUGIN_OVERVIEW.md">
            Provider retry
          </a>
          .
        </p>
      ),
    },
  ],
  closer: {
    title: "Keep both agents within reach",
    body: "Check the usage your plans report, then choose which agent takes the next task. The bb app is free and open source.",
  },
};
