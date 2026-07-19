import {
  memo,
  useLayoutEffect,
  useContext,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type SetStateAction,
} from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@bb/shared-ui/context-menu";
import type {
  Components,
  ExtraProps,
  Options as ReactMarkdownOptions,
  UrlTransform,
} from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { ImageLightbox } from "./image-lightbox.js";
import { CopyButton } from "./copy-button.js";
import { Icon } from "@bb/shared-ui/icon";
import { RouteAnchor } from "./app-route-anchor.js";
import {
  getMarkdownCodeLanguage,
  isMarkdownCodeBlock,
} from "./markdown-code-block.js";
import { highlightMarkdownCode } from "./markdown-code-highlight.js";
import "./markdown-code-highlight.css";
import { normalizeLocalFileMarkdownLinks } from "./markdown-local-file-link-normalize.js";
import {
  buildLocalFileAnchorHref,
  parseLocalFileHref,
  resolveRelativeLocalFileHref,
  type MarkdownAbsoluteLocalFileLinkRouting,
  type MarkdownPreviewLocalFileLink,
  type MarkdownRelativeLocalFileLinkRouting,
} from "./markdown-local-file-link.js";
import {
  MarkdownLocalFileContextMenuContext,
  type MarkdownLinkRouting,
  type MarkdownLocalFileContextMenuItem,
  type MarkdownLocalFileLinkRouting,
  type MarkdownLocalImageRouting,
} from "./markdown-link-routing.js";
import {
  buildThreadMentionComponent,
  remarkThreadMentions,
} from "./markdown-thread-mentions.js";
import {
  buildPromptMentionComponent,
  remarkPromptMentions,
  substitutePromptMentions,
  type IndexedPromptMention,
  type MarkdownPromptMentions,
} from "./markdown-prompt-mentions.js";
import {
  buildMessageDirectiveComponent,
  remarkMessageDirectives,
  type MarkdownMessageDirectives,
  type MountedMessageDirective,
} from "./markdown-message-directives.js";
import { normalizePromptBlockquoteBoundaries } from "./markdown-prompt-blockquote-boundaries.js";
import { MarkdownMermaidDiagram } from "./markdown-mermaid-diagram.js";
import type { PromptTextMention } from "@bb/domain";
import type { PromptMentionLinkResolver } from "@/components/promptbox/editor/prompt-mention-link";
import type { TimelineTitleLinkResolver } from "@/components/thread/timeline/TimelineTitleView.js";
import { usePreferredTheme, type Theme } from "@/hooks/useTheme";
import {
  rewriteLocalhostLinkHref,
  useRewriteLocalhostLinksPreference,
} from "@/lib/localhost-link-rewrite-preference";
import { resolveRouteHref } from "@/lib/route-paths";
import { cn } from "@bb/shared-ui/lib/utils";
import remarkDirective from "remark-directive";

export interface MarkdownPreviewProps {
  allowHtml?: boolean;
  className?: string;
  content: string;
  expandedImageAlt?: string;
  imageLightboxTitle?: string;
  linkRouting?: MarkdownLinkRouting;
  /**
   * When supplied, the literal `@thread:<id>` token in the markdown source
   * renders as the canonical thread-mention pill (display name resolved from
   * live thread resources, then `mentions`, and finally the id). When present,
   * `resolveLinkHref` routes links through the same resolver as timeline
   * titles; otherwise the mention resource's project route is used.
   */
  threadMentions?: MarkdownThreadMentions;
  /**
   * Authored-prompt mentions (user messages): unlike {@link threadMentions},
   * which matches a single `@thread:<id>` token by regex, this carries the
   * editor's offset-based `mentions` array (offsets into `content`) and renders
   * every kind — thread, file/path, and slash command — as its canonical pill.
   * Activates the offset-substitution pipeline in `markdown-prompt-mentions`.
   * User messages may also supply {@link threadMentions} so raw serialized
   * thread tokens without offset metadata still render consistently. Structured
   * spans are substituted before Markdown parsing, so the two pipelines do not
   * double-render the same mention. Absent for assistant and generated bodies;
   * that path is unaffected.
   */
  promptMentions?: MarkdownPromptMentions;
  /**
   * Plugin assistant-message directives (`::inline-vis{...}`). Only supplied
   * for assistant conversation bodies (and nested agent output); user messages
   * and generic Markdown/file previews omit this so directives stay literal.
   * Parsing is `remark-directive`; recognized ids mount via PluginSlotMount.
   */
  messageDirectives?: MarkdownMessageDirectives;
  urlTransform?: UrlTransform;
}

export interface MarkdownThreadMentions {
  mentions: readonly PromptTextMention[];
  preserveSoftBreaks: boolean;
  resolveLinkHref?: TimelineTitleLinkResolver;
}

interface MarkdownAnchorProps
  extends ComponentPropsWithoutRef<"a">, ExtraProps {
  linkRouting?: MarkdownLinkRouting;
  rewriteLocalhostLinks?: boolean;
}

interface IsMarkdownAppRouteHrefArgs {
  href: string | undefined;
}

interface BuildMarkdownComponentsArgs {
  linkRouting?: MarkdownLinkRouting;
  preferredTheme: Theme;
  rewriteLocalhostLinks: boolean;
  setExpandedImageUrl: ExpandedImageUrlSetter;
  threadMentions?: MarkdownThreadMentions;
  promptMentions?: ResolvedPromptMentions;
  messageDirectives?: ResolvedMessageDirectiveRender;
}

/**
 * Message-directive props after the remark transform has filled the mount table
 * for this render (indices match `data-directive-index` on the custom element).
 */
interface ResolvedMessageDirectiveRender {
  mounts: readonly MountedMessageDirective[];
  message: MarkdownMessageDirectives["message"];
  openWorkspaceFile: MarkdownMessageDirectives["openWorkspaceFile"];
  openThreadPanel: MarkdownMessageDirectives["openThreadPanel"];
}

