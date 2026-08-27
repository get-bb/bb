/**
 * The product-shape inventory behind the Plugin Guide: every surface a plugin
 * can plug into, in plain language. This file is the whole of bb's plugin API
 * documentation, so it has to stay current with the SDK — each surface names
 * the SDK symbols it documents and api-sync.test.ts fails the build when the
 * two drift apart.
 *
 * Each surface reads as plain product capability: what becomes possible in
 * that part of bb once a plugin owns it.
 *
 * `firstParty` lists the shipped bb plugins that use each surface today,
 * taken from a registration-call inventory of plugins/* in the bb repo.
 */

export interface PluginSurface {
  id: string;
  title: string;
  /** Lead sentence, ending in the phrase the bullets hang off. */
  summary: string;
  /** What a plugin can do on this surface, one capability per line. */
  bullets: string[];
  /**
   * One scannable line for capability grids; the prose stays in the detail
   * card. Only the pixel-less surfaces need one today.
   */
  tagline?: string;
  /**
   * The SDK symbols this surface documents. Not shown in the UI: it is the
   * tie between a card and the API it describes, and api-sync.test.ts fails
   * when one of them is renamed or removed, or when a new registration slot
   * ships with no card naming its type.
   */
  apiSymbols: string[];
  /** First-party bb plugins that ship on this surface today (display names). */
  firstParty?: string[];
  experimental?: boolean;
}

export interface SurfaceGroup {
  id:
    | "app-shell"
    | "command-palette"
    | "composer"
    | "home"
    | "settings"
    | "extensions"
    | "headless";
  title: string;
  blurb: string;
  /** Product anatomy stays spatial; non-spatial documentation can reflow. */
  fixtureKind: "spatial" | "capability-grid";
  surfaces: PluginSurface[];
  /**
   * Named clusters for a group that lists its surfaces instead of drawing
   * them. Every surface id in the group appears in exactly one section
   * (surfaces.test.ts enforces it).
   */
  sections?: readonly {
    title: string;
    surfaceIds: readonly string[];
  }[];
}

export type FixtureResponsiveStrategy = "scale-together" | "reflow";

/**
 * Responsive behavior follows fixture meaning, never an author's per-page
 * preference. Product anatomy scales as one composition; the one non-spatial
 * capability grid uses ordinary document reflow.
 */
export function fixtureResponsiveStrategy(
  group: Pick<SurfaceGroup, "fixtureKind">,
): FixtureResponsiveStrategy {
  return group.fixtureKind === "spatial" ? "scale-together" : "reflow";
}

