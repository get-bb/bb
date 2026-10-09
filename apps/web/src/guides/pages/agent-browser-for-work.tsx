import AiMagicIcon from "@hugeicons/core-free-icons/AiMagicIcon";
import ComputerIcon from "@hugeicons/core-free-icons/ComputerIcon";
import InternetIcon from "@hugeicons/core-free-icons/InternetIcon";

import { BrowserConcept } from "../concepts";
import { BulletList, PromptBlock } from "../guide-blocks";
import { withIntake } from "../prompt-intake";
import type { Guide, GuideMeta } from "../guide-types";
import {
  annotateStep,
  BROWSER_FAQ,
  BROWSER_TROUBLESHOOTING,
  PLUGINS_STEP,
  SIGN_INS_STEP,
} from "../shared/browser";

const AGENT_PROMPT = withIntake(
  [
    { label: "Task", hint: "what you want found, compared, or filled in" },
    { label: "Sites", hint: "where to look" },
    { label: "Logins", hint: "sites that need your account, if any" },
    { label: "Bring back", hint: "e.g. a table with a source link per row" },
  ],
  `Use a real browser to do the web task above, and show me what you found.
Guide: https://getbb.app/guides/agent-browser-for-work

You're in a bb thread with the bb CLI on PATH. Do every step below, with a Check after each step. Stop if a check fails and tell me what failed.

1. Set up browser access. Run bb plugin list. Browser Automation isn't installed by default: install it with bb plugin install browser-automation if it's missing, or enable it with bb plugin enable browser-automation if it's off. Agent Annotations is built in but off: enable it with bb plugin enable agent-annotations. Then read bb guide browser and bb browser-automation --help.
   Check: both plugins are running.

2. Open a browser. Find the computer running the bb desktop app with bb machine list, then run bb browser instances --host <desktop-host-id> --json. If a desktop instance is connected, open a Browser tab there so I can watch and my sign-ins work:
   bb browser-automation open --backend desktop --machine <desktop-host-id> --desktop <instance-id> --json
   If no desktop instance is connected and Logins lists any site, stop and tell me signed-in sites need the bb desktop app open. Otherwise open headless Chrome on this thread's machine:
   bb browser-automation open --backend local --headless --machine <host-id> --json
   Keep the returned session ID. Emit the returned previewDirective once if present.
   Check: the first page loads. For a signed-in site, confirm the expected account is signed in. If it isn't, stop and ask me to sign in once in a Browser tab, or to import my sign-ins in Settings → Browser. Never read or print cookie values.

3. Do the task. Take a fresh snapshot before each action and use its element references. Read pages instead of guessing, and keep a list of the sources you used. If a page doesn't state a number, say so instead of filling it in from memory. Don't buy anything, send messages, submit forms that commit me to something, or change account settings unless I asked for exactly that; stop and ask first.
   Check: you have the information or result I asked for, with the page each fact came from.

4. Report and leave the tab for feedback. If you used a desktop Browser tab, stop controlling it with bb browser-automation stop <session-id> so it stays open on the most relevant page, and tell me I can choose Annotate elements to point at anything to change or dig into. If you used headless Chrome, close it with bb browser-automation close <session-id> and give me the page URLs instead.
   Check: reply with the result in the format from my Bring back answer (by default, a table with a source per row), a source link for each fact, screenshots of anything I should look at, and what you couldn't do.`,
);

export const meta: GuideMeta = {
  slug: "agent-browser-for-work",
  title: "Get research and reports from any site",
  nav: { group: "Automate", label: "Automate browser tasks", order: 4 },
  canonical: null,
};

