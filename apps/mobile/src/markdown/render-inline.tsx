import type { PhrasingContent } from "mdast";
import { toString as mdastToString } from "mdast-util-to-string";
import type { ReactNode } from "react";
import { Linking, Text as RNText, type TextStyle } from "react-native";
import type { PromptMentionResource } from "@bb/domain";
import {
  FONT_FAMILIES,
  FONT_WEIGHT_VALUES,
  resolveItalicFont,
  type FontWeightName,
} from "@/theme/fonts";
import { nativeTypography } from "@/theme/theme.native";
import { withAlpha } from "./colors";
import {
  classifyMarkdownLink,
  resolveInlineCodeMarkdownFileHref,
} from "./links";
import type { MarkdownContextValue } from "./MarkdownContext";
import { MentionPill } from "./MentionPill";

/**
 * Inline (phrasing) rendering: mdast phrasing content → nested RN `Text`
 * spans. The caller owns the outer `Text` (size, line height, colour); spans
 * only add the deltas (weight, italic, strike, mono, link) so plain prose
 * stays a bare string child and RN lays it out as one run.
 */

export interface InlineState {
  weight: FontWeightName;
  italic: boolean;
  strike: boolean;
}

export const DEFAULT_INLINE_STATE: InlineState = {
  weight: "regular",
  italic: false,
  strike: false,
};

function spanFont(
  state: InlineState,
): Pick<TextStyle, "fontFamily" | "fontWeight"> {
  if (state.italic) {
    return resolveItalicFont(state.weight);
  }
  return {
    fontFamily: FONT_FAMILIES.sans[state.weight],
    fontWeight: FONT_WEIGHT_VALUES[state.weight],
  };
}

function isDefaultState(state: InlineState): boolean {
  return state.weight === "regular" && !state.italic && !state.strike;
}

function spanStyle(state: InlineState): TextStyle {
  return {
    ...spanFont(state),
    ...(state.strike ? { textDecorationLine: "line-through" as const } : {}),
  };
}

/** Mono span style for inline code / inline math. */
function inlineCodeStyle(
  ctx: MarkdownContextValue,
  state: InlineState,
): TextStyle {
  const mono =
    state.weight === "regular"
      ? FONT_FAMILIES.mono.regular
      : FONT_FAMILIES.mono[state.weight];
  return {
    fontFamily: mono,
    fontWeight: FONT_WEIGHT_VALUES[state.weight],
    fontSize: nativeTypography.xs.fontSize,
    backgroundColor: withAlpha(ctx.tokens.muted, 0.7),
    ...(state.strike ? { textDecorationLine: "line-through" as const } : {}),
  };
}

/** Opens a link per the context callbacks; exported for the pills/blocks. */
function pressMarkdownLink(ctx: MarkdownContextValue, href: string): void {
  const target = classifyMarkdownLink(href, {
    rewriteLocalhostLinks: ctx.rewriteLocalhostLinks,
    serverHostname: ctx.serverHostname,
  });
  if (ctx.onLinkPress?.(target) === true) {
    return;
  }
  switch (target.kind) {
    case "external":
      void Linking.openURL(target.url).catch(() => undefined);
      return;
    case "local-file":
      ctx.onFilePress?.(target);
      return;
    case "relative":
      return;
  }
}

function linkStyle(ctx: MarkdownContextValue, state: InlineState): TextStyle {
  return {
    ...spanStyle(state),
    textDecorationLine: state.strike ? "underline line-through" : "underline",
    color: ctx.tokens.foreground,
  };
}

function isLocalFileHref(ctx: MarkdownContextValue, href: string): boolean {
  return (
    classifyMarkdownLink(href, {
      rewriteLocalhostLinks: ctx.rewriteLocalhostLinks,
      serverHostname: ctx.serverHostname,
    }).kind === "local-file"
  );
}

function renderLink(
  ctx: MarkdownContextValue,
  state: InlineState,
  href: string,
  children: ReactNode,
  key: string,
): ReactNode {
  const localFile = isLocalFileHref(ctx, href);
  const inert = localFile && ctx.onFilePress === undefined;
  return (
    <RNText
      key={key}
      accessibilityRole={inert ? undefined : "link"}
      onPress={inert ? undefined : () => pressMarkdownLink(ctx, href)}
      style={inert ? spanStyle(state) : linkStyle(ctx, state)}
    >
      {children}
    </RNText>
  );
}

function persistedThreadResource(
  ctx: MarkdownContextValue,
  threadId: string,
): PromptMentionResource | null {
  for (const mention of ctx.threadMentions?.mentions ?? []) {
    if (
      mention.resource.kind === "thread" &&
      mention.resource.threadId === threadId
    ) {
      return mention.resource;
    }
  }
  return null;
}

function renderThreadPill(
  ctx: MarkdownContextValue,
  resource: PromptMentionResource,
  key: string,
): ReactNode {
  const onThreadPress = ctx.onThreadPress;
  const onPress =
    onThreadPress && resource.kind === "thread"
      ? () => onThreadPress({ threadId: resource.threadId, resource })
      : undefined;
  return <MentionPill key={key} resource={resource} onPress={onPress} />;
}

