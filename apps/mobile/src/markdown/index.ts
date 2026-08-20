// Native markdown renderer (mdast → React Native). Import from "@/markdown".
//
// Components (RN):
//   <Markdown content … />       full block renderer for message bodies
//   <MarkdownText content … />   single-Text inline renderer for previews
//   <CodeBlock code language />  standalone fenced-code block
//   <MentionPill resource />     inline mention chip (needs a Markdown context)
// Pure helpers (node-safe, tested):
//   parseMarkdown, markdownToPlainText, extractMarkdownHeadings,
//   classifyMarkdownLink, tokenizeCodeLines, substitutePromptMentions, …
export {
  buildTableModel,
  collectDefinitions,
  getNodeSource,
  splitParagraphSegments,
  type MarkdownDefinition,
  type ParagraphSegment,
  type TableModel,
} from "./blocks";
export {
  CODE_HIGHLIGHT_CHAR_LIMIT,
  CODE_TOKEN_COLORS,
  codeTokenColor,
  normalizeCodeLanguage,
  tokenizeCodeLines,
  type CodeLine,
  type CodeSpan,
  type CodeTokenType,
} from "./code";
export {
  CodeBlock,
  copyCodeToClipboard,
  type CodeBlockProps,
} from "./CodeBlock";
export { withAlpha } from "./colors";
export {
  MARKDOWN_DIRECTIVE_LIMIT,
  normalizeDirectiveAttributes,
  reconstructDirectiveSource,
  remarkBbDirectives,
} from "./directives";
export {
  classifyMarkdownLink,
  parseLocalFileHref,
  parseLocalFileLineSuffix,
  resolveInlineCodeMarkdownFileHref,
  type ClassifyMarkdownLinkOptions,
  type MarkdownExternalLink,
  type MarkdownLinkTarget,
  type MarkdownLocalFileLink,
  type MarkdownRelativeLink,
} from "./links";
export { Markdown, type MarkdownProps } from "./Markdown";
export {
  useMarkdownContext,
  type MarkdownBlockPress,
  type MarkdownCallbacks,
  type MarkdownContextValue,
  type MarkdownDirective,
  type MarkdownImagePress,
  type MarkdownTextSize,
  type MarkdownThreadMentionPress,
  type MarkdownThreadMentions,
} from "./MarkdownContext";
export { MarkdownImage, type MarkdownImageProps } from "./MarkdownImage";
export { MarkdownTable } from "./MarkdownTable";
export { MarkdownText, type MarkdownTextProps } from "./MarkdownText";
export {
  isBbDirectiveNode,
  isBbPromptMentionNode,
  isBbThreadMentionNode,
  type BbDirectiveKind,
  type BbDirectiveNode,
  type BbMarkdownNode,
  type BbPromptMentionNode,
  type BbThreadMentionNode,
  type IndexedPromptMention,
} from "./mdast-nodes";
export {
  promptMentionAccessibilityLabel,
  promptMentionIconName,
  promptMentionKindLabel,
} from "./mention-display";
export { MentionPill, type MentionPillProps } from "./MentionPill";
export {
  clearParseMarkdownCache,
  DEFAULT_PARSE_MARKDOWN_OPTIONS,
  parseMarkdown,
  parseMarkdownUncached,
  splitMarkdownFrontmatter,
  type ParseMarkdownOptions,
  type SplitMarkdownFrontmatterResult,
} from "./parse";
export {
  extractMarkdownHeadings,
  markdownToPlainText,
  type MarkdownHeading,
} from "./plain-text";
export {
  normalizePromptTextMentions,
  remarkPromptMentions,
  substitutePromptMentions,
  type SubstitutePromptMentionsResult,
} from "./prompt-mentions";
export {
  remarkThreadMentions,
  splitRawThreadIdsInText,
  type RawThreadIdTextSegment,
} from "./thread-mentions";
