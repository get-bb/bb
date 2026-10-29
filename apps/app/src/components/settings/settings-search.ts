import type { IconName } from "@bb/shared-ui/icon";
import { getPluginConfigurationRoutePath } from "@/lib/route-paths";
import type { PluginSettingsEntry } from "./plugin-settings-entries";
import {
  getSettingsSectionRoutePath,
  type SettingsNavSection,
  type SettingsSectionId,
} from "./settings-sections";

export type SettingsSearchCondition =
  | "cliCommand"
  | "composers"
  | "desktopBrowser"
  | "diffRenderers"
  | "fileOpeners"
  | "filePreferences"
  | "localhostLinkRewrite"
  | "performanceDiagnostics"
  | "pluginUpdates"
  | "sidebarNavigations"
  | "sourceCodeRenderers"
  | "threadLists";

interface SettingsSearchSetting {
  keywords: readonly string[];
  title: string;
  when?: SettingsSearchCondition;
}

interface SettingsSearchSection {
  keywords: readonly string[];
  settings: readonly SettingsSearchSetting[];
}

export const SETTINGS_SEARCH_INDEX: Record<
  SettingsSectionId,
  SettingsSearchSection
> = {
  general: {
    keywords: ["preferences"],
    settings: [
      {
        title: "Navigate to threads on creation",
        keywords: ["new thread", "open", "background"],
      },
      {
        title: "Default thread followup behavior",
        keywords: ["enter", "steer", "queue", "follow-up"],
      },
      {
        title: "Thread archive confirmation",
        keywords: ["confirm", "child threads"],
      },
      {
        title: "Show messages from before a context clear",
        keywords: ["history", "clear context"],
      },
      {
        title: "Setup guide",
        keywords: ["onboarding", "getting started", "welcome"],
      },
      {
        title: "App links",
        keywords: [
          "always allow",
          "native apps",
          "linear",
          "reflect",
          "application links",
          "approvals",
          "permissions",
        ],
      },
      {
        title: "Open links in the in-app browser",
        keywords: ["url", "web"],
        when: "desktopBrowser",
      },
      {
        title: "Rewrite localhost links",
        keywords: ["url", "port", "remote"],
        when: "localhostLinkRewrite",
      },
      {
        title: "New branch prefix",
        keywords: ["git", "worktree", "branch name"],
      },
      {
        title: "bb CLI",
        keywords: ["command line", "terminal", "path", "install"],
        when: "cliCommand",
      },
      { title: "bb CLI skills", keywords: ["agents", "install"] },
      {
        title: "Microphone",
        keywords: ["voice input", "audio", "dictation", "speech"],
      },
      {
        title: "Streamer mode",
        keywords: ["privacy", "screen share", "hide models"],
      },
      {
        title: "Share anonymous usage data",
        keywords: ["privacy", "telemetry", "analytics"],
      },
      {
        title: "Show diagnostic events",
        keywords: ["debug", "troubleshooting", "logs"],
      },
    ],
  },
  providers: {
    keywords: ["agents", "models"],
    settings: [
      {
        title: "Allow faster service tiers",
        keywords: ["fast mode", "priority", "speed"],
      },
      {
        title: "Release idle agent sessions",
        keywords: ["memory", "RAM", "timeout", "retention", "cleanup"],
      },
    ],
  },
  "ai-services": {
    keywords: ["bb cloud", "llm"],
    settings: [
      {
        title: "Thread titles",
        keywords: ["naming", "branch names", "generate"],
      },
      { title: "Commit messages", keywords: ["git", "generate"] },
      {
        title: "Voice input",
        keywords: ["transcription", "dictation", "microphone", "speech"],
      },
    ],
  },
  appearance: {
    keywords: ["look", "interface"],
    settings: [
      {
        title: "Theme",
        keywords: ["dark mode", "light mode", "system", "color scheme"],
      },
      {
        title: "Palette",
        keywords: ["colors", "theme", "syntax highlighting", "custom"],
      },
      { title: "Favicon color", keywords: ["icon", "tab"] },
      { title: "Fade inactive splits", keywords: ["dim", "panes", "focus"] },
      {
        title: "Navigation",
        keywords: ["sidebar", "rail", "top list", "layout", "labels", "plugin"],
        when: "sidebarNavigations",
      },
      {
        title: "Sidebar thread list",
        keywords: ["threads", "plugin"],
        when: "threadLists",
      },
      {
        title: "Source code",
        keywords: ["viewer", "renderer", "syntax highlighting", "files"],
        when: "sourceCodeRenderers",
      },
      {
        title: "Diffs",
        keywords: ["renderer", "split", "unified"],
        when: "diffRenderers",
      },
      {
        title: "Composer",
        keywords: ["prompt box", "input", "editor", "renderer", "plugin"],
        when: "composers",
      },
      {
        title: "Sidebar footer",
        keywords: ["reorder", "buttons", "navigation"],
      },
    ],
  },
  keyboard: {
    keywords: ["shortcuts", "keybindings", "hotkeys", "keys"],
    settings: [
      {
        title: "Show keyboard hints when holding CMD / Control",
        keywords: ["badges", "shortcut hints"],
      },
    ],
  },
  browser: {
    keywords: ["cookies", "sessions", "import", "sign in", "login"],
    settings: [],
  },
  files: {
    keywords: ["editor", "open with"],
    settings: [
      {
        title: "File preferences",
        keywords: ["editor", "directory default", "file default", "open with"],
        when: "filePreferences",
      },
      {
        title: "File openers",
        keywords: ["extensions", "file types", "viewer", "plugins"],
        when: "fileOpeners",
      },
    ],
  },
  projects: {
    keywords: ["repositories", "folders", "workspaces"],
    settings: [],
  },
  machines: {
    keywords: [
      "hosts",
      "computers",
      "remote",
      "connection method",
      "server address",
    ],
    settings: [],
  },
  mobile: {
    keywords: ["phone", "ios", "iphone", "android", "testflight", "apk"],
    settings: [],
  },
  "environment-variables": {
    keywords: ["env", "secrets", "tokens", "gh_token"],
    settings: [],
  },
  updates: {
    keywords: ["upgrade", "version", "release notes", "changelog"],
    settings: [
      { title: "Provider CLIs", keywords: ["agents", "upgrade"] },
      {
        title: "Plugins",
        keywords: ["plugin updates", "outdated", "upgrade"],
        when: "pluginUpdates",
      },
    ],
  },
  plugins: {
    keywords: ["extensions", "manage", "uninstall"],
    settings: [],
  },
  marketplaces: {
    keywords: ["catalog", "sources", "registry"],
    settings: [],
  },
  experiments: {
    keywords: ["beta", "preview", "labs", "feature flags"],
    settings: [
      { title: "Early adopter", keywords: ["beta", "opt in", "preview"] },
      {
        title: "App links",
        keywords: [
          "application links",
          "deep links",
          "linear",
          "slack",
          "URL schemes",
        ],
      },
      { title: "Changelog preview", keywords: ["release notes", "updates"] },
      {
        title: "Server performance diagnostics",
        keywords: ["cpu profile", "logs"],
        when: "performanceDiagnostics",
      },
      {
        title: "Server move",
        keywords: ["migrate", "export", "import", "machine"],
      },
    ],
  },
  community: {
    keywords: ["help", "support", "feedback"],
    settings: [
      { title: "Discord", keywords: ["chat", "support"] },
      {
        title: "GitHub",
        keywords: ["issues", "source code", "bug report", "releases"],
      },
    ],
  },
  archived: {
    keywords: ["archive", "restore", "unarchive"],
    settings: [],
  },
};

