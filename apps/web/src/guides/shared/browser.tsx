import type { ReactNode } from "react";

import { Substeps, Ui } from "../guide-blocks";
import type { GuideFaq, GuideShot, GuideStep } from "../guide-types";
import { AGENTS_FAQ } from "./faq";

export function annotateStep({
  title,
  lead,
  open,
  target,
  note,
  shot,
}: {
  title: string;
  lead: string;
  open: ReactNode;
  target: string;
  note: string;
  shot: GuideShot;
}): GuideStep {
  return {
    id: "annotate",
    title,
    lead,
    body: (
      <Substeps>
        <li>{open}</li>
        <li>
          Choose <Ui icon="annotate">Annotate elements</Ui> in the toolbar and
          click {target}.
        </li>
        <li>
          In the box, write {note} and choose <strong>Add to prompt</strong>.
          Add as many as you like, then send.
        </li>
      </Substeps>
    ),
    shot,
    options: [],
  };
}

export const PLUGINS_STEP: GuideStep = {
  id: "plugins",
  title: "Add the browser plugins",
  lead: (
    <>
      The <a href="/marketplace/browser-automation">Browser Automation</a>{" "}
      plugin gives your agent a browser. The{" "}
      <a href="/marketplace/agent-annotations">Agent Annotations</a> plugin lets
      you point at what you mean.
    </>
  ),
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
    src: "/guides/agent-browser/window-plugins-sidebar.png",
    alt: "bb's Plugins page with Browse plugins selected in the sidebar, a search for browser, and Browser Automation open with an Install button",
    width: 2048,
    height: 1280,
  },
  options: [],
};

export const SIGN_INS_STEP: GuideStep = {
  id: "sign-ins",
  title: "Import your browser logins",
  lead: "Your agent can open the sites you use, logged in as you.",
  body: (
    <Substeps>
      <li>
        In the bb desktop app, open <Ui icon="settings">Settings → Browser</Ui>.
      </li>
      <li>
        If a browser shows <strong>Running</strong>, quit it and choose{" "}
        <strong>Recheck</strong>.
      </li>
      <li>
        Choose <strong>Import…</strong> next to your browser, like Chrome, and
        pick a profile.
      </li>
    </Substeps>
  ),
  shot: {
    src: "/guides/agent-browser/window-sign-ins.png",
    alt: "bb's Browser settings listing Google Chrome (running, quit to import), Chromium with an Import button, and Safari needing Full Disk Access",
    width: 2048,
    height: 1280,
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
          <Ui icon="settings">Settings → Machines</Ui>.
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
          Import from <Ui icon="settings">Settings → Browser</Ui> again.
          Importing copies your logins once, so newer logins don't carry over.
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
  AGENTS_FAQ,
  {
    question: "Do I need the desktop app?",
    answer: (
      <p>
        Not for a fresh browser: your agent can open Chrome on any connected Mac
        or Linux machine, and you watch it in the thread. Browser tabs, your
        logins, and annotations need the desktop app.
      </p>
    ),
  },
  {
    question: "Can I stop the agent or step in?",
    answer: (
      <p>
        Yes. A Browser tab shows a bar while your agent controls it. Choose{" "}
        <strong>Take over</strong> to click and type yourself, like to enter a
        sign-in code, or <strong>Stop</strong> to end its control.
      </p>
    ),
  },
  {
    question: "Can my agent see my passwords?",
    answer: (
      <p>
        No. bb imports your logins, not your saved passwords, so your agent
        opens sites already signed in without seeing a password. Your logins
        stay in bb's Browser on this computer, and the prompt from{" "}
        <strong>Copy for agent</strong> tells your agent never to read or print
        them.
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
