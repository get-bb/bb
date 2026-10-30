export const BB_DOCS_URL = "https://getbb.app/docs";

export const DOCS_LINK_SOURCE_QUERY = "utm_source=bb-app&utm_medium=docs-link";

function docsPage(slug: string): string {
  return `${BB_DOCS_URL}/${slug}?${DOCS_LINK_SOURCE_QUERY}`;
}

export const docsLinks = {
  home: `${BB_DOCS_URL}?${DOCS_LINK_SOURCE_QUERY}`,
  keyboardShortcuts: docsPage("keyboard-shortcuts"),
  changeKeyboardShortcuts: docsPage("change-keyboard-shortcuts"),
  agentSignIn: docsPage("an-agent-wont-sign-in-or-cant-be-found"),
  memoryUse: docsPage("bb-is-slow-or-uses-a-lot-of-memory"),
  addMachine: docsPage("add-a-machine"),
  installPlugins: docsPage("find-and-install-plugins"),
  mobile: docsPage("use-bb-on-your-phone"),
  skills: docsPage("add-and-share-skills"),
  remoteAccess: docsPage("set-up-remote-access"),
} as const;

export const bbHelpLinks = {
  releaseNotes: "https://getbb.app/changelog",
  discord: "https://discord.gg/kvBU6tJhcJ",
  reportBug: "https://github.com/get-bb/bb/issues/new",
} as const;