export const guide: Guide = {
  ...meta,
  description:
    "Your agent compares pricing pages, pulls numbers from your dashboards, and fills in forms, in a browser you can watch.",
  concept: <BrowserConcept scene="work" />,
  picker: null,
  handoffNote:
    "Your agent asks what you need, then works in a browser and reports back with sources.",
  agentPrompt: AGENT_PROMPT,
  needs: [
    {
      title: "The bb desktop app",
      icon: ComputerIcon,
      body: "Your agent works in a Browser tab you can watch, logged in as you.",
    },
    {
      title: "An agent you're signed in to",
      icon: AiMagicIcon,
      body: "Claude Code, Codex, or another agent.",
    },
    {
      title: "The sites to use",
      icon: InternetIcon,
      body: "Public pages, or the dashboards and tools you sign in to.",
    },
  ],
  steps: [
    PLUGINS_STEP,
    {
      ...SIGN_INS_STEP,
      lead: "For dashboards and tools behind a login, start bb's Browser signed in.",
    },
    {
      id: "ask",
      title: "Ask for the job",
      lead: "Say what you need, which sites to use, and what to bring back.",
      body: (
        <>
          <p>
            Choose <strong>New thread</strong>, set the project to{" "}
            <strong>Don't work in a project</strong>, then paste your request:
          </p>
          <PromptBlock
            name="Example"
            prompt="Compare the cheapest paid plans of Linear, Trello, and Asana from their pricing pages: the plan name and its price per user per month, billed yearly. Work in a Browser tab here so I can watch. Put the result in a table and link each price to the page it came from."
          />
          <p>Jobs that work well:</p>
          <BulletList>
            <li>
              <strong>Research.</strong> Compare plans, pricing, or reviews
              across sites.
            </li>
            <li>
              <strong>Dashboards.</strong> Pull this week's numbers from
              analytics, billing, or ad accounts into one summary.
            </li>
            <li>
              <strong>Forms.</strong> Fill in the same details on several sites,
              and stop before anything is submitted.
            </li>
            <li>
              <strong>Every week.</strong> Pair it with an{" "}
              <a href="/guides/run-an-agent-on-a-schedule">automation</a> and
              have the report ready each morning.
            </li>
          </BulletList>
        </>
      ),
      shot: {
        src: "/guides/agent-browser-for-work/window-ask.png",
        alt: "A bb thread with a table of the cheapest paid plans of Linear, Trello, and Asana, each price linked to its pricing page, next to Asana's pricing page in a Browser tab",
        width: 2048,
        height: 1280,
      },
      options: [
        {
          title: "Watch it work, or step in",
          body: (
            <p>
              While your agent uses the tab, a bar shows it's in control. Choose{" "}
              <strong>Take over</strong> to click or type yourself, like for a
              two-factor code, or <strong>Stop</strong> to end its control.
            </p>
          ),
          shot: {
            src: "/guides/agent-browser-for-work/window-take-over.png",
            alt: "The agent reading Trello's pricing page in a bb Browser tab, under a bar that says Browser Automation is controlling this tab, with Stop and Take over",
            width: 2048,
            height: 1280,
          },
        },
      ],
    },
    annotateStep({
      title: "Point at what to dig into",
      lead: "Select the thing on the page instead of describing it.",
      open: (
        <>
          In the Browser tab, choose <strong>Take over</strong> if your agent
          still has it.
        </>
      ),
      target: "the text, number, or button",
      note: "your question or request",
      shot: {
        src: "/guides/agent-browser-for-work/window-annotate.png",
        alt: "Asana's pricing page in a bb Browser tab with the Starter price selected, and the note: Add each plan's monthly price as a second column.",
        width: 2048,
        height: 1280,
      },
    }),
  ],
  troubleshooting: BROWSER_TROUBLESHOOTING,
  faq: [
    {
      question: "Do I need a code project?",
      answer: (
        <p>
          No. When you start the thread, set the project to{" "}
          <strong>Don't work in a project</strong>, and ask for the job.
        </p>
      ),
    },
    {
      question: "Will it buy things or send messages for me?",
      answer: (
        <p>
          Only if you ask. The prompt from <strong>Copy for agent</strong> tells
          it to stop and ask before buying, sending, or submitting anything. You
          can choose <strong>Stop</strong> or <strong>Take over</strong> at any
          point.
        </p>
      ),
    },
    {
      question: "What if a site doesn't list the number I asked for?",
      answer: (
        <p>
          Ask your agent to say so instead of guessing, and to link the page it
          checked so you can look yourself.
        </p>
      ),
    },
    {
      question: "Can it handle two-factor sign-in?",
      answer: (
        <p>
          Choose <strong>Take over</strong>, enter the code yourself, and hand
          the tab back. Once you're signed in to a site in bb's Browser, it
          usually stays signed in.
        </p>
      ),
    },
    ...BROWSER_FAQ,
  ],
  closer: {
    title: "Get the answer, with sources",
    body: "Free and open source. Use the agents you already have.",
  },
};