/**
 * {@link MarkdownPromptMentions} after sentinel substitution: the mention array
 * is now indexed to match the sentinels embedded in the parsed content.
 */
interface ResolvedPromptMentions {
  mentions: readonly IndexedPromptMention[];
  resolveLinkHref?: TimelineTitleLinkResolver;
  resolveMentionLink?: PromptMentionLinkResolver;
}

interface BuildLocalAwareUrlTransformArgs {
  fallbackUrlTransform: UrlTransform | undefined;
  localFileRouting: MarkdownLocalFileLinkRouting | undefined;
  localImageRouting: MarkdownLocalImageRouting | undefined;
}

interface MarkdownImageRendererArgs {
  alt: ComponentPropsWithoutRef<"img">["alt"];
  imageAttributes: MarkdownImageRenderAttributes;
  setExpandedImageUrl: ExpandedImageUrlSetter;
  src: ComponentPropsWithoutRef<"img">["src"];
}

interface ResolveMarkdownSourceMediaArgs {
  media: MarkdownSourceMedia;
  preferredTheme: Theme;
}

interface AreMarkdownAbsoluteLocalFileLinkRoutingsEqualArgs {
  next: MarkdownAbsoluteLocalFileLinkRouting | undefined;
  previous: MarkdownAbsoluteLocalFileLinkRouting | undefined;
}

interface AreMarkdownRelativeLocalFileLinkRoutingsEqualArgs {
  next: MarkdownRelativeLocalFileLinkRouting | undefined;
  previous: MarkdownRelativeLocalFileLinkRouting | undefined;
}

interface AreMarkdownLocalFileLinkRoutingsEqualArgs {
  next: MarkdownLocalFileLinkRouting | undefined;
  previous: MarkdownLocalFileLinkRouting | undefined;
}

interface AreMarkdownLocalImageRoutingsEqualArgs {
  next: MarkdownLocalImageRouting | undefined;
  previous: MarkdownLocalImageRouting | undefined;
}

interface AreMarkdownLinkRoutingsEqualArgs {
  next: MarkdownLinkRouting | undefined;
  previous: MarkdownLinkRouting | undefined;
}

interface AreMarkdownThreadMentionsEqualArgs {
  next: MarkdownThreadMentions | undefined;
  previous: MarkdownThreadMentions | undefined;
}

interface AreMarkdownPromptMentionsEqualArgs {
  next: MarkdownPromptMentions | undefined;
  previous: MarkdownPromptMentions | undefined;
}

interface AreMarkdownMessageDirectivesEqualArgs {
  next: MarkdownMessageDirectives | undefined;
  previous: MarkdownMessageDirectives | undefined;
}

type ExpandedImageUrlSetter = Dispatch<SetStateAction<string | null>>;

interface SetMarkdownContentWidthVariableArgs {
  element: HTMLElement;
  width: number;
}

type MarkdownPreviewPropsEqual = (
  previous: MarkdownPreviewProps,
  next: MarkdownPreviewProps,
) => boolean;
type MarkdownAnchorEvent = ReactMouseEvent<HTMLAnchorElement>;
type MarkdownBlockquoteProps = ComponentPropsWithoutRef<"blockquote"> &
  ExtraProps;
type MarkdownCodeProps = ComponentPropsWithoutRef<"code"> & ExtraProps;
interface MarkdownCodeRendererProps extends MarkdownCodeProps {
  linkRouting?: MarkdownLinkRouting;
  preferredTheme: Theme;
  rewriteLocalhostLinks: boolean;
}
type MarkdownHeadingProps = ComponentPropsWithoutRef<"h1"> & ExtraProps;
type MarkdownHrProps = ComponentPropsWithoutRef<"hr"> & ExtraProps;
type MarkdownImageProps = ComponentPropsWithoutRef<"img"> & ExtraProps;
type MarkdownImageRenderAttributes = Omit<
  MarkdownImageProps,
  "alt" | "children" | "className" | "node" | "src"
>;
type MarkdownListItemProps = ComponentPropsWithoutRef<"li"> & ExtraProps;
type MarkdownOrderedListProps = ComponentPropsWithoutRef<"ol"> & ExtraProps;
type MarkdownParagraphProps = ComponentPropsWithoutRef<"p"> & ExtraProps;
type MarkdownPreProps = ComponentPropsWithoutRef<"pre"> & ExtraProps;
type MarkdownSourceMedia = ComponentPropsWithoutRef<"source">["media"];
type MarkdownSourceProps = ComponentPropsWithoutRef<"source"> & ExtraProps;
type MarkdownTableProps = ComponentPropsWithoutRef<"table"> & ExtraProps;
type MarkdownTableCellProps = ComponentPropsWithoutRef<"td"> & ExtraProps;
type MarkdownTableHeadProps = ComponentPropsWithoutRef<"thead"> & ExtraProps;
type MarkdownTableHeaderProps = ComponentPropsWithoutRef<"th"> & ExtraProps;
type MarkdownUnorderedListProps = ComponentPropsWithoutRef<"ul"> & ExtraProps;
type MarkdownRehypePlugins = NonNullable<ReactMarkdownOptions["rehypePlugins"]>;

const MARKDOWN_TABLE_BREAKOUT_WIDTH = "max(100%, min(1100px, 100cqw - 2rem))";
const MARKDOWN_CONTENT_WIDTH_VARIABLE = "--md-content-w";
const MARKDOWN_SOURCE_COLOR_SCHEME_MEDIA_PATTERN =
  /^\(\s*prefers-color-scheme\s*:\s*(dark|light)\s*\)$/iu;
