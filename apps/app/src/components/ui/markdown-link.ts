interface MarkdownPreviewLink {
  /** The anchor's resolved (sanitized) href. */
  href: string;
}

/**
 * Handler for ordinary (non-local-file) markdown anchor clicks. Return `true`
 * when the link was handled (e.g. routed into the in-app browser) and anchor
 * navigation should be prevented. Return `false` to leave the link as a normal
 * anchor with its default behavior.
 */
export type MarkdownPreviewLinkHandler = (link: MarkdownPreviewLink) => boolean;

/**
 * Cmd/Ctrl+click means "open this elsewhere" everywhere else in the OS, so it
 * opts out of in-app routing and falls back to the external browser.
 */
export function isExternalBrowserModifierClick(event: {
  ctrlKey: boolean;
  metaKey: boolean;
}): boolean {
  return event.metaKey || event.ctrlKey;
}
