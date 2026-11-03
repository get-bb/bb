/* A checked-in snapshot of the BB Community plugin catalog for the homepage
   "Make bb yours" graphic. The homepage route has no loader, and the live
   catalog (getPublicMarketplace, used by /marketplace) is an async server read
   of a 1.2 MB manifest, so the graphic carries only what it shows.

   Source: getbb.app/marketplace/v2/marketplace.json and
   getbb.app/marketplace/v1/stats.json, generated 2026-11-02T15:57:44Z.
   Names, authors and install counts are the listings' own; each description is
   the first sentence of the listing's, and each icon is the listing's icon
   (its SVG, or the Hugeicons glyph the marketplace maps its icon name to). */

import ChartColumnIcon from "@hugeicons/core-free-icons/ChartColumnIcon";
import Folder02Icon from "@hugeicons/core-free-icons/Folder02Icon";
import SidebarLeftIcon from "@hugeicons/core-free-icons/SidebarLeftIcon";
import WorkflowCircle03Icon from "@hugeicons/core-free-icons/WorkflowCircle03Icon";
import type { IconSvgElement } from "@hugeicons/react";

import AuraIcon from "../assets/plugin-icons/aura.svg";
import AyuIcon from "../assets/plugin-icons/ayu.svg";
import BeautifulChatIcon from "../assets/plugin-icons/beautiful-chat.svg";
import BotsSidebarIcon from "../assets/plugin-icons/bots-sidebar.svg";
import ContextMeterIcon from "../assets/plugin-icons/context-meter.svg";
import FilesEditorIcon from "../assets/plugin-icons/files-editor.svg";
import FontsIcon from "../assets/plugin-icons/fonts.svg";
import GenuiIcon from "../assets/plugin-icons/genui.svg";
import HandoffIcon from "../assets/plugin-icons/handoff.svg";
import LinearIcon from "../assets/plugin-icons/linear.svg";
import LinkHovercardsIcon from "../assets/plugin-icons/link-hovercards.svg";
import MonokaiIcon from "../assets/plugin-icons/monokai.svg";
import SubscriptionsIcon from "../assets/plugin-icons/subscriptions.svg";
import TaskboardIcon from "../assets/plugin-icons/taskboard.svg";
import TokyoNightIcon from "../assets/plugin-icons/tokyo-night.svg";
import UsageTrackerIcon from "../assets/plugin-icons/usage-tracker.svg";

/* Plugins in BB Community when the snapshot was taken. */
export const CATALOG_PLUGIN_COUNT = 518;

export type CatalogPlugin = {
  id: string;
  name: string;
  description: string;
  author: string;
  installs: number;
  icon: { glyph: IconSvgElement } | { url: string };
};

