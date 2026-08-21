import type { RootContent } from "mdast";
import { toString as mdastToString } from "mdast-util-to-string";
import { memo, useMemo, type ReactNode } from "react";
import { Text as RNText, type StyleProp, type TextStyle } from "react-native";
import type { PromptTextMention } from "@bb/domain";
import { useRewriteLocalhostLinksPreference } from "@/data/settings/use-local-preferences";
import { collectDefinitions } from "./blocks";
import {
  MarkdownContextProvider,
  useMarkdownContextValue,
  type MarkdownCallbacks,
  type MarkdownContextValue,
  type MarkdownTextSize,
  type MarkdownThreadMentions,
} from "./MarkdownContext";
import type { IndexedPromptMention } from "./mdast-nodes";
import { parseMarkdown, type ParseMarkdownOptions } from "./parse";
import { substitutePromptMentions } from "./prompt-mentions";
import { bodyTextStyle } from "./render-blocks";
import { renderInline } from "./render-inline";

export interface MarkdownTextProps extends Pick<
  MarkdownCallbacks,
  "onLinkPress" | "onFilePress" | "onThreadPress" | "onMentionPress"
> {
  content: string;
  textSize?: MarkdownTextSize;
  promptMentions?: readonly PromptTextMention[];
  threadMentions?: MarkdownThreadMentions;
  /** Merged over the body text style (colour, size, …). */
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  selectable?: boolean;
  serverHostname?: string;
  testID?: string;
}

const EMPTY_MENTIONS: readonly IndexedPromptMention[] = [];

function renderFlat(
  nodes: readonly RootContent[],
  ctx: MarkdownContextValue,
): ReactNode[] {
  const out: ReactNode[] = [];
  const visible = nodes.filter((node) => node.type !== "definition");
  visible.forEach((node, index) => {
    if (index > 0) {
      out.push("\n");
    }
    switch (node.type) {
      case "paragraph":
      case "heading":
        out.push(...renderInline(node.children, ctx, undefined, `p${index}`));
        return;
      case "list":
        node.children.forEach((item, itemIndex) => {
          if (itemIndex > 0) {
            out.push("\n");
          }
          out.push(...renderFlat(item.children, ctx));
        });
        return;
      case "blockquote":
        out.push(...renderFlat(node.children, ctx));
        return;
      default:
        out.push(mdastToString(node));
    }
  });
  return out;
}

function MarkdownTextComponent({
  content,
  textSize = "sm",
  promptMentions,
  threadMentions,
  style,
  numberOfLines,
  selectable = false,
  serverHostname,
  testID,
  onLinkPress,
  onFilePress,
  onThreadPress,
  onMentionPress,
}: MarkdownTextProps) {
  const rewriteLocalhostLinks = useRewriteLocalhostLinksPreference();
  const substitution = useMemo(
    () =>
      promptMentions === undefined
        ? null
        : substitutePromptMentions(content, promptMentions),
    [content, promptMentions],
  );
  const parseOptions = useMemo<ParseMarkdownOptions>(
    () => ({
      preserveSoftBreaks: true,
      threadMentions: threadMentions !== undefined,
      promptMentions: promptMentions !== undefined,
      directives: false,
    }),
    [threadMentions, promptMentions],
  );
  const tree = useMemo(
    () => parseMarkdown(substitution?.content ?? content, parseOptions),
    [substitution, content, parseOptions],
  );
  const definitions = useMemo(() => collectDefinitions(tree), [tree]);
  const ctx = useMarkdownContextValue({
    textSize,
    selectable,
    promptMentions: substitution?.mentions ?? EMPTY_MENTIONS,
    threadMentions: threadMentions ?? null,
    rewriteLocalhostLinks,
    serverHostname,
    definitions,
    onLinkPress,
    onFilePress,
    onThreadPress,
    onMentionPress,
  });
  return (
    <MarkdownContextProvider value={ctx}>
      <RNText
        selectable={selectable}
        numberOfLines={numberOfLines}
        style={[bodyTextStyle(ctx), style]}
        testID={testID}
      >
        {renderFlat(tree.children, ctx)}
      </RNText>
    </MarkdownContextProvider>
  );
}

/**
 * Single-`Text` markdown: inline formatting, links, and mention pills, with
 * block structure flattened to line breaks. For titles, list snippets,
 * tooltips, and other places a full block renderer is overkill.
 */
export const MarkdownText = memo(MarkdownTextComponent);
MarkdownText.displayName = "MarkdownText";