// CommonMark soft line breaks survive in text values as "\n"; HTML collapses
// them to a space, RN would render a real line break. Hard breaks arrive as
// `break` nodes (always, and for every newline under remark-breaks).
function collapseSoftBreaks(value: string): string {
  return value.includes("\n")
    ? value.replace(/[ \t]*\r?\n[ \t]*/gu, " ")
    : value;
}

/**
 * Padding inside an inline code span: RN nested text cannot pad, so narrow
 * spaces. They must be NO-BREAK (U+202F, not U+2009): a breaking pad lets the
 * line wrap right after the leading space, which strands an empty highlighted
 * fragment at the end of one line and puts the code on the next.
 */
const CODE_PAD = "\u202f";

function renderText(value: string, state: InlineState, key: string): ReactNode {
  const text = collapseSoftBreaks(value);
  if (isDefaultState(state)) {
    return text;
  }
  return (
    <RNText key={key} style={spanStyle(state)}>
      {text}
    </RNText>
  );
}

/** Renders phrasing children into nodes for an enclosing `Text`. */
export function renderInline(
  nodes: readonly PhrasingContent[],
  ctx: MarkdownContextValue,
  state: InlineState = DEFAULT_INLINE_STATE,
  keyPrefix = "i",
): ReactNode[] {
  const out: ReactNode[] = [];
  nodes.forEach((node, index) => {
    const key = `${keyPrefix}.${index}`;
    switch (node.type) {
      case "text":
        out.push(renderText(node.value, state, key));
        return;
      case "emphasis":
        out.push(
          ...renderInline(node.children, ctx, { ...state, italic: true }, key),
        );
        return;
      case "strong":
        out.push(
          ...renderInline(
            node.children,
            ctx,
            { ...state, weight: "semibold" },
            key,
          ),
        );
        return;
      case "delete":
        out.push(
          ...renderInline(node.children, ctx, { ...state, strike: true }, key),
        );
        return;
      case "break":
        out.push("\n");
        return;
      case "inlineCode": {
        const fileHref =
          ctx.onFilePress === undefined
            ? null
            : resolveInlineCodeMarkdownFileHref(node.value);
        const code = (
          <RNText key={key} style={inlineCodeStyle(ctx, state)}>
            {`${CODE_PAD}${node.value}${CODE_PAD}`}
          </RNText>
        );
        out.push(
          fileHref === null
            ? code
            : renderLink(ctx, state, fileHref, code, `${key}.link`),
        );
        return;
      }
      case "inlineMath":
        out.push(
          <RNText key={key} style={inlineCodeStyle(ctx, state)}>
            {`${CODE_PAD}${node.value}${CODE_PAD}`}
          </RNText>,
        );
        return;
      case "link":
        out.push(
          renderLink(
            ctx,
            state,
            node.url,
            renderInline(node.children, ctx, state, key),
            key,
          ),
        );
        return;
      case "linkReference": {
        const definition = ctx.definitions.get(node.identifier.toLowerCase());
        if (definition === undefined) {
          // No definition: CommonMark renders the brackets literally.
          out.push(renderText("[", state, `${key}.open`));
          out.push(...renderInline(node.children, ctx, state, key));
          out.push(renderText("]", state, `${key}.close`));
          return;
        }
        out.push(
          renderLink(
            ctx,
            state,
            definition.url,
            renderInline(node.children, ctx, state, key),
            key,
          ),
        );
        return;
      }
      case "image":
        out.push(renderText(node.alt ?? "", state, key));
        return;
      case "imageReference":
        out.push(renderText(node.alt ?? "", state, key));
        return;
      case "html":
        out.push(renderText(node.value, state, key));
        return;
      case "footnoteReference":
        out.push(renderText(`[${node.label ?? node.identifier}]`, state, key));
        return;
      case "bbPromptMention": {
        const mention = ctx.promptMentions[node.index];
        if (mention === undefined) {
          return;
        }
        if (mention.resource.kind === "thread") {
          out.push(renderThreadPill(ctx, mention.resource, key));
          return;
        }
        const onMentionPress = ctx.onMentionPress;
        out.push(
          <MentionPill
            key={key}
            resource={mention.resource}
            onPress={onMentionPress ? () => onMentionPress(mention) : undefined}
          />,
        );
        return;
      }
      case "bbThreadMention": {
        const live = ctx.threadMentions?.resolveThread?.(node.threadId) ?? null;
        const resource = live ?? persistedThreadResource(ctx, node.threadId);
        if (resource !== null) {
          out.push(renderThreadPill(ctx, resource, key));
          return;
        }
        if (node.rawThreadId) {
          // A raw id without a known thread stays literal (code span if it was one).
          out.push(
            node.inlineCode ? (
              <RNText key={key} style={inlineCodeStyle(ctx, state)}>
                {`${CODE_PAD}${node.threadId}${CODE_PAD}`}
              </RNText>
            ) : (
              renderText(node.threadId, state, key)
            ),
          );
          return;
        }
        out.push(
          renderThreadPill(
            ctx,
            { kind: "thread", threadId: node.threadId, label: node.threadId },
            key,
          ),
        );
        return;
      }
      default:
        out.push(renderText(mdastToString(node), state, key));
    }
  });
  return out;
}
