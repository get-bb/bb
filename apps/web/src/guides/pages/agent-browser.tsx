import AiMagicIcon from "@hugeicons/core-free-icons/AiMagicIcon";
import ComputerIcon from "@hugeicons/core-free-icons/ComputerIcon";
import GitBranchIcon from "@hugeicons/core-free-icons/GitBranchIcon";

import { BrowserConcept } from "../concepts";
import { PromptBlock, Substeps } from "../guide-blocks";
import { withIntake } from "../prompt-intake";
import type { Guide, GuideFaq, GuideStep } from "../guide-types";

const AGENT_PROMPT = withIntake(
  [
    { label: "App URL", hint: "e.g. http://localhost:3000" },
    { label: "Flow to check", hint: "the change to click through" },
    { label: "Screen sizes", hint: "e.g. desktop and phone" },
    { label: "Needs a sign-in", hint: "yes or no" },
  ],
  `Use a real browser to check my app, click through the change, and show me screenshots.
Guide: https://getbb.app/guides/agent-browser

You're in a bb thread with the bb CLI on PATH. Do every step below, with a Check after each step. Stop if a check fails and tell me what failed.

1. Set up browser access. Read bb guide browser and bb browser-automation --help. Run bb plugin list. Browser Automation isn't installed by default: install it with bb plugin install browser-automation if it's missing, or enable it with bb plugin enable browser-automation if it's disabled. Agent Annotations is built in but off: enable it with bb plugin enable agent-annotations. Find this thread's machine with bb status --json and bb machine list.
   Check: both plugins are running and the chosen browser machine is connected.

2. Open the app. If it needs a dev server, use the project's documented command in a persistent bb terminal in this environment and verify the actual app route responds. For a flow that doesn't need my sign-ins, open headless Chrome on that machine:
   bb browser-automation open --backend local --headless --machine <host-id> --json
   If the flow needs my sign-ins or I asked to use the in-app Browser, run bb browser instances --host <desktop-host-id> --json, select the intended connected desktop instance, then:
   bb browser-automation open --backend desktop --machine <desktop-host-id> --desktop <instance-id> --json
   Ask if the intended desktop instance is ambiguous. Localhost means the browser's machine; use a reachable app URL if it differs from the dev server's machine. Keep the returned session ID. Emit the returned previewDirective once if present. Use bb browser-automation run to get a named page, navigate, and snapshot it.
   Check: the page shows the intended app. For a signed-in flow, verify the expected account. If signed out, use bb browser import-sources with the selected host, instance, and generation to discover sources. Ask me which source/profile to use, then run bb browser import-cookies with those exact values. If the source browser needs quitting, an OS prompt needs my input, or login is still needed, stop with that specific next action. Never read or print cookie values. Import is desktop-only and doesn't populate headless sessions.

3. Verify the change. Take a fresh snapshot, click through the requested flow using its element references, and check the visible result. Check the console and the layout at desktop and phone sizes. Use bb browser-automation screenshot <session-id> --page <name> --json and inspect the returned images. Show the screenshots that matter in this thread as images; for another browser host, fetch them with bb file read. Fix failures within the requested change and recheck the affected flow.
   Check: the flow behaves as requested, the layout works at both sizes, and any console errors are explained. Report what you actually exercised and show the screenshots; don't call a screenshot alone a passing interaction test.

4. Leave the app ready for feedback. Close the automation session with bb browser-automation close and keep the preview server running. In desktop bb, use bb browser create with the selected host, instance, generation, current thread, URL, and --reveal to leave a Browser tab open for annotations. If no desktop instance is connected, explain that element annotations require the desktop app and give me the app URL. Tell me to choose Annotate elements, click the element, write the change, and choose Add to prompt. When I send an annotation, use its element context to make the change and verify it in a new browser session.
   Check: the automation session is closed, the preview route still responds, and the feedback tab is open when desktop is available. Report the URL, terminal ID, browser machine, screenshots, and anything you couldn't verify.`,
);

export const PLUGINS_STEP: GuideStep = {
  id: "plugins",
  title: "Add the browser plugins",
  lead: "Browser Automation gives your agent a browser. Agent Annotations lets you point at what you mean.",
  body: (
    <Substeps>
      <li>
        Choose <strong>Plugins</strong> in the sidebar, search for “browser”,
        open <strong>Browser Automation</strong>, and choose{" "}
        <strong>Install</strong>. It's made by bb but isn't installed until you
        add it.
      </li>
      <li>
        Agent Annotations comes with bb, turned off. Open{" "}
        <strong>Installed plugins</strong> and switch on{" "}
        <strong>Agent Annotations</strong>.
      </li>
    </Substeps>
  ),
  shot: {
    src: "/guides/agent-browser/window-plugins.png",
    alt: "bb's Installed plugins page with Agent Annotations switched on, and Browser Automation open beside it, switched on",
  },
  options: [],
};