// `remark-math` emits math as `<code class="language-math">` (inline) and
// `<pre><code class="language-math">` (display) holding the raw TeX, and
// `rehype-katex` renders any element carrying that class. The default sanitize
// schema already keeps `language-*` classes on `<code>`, so the wrappers survive
// sanitization untouched — and `rehype-katex` runs LAST, after sanitize, so KaTeX
// (which uses `trust: false` and self-escapes its TeX input) emits its rendered
// output without it being re-sanitized.
//
// Security-critical order: raw HTML must become nodes (rehypeRaw) before
// sanitization can strip unsafe elements, attributes, and URLs.
const MARKDOWN_HTML_REHYPE_PLUGINS: MarkdownRehypePlugins = [
  rehypeRaw,
  rehypeSanitize,
  rehypeKatex,
];

// No raw HTML means nothing untrusted to sanitize, so KaTeX renders straight
// from the `remark-math` wrappers.
const MARKDOWN_MATH_REHYPE_PLUGINS: MarkdownRehypePlugins = [rehypeKatex];

function areMarkdownAbsoluteLocalFileLinkRoutingsEqual({
  next,
  previous,
}: AreMarkdownAbsoluteLocalFileLinkRoutingsEqualArgs): boolean {
  if (previous === next) return true;
  if (previous === undefined || next === undefined) return false;
  if (previous.kind !== next.kind) return false;
  if (previous.kind === "trusted-host" || next.kind === "trusted-host") {
    return true;
  }
  return previous.rootPath === next.rootPath;
}

function areMarkdownRelativeLocalFileLinkRoutingsEqual({
  next,
  previous,
}: AreMarkdownRelativeLocalFileLinkRoutingsEqualArgs): boolean {
  if (previous === next) return true;
  if (previous === undefined || next === undefined) return false;
  return (
    previous.baseDir === next.baseDir && previous.rootPath === next.rootPath
  );
}

function areMarkdownLocalFileLinkRoutingsEqual({
  next,
  previous,
}: AreMarkdownLocalFileLinkRoutingsEqualArgs): boolean {
  if (previous === next) return true;
  if (previous === undefined || next === undefined) return false;
  return (
    previous.onOpenLink === next.onOpenLink &&
    areMarkdownAbsoluteLocalFileLinkRoutingsEqual({
      next: next.absoluteLinks,
      previous: previous.absoluteLinks,
    }) &&
    areMarkdownRelativeLocalFileLinkRoutingsEqual({
      next: next.relativeLinks,
      previous: previous.relativeLinks,
    })
  );
}

function areMarkdownLocalImageRoutingsEqual({
  next,
  previous,
}: AreMarkdownLocalImageRoutingsEqualArgs): boolean {
  if (previous === next) return true;
  if (previous === undefined || next === undefined) return false;
  return (
    previous.resolveSrc === next.resolveSrc &&
    areMarkdownAbsoluteLocalFileLinkRoutingsEqual({
      next: next.absolutePaths,
      previous: previous.absolutePaths,
    }) &&
    areMarkdownRelativeLocalFileLinkRoutingsEqual({
      next: next.relativePaths,
      previous: previous.relativePaths,
    })
  );
}

function areMarkdownLinkRoutingsEqual({
  next,
  previous,
}: AreMarkdownLinkRoutingsEqualArgs): boolean {
  if (previous === next) return true;
  if (previous === undefined || next === undefined) return false;
  return (
    previous.onOpenLink === next.onOpenLink &&
    areMarkdownLocalFileLinkRoutingsEqual({
      next: next.localFile,
      previous: previous.localFile,
    }) &&
    areMarkdownLocalImageRoutingsEqual({
      next: next.localImage,
      previous: previous.localImage,
    })
  );
}

function areMarkdownThreadMentionsEqual({
  next,
  previous,
}: AreMarkdownThreadMentionsEqualArgs): boolean {
  if (previous === next) return true;
  if (previous === undefined || next === undefined) return false;
  return (
    previous.mentions === next.mentions &&
    previous.preserveSoftBreaks === next.preserveSoftBreaks &&
    previous.resolveLinkHref === next.resolveLinkHref
  );
}

function areMarkdownPromptMentionsEqual({
  next,
  previous,
}: AreMarkdownPromptMentionsEqualArgs): boolean {
  if (previous === next) return true;
  if (previous === undefined || next === undefined) return false;
  return (
    previous.mentions === next.mentions &&
    previous.resolveLinkHref === next.resolveLinkHref &&
    previous.resolveMentionLink === next.resolveMentionLink
  );
}

function areMarkdownMessageDirectivesEqual({
  next,
  previous,
}: AreMarkdownMessageDirectivesEqualArgs): boolean {
  if (previous === next) return true;
  if (previous === undefined || next === undefined) return false;
  return (
    previous.registry === next.registry &&
    previous.openWorkspaceFile === next.openWorkspaceFile &&
    previous.openThreadPanel === next.openThreadPanel &&
    previous.message.id === next.message.id &&
    previous.message.threadId === next.message.threadId &&
    previous.message.turnId === next.message.turnId &&
    previous.message.projectId === next.message.projectId
  );
}

const areMarkdownPreviewPropsEqual: MarkdownPreviewPropsEqual = (
  previous,
  next,
) =>
  (previous.allowHtml ?? false) === (next.allowHtml ?? false) &&
  previous.className === next.className &&
  previous.content === next.content &&
  (previous.expandedImageAlt ?? "Expanded image") ===
    (next.expandedImageAlt ?? "Expanded image") &&
  (previous.imageLightboxTitle ?? "Expanded image preview") ===
    (next.imageLightboxTitle ?? "Expanded image preview") &&
  previous.urlTransform === next.urlTransform &&
  areMarkdownThreadMentionsEqual({
    next: next.threadMentions,
    previous: previous.threadMentions,
  }) &&
  areMarkdownPromptMentionsEqual({
    next: next.promptMentions,
    previous: previous.promptMentions,
  }) &&
  areMarkdownMessageDirectivesEqual({
    next: next.messageDirectives,
    previous: previous.messageDirectives,
  }) &&
  areMarkdownLinkRoutingsEqual({
    next: next.linkRouting,
    previous: previous.linkRouting,
  });

