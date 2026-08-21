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
  type MarkdownDefinition,
  type ParagraphSegment,
  type TableModel,
} from "./blocks";
export { type CodeLine, type CodeSpan, type CodeTokenType } from "./code";
export { type CodeBlockProps } from "./CodeBlock";
export {
  parseLocalFileLineSuffix,
  type ClassifyMarkdownLinkOptions,
  type MarkdownExternalLink,
  type MarkdownLinkTarget,
  type MarkdownLocalFileLink,
  type MarkdownRelativeLink,
} from "./links";
export { Markdown, type MarkdownProps } from "./Markdown";
export {
  type MarkdownBlockPress,
  type MarkdownCallbacks,
  type MarkdownContextValue,
  type MarkdownDirective,
  type MarkdownImagePress,
  type MarkdownTextSize,
  type MarkdownThreadMentionPress,
  type MarkdownThreadMentions,
} from "./MarkdownContext";
export { type MarkdownImageProps } from "./MarkdownImage";
export { MarkdownText, type MarkdownTextProps } from "./MarkdownText";
export {
  type BbDirectiveKind,
  type BbDirectiveNode,
  type BbMarkdownNode,
  type BbPromptMentionNode,
  type BbThreadMentionNode,
  type IndexedPromptMention,
} from "./mdast-nodes";
export { type MentionPillProps } from "./MentionPill";
export {
  type ParseMarkdownOptions,
  type SplitMarkdownFrontmatterResult,
} from "./parse";
export {
  extractMarkdownHeadings,
  markdownToPlainText,
  type MarkdownHeading,
} from "./plain-text";
export { type SubstitutePromptMentionsResult } from "./prompt-mentions";