export const SIGN_INS_STEP: GuideStep = {
  id: "sign-ins",
  title: "Bring your sign-ins",
  lead: "bb's Browser can start signed in to the sites you already use.",
  body: (
    <Substeps>
      <li>
        In the bb desktop app, open <strong>Settings → Browser</strong>.
      </li>
      <li>
        If a browser shows <strong>Running</strong>, quit it and choose{" "}
        <strong>Recheck</strong>.
      </li>
      <li>
        Choose <strong>Import…</strong> and pick the profile. Safari first asks
        for Full Disk Access: choose <strong>Grant access…</strong>.
      </li>
    </Substeps>
  ),
  shot: {
    src: "/guides/agent-browser/window-sign-ins.png",
    alt: "bb's Browser settings listing Google Chrome (running, quit to import), Chromium with an Import button, and Safari needing Full Disk Access",
  },
  options: [],
};

export const BROWSER_TROUBLESHOOTING: [GuideFaq, ...GuideFaq[]] = [
  {
    question: "Browser Automation isn't in my installed plugins",
    answer: (
      <ol>
        <li>
          It's not installed by default. Choose <strong>Plugins</strong>, search
          for “browser”, and open <strong>Browser Automation</strong>.
        </li>
        <li>
          Choose <strong>Install</strong>, then confirm. It turns on right away.
        </li>
      </ol>
    ),
  },
  {
    question: "I don't see Annotate elements",
    answer: (
      <ol>
        <li>
          Use the bb desktop app. Annotations only work in a{" "}
          <strong>Browser</strong> tab there, not in the web app or the live
          preview in a thread.
        </li>
        <li>
          In <strong>Installed plugins</strong>, switch on{" "}
          <strong>Agent Annotations</strong>.
        </li>
        <li>
          If your agent is using the tab, choose <strong>Take over</strong>{" "}
          first.
        </li>
      </ol>
    ),
  },
  {
    question: "The browser won't start",
    answer: (
      <ol>
        <li>
          Check that the machine is connected in{" "}
          <strong>Settings → Machines</strong>.
        </li>
        <li>
          The first run installs the browser tools on that machine, so it needs
          network access and npm. A fresh browser also needs Chrome or Chromium
          installed there.
        </li>
        <li>
          For a Browser tab, keep the bb desktop app open, then ask again.
        </li>
      </ol>
    ),
  },
  {
    question: "The site still asks me to sign in",
    answer: (
      <ol>
        <li>
          A fresh browser starts signed out. Ask your agent to use a Browser tab
          instead.
        </li>
        <li>
          Import from <strong>Settings → Browser</strong> again. Importing
          copies your sign-ins once, so newer sign-ins don't carry over.
        </li>
        <li>
          Still signed out? Sign in once in a Browser tab. It stays signed in.
        </li>
      </ol>
    ),
  },
  {
    question: "I can't import from my browser",
    answer: (
      <ol>
        <li>
          Quit that browser completely, then choose <strong>Recheck</strong>.
        </li>
        <li>
          For Safari, choose <strong>Grant access…</strong> and turn on Full
          Disk Access for bb. Chrome may ask for Keychain access; allow it.
        </li>
        <li>
          Choose <strong>Refresh</strong> to look for browsers again.
        </li>
      </ol>
    ),
  },
  {
    question: "The live preview says Ended",
    answer: (
      <p>
        Your agent closed its browser, or it sat unused for five minutes. The
        thread keeps the last view. Ask your agent to open it again.
      </p>
    ),
  },
];