function isMarkdownAppRouteHref({ href }: IsMarkdownAppRouteHrefArgs): boolean {
  if (!href || typeof window === "undefined") {
    return false;
  }

  return (
    resolveRouteHref({
      currentOrigin: window.location.origin,
      href,
    }) !== null
  );
}

function resolveMarkdownLocalPath(
  value: string,
  absolutePaths: MarkdownAbsoluteLocalFileLinkRouting,
  relativePaths: MarkdownRelativeLocalFileLinkRouting | undefined,
): MarkdownPreviewLocalFileLink | null {
  const absolutePath = parseLocalFileHref({
    absoluteLinks: absolutePaths,
    href: value,
  });
  if (absolutePath !== null || relativePaths === undefined) {
    return absolutePath;
  }

  const resolvedHref = resolveRelativeLocalFileHref({
    href: value,
    ...relativePaths,
  });
  return resolvedHref === null
    ? null
    : parseLocalFileHref({
        absoluteLinks: absolutePaths,
        href: resolvedHref,
      });
}

function buildLocalAwareUrlTransform({
  fallbackUrlTransform,
  localFileRouting,
  localImageRouting,
}: BuildLocalAwareUrlTransformArgs): UrlTransform {
  return (value, key, node) => {
    if (key === "href" && localFileRouting !== undefined) {
      if (
        parseLocalFileHref({
          absoluteLinks: localFileRouting.absoluteLinks,
          href: value,
        })
      ) {
        return value;
      }

      if (localFileRouting.relativeLinks !== undefined) {
        const resolvedHref = resolveRelativeLocalFileHref({
          href: value,
          ...localFileRouting.relativeLinks,
        });
        if (
          resolvedHref !== null &&
          parseLocalFileHref({
            absoluteLinks: localFileRouting.absoluteLinks,
            href: resolvedHref,
          })
        ) {
          return resolvedHref;
        }
      }
    }

    if (key === "src" && localImageRouting !== undefined) {
      const localImage = resolveMarkdownLocalPath(
        value,
        localImageRouting.absolutePaths,
        localImageRouting.relativePaths,
      );
      if (localImage !== null) {
        return localImageRouting.resolveSrc(localImage);
      }
    }

    return (fallbackUrlTransform ?? defaultUrlTransform)(value, key, node);
  };
}

function hasMarkdownFileExtension(path: string): boolean {
  return /\.(?:md|markdown)$/iu.test(path);
}

function resolveInlineCodeMarkdownFileHref({
  codeText,
  localFileRouting,
}: {
  codeText: string;
  localFileRouting: MarkdownLocalFileLinkRouting | undefined;
}): string | null {
  if (
    localFileRouting === undefined ||
    codeText.length === 0 ||
    codeText.trim() !== codeText ||
    codeText.includes("\n") ||
    codeText.includes("\r")
  ) {
    return null;
  }

  const absoluteLink = parseLocalFileHref({
    absoluteLinks: localFileRouting.absoluteLinks,
    href: codeText,
  });
  if (absoluteLink !== null) {
    return hasMarkdownFileExtension(absoluteLink.path) ? codeText : null;
  }

  if (localFileRouting.relativeLinks === undefined) {
    return null;
  }

  const resolvedHref = resolveRelativeLocalFileHref({
    href: codeText,
    ...localFileRouting.relativeLinks,
  });
  if (resolvedHref === null) {
    return null;
  }

  const resolvedLink = parseLocalFileHref({
    absoluteLinks: localFileRouting.absoluteLinks,
    href: resolvedHref,
  });
  return resolvedLink !== null && hasMarkdownFileExtension(resolvedLink.path)
    ? resolvedHref
    : null;
}

