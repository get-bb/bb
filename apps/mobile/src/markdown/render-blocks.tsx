import type { Heading, List, ListItem, RootContent } from "mdast";
import { toString as mdastToString } from "mdast-util-to-string";
import { memo, type ReactNode } from "react";
import { Pressable, Text as RNText, View, type TextStyle } from "react-native";
import { FONT_FAMILIES, FONT_WEIGHT_VALUES } from "@/theme/fonts";
import { nativeTypography } from "@/theme/theme.native";
import { Icon } from "@/ui/Icon";
import { LONG_PRESS_DELAY_MS } from "@/ui/long-press";
import { getNodeSource, splitParagraphSegments } from "./blocks";
import { CodeBlock } from "./CodeBlock";
import type { MarkdownContextValue } from "./MarkdownContext";
import { MarkdownImage } from "./MarkdownImage";
import { MarkdownTable } from "./MarkdownTable";
import {
  DEFAULT_INLINE_STATE,
  renderInline,
  type InlineState,
} from "./render-inline";

/**
 * Block (flow) rendering: mdast flow content → RN views. Each top-level
 * block is a memoized `MarkdownBlock` keyed by position and compared by its
 * exact source slice, so a streaming body only re-renders the block that is
 * still changing.
 */

export interface BlockRenderOptions {
  /** Tight list items: paragraphs collapse their bottom spacing. */
  tight: boolean;
  /** Text colour override (blockquotes render muted). */
  color: string | undefined;
}

const DEFAULT_BLOCK_OPTIONS: BlockRenderOptions = {
  tight: false,
  color: undefined,
};

/** Body paragraph text style for the context's text size. */
export function bodyTextStyle(
  ctx: MarkdownContextValue,
  color?: string,
): TextStyle {
  const type = nativeTypography[ctx.textSize];
  return {
    fontFamily: FONT_FAMILIES.sans.regular,
    fontWeight: FONT_WEIGHT_VALUES.regular,
    fontSize: type.fontSize,
    lineHeight: type.lineHeight,
    color: color ?? ctx.tokens.foreground,
  };
}

interface HeadingStyleSpec {
  fontSize: number;
  lineHeight: number;
  weight: "medium" | "semibold";
  uppercase: boolean;
  muted: boolean;
  marginTop: number;
  marginBottom: number;
}

// Web: h1 text-lg/semibold mt-4 mb-2, h2 text-base, h3 text-sm, h4 text-sm
// medium, h5 text-sm semibold uppercase muted, h6 text-xs semibold uppercase.
const HEADING_STYLES: Record<Heading["depth"], HeadingStyleSpec> = {
  1: {
    fontSize: 18,
    lineHeight: 26,
    weight: "semibold",
    uppercase: false,
    muted: false,
    marginTop: 16,
    marginBottom: 8,
  },
  2: {
    fontSize: nativeTypography.base.fontSize,
    lineHeight: nativeTypography.base.lineHeight,
    weight: "semibold",
    uppercase: false,
    muted: false,
    marginTop: 16,
    marginBottom: 8,
  },
  3: {
    fontSize: nativeTypography.sm.fontSize,
    lineHeight: nativeTypography.sm.lineHeight,
    weight: "semibold",
    uppercase: false,
    muted: false,
    marginTop: 12,
    marginBottom: 8,
  },
  4: {
    fontSize: nativeTypography.sm.fontSize,
    lineHeight: nativeTypography.sm.lineHeight,
    weight: "medium",
    uppercase: false,
    muted: false,
    marginTop: 12,
    marginBottom: 4,
  },
  5: {
    fontSize: nativeTypography.sm.fontSize,
    lineHeight: nativeTypography.sm.lineHeight,
    weight: "semibold",
    uppercase: true,
    muted: true,
    marginTop: 8,
    marginBottom: 4,
  },
  6: {
    fontSize: nativeTypography.xs.fontSize,
    lineHeight: nativeTypography.xs.lineHeight,
    weight: "semibold",
    uppercase: true,
    muted: true,
    marginTop: 8,
    marginBottom: 4,
  },
};

