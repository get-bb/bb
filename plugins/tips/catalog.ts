import type {
  TipAction,
  TipClient,
  TipId,
  TipTone,
  TipView,
} from "./contract.js";

export const ACCOUNT_POOL_PLUGIN_ID = "account-pool";
export const AUTOMATIONS_PLUGIN_ID = "automations";
export const BROWSER_AUTOMATION_PLUGIN_ID = "browser-automation";
export const PROVIDER_USAGE_PLUGIN_ID = "bb--provider-usage";
export const PUSH_NOTIFICATIONS_PLUGIN_ID = "push-notifications";

export interface TipSignals {
  client: TipClient | null;
  projectId: string | null;
  serverPlatform: string;
  appVersion: string | null;
  firstSeenVersion: string | null;
  daysSinceFirstSeen: number;
  threadCount: number;
  availableProviderCount: number;
  installedPlugins: Readonly<Record<string, boolean>>;
  hasFinishedThread: boolean;
  finishedThreadCount: number;
  hasChildThread: boolean;
  hasAutomationThread: boolean;
  projectHasChildThread: boolean;
  projectHasAutomationThread: boolean;
  waitingThreadCount: number;
  rateLimited: boolean;
  recentlyRateLimited: boolean;
  queuedFollowUp: boolean;
  usedMobileApp: boolean;
}

export const CATALOG_REVIEWED_THROUGH = "0.46.0";

export interface TipSource {
  kind: "changelog" | "blog" | "guide" | "feature";
  ref: string;
  version?: string;
}

export type TipTier = 1 | 2 | 3 | "unranked";

export interface TipDefinition {
  id: string;
  title: string;
  body: string;
  illustration: string;
  tone: TipTone;
  action: TipAction;
  source: TipSource;
  addedAt: string;
  reviewedAt: string;
  expiresAt?: string;
  held: boolean;
  tier: TipTier;
  priority: number;
  perVersion: boolean;
  eligible(signals: TipSignals): boolean;
  retireWhen(signals: TipSignals): boolean;
  boost(signals: TipSignals): number;
}

export const TIP_TITLE_MAX = 45;
export const TIP_BODY_MAX = 110;
const WAITING_THREADS_FOR_TIP = 2;
const WAITING_BOOST = 2000;
const RATE_LIMIT_BOOST = 1500;
const NEW_VERSION_BOOST = 1000;
const POWER_USER_THREAD_COUNT = 50;
const NEW_USER_DAYS = 14;

function isInstalled(signals: TipSignals, pluginId: string): boolean {
  return pluginId in signals.installedPlugins;
}

function isEnabled(signals: TipSignals, pluginId: string): boolean {
  return signals.installedPlugins[pluginId] === true;
}

function onClient(
  signals: TipSignals,
  test: (client: TipClient) => boolean,
): boolean {
  return signals.client === null || test(signals.client);
}

function hasKeyboard(client: TipClient): boolean {
  return client.surface === "desktop" || client.surface === "web";
}

function isWindowsClient(client: TipClient): boolean {
  return client.os === "windows";
}

function never(): boolean {
  return false;
}

function noBoost(): number {
  return 0;
}

function usesChildThreadsHere(signals: TipSignals): boolean {
  return signals.projectId === null
    ? signals.hasChildThread
    : signals.projectHasChildThread;
}

function usesAutomationsHere(signals: TipSignals): boolean {
  return signals.projectId === null
    ? signals.hasAutomationThread
    : signals.projectHasAutomationThread;
}

export function walkthroughPrompt(goal: string): string {
  return `Walk me through ${goal} in this bb, one step at a time, and check each step with me. If the interactive_answer tool is available, show the steps as an interactive answer; otherwise reply with plain numbered steps.`;
}

type TipDefaults = "held" | "perVersion" | "retireWhen" | "boost";

function tip(
  definition: Omit<TipDefinition, TipDefaults | "id"> &
    Partial<Pick<TipDefinition, TipDefaults>> & { id: TipId },
): TipDefinition {
  return {
    held: false,
    perVersion: false,
    retireWhen: never,
    boost: noBoost,
    ...definition,
  };
}