export const BROWSER_FAQ: GuideFaq[] = [
  {
    question: "Which agents can use the browser?",
    answer: (
      <p>
        Any agent you run in a bb thread, including Claude Code, Codex, Cursor,
        and OpenCode. You don't need a browser extension.
      </p>
    ),
  },
  {
    question: "Do I need the desktop app?",
    answer: (
      <p>
        Not for a fresh browser: your agent can open Chrome on any connected Mac
        or Linux machine, and you watch it in the thread. Browser tabs, your
        sign-ins, and annotations need the desktop app.
      </p>
    ),
  },
  {
    question: "Can I stop the agent or step in?",
    answer: (
      <p>
        Yes. A Browser tab shows a bar while your agent controls it. Choose{" "}
        <strong>Stop</strong> to end its control, or <strong>Take over</strong>{" "}
        to click and type yourself.
      </p>
    ),
  },
  {
    question: "Can the browser run on a different computer?",
    answer: (
      <p>
        Yes. Ask for the browser on the machine you want. There,{" "}
        <code>localhost</code> means that computer, so use an address it can
        reach.
      </p>
    ),
  },
  {
    question: "Does it need macOS Automation permission?",
    answer: (
      <p>
        No. Browser Automation talks to Chrome and bb's Browser directly, so it
        doesn't need Accessibility or Automation permission.
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
    "Fill in your app's address and what to check, or leave them and your agent asks. It opens a browser, tries the change, and shows you screenshots.",
  agentPrompt: AGENT_PROMPT,
  needs: [
    {
      title: "An agent you're signed in to",
      icon: AiMagicIcon,
      body: "Claude Code, Codex, or another agent.",
    },
    {
      title: "A project with a web app",
      icon: GitBranchIcon,
      body: "The repo your agent changes, with a dev server it can start.",
    },
    {
      title: "The bb desktop app",
      icon: ComputerIcon,
      body: "For Browser tabs, your sign-ins, and annotations.",
    },
  ],
  steps: [
    PLUGINS_STEP,
    {
      id: "check",
      title: "Ask your agent to try its change",
      lead: "Give it a flow to exercise and the screen sizes you care about.",
      body: (
        <>
          <PromptBlock
            name="Example"
            prompt="I just added status filters to the Orders page. Start the dev server, open the app in a browser, and try the filters at desktop and phone sizes. Fix anything broken, and show me screenshots."
          />
          <p>
            Your agent starts the dev server, opens a browser next to it, and
            clicks through the flow. A live preview in the thread lets you
            watch.
          </p>
        </>
      ),
      shot: {
        src: "/guides/agent-browser/window-check.png",
        alt: "A bb thread asking the agent to try new order filters, with a live preview of the Acme Store Orders page in the agent's browser",
      },
      options: [
        {
          title: "See the screenshots",
          body: (
            <p>
              Ask for them in the thread, like “show me the phone screenshots,
              before and after.” Here, the agent found the search box and Total
              column cut off on a phone, fixed the CSS, and posted both.
            </p>
          ),
          shot: {
            src: "/guides/agent-browser/window-screenshots.png",
            alt: "The agent's before screenshot in a bb thread: the Orders page on a phone with the search box and Total column cut off",
          },
        },
      ],
    },
    {
      ...SIGN_INS_STEP,
      lead: "For pages behind a login, your agent can work in a Browser tab with your sign-ins.",
    },
    {
      id: "annotate",
      title: "Point at what to change",
      lead: "Select the element instead of describing where it is.",
      body: (
        <Substeps>
          <li>
            In the thread's side panel (⌘ J), choose <strong>+</strong>, then{" "}
            <strong>Open browser</strong>, and enter your app's address.
          </li>
          <li>
            Choose <strong>Annotate elements</strong> in the toolbar and click
            the element.
          </li>
          <li>
            Under <strong>What should change?</strong>, write your note and
            choose <strong>Add to prompt</strong>. Add as many as you like, then
            send.
          </li>
        </Substeps>
      ),
      shot: {
        src: "/guides/agent-browser/window-annotate.png",
        alt: "A Browser tab in bb with the All filter selected for annotation, and the note: Use our brand blue for the selected filter, like Export CSV",
      },
      options: [],
    },
  ],
  troubleshooting: BROWSER_TROUBLESHOOTING,
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
          It's easiest. The agent starts the dev server in a terminal in the
          thread, then opens it in a browser on the same machine.
        </p>
      ),
    },
    {
      question: "Can I point at a Figma design?",
      answer: (
        <p>
          Annotations select elements on a webpage, not layers in Figma.
          Annotate the running app, and attach a screenshot of the design for
          reference.
        </p>
      ),
    },
    {
      question: "Can it do more than test my app?",
      answer: (
        <p>
          Yes. The same browser handles research, signed-in dashboards, and
          forms. See{" "}
          <a href="/guides/agent-browser-for-work">
            Get research and reports from any site
          </a>
          .
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