const BLOCK_GAP = 8;
const TIGHT_BLOCK_GAP = 2;
const LIST_ITEM_GAP = 4;
const LIST_MARKER_WIDTH = 20;
const LIST_INDENT = 4;

function blockMargins(
  node: RootContent,
  isFirst: boolean,
  isLast: boolean,
  options: BlockRenderOptions,
): { marginTop: number; marginBottom: number } {
  if (node.type === "heading") {
    const spec = HEADING_STYLES[node.depth];
    return {
      marginTop: isFirst ? 0 : spec.marginTop,
      marginBottom: isLast ? 0 : spec.marginBottom,
    };
  }
  if (node.type === "thematicBreak") {
    return { marginTop: isFirst ? 0 : 16, marginBottom: isLast ? 0 : 16 };
  }
  const gap = options.tight ? TIGHT_BLOCK_GAP : BLOCK_GAP;
  return { marginTop: 0, marginBottom: isLast ? 0 : gap };
}

function renderHeading(
  node: Heading,
  ctx: MarkdownContextValue,
  options: BlockRenderOptions,
): ReactNode {
  const spec = HEADING_STYLES[node.depth];
  const state: InlineState = {
    ...DEFAULT_INLINE_STATE,
    weight: spec.weight,
  };
  return (
    <RNText
      selectable={ctx.selectable}
      accessibilityRole="header"
      style={{
        fontFamily: FONT_FAMILIES.sans[spec.weight],
        fontWeight: FONT_WEIGHT_VALUES[spec.weight],
        fontSize: spec.fontSize,
        lineHeight: spec.lineHeight,
        color: spec.muted
          ? ctx.tokens.mutedForeground
          : (options.color ?? ctx.tokens.foreground),
        ...(spec.uppercase ? { textTransform: "uppercase" as const } : {}),
      }}
    >
      {renderInline(node.children, ctx, state)}
    </RNText>
  );
}