type SettingsSearchItemIcon =
  | { kind: "section"; name: IconName }
  | { kind: "plugin"; icon: string | null; pluginId: string };

export interface SettingsSearchItem {
  anchor: string | null;
  context: string | null;
  icon: SettingsSearchItemIcon;
  id: string;
  keywords: readonly string[];
  title: string;
  to: string;
}

export interface PluginSettingSearchEntry {
  description: string | null;
  key: string;
  label: string;
  pluginId: string;
}

interface BuildSettingsSearchItemsArgs {
  conditions: ReadonlySet<SettingsSearchCondition>;
  pluginEntries: readonly PluginSettingsEntry[];
  pluginSettings: readonly PluginSettingSearchEntry[];
  sections: readonly SettingsNavSection[];
}

export function buildSettingsSearchItems(
  args: BuildSettingsSearchItemsArgs,
): SettingsSearchItem[] {
  return [
    ...args.sections.flatMap((section) => {
      const indexed = SETTINGS_SEARCH_INDEX[section.id];
      const icon = { kind: "section" as const, name: section.icon };
      const to = getSettingsSectionRoutePath(section.id);
      return [
        {
          anchor: null,
          context: null,
          icon,
          id: `section:${section.id}`,
          keywords: indexed.keywords,
          title: section.label,
          to,
        },
        ...indexed.settings
          .filter(
            (setting) =>
              setting.when === undefined || args.conditions.has(setting.when),
          )
          .map((setting) => ({
            anchor: setting.title,
            context: section.label,
            icon,
            id: `setting:${section.id}:${setting.title}`,
            keywords: setting.keywords,
            title: setting.title,
            to,
          })),
      ];
    }),
    ...args.pluginEntries.flatMap((plugin) => {
      const icon = {
        kind: "plugin" as const,
        icon: plugin.icon,
        pluginId: plugin.id,
      };
      const to = getPluginConfigurationRoutePath({ pluginId: plugin.id });
      return [
        {
          anchor: null,
          context: "Plugin settings",
          icon,
          id: `plugin:${plugin.id}`,
          keywords: [plugin.id],
          title: plugin.label,
          to,
        },
        ...args.pluginSettings
          .filter((setting) => setting.pluginId === plugin.id)
          .map((setting) => ({
            anchor: setting.label,
            context: plugin.label,
            icon,
            id: `plugin-setting:${plugin.id}:${setting.key}`,
            keywords:
              setting.description === null
                ? [setting.key]
                : [setting.key, setting.description],
            title: setting.label,
            to,
          })),
      ];
    }),
  ];
}

