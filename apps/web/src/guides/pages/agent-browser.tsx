import { BrowserConcept } from "../concepts";
import { PromptBlock, Substeps } from "../guide-blocks";
import type { Guide, GuideFaq, GuideStep } from "../guide-types";

const AGENT_PROMPT = `Use a real browser to check my app, click through the change, and show me screenshots.
Guide: https://getbb.app/guides/agent-browser

You're in a bb thread with the bb CLI on PATH. Do every step below, with a Check after each step. Stop if a check fails and tell me what failed. Ask for the app URL and the flow to check if they aren't clear from this thread.

1. Set up browser access. Read bb guide browser and bb browser-automation --help. Enable Browser Automation with bb plugin enable browser-automation and Agent Annotations with bb plugin enable agent-annotations if they aren't enabled. Find this thread's machine with bb status --json and bb machine list.
   Check: both plugins are running and the chosen browser machine is connected.

2. Open the app. If it needs a dev server, use the project's documented command in a persistent bb terminal in this environment and verify the actual app route responds. For a flow that doesn't need my sign-ins, open headless Chrome on that machine:
   bb browser-automation open --backend local --headless --machine <host-id> --json
   If the flow needs my sign-ins or I asked to use the in-app Browser, run bb browser instances --host <desktop-host-id> --json, select the intended connected desktop instance, then:
   bb browser-automation open --backend desktop --machine <desktop-host-id> --desktop <instance-id> --json
   Ask if the intended desktop instance is ambiguous. Localhost means the browser's machine; use a reachable app URL if it differs from the dev server's machine. Keep the returned session ID. Emit the returned previewDirective once if present. Use bb browser-automation run to get a named page, navigate, and snapshot it.
   Check: the page shows the intended app. For a signed-in flow, verify the expected account. If signed out, use bb browser import-sources with the selected host, instance, and generation to discover sources. Ask me which source/profile to use, then run bb browser import-cookies with those exact values. If the source browser needs quitting, an OS prompt needs my input, or login is still needed, stop with that specific next action. Never read or print cookie values. Import is desktop-only and doesn't populate headless sessions.

3. Verify the change. Take a fresh snapshot, click through the requested flow using its element references, and check the visible result. Check the console and the layout at desktop and mobile sizes. Use bb browser-automation screenshot <session-id> --page <name> --json and inspect the returned images. Copy screenshots you will share into the workspace before closing the session; for another browser host, fetch them with bb file read. Fix failures within the requested change and recheck the affected flow.
   Check: the flow behaves as requested, the layout works at both sizes, and any console errors are explained. Report what you actually exercised and show the screenshots; don't call a screenshot alone a passing interaction test.

4. Leave the app ready for feedback. Close the automation session with bb browser-automation close and keep the preview server running. In desktop bb, use bb browser create with the selected host, instance, generation, current thread, URL, and --reveal to leave a Browser tab open for annotations. If no desktop instance is connected, explain that element annotations require the desktop app and give me the app URL. Tell me to choose Annotate elements, click the element, write the change, and choose Add to prompt. When I send an annotation, use its element context to make the change and verify it in a new browser session.
   Check: the automation session is closed, the preview route still responds, and the feedback tab is open when desktop is available. Report the URL, terminal ID, browser machine, screenshots, and anything you couldn't verify.`;

export const PLUGINS_STEP: GuideStep = {
  id: "plugins",
  title: "Turn on the browser plugins",
  lead: "Two built-in plugins give your agent a browser and let you point at what you mean.",
  body: (
    <>
      <Substeps>
        <li>
          Open <strong>Settings → Installed plugins</strong>.
        </li>
        <li>
          Turn on <strong>Browser Automation</strong>. Your agent can open
          Chrome on any connected Mac or Linux machine, or a tab in bb's own
          Browser, and click, type, and take screenshots.
        </li>
        <li>
          Turn on <strong>Agent Annotations</strong>. You can select an element
          in a Browser tab, say what should change, and add it to your prompt.
        </li>
      </Substeps>
    </>
  ),
  doneWhen: "both plugins are on in Settings → Installed plugins.",
};

export const SIGN_INS_STEP: GuideStep = {
  id: "sign-ins",
  title: "Bring your sign-ins",
  lead: "bb's Browser can start with the sites you're already signed in to.",
  body: (
    <Substeps>
      <li>
        In the bb desktop app, open <strong>Settings → Browser</strong>.
      </li>
      <li>
        Quit the browser you're importing from, choose{" "}
        <strong>Import from</strong> it, and pick the profile.
      </li>
      <li>
        Open the site in a <strong>Browser</strong> tab and check you're signed
        in. If it still asks, sign in there once.
      </li>
    </Substeps>
  ),
  doneWhen: "the site opens signed in, in a Browser tab in bb.",
};

export const ANNOTATE_STEP: GuideStep = {
  id: "annotate",
  title: "Point at what you mean",
  lead: "Select the element instead of describing where it is.",
  body: (
    <>
      <Substeps>
        <li>
          In a <strong>Browser</strong> tab, choose{" "}
          <strong>Annotate elements</strong> in the toolbar, then click the
          element. If your agent is still using the tab, choose{" "}
          <strong>Take over</strong> first.
        </li>
        <li>
          Under <strong>What should change?</strong>, write your note and choose{" "}
          <strong>Add to prompt</strong>.
        </li>
        <li>
          Send the prompt. Your agent gets your note with the page, the element,
          and its text and styles.
        </li>
      </Substeps>
      <p>
        Add as many pins as you like before sending. Click a numbered pin to
        edit its note.
      </p>
    </>
  ),
  doneWhen: "your note and the element show up in your prompt.",
};

