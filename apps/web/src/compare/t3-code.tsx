import t3CodeIcon from "../assets/competitors/t3-code.png";
import type { Comparison } from "./comparisons";
import {
  CLOSER,
  FAQ_AGENTS,
  FAQ_CODEX_TOGETHER,
  FAQ_CUSTOMIZE,
  FAQ_GET_STARTED,
  FAQ_PERMISSIONS,
  FAQ_PRIVACY,
  FAQ_REVIEW,
  FAQ_SUBSCRIPTIONS,
  cell,
  faqFree,
  faqPhone,
  faqPlatforms,
  faqSchedule,
  faqTeam,
  faqUsageLimit,
  price,
} from "./compare-content";
import { CustomizeBuild } from "../landing/landing-visuals";
import { agentsSection, type SectionCopy } from "./compare-sections";
import type { BrandLogo } from "./compare-visuals";

const T3_CODE_LOGO: BrandLogo = { kind: "image", src: t3CodeIcon };

const AGENTS_SECTION = agentsSection({
  title: "Every agent, in threads you can talk to",
  body: (
    <p>
      Claude Code, Codex, Cursor, OpenCode, and more run side by side. When one
      agent starts another, the new one is a full thread you can open and
      message mid-run, from any device.
    </p>
  ),
});

const PLUGINS_COPY_T3: SectionCopy = {
  title: "Your changes, without a fork to maintain",
  body: (
    <p>
      Plugins add panels to the sidebar, commands to the bb CLI, tools your
      agents can call, and new agents. 300+ are already in the marketplace, and
      bb still updates every week with nothing for you to rebase.
    </p>
  ),
};