export const SURFACE_GROUPS: SurfaceGroup[] = [
  {
    id: "app-shell",
    title: "The bb app window",
    fixtureKind: "spatial",
    blurb:
      "The main bb window, containing the sidebar, the conversation, and the side panel. A plugin can add rows, controls, panel tabs, and message content to the numbered regions.",
    surfaces: [
      {
        id: "nav-panel",
        title: "Full-page panels",
        summary:
          "Adds a row to bb's sidebar that opens a page your plugin renders where threads normally appear. With this, a plugin can:",
        bullets: [
          "Render any React you write across that whole area",
          "Get its own URL, so the page can be linked to and bb's back and forward buttons work",
          "Register tabs in the panel to the right of its page, beside bb's own Browser and Terminal tabs",
        ],
        apiSymbols: ["PluginNavPanelRegistration"],
        firstParty: ["Automations", "Docs", "GitHub", "Tasks"],
      },
      {
        id: "thread-list",
        title: "The thread list",
        summary:
          "Replaces the list of threads in bb's sidebar with a component your plugin renders. With this, a plugin can:",
        bullets: [
          "Render every row, and decide the grouping, the ordering, and what each row shows",
          "Read the same live thread data and run statuses bb's own list reads",
          "Replace only the list. The New thread button, the search action, the plugin rows, and the sidebar footer stay bb's",
        ],
        apiSymbols: [
          "PluginThreadListRegistration",
          "PluginSidebarThreadsState",
        ],
        experimental: true,
      },
      {
        id: "thread-row-status",
        title: "Thread row status",
        summary:
          "A small status bb can draw on a thread's row in the sidebar. With this, a plugin can:",
        bullets: [
          "Give the status an icon and a label",
          "Mark a thread as running while it works on it, and bb shimmers the icon",
          "Mark it succeeded or failed when the work ends, and bb settles the icon",
          "Set it only from an [app-wide script](content-scripts). A status needs an owner that outlives any single screen, and those scripts are the only plugin code that does",
          "Rely on bb to clear it when the script unmounts",
        ],
        apiSymbols: [
          "PluginComposerThreadRowStatus",
          "PluginContentScriptContext",
        ],
        experimental: true,
      },
      {
        id: "sidebar-footer",
        title: "Sidebar footer buttons",
        summary:
          "Adds an icon button to the row at the bottom of bb's sidebar, beside the Settings button. With this, a plugin can:",
        bullets: [
          "Supply the button's icon and its hover tooltip",
          "Run a callback when the button is clicked",
          "Stay reachable wherever bb's sidebar is showing",
        ],
        apiSymbols: ["PluginSidebarFooterActionRegistration"],
        firstParty: ["Remote access"],
      },
      {
        id: "thread-header",
        title: "Thread header controls",
        summary:
          "Adds a control to the header bar at the top of an open thread. With this, a plugin can:",
        bullets: [
          "Render a React component rather than a plain button, so it can show live state",
          "Receive the id of the thread currently on screen",
          "Render in the same row as bb's own header controls",
        ],
        apiSymbols: ["PluginThreadHeaderActionRegistration"],
        experimental: true,
      },
      {
        id: "message-directives",
        title: "Rich message embeds",
        summary:
          "Renders your component inside an agent's reply, in place of a marker the agent writes into its message. With this, a plugin can:",
        bullets: [
          "Claim a directive name; an agent writes `::name` in a message to invoke it",
          "Replace that marker with a live component, inline in the conversation",
          "Open a file from the workspace when someone interacts with the embed",
        ],
        apiSymbols: ["PluginMessageDirectiveRegistration"],
        firstParty: ["Docs", "Inline visualizations", "Tasks", "Workflows"],
      },
      {
        id: "message-actions",
        title: "Message actions",
        summary:
          "Adds an action to individual messages in a thread. With this, a plugin can:",
        bullets: [
          "Appear in the row that shows under messages on hover, or in the toolbar that appears when text in an agent's message is selected",
          "Receive the message, plus the selected text when the action was run from a selection",
          "Open one of the plugin's own [side-panel tabs](thread-panel) with what it received",
        ],
        apiSymbols: ["PluginMessageActionRegistration"],
        firstParty: ["Side chat"],
      },
      {
        id: "pending-interaction",
        title: "In-thread forms",
        summary:
          "Pauses an agent mid-turn to ask the person a question, and hands their answer back to the agent. With this, a plugin can:",
        bullets: [
          "Replace the prompt box with a form while the agent waits for an answer",
          "Receive the submitted answer, or a cancellation and its reason",
          "Supply the component that draws the form",
        ],
        apiSymbols: ["PluginUi", "PluginPendingInteractionRegistration"],
        firstParty: ["Ask User Question", "Secrets"],
      },
      {
        id: "code-renderers",
        title: "Code & diff renderers",
        summary:
          "Replaces bb's source-code or diff renderer everywhere that kind of content appears. With this, a plugin can:",
        bullets: [
          "Register the source-code and diff replacements independently",
          "Apply each replacement across bb's file previews, timeline and environment diffs, and plugin pages",
          "Hand any individual render back to bb's built-in renderer, and fall back to it automatically if the plugin is unavailable or crashes",
        ],
        apiSymbols: [
          "PluginSourceCodeRendererRegistration",
          "PluginSourceCodeRendererProps",
          "PluginDiffRendererRegistration",
          "PluginDiffRendererProps",
        ],
        experimental: true,
      },
      {
        id: "thread-panel",
        title: "Thread side-panel tabs",
        summary:
          "Adds a tab to the side panel that opens to the right of a thread. With this, a plugin can:",
        bullets: [
          "Render the tab's contents and receive the id of the thread it was opened from",
          "Open the tab from a [message action](message-actions), from the + button in the side panel, or from its own code",
        ],
        apiSymbols: ["PluginThreadPanelActionRegistration"],
        firstParty: ["Docs", "GitHub", "Side chat", "Tasks", "Workflows"],
      },
      {
        id: "file-opener",
        title: "File viewers & editors",
        summary:
          "Registers a viewer for the file types you name, so bb opens those files there instead of its built-in preview. With this, a plugin can:",
        bullets: [
          "Declare the file extensions it handles, for example `.csv` or `.excalidraw`",
          "Render its own viewer or editor whenever a file of that type is opened in bb",
          "Receive the file's path, then read it however the plugin already reads files",
        ],
        apiSymbols: ["PluginFileOpenerRegistration"],
        firstParty: ["Docs"],
      },
      {
        id: "timeline-renderers",
        title: "Timeline entry content",
        summary:
          "Renders the expanded content of plugin-owned timeline entries while bb keeps each entry's header and controls. With this, a plugin can:",
        bullets: [
          "Draw the expanded content beneath timeline entries created by the plugin's own provider",
          "Receive the entry data and plugin payload, plus bb's default content as `Original`",
          "Fall back to bb's default content automatically when the plugin is unavailable or crashes",
        ],
        apiSymbols: [
          "PluginTimelineRendererRegistration",
          "PluginTimelineRendererProps",
        ],
        experimental: true,
      },
      {
        id: "content-scripts",
        title: "App-wide scripts",
        summary:
          "Runs your code inside the bb window itself, without rendering a UI of its own. With this, a plugin can:",
        bullets: [
          "Mount once per bb window and unmount when the window reloads",
          "Add behavior that is not tied to one screen, such as a keyboard shortcut",
          "Set a [thread row status](thread-row-status) on any thread, for as long as the script is mounted",
          "Add plugin-owned elements to app pages without taking ownership of bb's built-in layout",
          "Return a cleanup function. bb calls it once on unmount, and clears any row statuses the script set",
        ],
        apiSymbols: [
          "PluginContentScriptRegistration",
          "PluginContentScriptContext",
        ],
      },
    ],
  },
  {
    id: "command-palette",
    title: "Command palette",
    fixtureKind: "spatial",
    blurb:
      "bb's searchable command menu. A plugin can add actions that match, rank, and run alongside bb's own commands.",
    surfaces: [
      {
        id: "command-palette-actions",
        title: "Command palette actions",
        summary:
          "Adds a row under Plugins in bb's quick command palette. With this, a plugin can:",
        bullets: [
          "Supply the row's label and run behavior; bb owns matching, ordering, and recency",
          "Read the current thread and project, and hide the row when it is unavailable",
          "Open one of the plugin's own thread side-panel tabs when a thread is on screen",
        ],
        apiSymbols: [
          "PluginCommandPaletteActionRegistration",
          "PluginCommandPaletteActionContext",
        ],
      },
    ],
  },
  {
    id: "composer",
    title: "The composer",
    fixtureKind: "spatial",
    blurb:
      "The prompt box used to start a thread and to reply inside one. A plugin can add banners, menu entries, and action buttons to it, answer mention searches, highlight the draft prompt, and supply the agent that runs the message.",
    surfaces: [
      {
        id: "composer-banners",
        title: "Banners",
        summary:
          "Renders a banner above the prompt box. With this, a plugin can:",
        bullets: [
          "Render its own component in the strip directly above the draft prompt",
          "Name which prompt boxes it appears in: the new-thread screen, the follow-up composer in a thread, or a queued message being edited. Omit the list to appear in all of them",
          "Show something the person should read before sending, such as a warning or a status",
        ],
        apiSymbols: ["ComposerCustomization", "PluginComposerScope"],
        firstParty: ["Provider retry", "Workflows"],
      },
      {
        id: "mention-provider",
        title: "Mentions",
        summary:
          "Adds results to the menu that opens when someone types a trigger character in the prompt box. On a trigger bb does not use itself, your plugin opens that menu and owns it. With this, a plugin can:",
        bullets: [
          "Answer each keystroke after the trigger with a list of items to show",
          "Claim one or more of the trigger characters @, #, $, !, and ~. Omit them to answer the default @",
          "Turn a picked item into a chip in the draft prompt, and send its content to the agent along with the message",
        ],
        apiSymbols: [
          "PluginMentionProviderRegistration",
          "PluginMentionSearchContext",
          "PluginMentionItem",
        ],
        firstParty: ["Docs", "GitHub", "Tasks"],
      },
      {
        id: "composer-rich-text",
        title: "Draft prompt highlighting",
        summary:
          "Styles text ranges as the person types a prompt, without changing the text. With this, a plugin can:",
        bullets: [
          "Match ranges in the draft prompt, such as a ticket number or the word TODO",
          "Change only how those ranges look; the text the agent receives is untouched",
          "Re-run its matcher on every keystroke",
          "Observe the draft prompt and its @-mentions as they change, read-only",
        ],
        apiSymbols: ["ComposerRichTextSpec", "ComposerStructuredDraft"],
      },
      {
        id: "composer-state",
        title: "Draft prompt state & locking",
        summary:
          "Reads the draft prompt, and can block typing while the plugin works. With this, a plugin can:",
        bullets: [
          "Read the draft prompt's text, whether it is empty, and how many files are attached",
          "Read the prompt box's layout and whether the thread is already running a turn",
          "Lock the input and release it again, so the draft prompt cannot change mid-operation",
          "Mark the thread row as running while the input is locked, with a [thread row status](thread-row-status)",
        ],
        apiSymbols: ["ComposerView", "PluginComposerApi"],
      },
      {
        id: "composer-plus-menu",
        title: "The + menu",
        summary:
          "Adds rows to the menu that opens from the + button beside the prompt box. With this, a plugin can:",
        bullets: [
          "Supply each row's icon, label, and disabled state; bb renders the row itself",
          "Run a callback when someone picks the row",
          "Read and rewrite the draft prompt from that callback",
        ],
        apiSymbols: ["ComposerPlusMenuItem"],
      },
      {
        id: "provider-picker",
        title: "Agent providers",
        summary:
          "Adds an agent to bb's model picker and runs the threads started with it. With this, a plugin can:",
        bullets: [
          "Appear in the model picker beside bb's built-in providers",
          "Declare what the provider supports, then serve its model list at runtime",
          "Supply a small icon that appears next to its name",
          "Receive every message in a thread started with it, through a bridge process the plugin ships",
        ],
        apiSymbols: [
          "PluginProviderDeclaration",
          "PluginProviderIconRegistration",
        ],
        firstParty: [
          "ACP providers",
          "Claude Code provider",
          "Codex provider",
          "Pi provider",
        ],
        experimental: true,
      },
      {
        id: "composer-actions",
        title: "Inline actions",
        summary:
          "Adds a button to the row of controls inside the prompt box, beside the voice and send buttons. With this, a plugin can:",
        bullets: [
          "Read and rewrite the draft prompt, for example rephrasing it or inserting a template",
          "Insert an @-mention into the draft so its provider can resolve fresh context when the message is sent",
          "Lock the input while it works, and tint the whole draft while it does",
          "Render in the same row as bb's own prompt-box buttons. If you have more than 3 plugins enabled, bb keeps the 3 most-used plugins inline and moves the rest into an overflow menu",
        ],
        apiSymbols: ["PluginComposerApi"],
      },
    ],
  },
  {
    id: "home",
    title: "Home page",
    fixtureKind: "spatial",
    blurb:
      "The screen bb opens on, holding the new-thread composer and a side panel. A plugin can add a section below the composer, and an action in that panel that opens its own tab.",
    surfaces: [
      {
        id: "homepage-section",
        title: "Home-screen sections",
        summary:
          "Adds a full-width section to the page bb opens on, below the prompt box. With this, a plugin can:",
        bullets: [
          "Render its own component across the width of the content area",
          "Render before any thread exists, which suits shortcuts and pinned work",
          "Render after bb's own content, in the order plugins registered",
        ],
        apiSymbols: ["PluginHomepageSectionRegistration"],
      },
      {
        id: "new-thread-panel",
        title: "New-thread side panel",
        summary:
          "Adds a plugin tab to the side panel on the new-thread screen. With this, a plugin can:",
        bullets: [
          "Render before a thread exists, so it receives no thread id",
          "Host setup the person does while writing the first prompt",
          "Receive the project selected in the prompt box",
        ],
        apiSymbols: ["PluginNewThreadPanelActionRegistration"],
        experimental: true,
      },
    ],
  },
  {
    id: "settings",
    title: "Plugin settings page",
    fixtureKind: "spatial",
    blurb:
      "The settings page bb creates for every installed plugin. A plugin can declare fields for bb to render and add its own section below them.",
    surfaces: [
      {
        id: "declarative-settings",
        title: "Settings fields",
        summary:
          "Declares the settings your plugin needs as plain data; bb renders the form for them on the plugin's settings page and stores the values. With this, a plugin can:",
        bullets: [
          "Declare each field's type (text, toggle, choice, or project) with a label and an optional default",
          "Get the form, its validation, and saving without writing any UI",
          "Mark a text field secret: bb stores it in a protected file on the server and never sends it to the browser",
          "Read saved values from its server code, or the non-secret ones from its own UI with `useSettings()`",
        ],
        apiSymbols: [
          "PluginSettings",
          "PluginSettingDescriptor",
          "PluginSettingsState",
        ],
        firstParty: ["GitHub", "Provider retry", "Workflows"],
      },
      {
        id: "settings-section",
        title: "Custom settings section",
        summary:
          "Renders your own React component on the plugin's settings page, below the [fields bb generated](declarative-settings). Use it for anything that is not a value in a form. With this, a plugin can:",
        bullets: [
          "Render whatever UI it needs, such as a connect-account button, a test-connection result, or a preview",
          "Run in the browser, so it stores nothing itself. It calls the plugin's own backend to do that",
          "Supply a heading and a one-line description for bb to render above it",
        ],
        apiSymbols: ["PluginSettingsSectionRegistration"],
        firstParty: [
          "Custom instructions",
          "Keep Awake",
          "Memory",
          "Remote access",
        ],
      },
    ],
  },
  {
    id: "extensions",
    title: "Plugin page in Extensions",
    fixtureKind: "spatial",
    blurb:
      "The page bb shows for an installed plugin under Extensions: what it is, what it registers, and whether it is healthy. A plugin can report that it needs configuring, and bb says so at the top of this page.",
    surfaces: [
      {
        id: "plugin-status",
        title: "Configuration status",
        summary:
          "Reports that the plugin cannot run until someone configures it, so bb can say so instead of the plugin failing silently. With this, a plugin can:",
        bullets: [
          "Set a needs-configuration state with a message naming what is missing",
          "Show a warning banner with that message on the plugin's page in Extensions",
        ],
        apiSymbols: ["PluginStatusApi"],
        firstParty: ["GitHub", "Workflows"],
      },
    ],
  },
  {
    id: "headless",
    title: "Plugin backend",
    fixtureKind: "capability-grid",
    // The grid below names all ten capabilities with their own taglines, so
    // the blurb does not list them again.
    blurb: "The parts of the plugin API with no interface of their own.",
    sections: [
      {
        title: "Commands & agent capabilities",
        surfaceIds: ["cli", "agent-tools"],
      },
      {
        title: "Running & reacting",
        surfaceIds: ["background", "wire", "thread-events", "host-workers"],
      },
      {
        title: "Data & platform",
        surfaceIds: ["storage", "bb-sdk", "host-components"],
      },
      {
        title: "Confidence",
        surfaceIds: ["testing"],
      },
    ],
    surfaces: [
      {
        id: "cli",
        tagline: "Your own `bb <name>` command",
        title: "bb CLI commands",
        summary:
          "Registers a top-level `bb <name>` command, available in the terminal and to agents. With this, a plugin can:",
        bullets: [
          "Be invoked the same way by a person at a terminal and by an agent mid-task",
          "Receive the thread and project it was invoked from, when bb knows them",
          "Make the plugin usable from scripts and automations, not only from the UI",
        ],
        apiSymbols: ["PluginCli"],
        firstParty: [
          "Automations",
          "Custom instructions",
          "Docs",
          "GitHub",
          "Keep Awake",
          "Memory",
          "Provider retry",
          "Remote access",
          "Secrets",
          "Tasks",
          "Workflows",
        ],
      },
      {
        id: "agent-tools",
        tagline: "Native tools, skills, and instructions in every session",
        title: "Agent tools & skills",
        summary:
          "Adds tools, skills, and instructions to the agent sessions bb runs. With this, a plugin can:",
        bullets: [
          "Register tools an agent calls the same way it calls bb's built-in tools",
          "Decide per thread which of its tools and skills are available",
          "Append instructions to a session's system prompt as that session starts",
        ],
        apiSymbols: ["PluginAgents"],
        firstParty: [
          "Ask User Question",
          "Custom instructions",
          "Memory",
          "Remote access",
          "Workflows",
        ],
      },
      {
        id: "background",
        tagline: "Supervised services and cron schedules",
        title: "Background work",
        summary:
          "Runs code on the bb server when no window is open. With this, a plugin can:",
        bullets: [
          "Register long-running services that bb starts, supervises, and restarts after a failure",
          "Register jobs that run on a cron schedule",
          "Be told to shut down cleanly before it reloads or is disabled",
        ],
        apiSymbols: ["PluginBackground"],
        firstParty: [
          "Automations",
          "Docs",
          "GitHub",
          "Keep Awake",
          "Provider retry",
          "Remote access",
          "Side chat",
          "Tasks",
          "Workflows",
        ],
      },
      {
        id: "wire",
        tagline: "Typed RPC, webhook routes, realtime push",
        title: "HTTP, RPC & realtime",
        summary:
          "Connects the plugin's own UI, its server code, and outside services. With this, a plugin can:",
        bullets: [
          "Call its server from its UI over RPC, with arguments and results checked against a schema",
          "Serve HTTP routes other systems can call, webhooks included",
          "Push messages to every open bb window, so the UI does not have to poll",
        ],
        apiSymbols: ["PluginRpc", "PluginHttp", "PluginRealtime"],
        firstParty: [
          "Automations",
          "Custom instructions",
          "Docs",
          "GitHub",
          "Inline visualizations",
          "Keep Awake",
          "Memory",
          "Provider retry",
          "Remote access",
          "Side chat",
          "Tasks",
          "Workflows",
        ],
      },
      {
        id: "thread-events",
        tagline: "React when threads start, finish, or fail",
        title: "Thread lifecycle events",
        summary:
          "Runs server code when a thread changes state. With this, a plugin can:",
        bullets: [
          "Subscribe to threads being created, going active or idle, failing, being archived, or being deleted",
          "Receive a typed payload describing the thread and the transition",
          "Respond by sending a notification, retrying, or writing to its own storage",
        ],
        apiSymbols: ["PluginEvents", "PluginThreadEventPayloads"],
        firstParty: ["Automations", "Provider retry", "Tasks", "Workflows"],
      },
      {
        id: "host-workers",
        tagline: "Run code on enrolled machines",
        title: "Host workers",
        summary:
          "Runs the plugin's code on an enrolled machine, not only on the bb server. With this, a plugin can:",
        bullets: [
          "Ship a Node entry point bb starts on demand on the machine it calls",
          "Call that worker from its server code over typed RPC",
          "Do work that has to happen on the machine itself, such as watching files or holding a wake lock",
        ],
        apiSymbols: ["PluginHosts"],
        firstParty: ["Keep Awake", "Remote access"],
        experimental: true,
      },
      {
        id: "storage",
        tagline: "Namespaced KV plus your own SQLite",
        title: "Storage",
        summary:
          "Stores the plugin's data on the bb server. With this, a plugin can:",
        bullets: [
          "Get a key-value store for small values such as flags and cursors",
          "Get its own SQLite database, with migrations, for larger or relational data",
          "Read and write only its own namespace; other plugins cannot see it",
        ],
        apiSymbols: ["PluginStorage"],
        firstParty: [
          "Automations",
          "Custom instructions",
          "Docs",
          "GitHub",
          "Keep Awake",
          "Memory",
          "Remote access",
          "Side chat",
          "Tasks",
          "Workflows",
        ],
      },
      {
        id: "bb-sdk",
        tagline: "Create threads and projects from plugin code",
        title: "The bb SDK",
        summary:
          "Calls bb's own API from the plugin's server code. With this, a plugin can:",
        bullets: [
          "Create threads, send messages to them, and manage projects",
          "Reach the same operations the [bb CLI](cli) and the bb UI use",
          "Have the threads it creates attributed back to the plugin",
        ],
        apiSymbols: ["BbPluginApi"],
        firstParty: [
          "Automations",
          "Docs",
          "GitHub",
          "Inline visualizations",
          "Keep Awake",
          "Provider retry",
          "Secrets",
          "Side chat",
          "Tasks",
          "Workflows",
        ],
      },
      {
        id: "host-components",
        tagline: "Embed bb's chat and prompt box",
        title: "Host components",
        summary:
          "Renders bb's own conversation and prompt-box components inside the plugin's pages. With this, a plugin can:",
        bullets: [
          "Embed the thread view and the new-thread prompt box as components",
          "Render message text with the same Markdown renderer bb uses",
          "Inherit bb's styling, so embedded UI matches the rest of the app",
        ],
        apiSymbols: [
          "ThreadChat",
          "Markdown",
          "experimental_NewThreadComposer",
        ],
        firstParty: ["Side chat"],
      },
      {
        id: "testing",
        tagline: "Unit-test every surface without a running bb",
        title: "Testing harnesses",
        summary:
          "Tests the plugin without a running bb. With this, a plugin can:",
        bullets: [
          "Run its server code against an in-process fake of the bb server",
          "Render its UI slots under vitest and jsdom",
          "Drive its host worker with no host daemon running",
        ],
        apiSymbols: [
          "createFakePluginHost",
          "renderSlot",
          "createFakeSdk",
          "experimental_createHostEntryHarness",
        ],
        firstParty: [
          "Ask User Question",
          "Automations",
          "Custom instructions",
          "Docs",
          "GitHub",
          "Inline visualizations",
          "Keep Awake",
          "Memory",
          "Provider retry",
          "Remote access",
          "Secrets",
          "Side chat",
          "Tasks",
          "Workflows",
        ],
      },
    ],
  },
];

/**
 * Which slide each surface is drawn on, so a card that names another surface
 * can say where to find it — the same page's marker number, or the other
 * page by name.
 */
export const GROUP_BY_SURFACE_ID: ReadonlyMap<
  string,
  { id: SurfaceGroup["id"]; title: string }
> = new Map(
  SURFACE_GROUPS.flatMap((group) =>
    group.surfaces.map(
      (surface) => [surface.id, { id: group.id, title: group.title }] as const,
    ),
  ),
);

export const SURFACES_BY_ID: ReadonlyMap<string, PluginSurface> = new Map(
  SURFACE_GROUPS.flatMap((group) =>
    group.surfaces.map((surface) => [surface.id, surface] as const),
  ),
);
