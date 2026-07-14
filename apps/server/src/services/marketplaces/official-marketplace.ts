import type { MarketplaceCatalog } from "./catalog.js";

export const OFFICIAL_MARKETPLACE_ID = "bb-official";
export const OFFICIAL_MARKETPLACE_GIT_URL =
  "https://github.com/ymichael/bb.git";
export const OFFICIAL_MARKETPLACE_GIT_REF = "main";

/**
 * Bundled last-known-good catalog for the default marketplace. Keeping this
 * snapshot in BB makes Browse useful before the first network refresh; the
 * Git-hosted marketplace remains authoritative when users refresh it.
 * The repository-root marketplace.json is checked against this value in tests.
 */
export const OFFICIAL_MARKETPLACE_CATALOG = {
  schemaVersion: 1,
  name: OFFICIAL_MARKETPLACE_ID,
  displayName: "BB Official",
  plugins: [
    {
      id: "github",
      displayName: "GitHub",
      description:
        "Browse GitHub issues and pull requests in BB, then send them to agents.",
      icon: "Github",
      category: "Developer tools",
      source: {
        githubRelease: {
          repository: "ymichael/bb",
          package: "bb-plugin-github",
          range: "^0.1.0",
          tagTemplate: "plugin-github-v{version}",
          assetTemplate: "bb-plugin-github-{version}.tgz",
        },
      },
      installation: {
        engines: { bb: ">=0.0", bbPluginSdk: "^0.2.0" },
      },
    },
    {
      id: "simple-notes",
      displayName: "Docs",
      description:
        "Create and edit Markdown documents across local and connected-host vaults.",
      icon: "FileText",
      category: "Productivity",
      source: {
        githubRelease: {
          repository: "ymichael/bb",
          package: "bb-plugin-simple-notes",
          range: "^0.1.1",
          tagTemplate: "plugin-docs-v{version}",
          assetTemplate: "bb-plugin-simple-notes-{version}.tgz",
        },
      },
      installation: {
        engines: { bb: ">=0.0", bbPluginSdk: "^0.2.0" },
      },
    },
    {
      id: "memory",
      displayName: "Memory",
      description:
        "Provider-independent durable memory for agents. We recommend disabling provider-native memory when using this plugin.",
      icon: "Brain",
      category: "Productivity",
      source: {
        githubRelease: {
          repository: "ymichael/bb",
          package: "bb-plugin-memory",
          range: "^0.1.0",
          tagTemplate: "plugin-memory-v{version}",
          assetTemplate: "bb-plugin-memory-{version}.tgz",
        },
      },
      installation: {
        engines: { bb: ">=0.0", bbPluginSdk: "^0.2.0" },
      },
    },
  ],
} satisfies MarketplaceCatalog;