export const BROWSER_FAQ: GuideFaq[] = [
  {
    question: "Which agents can use the browser?",
    answer: (
      <p>
        Any agent you run in a bb thread, including Claude Code, Codex, Cursor,
        and OpenCode. Turn on Browser Automation, then ask in plain words. You
        don't need Claude in Chrome or another browser extension.
      </p>
    ),
  },
  {
    question: "Do I need the desktop app?",
    answer: (
      <p>
        Not for a fresh browser: your agent can open Chrome on any connected Mac
        or Linux machine, and you can watch it in the thread. Your sign-ins, the
        Browser tab, and annotations need the bb desktop app.
      </p>
    ),
  },
  {
    question: "Can I watch what the agent is doing?",
    answer: (
      <p>
        Yes. A fresh browser shows a live preview in the thread. In a Browser
        tab, you see every click as it happens, with a bar that says the agent
        is controlling the tab. Choose <strong>Stop</strong> to end its control,
        or <strong>Take over</strong> to use the tab yourself.
      </p>
    ),
  },
  {
    question: "Why didn't my sign-in carry over?",
    answer: (
      <p>
        A fresh browser starts signed out. Ask your agent to use your Browser
        tab instead. Importing copies cookies once, so some sites still ask you
        to sign in again. Sign in once in the Browser tab and it sticks.
      </p>
    ),
  },
  {
    question: "What if my browser isn't listed for import?",
    answer: (
      <p>
        In <strong>Settings → Browser</strong>, choose <strong>Refresh</strong>,
        quit the source browser, and try again. On a Mac, Chrome and other
        Chromium browsers may ask for Keychain access, and Safari needs Full
        Disk Access. You can always sign in directly in bb's Browser.
      </p>
    ),
  },
  {
    question: "Can the browser run on a different computer from the agent?",
    answer: (
      <p>
        Yes. Ask for the browser on the machine you want. On that machine,{" "}
        <code>localhost</code> means that computer, so use an address it can
        reach.
      </p>
    ),
  },
  {
    question: "Can the agent upload files?",
    answer: (
      <p>
        Yes, from the computer the browser runs on. If the file is somewhere
        else, have the agent copy it there first, or choose{" "}
        <strong>Take over</strong> and upload it yourself.
      </p>
    ),
  },
  {
    question: "Why can't I annotate in the live preview?",
    answer: (
      <p>
        The live preview is for watching. Annotations work in a{" "}
        <strong>Browser</strong> tab in the desktop app, with Agent Annotations
        turned on.
      </p>
    ),
  },
  {
    question: "Can I point at a Figma design?",
    answer: (
      <p>
        Annotations select elements on a webpage, not layers inside a Figma
        canvas. Annotate the running app, and attach a screenshot of the design
        for reference.
      </p>
    ),
  },
  {
    question: "Why won't the browser start?",
    answer: (
      <p>
        Check that the machine is connected in{" "}
        <strong>Settings → Machines</strong>. The first run installs a browser
        on that machine, so it needs network access. For a Browser tab, the bb
        desktop app needs to be open.
      </p>
    ),
  },
  {
    question: "Does it need macOS Automation permission?",
    answer: (
      <p>
        No. Browser Automation talks to Chrome and bb's Browser directly, so it
        doesn't need Apple Events or Accessibility permission.
      </p>
    ),
  },
];

export const AGENT_BROWSER: Guide = {
  slug: "agent-browser",
  title: "Let your coding agent use a browser",
  description:
    "Have your coding agent open your app, click through its change, and show you screenshots. Then point at what to change instead of describing it.",
  concept: <BrowserConcept scene="code" />,
  picker: null,
  handoffNote:
    "Paste this into a thread with your app's address and what to check. Your agent opens a browser, tries the change, and shows you screenshots.",
  agentPrompt: AGENT_PROMPT,
  needs: [],
  steps: [
    PLUGINS_STEP,
    {
      id: "check",
      title: "Ask your agent to try its change",
      lead: "Give it a flow to exercise, and ask for screenshots.",
      body: (
        <>
          <PromptBlock
            name="Example"
            prompt="Start the dev server, open the app in a browser, and try the new issue filter at desktop and phone sizes. Fix anything broken, and show me screenshots."
          />
          <p>
            Your agent opens Chrome next to your dev server, clicks through the
            flow, checks the console, and posts screenshots in the thread. A
            live preview in the thread lets you watch.
          </p>
        </>
      ),
      doneWhen:
        "the thread shows screenshots of the change, and what the agent tried.",
    },
    {
      ...SIGN_INS_STEP,
      lead: "For pages behind a login, have your agent use bb's Browser with your sign-ins.",
    },
    ANNOTATE_STEP,
  ],
  sections: [
    {
      id: "knowledge-work",
      title: "Not just for code",
      body: (
        <p>
          The same browser handles research, signed-in dashboards, and forms.
          See{" "}
          <a href="/guides/agent-browser-for-work">
            Have an agent do your browser work
          </a>
          .
        </p>
      ),
    },
  ],
  faqTitle: "FAQ",
  faq: [
    {
      question: "Can it test my app at phone sizes?",
      answer: (
        <p>
          Yes. Ask for the sizes you care about, like “desktop and iPhone.” The
          agent resizes the browser and takes a screenshot at each size.
        </p>
      ),
    },
    {
      question: "Does my dev server need to run on the same machine?",
      answer: (
        <p>
          It's easiest. The agent can start the dev server in a terminal in the
          thread, then open it in a browser on the same machine.
        </p>
      ),
    },
    ...BROWSER_FAQ,
  ],
  closer: {
    title: "Let your agent try the app",
    body: "Free and open source. Use the agents you already have.",
  },
};
