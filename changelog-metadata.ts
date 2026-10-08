export type ReleaseHero = {
  src: string;
  darkSrc?: string;
  alt: string;
};

export type ReleaseVisualId =
  | "native-windows"
  | "diff-filter"
  | "saved-drafts"
  | "custom-environments"
  | "account-pooler"
  | "scheduled-send"
  | "file-editor"
  | "faster-threads"
  | "extensions-page"
  | "fast-mobile"
  | "fixes"
  | "plugins"
  | "multiple-choice"
  | "quiet-updates"
  | "split-views"
  | "multi-machine"
  | "more-agents";

export type ReleaseMeta = {
  date: string;
  headline: string;
  hero?: ReleaseHero;
  visual?: ReleaseVisualId;
};

export const RELEASE_META: Record<string, ReleaseMeta> = {
  "0.45.0": {
    date: "October 2, 2026",
    headline: "Native Windows support, service tiers, and faster conversations",
    visual: "native-windows",
  },
  "0.44.0": {
    date: "September 25, 2026",
    headline: "Diff filtering, safer archiving, and plugin safe mode",
    visual: "diff-filter",
  },
  "0.43.3": {
    date: "September 18, 2026",
    headline: "Saved drafts, browser annotations, and live browser previews",
    visual: "saved-drafts",
  },
  "0.43.0": {
    date: "September 11, 2026",
    headline: "Custom environments, machine plugins, and browser control",
    visual: "custom-environments",
  },
  "0.42.0": {
    date: "September 5, 2026",
    headline: "Account Pooler, push notifications, and a new plugin catalog",
    visual: "account-pooler",
  },
  "0.41.0": {
    date: "September 1, 2026",
    headline: "Scheduled sends, concurrency limits, and a rebuilt mobile app",
    visual: "scheduled-send",
  },
  "0.40.0": {
    date: "August 26, 2026",
    headline: "File Editor, quick palette, and agent providers",
    visual: "file-editor",
  },
  "0.39.0": {
    date: "August 19, 2026",
    headline: "Faster large threads and a long list of fixes",
    visual: "faster-threads",
  },
  "0.38.0": {
    date: "August 15, 2026",
    headline: "Extensions Page and Plugin Marketplaces",
    visual: "extensions-page",
  },
  "0.37.0": {
    date: "August 11, 2026",
    headline: "A much faster mobile app",
    visual: "fast-mobile",
  },
  "0.36.0": {
    date: "August 8, 2026",
    headline: "Fixes and improvements",
    visual: "fixes",
  },
  "0.35.0": {
    date: "August 4, 2026",
    headline: "Plugins",
    visual: "plugins",
  },
  "0.34.0": {
    date: "July 28, 2026",
    headline: "Fresher models, cross-provider questions",
    visual: "multiple-choice",
  },
  "0.33.0": {
    date: "July 21, 2026",
    headline: "Quieter updates and safer approvals",
    visual: "quiet-updates",
  },
  "0.0.31": {
    date: "July 17, 2026",
    headline: "Splits for everyone",
    visual: "split-views",
  },
  "0.0.30": {
    date: "July 14, 2026",
    headline: "Multi-machine workflows and bb Connect",
    visual: "multi-machine",
  },
  "0.0.29": {
    date: "July 9, 2026",
    headline: "More agents, more models, redesigned Settings",
    visual: "more-agents",
  },
};