export const BB_VS_T3_CODE: Comparison = {
  slug: "t3-code-alternatives",
  title: "T3 Code Alternatives: bb, Change Anything Without Forking",
  description:
    "bb is a free, open-source T3 Code alternative you can change without forking. Add panels, commands, and agents from the plugin marketplace, or have your agent build them.",
  competitor: { name: "T3 Code", logo: T3_CODE_LOGO },
  headline: "The T3 Code alternative you can change without forking",
  sub: "Add a panel, a command, or an agent from the plugin marketplace, or have your agent build one. It works everywhere you use bb, including your phone. Free and open source.",
  heroVisual: <CustomizeBuild />,
  tailored: AGENTS_SECTION,
  sections: [],
  pluginsCopy: PLUGINS_COPY_T3,
  tableNote: null,
  table: [
    {
      title: "Customize",
      rows: [
        {
          feature: "Plugin marketplace",
          bb: cell("yes", "Gallery or agent-built"),
          competitor: cell("no", "Fork the code"),
        },
      ],
    },
    {
      title: "Agents",
      rows: [
        {
          feature: "Message a subagent",
          bb: cell("yes", "Mid-run, from any device"),
          competitor: cell("no", "Subagent threads can't take messages"),
        },
        {
          feature: "Switch accounts at usage limits",
          bb: cell("yes", "Account Pooler, experimental"),
          competitor: cell("partial", "Tracks limits, you switch"),
        },
        {
          feature: "Multi-agent support",
          bb: cell(
            "yes",
            "Claude Code, Codex, Cursor, OpenCode, and any ACP agent",
          ),
          competitor: cell(
            "yes",
            "Claude Code, Codex, Cursor, OpenCode, and more",
          ),
        },
      ],
    },
    {
      title: "Everything you use today",
      rows: [
        {
          feature: "Git worktree per thread",
          bb: cell("yes", "Setup and teardown scripts"),
          competitor: cell("yes"),
        },
        {
          feature: "Review and merge",
          bb: cell("yes", "Line comments, checks, merge"),
          competitor: cell("yes"),
        },
        {
          feature: "Phone and remote access",
          bb: cell("yes", "iOS, Android, any browser"),
          competitor: cell("yes"),
        },
        {
          feature: "Go back to an earlier point",
          bb: cell("yes", "Edit a message or fork from it"),
          competitor: cell("yes"),
        },
      ],
    },
    {
      title: "Price and license",
      rows: [
        {
          feature: "Pricing",
          bb: price("$0", "Any team size"),
          competitor: price("$0", "No paid plan"),
        },
        {
          feature: "Open-source license",
          bb: cell("yes", "MIT"),
          competitor: cell("yes", "MIT"),
        },
      ],
    },
  ],
  faqTitle: "FAQ",
  faq: [
    {
      title: "Switching from T3 Code",
      items: [
        {
          question: "What’s the difference between bb and T3 Code?",
          answer: (
            <p>
              Both are free, MIT-licensed apps that run Claude Code, Codex, and
              other coding agents in Git worktrees on your own machines, with
              mobile and remote access, and both let agents hand work to each
              other. bb is built to be changed: install a plugin from the
              marketplace or have an agent build one, instead of keeping a fork.
              And in bb, every agent another agent starts is a full thread you
              can open and message mid-run.
            </p>
          ),
        },
        {
          question: "Is there a free, open-source T3 Code alternative?",
          answer: (
            <p>
              Yes: bb. It’s free for any team size and MIT-licensed, so you can
              use and change it for anything, including at work. Plugins add
              whatever you need without forking, and your agents work together
              across providers. <a href="/download/macos">Download bb</a>.
            </p>
          ),
        },
        {
          question: "How do I move my projects and worktrees to bb?",
          answer: (
            <p>
              Ask bb to do it. T3 Code keeps each thread’s worktree as plain Git
              on your machine, in <code>~/.t3/worktrees</code>, so a bb agent
              can add your repos and open each unfinished worktree as a thread.
              Your CLAUDE.md, skills, MCP servers, and agent sign-ins come
              along, and T3 Code keeps working while you try bb.
            </p>
          ),
        },
        {
          question: "What’s different day to day?",
          answer: (
            <ul>
              <li>
                When you want a new panel, command, or agent, you install or
                build a plugin instead of patching the app.
              </li>
              <li>
                When an agent starts another, the new one is a full thread you
                can message.
              </li>
              <li>
                Several threads can share one worktree, so a reviewer works
                right next to the agent that wrote the code.
              </li>
              <li>
                Setup commands from <code>t3.json</code> move to{" "}
                <code>.bb-env-setup.sh</code>, and untracked files like{" "}
                <code>.env</code> go in <code>.worktreeinclude</code>.
              </li>
            </ul>
          ),
        },
        FAQ_CUSTOMIZE,
        {
          question: "Do my skills and slash commands work in bb?",
          answer: (
            <p>
              Yes. bb reads each agent’s own skills and slash commands and shows
              them in that agent’s <code>/</code> menu, so the ones you use
              today keep working.
            </p>
          ),
        },
        FAQ_GET_STARTED,
      ],
    },
    {
      title: "Agents",
      items: [
        FAQ_AGENTS,
        FAQ_CODEX_TOGETHER,
        faqUsageLimit(
          "T3 Code shows your accounts’ limits, but you switch accounts yourself.",
        ),
        FAQ_PERMISSIONS,
      ],
    },
    {
      title: "Your T3 Code workflow in bb",
      items: [
        {
          question: "Does bb have setup scripts for new worktrees?",
          answer: (
            <p>
              Yes. Commit a <code>.bb-env-setup.sh</code> at your repo root and
              bb runs it in every new worktree. List untracked files like{" "}
              <code>.env</code> in <code>.worktreeinclude</code> and bb copies
              them in first, and <code>.bb-env-teardown.sh</code> cleans up when
              a worktree goes away.
            </p>
          ),
        },
        FAQ_REVIEW,
        {
          question: "Does bb have checkpoints?",
          answer: (
            <p>
              bb lets you rewind the conversation instead. Edit any earlier
              message to rerun the thread from there, or fork a new thread from
              any message to try a different approach. In a worktree thread,
              changes stay on that thread’s branch until you merge them.
            </p>
          ),
        },
        faqPhone(null),
        faqSchedule(null),
      ],
    },
    {
      title: "Price, platforms, and privacy",
      items: [
        faqFree(""),
        FAQ_SUBSCRIPTIONS,
        faqPlatforms(null),
        FAQ_PRIVACY,
        faqTeam(""),
      ],
    },
  ],
  closer: CLOSER,
};