function MarkdownAnchor({
  children,
  href,
  linkRouting,
  rewriteLocalhostLinks,
  ...anchorProps
}: MarkdownAnchorProps) {
  const localFileRouting = linkRouting?.localFile;
  const onOpenLocalFileLink = localFileRouting?.onOpenLink;
  const rewrittenHref = rewriteLocalhostLinkHref({
    currentHostname:
      typeof window === "undefined" ? undefined : window.location.hostname,
    enabled: rewriteLocalhostLinks ?? false,
    href,
  });
  const isAppRouteHref = isMarkdownAppRouteHref({ href: rewrittenHref });
  const localFileLink =
    !isAppRouteHref && localFileRouting
      ? parseLocalFileHref({
          absoluteLinks: localFileRouting.absoluteLinks,
          href: rewrittenHref,
        })
      : null;
  const anchorHref = buildLocalFileAnchorHref(localFileLink, rewrittenHref);
  const getContextMenuItems = useContext(MarkdownLocalFileContextMenuContext);
  const contextMenuItems =
    localFileLink !== null && getContextMenuItems !== null
      ? getContextMenuItems(localFileLink)
      : null;
  const handleAnchorClick = (event: MarkdownAnchorEvent) => {
    if (localFileLink && onOpenLocalFileLink) {
      if (onOpenLocalFileLink(localFileLink)) {
        event.preventDefault();
      }
      return;
    }

    // Let timeline/terminal hosts claim web links first. Absolute app-origin
    // URLs can still be browser destinations even though they resolve to an
    // app route.
    if (
      linkRouting?.onOpenLink &&
      rewrittenHref &&
      linkRouting.onOpenLink({ href: rewrittenHref })
    ) {
      event.preventDefault();
      return;
    }

    if (isAppRouteHref) {
      return;
    }
  };

  const anchor = (
    <RouteAnchor
      {...anchorProps}
      href={anchorHref}
      className={cn(
        "break-words [overflow-wrap:anywhere] underline underline-offset-2",
      )}
      target="_blank"
      rel="noopener noreferrer"
      onClick={handleAnchorClick}
    >
      {children}
      {localFileLink ? (
        <Icon
          name="ExternalLink"
          aria-hidden
          className="ml-1 inline size-3 align-[-0.125em] text-subtle-foreground"
        />
      ) : null}
    </RouteAnchor>
  );
  if (contextMenuItems === null || contextMenuItems.length === 0) {
    return anchor;
  }
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{anchor}</ContextMenuTrigger>
      <ContextMenuContent className="min-w-44">
        {contextMenuItems.map(renderMarkdownLocalFileContextMenuItem)}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function renderMarkdownLocalFileContextMenuItem(
  item: MarkdownLocalFileContextMenuItem,
) {
  if (item.type === "separator") {
    return <ContextMenuSeparator key={item.id} />;
  }
  if (item.type === "submenu") {
    return (
      <ContextMenuSub key={item.id}>
        <ContextMenuSubTrigger>{item.label}</ContextMenuSubTrigger>
        <ContextMenuSubContent className="min-w-44">
          {item.items.map(renderMarkdownLocalFileContextMenuItem)}
        </ContextMenuSubContent>
      </ContextMenuSub>
    );
  }
  return (
    <ContextMenuItem key={item.id} onSelect={item.onSelect}>
      {item.label}
    </ContextMenuItem>
  );
}

function MarkdownCode({
  className: codeClassName,
  children,
  linkRouting,
  node: _node,
  preferredTheme,
  rewriteLocalhostLinks,
  ...props
}: MarkdownCodeRendererProps) {
  const codeText = String(children ?? "").replace(/\n$/, "");
  const language = getMarkdownCodeLanguage({ className: codeClassName });
  const isBlock = isMarkdownCodeBlock({ codeText, language });
  const [softWrap, setSoftWrap] = useState(false);
  // Highlight only fenced blocks (mermaid renders as a diagram, inline code stays
  // plain). The HTML is escaped by sugar-high, so dangerouslySetInnerHTML is safe.
  const highlightedHtml = useMemo(
    () =>
      isBlock && language !== "mermaid"
        ? highlightMarkdownCode({ code: codeText, language })
        : null,
    [isBlock, language, codeText],
  );
  if (isBlock) {
    if (language === "mermaid") {
      return (
        <MarkdownMermaidDiagram
          preferredTheme={preferredTheme}
          source={codeText}
        />
      );
    }

    return (
      <div className="my-2 overflow-hidden rounded-md border border-border bg-surface-recessed">
        <div className="flex items-center justify-between pl-3 pr-1.5 pt-1.5">
          <span className="font-mono text-xs uppercase text-muted-foreground">
            {language ?? ""}
          </span>
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              aria-pressed={softWrap}
              aria-label={softWrap ? "Disable line wrap" : "Wrap long lines"}
              onClick={() => {
                setSoftWrap((value) => !value);
              }}
              className="inline-flex size-5 cursor-pointer items-center justify-center text-muted-foreground transition-colors hover:text-foreground aria-pressed:text-foreground"
            >
              <Icon name="TextWrap" className="size-3" />
            </button>
            <CopyButton text={codeText} label="Copy code" />
          </div>
        </div>
        <pre
          className={cn(
            "bb-code-highlight px-3 pb-3 pt-1",
            softWrap
              ? "whitespace-pre-wrap [overflow-wrap:anywhere]"
              : "overflow-x-auto",
          )}
        >
          {highlightedHtml === null ? (
            <code className="font-mono text-xs" {...props}>
              {codeText}
            </code>
          ) : (
            <code
              className={cn(
                "font-mono text-xs",
                language ? `language-${language}` : "",
              )}
              dangerouslySetInnerHTML={{ __html: highlightedHtml }}
              {...props}
            />
          )}
        </pre>
      </div>
    );
  }

  const markdownFileHref = resolveInlineCodeMarkdownFileHref({
    codeText,
    localFileRouting: linkRouting?.localFile,
  });
  if (markdownFileHref !== null) {
    return (
      <MarkdownAnchor
        href={markdownFileHref}
        linkRouting={linkRouting}
        rewriteLocalhostLinks={rewriteLocalhostLinks}
      >
        {codeText}
      </MarkdownAnchor>
    );
  }

  return (
    <code
      className="rounded bg-muted/70 px-1.5 py-0.5 font-mono text-xs"
      {...props}
    >
      {children}
    </code>
  );
}

function MarkdownPre({ children }: MarkdownPreProps) {
  return <>{children}</>;
}

function MarkdownH1({ children }: MarkdownHeadingProps) {
  return (
    <h1 className="mb-2 mt-4 text-lg font-semibold text-foreground first:mt-0">
      {children}
    </h1>
  );
}

function MarkdownH2({ children }: MarkdownHeadingProps) {
  return (
    <h2 className="mb-2 mt-4 text-base font-semibold text-foreground first:mt-0">
      {children}
    </h2>
  );
}

function MarkdownH3({ children }: MarkdownHeadingProps) {
  return (
    <h3 className="mb-2 mt-3 text-sm font-semibold text-foreground first:mt-0">
      {children}
    </h3>
  );
}

function MarkdownH4({ children }: MarkdownHeadingProps) {
  return (
    <h4 className="mb-1 mt-3 text-sm font-medium text-foreground first:mt-0">
      {children}
    </h4>
  );
}

function MarkdownH5({ children }: MarkdownHeadingProps) {
  return (
    <h5 className="mb-1 mt-2 text-sm font-semibold uppercase text-muted-foreground first:mt-0">
      {children}
    </h5>
  );
}

function MarkdownH6({ children }: MarkdownHeadingProps) {
  return (
    <h6 className="mb-1 mt-2 text-xs font-semibold uppercase text-muted-foreground first:mt-0">
      {children}
    </h6>
  );
}

function MarkdownParagraph({
  children,
  className: _className,
  node: _node,
  ...paragraphProps
}: MarkdownParagraphProps) {
  return (
    <p {...paragraphProps} className="mb-2 text-foreground last:mb-0">
      {children}
    </p>
  );
}

function MarkdownUnorderedList({ children }: MarkdownUnorderedListProps) {
  return <ul className="mb-2 list-disc pl-5 text-foreground">{children}</ul>;
}

function MarkdownOrderedList({ children }: MarkdownOrderedListProps) {
  return <ol className="mb-2 list-decimal pl-5 text-foreground">{children}</ol>;
}

function MarkdownListItem({ children }: MarkdownListItemProps) {
  return <li className="mb-1 text-foreground">{children}</li>;
}

function MarkdownBlockquote({ children }: MarkdownBlockquoteProps) {
  return (
    <blockquote className="my-2 border-l-2 border-surface-selected-border pl-3 text-muted-foreground">
      {children}
    </blockquote>
  );
}

function MarkdownTable({ children }: MarkdownTableProps) {
  const breakoutRef = useMarkdownTableContentWidthVariable();

  return (
    <div
      ref={breakoutRef}
      className="my-2 flex justify-center"
      style={{
        width: MARKDOWN_TABLE_BREAKOUT_WIDTH,
        marginInline: `calc((100% - ${MARKDOWN_TABLE_BREAKOUT_WIDTH}) / 2)`,
      }}
    >
      {/*
        Inner wrapper anchors narrow tables, centers mid-width tables, and
        scrolls overflow for very wide tables. The min-width is clamped by
        100% so it never forces the wrapper wider than the breakout
        container — without that clamp, when the viewport shrinks below
        `--md-content-w` the wrapper extends past the container and the
        scrollbar gets clipped.
      */}
      <div
        className="w-max max-w-full overflow-x-auto"
        style={{
          minWidth: `min(var(${MARKDOWN_CONTENT_WIDTH_VARIABLE}, 100%), 100%)`,
        }}
      >
        <table className="border border-border">{children}</table>
      </div>
    </div>
  );
}

function MarkdownTableHead({ children }: MarkdownTableHeadProps) {
  return <thead className="bg-surface-recessed">{children}</thead>;
}

function MarkdownTableHeader({ children }: MarkdownTableHeaderProps) {
  return (
    <th className="border border-border px-2 py-1 text-left font-medium">
      {children}
    </th>
  );
}

function MarkdownTableCell({ children }: MarkdownTableCellProps) {
  return <td className="border border-border px-2 py-1">{children}</td>;
}

function renderMarkdownImage({
  alt,
  imageAttributes,
  setExpandedImageUrl,
  src,
}: MarkdownImageRendererArgs) {
  const imageUrl = typeof src === "string" ? src : "";
  if (!imageUrl) return null;
  return (
    <img
      {...imageAttributes}
      src={imageUrl}
      alt={typeof alt === "string" ? alt : "Image"}
      className="my-2 max-h-96 max-w-full cursor-zoom-in object-contain"
      loading="lazy"
      onClick={() => setExpandedImageUrl(imageUrl)}
    />
  );
}

function MarkdownHr(_props: MarkdownHrProps) {
  return <hr className="my-4 border-t border-border" />;
}

function parseMarkdownSourceColorScheme(media: string): Theme | null {
  const match = MARKDOWN_SOURCE_COLOR_SCHEME_MEDIA_PATTERN.exec(media);
  const colorScheme = match?.[1];
  if (colorScheme === "dark" || colorScheme === "light") {
    return colorScheme;
  }
  return null;
}

function resolveMarkdownSourceMedia({
  media,
  preferredTheme,
}: ResolveMarkdownSourceMediaArgs): MarkdownSourceMedia {
  if (!media) return media;

  const colorScheme = parseMarkdownSourceColorScheme(media);
  if (!colorScheme) return media;

  return colorScheme === preferredTheme ? "all" : "not all";
}

function buildMarkdownComponents({
  linkRouting,
  preferredTheme,
  rewriteLocalhostLinks,
  setExpandedImageUrl,
  threadMentions,
  promptMentions,
  messageDirectives,
}: BuildMarkdownComponentsArgs): Components {
  function MarkdownLink(props: MarkdownAnchorProps) {
    return (
      <MarkdownAnchor
        {...props}
        linkRouting={linkRouting}
        rewriteLocalhostLinks={rewriteLocalhostLinks}
      />
    );
  }

  function MarkdownCodeRenderer(props: MarkdownCodeProps) {
    return (
      <MarkdownCode
        {...props}
        linkRouting={linkRouting}
        preferredTheme={preferredTheme}
        rewriteLocalhostLinks={rewriteLocalhostLinks}
      />
    );
  }

  function MarkdownImage({
    src,
    alt,
    className: _className,
    node: _node,
    ...imageAttributes
  }: MarkdownImageProps) {
    return renderMarkdownImage({
      alt,
      imageAttributes,
      setExpandedImageUrl,
      src,
    });
  }

  function MarkdownSource({
    media,
    node: _node,
    ...sourceProps
  }: MarkdownSourceProps) {
    return (
      <source
        {...sourceProps}
        media={resolveMarkdownSourceMedia({ media, preferredTheme })}
      />
    );
  }

  const components: Components = {
    a: MarkdownLink,
    blockquote: MarkdownBlockquote,
    code: MarkdownCodeRenderer,
    h1: MarkdownH1,
    h2: MarkdownH2,
    h3: MarkdownH3,
    h4: MarkdownH4,
    h5: MarkdownH5,
    h6: MarkdownH6,
    hr: MarkdownHr,
    img: MarkdownImage,
    li: MarkdownListItem,
    ol: MarkdownOrderedList,
    p: MarkdownParagraph,
    pre: MarkdownPre,
    source: MarkdownSource,
    table: MarkdownTable,
    td: MarkdownTableCell,
    th: MarkdownTableHeader,
    thead: MarkdownTableHead,
    ul: MarkdownUnorderedList,
  };

  if (threadMentions !== undefined) {
    components["bb-thread-mention"] = buildThreadMentionComponent({
      mentions: threadMentions.mentions,
      resolveSegmentLinkHref: threadMentions.resolveLinkHref,
    });
  }

  if (promptMentions !== undefined) {
    components["bb-prompt-mention"] = buildPromptMentionComponent({
      mentions: promptMentions.mentions,
      resolveLinkHref: promptMentions.resolveLinkHref,
      resolveMentionLink: promptMentions.resolveMentionLink,
    });
  }

  if (messageDirectives !== undefined) {
    components["bb-message-directive"] = buildMessageDirectiveComponent({
      mounts: messageDirectives.mounts,
      message: messageDirectives.message,
      openWorkspaceFile: messageDirectives.openWorkspaceFile,
      openThreadPanel: messageDirectives.openThreadPanel,
    });
  }

  return components;
}

function setMarkdownContentWidthVariable({
  element,
  width,
}: SetMarkdownContentWidthVariableArgs): void {
  if (width <= 0) {
    return;
  }
  element.style.setProperty(MARKDOWN_CONTENT_WIDTH_VARIABLE, `${width}px`);
}

function useMarkdownTableContentWidthVariable() {
  const breakoutRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const breakout = breakoutRef.current;
    const content = breakout?.closest<HTMLElement>("[data-markdown-preview]");
    if (!breakout || !content) {
      return;
    }

    setMarkdownContentWidthVariable({
      element: breakout,
      width: content.getBoundingClientRect().width,
    });

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }
      setMarkdownContentWidthVariable({
        element: breakout,
        width: entry.contentRect.width,
      });
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  return breakoutRef;
}

