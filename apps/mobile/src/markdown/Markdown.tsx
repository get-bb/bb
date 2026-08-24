import { memo, useMemo } from "react";
import {
  Text as RNText,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import type { PromptTextMention } from "@bb/domain";
import { useRewriteLocalhostLinksPreference } from "@/data/settings/use-local-preferences";
import { FONT_FAMILIES } from "@/theme/fonts";
import { nativeTypography } from "@/theme/theme.native";
import { collectDefinitions, type MarkdownDefinition } from "./blocks";
import {
  MarkdownContextProvider,
  useMarkdownContextValue,
  type MarkdownCallbacks,
  type MarkdownContextValue,
  type MarkdownTextSize,
  type MarkdownThreadMentions,
} from "./MarkdownContext";
import type { IndexedPromptMention } from "./mdast-nodes";
import {
  parseMarkdown,
  splitMarkdownFrontmatter,
  type ParseMarkdownOptions,
} from "./parse";
import { substitutePromptMentions } from "./prompt-mentions";
import { renderBlocks } from "./render-blocks";

export interface MarkdownProps extends MarkdownCallbacks {
  content: string;
  /** `sm` (timeline, default) or `base` (reading / composer). */
  textSize?: MarkdownTextSize;
  /**
   * Offset-based authored mentions (user messages): every kind renders as a
   * pill. Offsets index into `content`.
   */
  promptMentions?: readonly PromptTextMention[];
  /**
   * Enable `@thread:<id>` / raw thread id pills in prose. Pass `{}` to
   * enable with id-labelled fallbacks, or supply a live lookup.
   */
  threadMentions?: MarkdownThreadMentions;
  /** Text is selectable (long-press). Default true. */
  selectable?: boolean;
  /** `bb.rewriteLocalhostLinks` preference. Default true (web default). */
  rewriteLocalhostLinks?: boolean;
  /** Hostname the client reached the bb server on, for the rewrite. */
  serverHostname?: string;
  /** Show a leading `--- … ---` frontmatter block as muted metadata. */
  showFrontmatter?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const EMPTY_MENTIONS: readonly IndexedPromptMention[] = [];
const EMPTY_DEFINITIONS: ReadonlyMap<string, MarkdownDefinition> = new Map();

function definitionsKey(map: ReadonlyMap<string, MarkdownDefinition>): string {
  if (map.size === 0) {
    return "";
  }
  return [...map.entries()]
    .map(([id, def]) => `${id}\0${def.url}\0${def.title ?? ""}`)
    .join("\u0001");
}

/**
 * Interns definition maps by content so a streaming re-parse that defines
 * the same references yields the same map instance, keeping the render
 * context (and every memoized block) stable. Bounded like the parse cache.
 */
const DEFINITIONS_CACHE_LIMIT = 64;
const definitionsCache = new Map<
  string,
  ReadonlyMap<string, MarkdownDefinition>
>();

function internDefinitions(
  next: ReadonlyMap<string, MarkdownDefinition>,
): ReadonlyMap<string, MarkdownDefinition> {
  if (next.size === 0) {
    return EMPTY_DEFINITIONS;
  }
  const key = definitionsKey(next);
  const cached = definitionsCache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  definitionsCache.set(key, next);
  if (definitionsCache.size > DEFINITIONS_CACHE_LIMIT) {
    const oldest = definitionsCache.keys().next().value;
    if (oldest !== undefined) {
      definitionsCache.delete(oldest);
    }
  }
  return next;
}

function Frontmatter({
  source,
  ctx,
}: {
  source: string;
  ctx: MarkdownContextValue;
}) {
  const lines = source.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return null;
  }
  const type = nativeTypography.xs;
  return (
    <View
      style={{
        borderLeftWidth: 2,
        borderLeftColor: ctx.tokens.border,
        paddingLeft: 12,
        marginBottom: 12,
        gap: 2,
      }}
    >
      {lines.map((line, index) => {
        const separator = line.indexOf(":");
        const keyed = separator > 0 && !/^[\s-]/u.test(line);
        return (
          <RNText
            key={index}
            selectable={ctx.selectable}
            style={{
              fontFamily: FONT_FAMILIES.sans.regular,
              fontWeight: "400",
              fontSize: type.fontSize,
              lineHeight: type.lineHeight,
              color: ctx.tokens.mutedForeground,
            }}
          >
            {keyed ? (
              <>
                <RNText
                  style={{
                    fontFamily: FONT_FAMILIES.sans.medium,
                    fontWeight: "500",
                  }}
                >
                  {line.slice(0, separator).trim()}
                </RNText>
                {"  "}
                {line.slice(separator + 1).trim()}
              </>
            ) : (
              line
            )}
          </RNText>
        );
      })}
    </View>
  );
}

function MarkdownComponent({
  content,
  textSize = "sm",
  promptMentions,
  threadMentions,
  selectable = true,
  rewriteLocalhostLinks: rewriteLocalhostLinksProp,
  serverHostname,
  showFrontmatter = true,
  style,
  testID,
  onLinkPress,
  onFilePress,
  onImagePress,
  onThreadPress,
  onMentionPress,
  onBlockLongPress,
  onLongPress,
  renderDirective,
  resolveImageSource,
}: MarkdownProps) {
  // The device-local `bb.rewriteLocalhostLinks` preference unless the caller
  // decides (showcases, previews of other hosts' files).
  const rewriteLocalhostLinksPreference = useRewriteLocalhostLinksPreference();
  const rewriteLocalhostLinks =
    rewriteLocalhostLinksProp ?? rewriteLocalhostLinksPreference;
  // Prompt mentions are substituted for sentinels before anything else
  // (offsets index into the raw `content`).
  const substitution = useMemo(
    () =>
      promptMentions === undefined
        ? null
        : substitutePromptMentions(content, promptMentions),
    [content, promptMentions],
  );
  const substituted = substitution?.content ?? content;
  const { frontmatter, body } = useMemo(
    () =>
      showFrontmatter
        ? splitMarkdownFrontmatter(substituted)
        : { frontmatter: null, body: substituted },
    [showFrontmatter, substituted],
  );
  const parseOptions = useMemo<ParseMarkdownOptions>(
    () => ({
      preserveSoftBreaks: promptMentions !== undefined,
      threadMentions: threadMentions !== undefined,
      promptMentions: promptMentions !== undefined,
      directives: renderDirective !== undefined,
    }),
    [promptMentions, threadMentions, renderDirective],
  );
  const tree = useMemo(
    () => parseMarkdown(body, parseOptions),
    [body, parseOptions],
  );
  const definitions = useMemo(
    () => internDefinitions(collectDefinitions(tree)),
    [tree],
  );
  const indexedMentions = substitution?.mentions ?? EMPTY_MENTIONS;

  const ctx = useMarkdownContextValue({
    textSize,
    selectable,
    promptMentions: indexedMentions,
    threadMentions: threadMentions ?? null,
    rewriteLocalhostLinks,
    serverHostname,
    definitions,
    onLinkPress,
    onFilePress,
    onImagePress,
    onThreadPress,
    onMentionPress,
    onBlockLongPress,
    onLongPress,
    renderDirective,
    resolveImageSource,
  });

  return (
    <MarkdownContextProvider value={ctx}>
      <View style={style} testID={testID}>
        {frontmatter !== null ? (
          <Frontmatter source={frontmatter} ctx={ctx} />
        ) : null}
        {renderBlocks(tree.children, ctx, body)}
      </View>
    </MarkdownContextProvider>
  );
}

/**
 * Native markdown renderer for timeline messages and previews (mdast → RN).
 * Parsing is memoized by content; blocks are memoized by their source slice,
 * so keep callback props referentially stable (useCallback) to benefit.
 */
export const Markdown = memo(MarkdownComponent);
Markdown.displayName = "Markdown";