export const TIP_CATALOG: readonly TipDefinition[] = [
  tip({
    id: "whats-new",
    illustration: "whats-new",
    tone: "amber",
    source: { kind: "changelog", ref: "/settings/updates#whats-new" },
    addedAt: "0.46.0",
    reviewedAt: "0.46.0",
    title: "What's new in v{version}",
    body: "See what changed in this update.",
    action: {
      kind: "open-page",
      label: "See what's new",
      path: "/settings/updates#whats-new",
    },
    tier: "unranked",
    priority: 130,
    perVersion: true,
    boost: () => NEW_VERSION_BOOST,
    eligible: (signals) =>
      signals.appVersion !== null &&
      signals.firstSeenVersion !== null &&
      signals.appVersion !== signals.firstSeenVersion,
  }),
  tip({
    id: "account-pool",
    illustration: "account-pool",
    tone: "orange",
    source: { kind: "feature", ref: "account-pool plugin" },
    addedAt: "0.46.0",
    reviewedAt: "0.46.0",
    title: "Keep working through usage limits",
    body: "When an account hits its limit, Account Pooler moves the thread to another one you own.",
    action: {
      kind: "open-plugin",
      label: "Set up Account Pooler",
      pluginId: ACCOUNT_POOL_PLUGIN_ID,
    },
    tier: "unranked",
    priority: 120,
    eligible: (signals) =>
      isInstalled(signals, ACCOUNT_POOL_PLUGIN_ID) &&
      (signals.rateLimited || signals.threadCount >= POWER_USER_THREAD_COUNT),
    retireWhen: (signals) => isEnabled(signals, ACCOUNT_POOL_PLUGIN_ID),
    boost: (signals) => (signals.recentlyRateLimited ? RATE_LIMIT_BOOST : 0),
  }),
  tip({
    id: "child-threads",
    illustration: "child-threads",
    tone: "blue",
    source: { kind: "feature", ref: "child-threads" },
    addedAt: "0.46.0",
    reviewedAt: "0.46.0",
    title: "Run work in parallel",
    body: "Ask bb to try three approaches at once in child threads, or to have one review this work.",
    action: {
      kind: "prompt",
      label: "Try it",
      prompt:
        "Spin up three child threads that each try a different approach to this task, then compare their results and recommend one. Task: ",
    },
    tier: 1,
    priority: 110,
    eligible: (signals) =>
      signals.hasFinishedThread && !usesChildThreadsHere(signals),
  }),
  tip({
    id: "set-up-for-me",
    illustration: "set-up-for-me",
    tone: "green",
    source: { kind: "feature", ref: "bb self-configuration" },
    addedAt: "0.46.0",
    reviewedAt: "0.46.0",
    title: "Ask bb to set things up",
    body: "bb can change its own settings, add machines, and configure providers when you ask.",
    action: {
      kind: "prompt",
      label: "Try it",
      prompt:
        "Review my bb setup (settings, machines, and providers), suggest improvements, and make the changes I approve.",
    },
    tier: "unranked",
    priority: 100,
    eligible: (signals) => signals.hasFinishedThread,
  }),
  tip({
    id: "phone",
    illustration: "phone",
    tone: "rose",
    source: { kind: "feature", ref: "mobile app" },
    addedAt: "0.46.0",
    reviewedAt: "0.46.0",
    title: "Check on your agents from your phone",
    body: "The bb mobile app lets you follow threads and answer questions away from your desk.",
    action: {
      kind: "prompt",
      label: "Walk me through it",
      prompt: walkthroughPrompt("connecting the bb mobile app on my phone"),
    },
    tier: 1,
    priority: 90,
    eligible: (signals) =>
      signals.hasFinishedThread &&
      onClient(
        signals,
        (client) => client.surface === "desktop" || client.surface === "web",
      ),
    retireWhen: (signals) => signals.usedMobileApp,
  }),
  tip({
    id: "browser-automation",
    illustration: "browser-automation",
    tone: "green",
    source: { kind: "feature", ref: "browser-automation plugin" },
    addedAt: "0.46.0",
    reviewedAt: "0.46.0",
    title: "Let the agent test your app",
    body: "Your agent can turn on Browser Automation, click through your app, and report what breaks.",
    action: {
      kind: "prompt",
      label: "Try it",
      prompt:
        "Turn on the Browser Automation plugin if it is off, then open my app in a browser, click through the main flow, and tell me what is broken.",
    },
    tier: "unranked",
    priority: 80,
    eligible: (signals) =>
      signals.hasFinishedThread &&
      signals.serverPlatform !== "win32" &&
      onClient(signals, (client) => !isWindowsClient(client)),
    retireWhen: (signals) => isEnabled(signals, BROWSER_AUTOMATION_PLUGIN_ID),
  }),
  tip({
    id: "build-plugin",
    illustration: "build-plugin",
    tone: "amber",
    source: { kind: "guide", ref: "bb guide plugins" },
    addedAt: "0.46.0",
    reviewedAt: "0.46.0",
    title: "Ask the agent to build you a tool",
    body: "Your agent can write bb plugins for you, from a dashboard page to a new panel or command.",
    action: {
      kind: "prompt",
      label: "Walk me through it",
      prompt: walkthroughPrompt("building and installing my first bb plugin"),
    },
    tier: 1,
    priority: 75,
    eligible: (signals) =>
      signals.hasFinishedThread && signals.daysSinceFirstSeen <= NEW_USER_DAYS,
  }),
  tip({
    id: "open-threads-that-need-me",
    illustration: "open-threads-that-need-me",
    tone: "orange",
    source: { kind: "feature", ref: "split panes" },
    addedAt: "0.46.0",
    reviewedAt: "0.46.0",
    title: "See every thread that needs you",
    body: "Ask bb to open each thread that is waiting on you side by side in split panes.",
    action: {
      kind: "prompt",
      label: "Try it",
      prompt:
        "Find my threads that are waiting on me (open questions, errors, or unread results) and open them side by side in split panes with bb thread open --split.",
    },
    tier: "unranked",
    priority: 70,
    eligible: (signals) =>
      signals.waitingThreadCount >= WAITING_THREADS_FOR_TIP &&
      onClient(signals, hasKeyboard),
    boost: (signals) => WAITING_BOOST + signals.waitingThreadCount,
  }),
  tip({
    id: "morning-digest",
    illustration: "morning-digest",
    tone: "rose",
    source: { kind: "feature", ref: "automations with Browser Automation" },
    addedAt: "0.46.0",
    reviewedAt: "0.46.0",
    title: "Get a morning email digest",
    body: "An automation can read your inbox in bb's browser each morning and send you a short digest.",
    action: {
      kind: "prompt",
      label: "Try it",
      prompt:
        "Set up an automation that runs every weekday at 8am, uses Browser Automation to read my unread email in bb's browser (where I am signed in), and writes me a short digest of what needs my attention. Turn on Browser Automation first if it is off.",
    },
    tier: "unranked",
    priority: 65,
    eligible: (signals) =>
      signals.finishedThreadCount >= 3 &&
      isEnabled(signals, AUTOMATIONS_PLUGIN_ID) &&
      signals.serverPlatform !== "win32" &&
      onClient(signals, (client) => !isWindowsClient(client)),
  }),
  tip({
    id: "decision-buttons",
    illustration: "decision-buttons",
    tone: "green",
    source: { kind: "guide", ref: "bb guide plugins" },
    addedAt: "0.46.0",
    reviewedAt: "0.46.0",
    title: "Turn decisions into buttons",
    body: "Ask the agent for a plugin that shows the choices it needs from you as one-click buttons.",
    action: {
      kind: "prompt",
      label: "Try it",
      prompt:
        "Build me a bb plugin that gives you a tool to ask me a decision with one-click answer buttons in the thread, then use it whenever you need a choice from me.",
    },
    tier: 1,
    priority: 60,
    eligible: (signals) => signals.finishedThreadCount >= 3,
  }),
  tip({
    id: "automations",
    illustration: "automations",
    tone: "blue",
    source: { kind: "feature", ref: "automations plugin" },
    addedAt: "0.46.0",
    reviewedAt: "0.46.0",
    title: "Run a prompt on a schedule",
    body: "Ask the agent to turn any prompt into an automation that runs every morning or every hour.",
    action: {
      kind: "prompt",
      label: "Try it",
      prompt: "Create an automation that runs every weekday at 9am and ",
    },
    tier: "unranked",
    priority: 150,
    eligible: (signals) =>
      signals.finishedThreadCount >= 5 &&
      isEnabled(signals, AUTOMATIONS_PLUGIN_ID) &&
      !usesAutomationsHere(signals),
  }),
  tip({
    id: "queue-or-steer",
    illustration: "queue-or-steer",
    tone: "amber",
    source: { kind: "feature", ref: "queue and steer" },
    addedAt: "0.46.0",
    reviewedAt: "0.46.0",
    title: "Add to a running turn",
    body: "While the agent works, steer to change course now or queue a follow-up for when it finishes.",
    action: {
      kind: "open-page",
      label: "Choose what Enter does",
      path: "/settings",
    },
    tier: 3,
    priority: 50,
    eligible: (signals) => signals.finishedThreadCount >= 3,
    retireWhen: (signals) => signals.queuedFollowUp,
  }),
  tip({
    id: "thread-search",
    illustration: "thread-search",
    tone: "blue",
    source: { kind: "feature", ref: "thread search" },
    addedAt: "0.46.0",
    reviewedAt: "0.46.0",
    title: "Jump to any thread",
    body: "Press {searchKeys} to search your threads.",
    action: {
      kind: "run-command",
      label: "Search threads",
      commandId: "thread.search",
    },
    tier: "unranked",
    priority: 42,
    eligible: (signals) =>
      signals.threadCount >= 10 && onClient(signals, hasKeyboard),
  }),
  tip({
    id: "command-palette",
    illustration: "command-palette",
    tone: "rose",
    source: { kind: "feature", ref: "command palette" },
    addedAt: "0.46.0",
    reviewedAt: "0.46.0",
    title: "Do anything from the keyboard",
    body: "Press {paletteKeys} to search bb's commands and settings.",
    action: {
      kind: "run-command",
      label: "Open palette",
      commandId: "palette.open",
    },
    tier: "unranked",
    priority: 40,
    eligible: (signals) =>
      signals.daysSinceFirstSeen >= 3 && onClient(signals, hasKeyboard),
  }),
  tip({
    id: "another-agent",
    illustration: "another-agent",
    tone: "amber",
    source: { kind: "feature", ref: "multiple providers" },
    addedAt: "0.46.0",
    reviewedAt: "0.46.0",
    title: "Try a second agent on the same task",
    body: "Ask bb to hand this task to another agent in a child thread, then compare the two results.",
    action: {
      kind: "prompt",
      label: "Try it",
      prompt:
        "Start a child thread that does this task with a different agent provider than the one you are using, then compare both results and tell me which is better. Task: ",
    },
    tier: 1,
    priority: 105,
    eligible: (signals) =>
      signals.hasFinishedThread && signals.availableProviderCount >= 2,
  }),
  tip({
    id: "remote-access",
    illustration: "remote-access",
    tone: "orange",
    source: { kind: "feature", ref: "connect plugin" },
    addedAt: "0.46.0",
    reviewedAt: "0.46.0",
    title: "Open bb from another computer",
    body: "bb connect gives your bb a private web address, so you can reach it from any browser.",
    action: {
      kind: "prompt",
      label: "Walk me through it",
      prompt: walkthroughPrompt("turning on bb connect"),
    },
    tier: 2,
    priority: 95,
    eligible: (signals) =>
      signals.hasFinishedThread &&
      onClient(
        signals,
        (client) => client.surface === "desktop" || client.surface === "web",
      ),
  }),
  tip({
    id: "bb-cli",
    illustration: "bb-cli",
    tone: "blue",
    source: { kind: "guide", ref: "bb guide cli" },
    addedAt: "0.46.0",
    reviewedAt: "0.46.0",
    title: "Drive bb from scripts",
    body: "The bb command lets scripts and agents start threads, check on them, and change settings.",
    action: {
      kind: "prompt",
      label: "Try it",
      prompt: "Write me a shell script that uses the bb CLI to ",
    },
    tier: 2,
    priority: 85,
    eligible: (signals) =>
      signals.hasFinishedThread && onClient(signals, hasKeyboard),
  }),
  tip({
    id: "add-agent",
    illustration: "add-agent",
    tone: "green",
    source: { kind: "feature", ref: "multiple providers" },
    addedAt: "0.46.0",
    reviewedAt: "0.46.0",
    title: "Add a second coding agent",
    body: "bb can run more than one agent, so you can compare them or keep working when one hits a limit.",
    action: {
      kind: "prompt",
      label: "Walk me through it",
      prompt: walkthroughPrompt("setting up a second coding agent"),
    },
    tier: 2,
    priority: 80,
    eligible: (signals) =>
      signals.hasFinishedThread && signals.availableProviderCount < 2,
  }),
  tip({
    id: "notifications",
    illustration: "notifications",
    tone: "amber",
    source: { kind: "feature", ref: "push-notifications plugin" },
    addedAt: "0.46.0",
    reviewedAt: "0.46.0",
    title: "Know when an agent needs you",
    body: "Turn on notifications to see when a thread finishes or asks you a question.",
    action: {
      kind: "open-plugin",
      label: "Turn on notifications",
      pluginId: PUSH_NOTIFICATIONS_PLUGIN_ID,
    },
    tier: "unranked",
    priority: 140,
    eligible: (signals) =>
      signals.client?.notificationNudge === true &&
      isEnabled(signals, PUSH_NOTIFICATIONS_PLUGIN_ID),
  }),
  tip({
    id: "browse-plugins",
    illustration: "browse-plugins",
    tone: "green",
    source: { kind: "feature", ref: "plugin store" },
    addedAt: "0.46.0",
    reviewedAt: "0.46.0",
    title: "Find plugins that fit your work",
    body: "Browse bb's plugins, like Browser Automation, which lets the agent test your app in a real browser.",
    action: {
      kind: "open-page",
      label: "Browse plugins",
      path: "/plugins",
    },
    tier: 3,
    priority: 30,
    eligible: (signals) =>
      signals.hasFinishedThread &&
      onClient(
        signals,
        (client) => client.surface === "desktop" || client.surface === "web",
      ),
  }),
  tip({
    id: "provider-usage",
    illustration: "provider-usage",
    tone: "orange",
    source: { kind: "feature", ref: "provider-usage plugin" },
    addedAt: "0.46.0",
    reviewedAt: "0.46.0",
    title: "See your usage across providers",
    body: "Provider usage shows how much of each account's limits you have used and when they reset.",
    action: {
      kind: "open-plugin",
      label: "Open Provider usage",
      pluginId: PROVIDER_USAGE_PLUGIN_ID,
    },
    tier: 2,
    priority: 35,
    eligible: (signals) =>
      signals.threadCount >= 10 && isEnabled(signals, PROVIDER_USAGE_PLUGIN_ID),
  }),
];

function keyLabel(
  client: TipClient | null,
  mac: string,
  other: string,
): string {
  if (client === null) return `${mac} (${other})`;
  return client.os === "macos" ? mac : other;
}

function fillTemplate(text: string, signals: TipSignals): string {
  return text
    .replaceAll("{version}", signals.appVersion ?? "")
    .replaceAll(
      "{paletteKeys}",
      keyLabel(signals.client, "⌘⇧P", "Ctrl+Shift+P"),
    )
    .replaceAll("{searchKeys}", keyLabel(signals.client, "⌘K", "Ctrl+K"));
}

export function renderTip(
  definition: TipDefinition,
  signals: TipSignals,
): TipView {
  return {
    id: definition.id,
    illustration: definition.illustration,
    tone: definition.tone,
    title: fillTemplate(definition.title, signals),
    body: fillTemplate(definition.body, signals),
    action: definition.action,
  };
}
