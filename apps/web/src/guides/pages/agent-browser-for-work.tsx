import { BrowserConcept } from "../concepts";
import { PromptBlock } from "../guide-blocks";
import type { Guide } from "../guide-types";
import {
  ANNOTATE_STEP,
  BROWSER_FAQ,
  PLUGINS_STEP,
  SIGN_INS_STEP,
} from "./agent-browser";

const AGENT_PROMPT = `Use a real browser to do the web task I describe, with my sign-ins, and show me what you found.
Guide: https://getbb.app/guides/agent-browser-for-work

You're in a bb thread with the bb CLI on PATH. Do every step below, with a Check after each step. Stop if a check fails and tell me what failed. If I haven't described the task, or it's unclear which sites and accounts to use, ask me first.

1. Set up browser access. Read bb guide browser and bb browser-automation --help. Enable Browser Automation with bb plugin enable browser-automation and Agent Annotations with bb plugin enable agent-annotations if they aren't enabled.
   Check: both plugins are running.

2. Open a browser. If the task needs my sign-ins, run bb browser instances --json, pick the connected desktop instance, and open a tab there:
   bb browser-automation open --backend desktop --machine <desktop-host-id> --desktop <instance-id> --json
   Otherwise open headless Chrome on this thread's machine:
   bb browser-automation open --backend local --headless --machine <host-id> --json
   Keep the returned session ID. Emit the returned previewDirective once if present.
   Check: the first page loads. For a signed-in site, confirm the expected account is signed in. If it isn't, stop and ask me to sign in once in bb's Browser tab, or to import my sign-ins in Settings → Browser. Never read or print cookie values.

3. Do the task. Take a fresh snapshot before each action and use its element references. Read pages instead of guessing, and keep a list of the sources you used. Don't buy anything, send messages, submit forms that commit me to something, or change account settings unless I asked for exactly that; stop and ask first.
   Check: you have the information or result I asked for, with the page each fact came from.

4. Report and leave the tab for feedback. Close the automation session with bb browser-automation close. If a desktop instance is connected, leave a Browser tab open on the most relevant page so I can use Annotate elements to point at anything to change or dig into.
   Check: reply with the result, a source link for each fact, screenshots of anything I should look at, and what you couldn't do.`;

export const AGENT_BROWSER_FOR_WORK: Guide = {
  slug: "agent-browser-for-work",
  title: "Have an agent do your browser work",
  description:
    "Research across sites, pull numbers from the dashboards you sign in to, and fill in the forms you'd rather not. Your agent uses your sign-ins, and you point at what you mean.",
  concept: <BrowserConcept scene="work" />,
  picker: null,
  handoffNote:
    "Paste this into a thread with the task and the sites to use. Your agent works in a browser and reports what it found, with sources.",
  agentPrompt: AGENT_PROMPT,
  needs: [],
  steps: [
    PLUGINS_STEP,
    SIGN_INS_STEP,
    {
      id: "ask",
      title: "Ask for the job",
      lead: "Say what you need, which sites to use, and what to bring back.",
      body: (
        <>
          <PromptBlock
            name="Example"
            prompt="Open our billing portal, collect this quarter's invoices, and add each month's total to a table. Link every number to the invoice it came from."
          />
          <p>
            Your agent works in a Browser tab you can watch. Choose{" "}
            <strong>Take over</strong> any time to step in yourself, like for a
            two-factor code.
          </p>
        </>
      ),
      doneWhen:
        "the thread has the result, with a link to where each fact came from.",
    },
    ANNOTATE_STEP,
  ],
  sections: [
    {
      id: "what-it-does",
      title: "Hand off the clicking",
      body: (
        <ul className="gd-list">
          <li>
            <strong>Research.</strong> Compare plans, pricing, or reviews across
            sites, with a source for every claim.
          </li>
          <li>
            <strong>Signed-in dashboards.</strong> Pull this week's numbers from
            analytics, billing, or ad accounts into one summary.
          </li>
          <li>
            <strong>Forms and admin.</strong> Fill in the same details across
            several sites, and stop before anything is submitted.
          </li>
          <li>
            <strong>Every week.</strong> Pair it with an{" "}
            <a href="/guides/run-an-agent-on-a-schedule">automation</a> and get
            the report before you start your day.
          </li>
        </ul>
      ),
    },
  ],
  faqTitle: "FAQ",
  faq: [
    {
      question: "Do I need a code project?",
      answer: (
        <p>
          No. Start a thread with <strong>No project</strong> picked, and ask
          for the job.
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
    title: "Hand off the clicking",
    body: "Free and open source. Use the agents you already have.",
  },
};