export const CATALOG_PLUGINS: readonly CatalogPlugin[] = [
  {
    id: "bb-sidebar",
    name: "BB Sidebar",
    description:
      "A sidebar inspired by T3 Code that adds manual and automatic thread sorting, collapsible shelves, and bulk actions to bb.",
    author: "Yusuf Akbulut",
    installs: 756,
    icon: { glyph: SidebarLeftIcon },
  },
  {
    id: "usage-tracker",
    name: "Usage Tracker",
    description: "See subscription limits without leaving BB.",
    author: "Mateo Cerquetella",
    installs: 571,
    icon: { url: UsageTrackerIcon },
  },
  {
    id: "file-manager",
    name: "File Manager",
    description:
      "Manage the files on the machine bb runs on without a terminal: browse, upload, move, rename, extract and hand them to the agent.",
    author: "Foma",
    installs: 554,
    icon: { glyph: Folder02Icon },
  },
  {
    id: "genui",
    name: "Generative UI",
    description:
      "Turns agent replies into charts, diagrams, maps, plans and forms you can use, right in the chat.",
    author: "ComicBit",
    installs: 531,
    icon: { url: GenuiIcon },
  },
  {
    id: "taskboard",
    name: "Taskboard",
    description:
      "Browses and creates project-scoped GitHub, GitLab, Gitea, Linear, or Jira issues in one focused List or Kanban board, with explicit review before creation and an optional autonomous task factory.",
    author: "Mateo Cerquetella",
    installs: 411,
    icon: { url: TaskboardIcon },
  },
  {
    id: "files-editor",
    name: "Files",
    description:
      "A VS Code-style file explorer and editor for the workspace behind a thread.",
    author: "AbdElrahman Telb",
    installs: 402,
    icon: { url: FilesEditorIcon },
  },
  {
    id: "agent-graph",
    name: "Agent Graph",
    description:
      "Shows your bb agents as a live node graph of threads, turns, tool calls, subagents and workflow agents, color-coded by type or status, so you can see what every agent is doing at a glance.",
    author: "Nathan Colgate",
    installs: 401,
    icon: { glyph: WorkflowCircle03Icon },
  },
  {
    id: "t3sidebar",
    name: "T3 Sidebar",
    description:
      "Replaces the BB thread list with a stable inbox, snooze controls, and child thread links.",
    author: "Sawyer Hood",
    installs: 399,
    icon: { glyph: SidebarLeftIcon },
  },
  {
    id: "bots-sidebar",
    name: "Bots Sidebar",
    description:
      "Keep specialist bots, their memory, and their conversations together across projects.",
    author: "Tobias Lütke",
    installs: 362,
    icon: { url: BotsSidebarIcon },
  },
  {
    id: "usage",
    name: "Usage",
    description:
      "Tracks coding-agent token usage and estimated API cost across enrolled machines.",
    author: "Mayank Bansal",
    installs: 359,
    icon: { glyph: ChartColumnIcon },
  },
  {
    id: "context-meter",
    name: "Context Meter",
    description:
      "Keeps threads in the smart zone, by tracking context against a limit you set rather than the provider's full window.",
    author: "Roger Serra",
    installs: 355,
    icon: { url: ContextMeterIcon },
  },
  {
    id: "handoff",
    name: "Handoff",
    description:
      "Moves a whole session between agents and machines in both directions: hands a bb thread's rendered transcript to another provider (optionally on another enrolled machine, carrying uncommitted work as a patch), or adopts a Claude Code, Codex, Gemini CLI or OpenCode session from your terminal as a bb thread in the same directory.",
    author: "Vedran Burojević",
    installs: 323,
    icon: { url: HandoffIcon },
  },
  {
    id: "linear",
    name: "Linear",
    description:
      "Linear inside bb — a list-first issue browser, inbox, and create dialog served from a local mirror, thirteen linear_* agent tools, a bb linear CLI, and every thread resolving which issue it works on, shown live in the header and side panel and injected into agent context.",
    author: "Vedran Burojević",
    installs: 224,
    icon: { url: LinearIcon },
  },
  {
    id: "link-hovercards",
    name: "Link Hovercards",
    description:
      "See a pull request's CI, review and merge state by hovering its link, without leaving the thread.",
    author: "Bruno Bornsztein",
    installs: 18,
    icon: { url: LinkHovercardsIcon },
  },
  {
    id: "subscriptions",
    name: "Subscriptions",
    description:
      "Get a short message in your thread when a GitHub pull request or Linear issue you follow changes.",
    author: "grrowl",
    installs: 17,
    icon: { url: SubscriptionsIcon },
  },
  {
    id: "beautiful-chat",
    name: "Beautiful Chat",
    description:
      "Restyles BB's chat — composer, messages, work rows, loading states — in BeautifulUI's design language, using your active theme's colors.",
    author: "Diip3sh",
    installs: 250,
    icon: { url: BeautifulChatIcon },
  },
  {
    id: "aura",
    name: "Aura",
    description:
      "Make your BB workspace your own with personal wallpapers and animated pixel textures.",
    author: "Mateo Cerquetella",
    installs: 221,
    icon: { url: AuraIcon },
  },
  {
    id: "monokai",
    name: "bb Monokai",
    description:
      "A dark Monokai-family theme for bb: one meaning per hue, a single text ladder, and a matching terminal palette.",
    author: "Scott Sunarto",
    installs: 164,
    icon: { url: MonokaiIcon },
  },
  {
    id: "fonts",
    name: "Fonts",
    description:
      "Choose local font families and tune interface, code, and serif typography independently of BB's active theme.",
    author: "Guilherme J. Tramontina",
    installs: 163,
    icon: { url: FontsIcon },
  },
  {
    id: "ayu",
    name: "Ayu",
    description:
      "Adds the three ayu themes (Light, Dark and Mirage) and a settings panel that switches between them and copies any colour from the palette.",
    author: "Vedran Burojević",
    installs: 157,
    icon: { url: AyuIcon },
  },
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    description:
      "Adds the two Tokyo Night palettes (Night and Storm), each pairing its dark base with Tokyo Night Light for light mode.",
    author: "Justin Krehel",
    installs: 144,
    icon: { url: TokyoNightIcon },
  },
];

/* What bb's Plugins page lists, sorted by installs: the whole catalog, then
   the first results of two searches. bb's catalog search matches the query in
   a plugin's id, name, description, category, marketplace name and tags
   (plugin-catalog-service.ts); "linear" matches 4 plugins and "themes" 61. */
export const CATALOG_VIEWS = {
  "": [
    "bb-sidebar",
    "usage-tracker",
    "file-manager",
    "genui",
    "taskboard",
    "files-editor",
    "agent-graph",
    "t3sidebar",
    "bots-sidebar",
    "usage",
    "context-meter",
    "handoff",
  ],
  linear: ["taskboard", "linear", "link-hovercards", "subscriptions"],
  themes: ["beautiful-chat", "aura", "monokai", "fonts", "ayu", "tokyo-night"],
} as const satisfies Record<string, readonly string[]>;

export type CatalogQuery = keyof typeof CATALOG_VIEWS;