function ListMarker({
  list,
  item,
  index,
  ctx,
  color,
}: {
  list: List;
  item: ListItem;
  index: number;
  ctx: MarkdownContextValue;
  color: string | undefined;
}) {
  const body = bodyTextStyle(ctx, color);
  if (item.checked === true || item.checked === false) {
    const checked = item.checked;
    const size = 16;
    return (
      <View
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        style={{
          width: LIST_MARKER_WIDTH,
          height: body.lineHeight,
          justifyContent: "center",
        }}
      >
        <View
          style={{
            width: size,
            height: size,
            borderRadius: 4,
            borderWidth: 1.5,
            borderColor: checked
              ? ctx.tokens.primary
              : ctx.tokens.mutedForeground,
            backgroundColor: checked ? ctx.tokens.primary : "transparent",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {checked ? (
            <Icon
              name="Check"
              size={12}
              strokeWidth={2.5}
              color={ctx.tokens.primaryForeground}
            />
          ) : null}
        </View>
      </View>
    );
  }
  const label = list.ordered ? `${(list.start ?? 1) + index}.` : "•";
  return (
    <RNText
      style={{
        ...body,
        width: LIST_MARKER_WIDTH,
        textAlign: list.ordered ? "right" : "center",
        paddingRight: list.ordered ? 2 : 0,
        color: ctx.tokens.mutedForeground,
        fontVariant: ["tabular-nums"],
      }}
    >
      {label}
    </RNText>
  );
}

function renderList(
  node: List,
  ctx: MarkdownContextValue,
  content: string,
  options: BlockRenderOptions,
  keyPrefix: string,
): ReactNode {
  const tight = node.spread !== true;
  return (
    <View style={{ paddingLeft: LIST_INDENT }}>
      {node.children.map((item, index) => (
        <View
          key={index}
          style={{
            flexDirection: "row",
            alignItems: "flex-start",
            marginBottom: index < node.children.length - 1 ? LIST_ITEM_GAP : 0,
          }}
        >
          <ListMarker
            list={node}
            item={item}
            index={index}
            ctx={ctx}
            color={options.color}
          />
          <View style={{ flex: 1, minWidth: 0, paddingLeft: 4 }}>
            {renderBlocks(
              item.children,
              ctx,
              content,
              { tight: tight || item.spread !== true, color: options.color },
              `${keyPrefix}.${index}`,
            )}
          </View>
        </View>
      ))}
    </View>
  );
}

function renderBlockquote(
  node: Extract<RootContent, { type: "blockquote" }>,
  ctx: MarkdownContextValue,
  content: string,
  keyPrefix: string,
): ReactNode {
  return (
    <View
      style={{
        borderLeftWidth: 2,
        borderLeftColor: ctx.tokens.surfaceSelectedBorder,
        paddingLeft: 12,
      }}
    >
      {renderBlocks(
        node.children,
        ctx,
        content,
        { tight: false, color: ctx.tokens.mutedForeground },
        keyPrefix,
      )}
    </View>
  );
}

function renderParagraph(
  node: Extract<RootContent, { type: "paragraph" }>,
  ctx: MarkdownContextValue,
  options: BlockRenderOptions,
  keyPrefix: string,
): ReactNode {
  const segments = splitParagraphSegments(node);
  if (segments.length === 1 && segments[0]?.kind === "inline") {
    return (
      <RNText
        selectable={ctx.selectable}
        style={bodyTextStyle(ctx, options.color)}
      >
        {renderInline(
          segments[0].children,
          ctx,
          DEFAULT_INLINE_STATE,
          keyPrefix,
        )}
      </RNText>
    );
  }
  if (segments.length === 0) {
    return null;
  }
  return (
    <View style={{ gap: BLOCK_GAP }}>
      {segments.map((segment, index) =>
        segment.kind === "image" ? (
          <MarkdownImage
            key={index}
            src={segment.image.url}
            alt={segment.image.alt ?? ""}
          />
        ) : (
          <RNText
            key={index}
            selectable={ctx.selectable}
            style={bodyTextStyle(ctx, options.color)}
          >
            {renderInline(
              segment.children,
              ctx,
              DEFAULT_INLINE_STATE,
              `${keyPrefix}.${index}`,
            )}
          </RNText>
        ),
      )}
    </View>
  );
}

function LiteralBlock({
  ctx,
  text,
}: {
  ctx: MarkdownContextValue;
  text: string;
}) {
  return (
    <RNText
      selectable={ctx.selectable}
      style={{
        fontFamily: FONT_FAMILIES.mono.regular,
        fontWeight: "400",
        fontSize: nativeTypography.xs.fontSize,
        lineHeight: nativeTypography.xs.lineHeight,
        color: ctx.tokens.mutedForeground,
      }}
    >
      {text}
    </RNText>
  );
}

function renderBlockContent(
  node: RootContent,
  ctx: MarkdownContextValue,
  content: string,
  options: BlockRenderOptions,
  keyPrefix: string,
): ReactNode {
  switch (node.type) {
    case "paragraph":
      return renderParagraph(node, ctx, options, keyPrefix);
    case "heading":
      return renderHeading(node, ctx, options);
    case "thematicBreak":
      return <View style={{ height: 1, backgroundColor: ctx.tokens.border }} />;
    case "blockquote":
      return renderBlockquote(node, ctx, content, keyPrefix);
    case "list":
      return renderList(node, ctx, content, options, keyPrefix);
    case "code":
      return <CodeBlock code={node.value} language={node.lang ?? null} />;
    case "math":
      return <CodeBlock code={node.value} language="math" />;
    case "html":
      return (
        <RNText
          selectable={ctx.selectable}
          style={bodyTextStyle(ctx, options.color)}
        >
          {node.value}
        </RNText>
      );
    case "bbDirective": {
      const rendered = ctx.renderDirective?.({
        kind: node.kind,
        name: node.name,
        attributes: node.attributes,
        source: node.source,
        children:
          node.children.length === 0
            ? null
            : renderBlocks(node.children, ctx, content, options, keyPrefix),
      });
      if (rendered !== null && rendered !== undefined) {
        return rendered;
      }
      return <LiteralBlock ctx={ctx} text={node.source} />;
    }
    case "definition":
      return null;
    case "footnoteDefinition":
      return (
        <View style={{ flexDirection: "row", gap: 4 }}>
          <RNText style={bodyTextStyle(ctx, ctx.tokens.mutedForeground)}>
            [{node.label ?? node.identifier}]
          </RNText>
          <View style={{ flex: 1 }}>
            {renderBlocks(node.children, ctx, content, options, keyPrefix)}
          </View>
        </View>
      );
    case "yaml":
      return <LiteralBlock ctx={ctx} text={node.value} />;
    default: {
      // Phrasing content at block level (after transforms) or unknown nodes:
      // show their text so nothing silently disappears.
      const text = mdastToString(node);
      if (text.length === 0) {
        return null;
      }
      return (
        <RNText
          selectable={ctx.selectable}
          style={bodyTextStyle(ctx, options.color)}
        >
          {text}
        </RNText>
      );
    }
  }
}

interface MarkdownBlockProps {
  node: RootContent;
  /** Exact source slice of `node` (null when positions are unavailable). */
  source: string | null;
  content: string;
  ctx: MarkdownContextValue;
  options: BlockRenderOptions;
  isFirst: boolean;
  isLast: boolean;
  keyPrefix: string;
}

function areBlockPropsEqual(
  previous: MarkdownBlockProps,
  next: MarkdownBlockProps,
): boolean {
  if (
    previous.ctx !== next.ctx ||
    previous.isFirst !== next.isFirst ||
    previous.isLast !== next.isLast ||
    previous.options.tight !== next.options.tight ||
    previous.options.color !== next.options.color ||
    previous.keyPrefix !== next.keyPrefix ||
    previous.node.type !== next.node.type
  ) {
    return false;
  }
  if (previous.node === next.node) {
    return true;
  }
  return previous.source !== null && previous.source === next.source;
}

/**
 * One flow block. Memoized on the source slice (see module docs) so only the
 * still-streaming tail of a body re-renders on every delta.
 */
const MarkdownBlock = memo(function MarkdownBlock({
  node,
  source,
  content,
  ctx,
  options,
  isFirst,
  isLast,
  keyPrefix,
}: MarkdownBlockProps) {
  const onBlockLongPress = ctx.onBlockLongPress;
  const onLongPress =
    onBlockLongPress !== undefined && source !== null
      ? () => onBlockLongPress({ source })
      : undefined;
  const style = blockMargins(node, isFirst, isLast, options);
  if (node.type === "table") {
    // A table owns its long-press target (inside its ScrollView; see
    // MarkdownTable), so it gets no Pressable wrapper. Without a block
    // handler it falls back to the body-level one. Code blocks also own
    // their target, but theirs copies the code instead of quoting it.
    return (
      <View style={style}>
        <MarkdownTable
          table={node}
          onLongPress={onLongPress ?? ctx.onLongPress}
        />
      </View>
    );
  }
  const rendered = renderBlockContent(node, ctx, content, options, keyPrefix);
  if (rendered === null) {
    return null;
  }
  if (onLongPress !== undefined) {
    // Not an accessibility element of its own: the text inside stays the
    // screen-reader target; long-press is a shortcut to quote this block.
    return (
      <Pressable
        accessible={false}
        onLongPress={onLongPress}
        delayLongPress={LONG_PRESS_DELAY_MS}
        style={style}
      >
        {rendered}
      </Pressable>
    );
  }
  return <View style={style}>{rendered}</View>;
}, areBlockPropsEqual);

/** Renders a list of flow nodes as memoized blocks. */
export function renderBlocks(
  nodes: readonly RootContent[],
  ctx: MarkdownContextValue,
  content: string,
  options: BlockRenderOptions = DEFAULT_BLOCK_OPTIONS,
  keyPrefix = "b",
): ReactNode[] {
  const visible = nodes.filter((node) => node.type !== "definition");
  return visible.map((node, index) => (
    <MarkdownBlock
      key={`${keyPrefix}.${index}`}
      node={node}
      source={getNodeSource(node, content)}
      content={content}
      ctx={ctx}
      options={options}
      isFirst={index === 0}
      isLast={index === visible.length - 1}
      keyPrefix={`${keyPrefix}.${index}`}
    />
  ));
}