const FRONTMATTER_PATTERN =
  /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/**
 * Splits a leading YAML frontmatter block (`---` … `---` at the very start of
 * the document) from the markdown body. Without this, react-markdown renders
 * the fences as two thematic breaks with the raw YAML as a paragraph between
 * them. Returns the inner frontmatter text (or null) and the remaining body.
 */
function splitMarkdownFrontmatter(markdown: string): {
  frontmatter: string | null;
  body: string;
} {
  const match = FRONTMATTER_PATTERN.exec(markdown);
  if (match === null) {
    return { frontmatter: null, body: markdown };
  }
  return { frontmatter: match[1], body: markdown.slice(match[0].length) };
}

/**
 * Renders frontmatter subtly: a muted, small key/value list set off by a thin
 * left rule, so it reads as document metadata instead of competing with the
 * body. Flat `key: value` lines get an aligned key; anything else (nested keys,
 * list items) is shown verbatim but still muted.
 */
function MarkdownFrontmatter({ source }: { source: string }) {
  const lines = source.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return null;
  }
  return (
    <div className="mb-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 border-l-2 border-border pl-3 text-xs leading-relaxed text-muted-foreground">
      {lines.map((line, index) => {
        const separator = line.indexOf(":");
        if (separator > 0 && !/^[\s-]/.test(line)) {
          const key = line.slice(0, separator).trim();
          const value = line.slice(separator + 1).trim();
          // `contents` lets the key/value spans participate in the parent grid,
          // so every value lines up in a single column regardless of key width.
          return (
            <div key={index} className="contents">
              <span className="font-medium text-muted-foreground/70">
                {key}
              </span>
              <span className="min-w-0 break-words">{value}</span>
            </div>
          );
        }
        return (
          <div
            key={index}
            className="col-span-2 whitespace-pre-wrap break-words text-muted-foreground/80"
          >
            {line}
          </div>
        );
      })}
    </div>
  );
}

