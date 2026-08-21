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
  parseLocalFileLineSuffix,
  type MarkdownLinkTarget,
  type MarkdownLocalFileLink,
} from "./links";
export { Markdown } from "./Markdown";
export {
  type MarkdownBlockPress,
  type MarkdownDirective,
  type MarkdownImagePress,
  type MarkdownThreadMentionPress,
  type MarkdownThreadMentions,
} from "./MarkdownContext";
export { MarkdownText } from "./MarkdownText";
export { extractMarkdownHeadings, markdownToPlainText } from "./plain-text";
