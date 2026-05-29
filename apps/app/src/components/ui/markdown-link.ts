export interface MarkdownPreviewLink {
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