const TITLE_PREFIX_RANK = 0;
const TITLE_WORD_RANK = 1;
const TITLE_SUBSTRING_RANK = 2;
const TITLE_TOKENS_RANK = 3;
const KEYWORD_RANK = 4;

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/gu, " ");
}

function rankSettingsSearchItem(
  item: SettingsSearchItem,
  query: string,
  tokens: readonly string[],
): number | null {
  const title = normalizeSearchText(item.title);
  if (title.startsWith(query)) return TITLE_PREFIX_RANK;
  if (title.includes(` ${query}`)) return TITLE_WORD_RANK;
  if (title.includes(query)) return TITLE_SUBSTRING_RANK;
  if (tokens.every((token) => title.includes(token))) return TITLE_TOKENS_RANK;
  const haystack = normalizeSearchText(
    [item.title, item.context ?? "", ...item.keywords].join(" "),
  );
  return tokens.every((token) => haystack.includes(token))
    ? KEYWORD_RANK
    : null;
}

export function searchSettings(
  query: string,
  items: readonly SettingsSearchItem[],
): SettingsSearchItem[] {
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery.length === 0) return [];
  const tokens = normalizedQuery.split(" ");
  return items
    .flatMap((item, index) => {
      const rank = rankSettingsSearchItem(item, normalizedQuery, tokens);
      return rank === null ? [] : [{ index, item, rank }];
    })
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        Number(left.item.anchor !== null) -
          Number(right.item.anchor !== null) ||
        left.index - right.index,
    )
    .map((match) => match.item);
}

export const SETTINGS_SEARCH_ANCHOR_STATE_KEY = "settingsSearchAnchor";

export function readSettingsSearchAnchor(state: unknown): string | null {
  if (
    typeof state !== "object" ||
    state === null ||
    !(SETTINGS_SEARCH_ANCHOR_STATE_KEY in state)
  ) {
    return null;
  }
  const anchor = state[SETTINGS_SEARCH_ANCHOR_STATE_KEY];
  return typeof anchor === "string" ? anchor : null;
}