function MarkdownPreviewComponent({
  allowHtml = false,
  className,
  content,
  expandedImageAlt = "Expanded image",
  imageLightboxTitle = "Expanded image preview",
  linkRouting,
  threadMentions,
  promptMentions,
  messageDirectives,
  urlTransform,
}: MarkdownPreviewProps) {
  const preferredTheme = usePreferredTheme();
  const [rewriteLocalhostLinks] = useRewriteLocalhostLinksPreference();
  const [expandedImageUrl, setExpandedImageUrl] = useState<string | null>(null);
  const localFileRouting = linkRouting?.localFile;
  const localImageRouting = linkRouting?.localImage;
  const normalizeLocalFileLinks =
    localFileRouting !== undefined || localImageRouting !== undefined;
  // Substitute prompt-mention spans for inert sentinels first (offsets index
  // into the raw `content`), so the sentinels are present before frontmatter
  // splitting and link normalization run. `resolvedPromptMentions` carries the
  // index-aligned mention list the `bb-prompt-mention` renderer reads back.
  const promptMentionSubstitution = useMemo(
    () =>
      promptMentions
        ? substitutePromptMentions(content, promptMentions.mentions)
        : null,
    [content, promptMentions],
  );
  const resolvedPromptMentions = useMemo<ResolvedPromptMentions | undefined>(
    () =>
      promptMentions && promptMentionSubstitution
        ? {
            mentions: promptMentionSubstitution.mentions,
            resolveLinkHref: promptMentions.resolveLinkHref,
            resolveMentionLink: promptMentions.resolveMentionLink,
          }
        : undefined,
    [promptMentions, promptMentionSubstitution],
  );
  const substitutedContent = promptMentionSubstitution?.content ?? content;
  const markdownContent = useMemo(
    () =>
      normalizeLocalFileLinks
        ? normalizeLocalFileMarkdownLinks(substitutedContent)
        : substitutedContent,
    [substitutedContent, normalizeLocalFileLinks],
  );
  const promptMarkdownContent = useMemo(
    () =>
      promptMentions !== undefined
        ? normalizePromptBlockquoteBoundaries(markdownContent)
        : markdownContent,
    [markdownContent, promptMentions],
  );
  const { frontmatter, body } = useMemo(
    () => splitMarkdownFrontmatter(promptMarkdownContent),
    [promptMarkdownContent],
  );
  // The remark transform fills this shared mount table on every parse. Keep it
  // stable while assistant text streams so the custom React component type
  // also stays stable and an already-complete directive does not remount when
  // later prose arrives.
  const messageDirectiveMounts = useMemo(() => {
    if (messageDirectives === undefined) {
      return null;
    }
    const mounts: MountedMessageDirective[] = [];
    return {
      mounts,
      message: messageDirectives.message,
      openWorkspaceFile: messageDirectives.openWorkspaceFile,
      openThreadPanel: messageDirectives.openThreadPanel,
      registry: messageDirectives.registry,
    };
  }, [messageDirectives]);
  const markdownComponents = useMemo(
    () =>
      buildMarkdownComponents({
        linkRouting,
        preferredTheme,
        rewriteLocalhostLinks,
        setExpandedImageUrl,
        threadMentions,
        promptMentions: resolvedPromptMentions,
        messageDirectives:
          messageDirectiveMounts === null
            ? undefined
            : {
                mounts: messageDirectiveMounts.mounts,
                message: messageDirectiveMounts.message,
                openWorkspaceFile: messageDirectiveMounts.openWorkspaceFile,
                openThreadPanel: messageDirectiveMounts.openThreadPanel,
              },
      }),
    [
      linkRouting,
      preferredTheme,
      rewriteLocalhostLinks,
      threadMentions,
      resolvedPromptMentions,
      messageDirectiveMounts,
    ],
  );
  // A mention pipeline activates only when its prop is set. Generated thread
  // bodies opt into `remark-breaks` so a single `\n` stays a line break;
  // assistant thread mentions keep ordinary CommonMark soft breaks. Authored
  // prompt mentions also preserve breaks to retain the editor's prior
  // `whitespace-pre-wrap` behavior. User messages may enable both pipelines:
  // offset substitution removes structured mentions before the raw-token pass,
  // leaving only unstructured `@thread:<id>` tokens for that fallback.
  //
  // Message directives (assistant only) add `remark-directive` + a host
  // transformer that rewrites recognized leaf directives into plugin mounts.
  const remarkPlugins = useMemo((): NonNullable<
    ReactMarkdownOptions["remarkPlugins"]
  > => {
    const plugins: NonNullable<ReactMarkdownOptions["remarkPlugins"]> = [
      remarkGfm,
      // `remark-math` with single-dollar math OFF: micromark pairs any two
      // unescaped `$` on a line, so "$5 to $10" or "$HOME and $PATH" render the
      // span between them as math — and literal dollars dominate chat (#511).
      // Inline math needs `$$x$$`; `$$` on its own lines is still a block.
      [remarkMath, { singleDollarTextMath: false }],
    ];
    if (
      threadMentions?.preserveSoftBreaks === true ||
      promptMentions !== undefined
    ) {
      plugins.push(remarkBreaks);
    }
    if (threadMentions !== undefined) {
      plugins.push(remarkThreadMentions);
    }
    if (promptMentions !== undefined) {
      plugins.push(remarkPromptMentions);
    }
    if (messageDirectiveMounts !== null) {
      plugins.push(remarkDirective);
      // Attacher + options: shared mount table is cleared/refilled each parse
      // so indices stay aligned with the custom elements below.
      plugins.push([
        remarkMessageDirectives,
        {
          mounts: messageDirectiveMounts.mounts,
          registry: messageDirectiveMounts.registry,
        },
      ]);
    }
    return plugins;
  }, [threadMentions, promptMentions, messageDirectiveMounts]);
  const resolvedUrlTransform = useMemo(
    () =>
      localFileRouting || localImageRouting
        ? buildLocalAwareUrlTransform({
            fallbackUrlTransform: urlTransform,
            localFileRouting,
            localImageRouting,
          })
        : urlTransform,
    [localFileRouting, localImageRouting, urlTransform],
  );

  return (
    <>
      <div
        data-markdown-preview=""
        className={cn(
          "max-w-none break-words text-sm leading-relaxed text-foreground",
          className,
        )}
      >
        {frontmatter !== null ? (
          <MarkdownFrontmatter source={frontmatter} />
        ) : null}
        <ReactMarkdown
          rehypePlugins={
            allowHtml
              ? MARKDOWN_HTML_REHYPE_PLUGINS
              : MARKDOWN_MATH_REHYPE_PLUGINS
          }
          remarkPlugins={remarkPlugins}
          components={markdownComponents}
          urlTransform={resolvedUrlTransform}
        >
          {body}
        </ReactMarkdown>
      </div>

      <ImageLightbox
        imageSrc={expandedImageUrl}
        imageAlt={expandedImageAlt}
        title={imageLightboxTitle}
        onClose={() => setExpandedImageUrl(null)}
      />
    </>
  );
}

export const MarkdownPreview = memo(
  MarkdownPreviewComponent,
  areMarkdownPreviewPropsEqual,
);
MarkdownPreview.displayName = "MarkdownPreview";
