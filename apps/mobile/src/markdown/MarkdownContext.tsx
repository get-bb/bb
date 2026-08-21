import type { ImageSource } from "expo-image";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { PromptMentionResource, PromptTextMention } from "@bb/domain";
import { useTheme } from "@/theme/ThemeProvider";
import type { NativeThemeTokens } from "@/theme/theme.native";
import type { ThemeMode } from "@/theme/theme-preference";
import type { MarkdownLinkTarget, MarkdownLocalFileLink } from "./links";
import type { BbDirectiveKind, IndexedPromptMention } from "./mdast-nodes";

/** Body type scale: `sm` = web timeline (15/22), `base` = composer/reading (16/24). */
export type MarkdownTextSize = "sm" | "base";

export interface MarkdownDirective {
  kind: BbDirectiveKind;
  name: string;
  attributes: Readonly<Record<string, string>>;
  /** Literal source (`::task{key="ABC-1"}`), also the fallback rendering. */
  source: string;
  /** Container body rendered as markdown (empty for leaf directives). */
  children: ReactNode;
}

export interface MarkdownImagePress {
  /** Resolved `uri` the image was rendered from. */
  src: string;
  alt: string;
}

/** A top-level flow block the user long-pressed (quote a paragraph). */
export interface MarkdownBlockPress {
  /** Exact source slice of the block. */
  source: string;
}

export interface MarkdownThreadMentionPress {
  threadId: string;
  /** Resolved display resource (may be a fallback labelled with the id). */
  resource: Extract<PromptMentionResource, { kind: "thread" }>;
}

/**
 * Thread-mention resolution for `@thread:<id>` tokens and raw ids. The host
 * supplies a synchronous lookup (sidebar cache / detail cache); unresolved
 * serialized tokens fall back to the persisted `mentions` and then to a pill
 * labelled with the id, unresolved raw ids stay literal text.
 */
export interface MarkdownThreadMentions {
  /** Persisted mention contract of the message (fallback labels). */
  mentions?: readonly PromptTextMention[];
  /** Live lookup; return null when unknown. */
  resolveThread?: (threadId: string) => PromptMentionResource | null;
}

export interface MarkdownCallbacks {
  /**
   * Tapped a link. Return `true` to claim it; otherwise external links open
   * with `Linking.openURL`, local file links go to `onFilePress`, and
   * relative links are inert.
   */
  onLinkPress?: (link: MarkdownLinkTarget) => boolean | void;
  /** Tapped a local file link (`/abs/path.ts:12`). Inert when absent. */
  onFilePress?: (file: MarkdownLocalFileLink) => void;
  /** Tapped an image (lightbox). Images are inert when absent. */
  onImagePress?: (image: MarkdownImagePress) => void;
  /** Tapped a thread-mention pill. */
  onThreadPress?: (mention: MarkdownThreadMentionPress) => void;
  /** Tapped a non-thread prompt-mention pill (path, command, plugin, …). */
  onMentionPress?: (mention: IndexedPromptMention) => void;
  /**
   * Long-pressed one flow block (paragraph, list, heading, …). When set,
   * every block with a known source slice becomes long-pressable; the
   * innermost block wins for nested content. Keep it referentially stable:
   * blocks are memoized on the context.
   */
  onBlockLongPress?: (block: MarkdownBlockPress) => void;
  /**
   * Directive cards. Return a node to render a card, or null to fall back to
   * the literal directive source.
   */
  renderDirective?: (directive: MarkdownDirective) => ReactNode | null;
  /**
   * Maps an image `src` to an expo-image source (headers / cookies / local
   * file routes). Return null to render the alt text instead. Default:
   * `{ uri: src }`.
   */
  resolveImageSource?: (src: string) => ImageSource | null;
}

export interface MarkdownContextValue extends MarkdownCallbacks {
  tokens: NativeThemeTokens;
  mode: ThemeMode;
  textSize: MarkdownTextSize;
  selectable: boolean;
  promptMentions: readonly IndexedPromptMention[];
  threadMentions: MarkdownThreadMentions | null;
  rewriteLocalhostLinks: boolean;
  serverHostname: string | undefined;
  /** Definitions (`[id]: url`) collected from the tree for reference links. */
  definitions: ReadonlyMap<string, { url: string; title: string | null }>;
}

const MarkdownContext = createContext<MarkdownContextValue | null>(null);

export const MarkdownContextProvider = MarkdownContext.Provider;

export function useMarkdownContext(): MarkdownContextValue {
  const value = useContext(MarkdownContext);
  if (value === null) {
    throw new Error("Markdown renderers must be mounted under <Markdown>.");
  }
  return value;
}

export interface MarkdownContextInputs extends MarkdownCallbacks {
  textSize: MarkdownTextSize;
  selectable: boolean;
  promptMentions: readonly IndexedPromptMention[];
  threadMentions: MarkdownThreadMentions | null;
  rewriteLocalhostLinks: boolean;
  serverHostname: string | undefined;
  definitions: ReadonlyMap<string, { url: string; title: string | null }>;
}

/** Builds the render context from the theme plus the component's props. */
export function useMarkdownContextValue(
  inputs: MarkdownContextInputs,
): MarkdownContextValue {
  const { tokens, mode } = useTheme();
  const {
    textSize,
    selectable,
    promptMentions,
    threadMentions,
    rewriteLocalhostLinks,
    serverHostname,
    definitions,
    onLinkPress,
    onFilePress,
    onImagePress,
    onThreadPress,
    onMentionPress,
    onBlockLongPress,
    renderDirective,
    resolveImageSource,
  } = inputs;
  return useMemo<MarkdownContextValue>(
    () => ({
      tokens,
      mode,
      textSize,
      selectable,
      promptMentions,
      threadMentions,
      rewriteLocalhostLinks,
      serverHostname,
      definitions,
      onLinkPress,
      onFilePress,
      onImagePress,
      onThreadPress,
      onMentionPress,
      onBlockLongPress,
      renderDirective,
      resolveImageSource,
    }),
    [
      tokens,
      mode,
      textSize,
      selectable,
      promptMentions,
      threadMentions,
      rewriteLocalhostLinks,
      serverHostname,
      definitions,
      onLinkPress,
      onFilePress,
      onImagePress,
      onThreadPress,
      onMentionPress,
      onBlockLongPress,
      renderDirective,
      resolveImageSource,
    ],
  );
}
