import {
  memo,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type SetStateAction,
} from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import type {
  Components,
  ExtraProps,
  Options as ReactMarkdownOptions,
  UrlTransform,
} from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { ImageLightbox } from "./image-lightbox.js";
import { CopyButton } from "./copy-button.js";
import { Icon } from "./icon.js";
import { RouteAnchor } from "./app-route-anchor.js";
import {
  getMarkdownCodeLanguage,
  isMarkdownCodeBlock,
} from "./markdown-code-block.js";
import { normalizeLocalFileMarkdownLinks } from "./markdown-local-file-link-normalize.js";
import {
  buildLocalFileAnchorHref,
  parseLocalFileHref,
  resolveRelativeLocalFileHref,
  type MarkdownAbsoluteLocalFileLinkRouting,
  type MarkdownRelativeLocalFileLinkRouting,
} from "./markdown-local-file-link.js";
import type {
  MarkdownLinkRouting,
  MarkdownLocalFileLinkRouting,
} from "./markdown-link-routing.js";
import {
  buildThreadMentionComponent,
  remarkThreadMentions,
} from "./markdown-thread-mentions.js";
import { MarkdownMermaidDiagram } from "./markdown-mermaid-diagram.js";
import type { PromptTextMention } from "@bb/domain";
import type { TimelineTitleLinkResolver } from "@/components/thread/timeline/TimelineTitleView.js";
import { usePreferredTheme, type Theme } from "@/hooks/useTheme";
import { resolveRouteHref } from "@/lib/route-paths";
import { cn } from "@/lib/utils";

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
   * `mentions`, falling back to the id) with its link routed through
   * `resolveLinkHref` (the same resolver the timeline title links use). The two
   * fields are coupled — a pill is only useful when it can resolve both its
   * display resource and its href — so they travel together. Absent for
   * assistant content, which carries no mentions; that path is unaffected.
   */
  threadMentions?: MarkdownThreadMentions;
  urlTransform?: UrlTransform;
}

export interface MarkdownThreadMentions {
  mentions: readonly PromptTextMention[];
  resolveLinkHref: TimelineTitleLinkResolver;
}

interface MarkdownAnchorProps
  extends ComponentPropsWithoutRef<"a">, ExtraProps {
  linkRouting?: MarkdownLinkRouting;
}

interface IsMarkdownAppRouteHrefArgs {
  href: string | undefined;
}

interface BuildMarkdownComponentsArgs {
  linkRouting?: MarkdownLinkRouting;
  preferredTheme: Theme;
  setExpandedImageUrl: ExpandedImageUrlSetter;
  threadMentions?: MarkdownThreadMentions;
}

interface BuildLocalFileAwareUrlTransformArgs {
  fallbackUrlTransform: UrlTransform | undefined;
  localFileRouting: MarkdownLocalFileLinkRouting;
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

interface AreMarkdownLinkRoutingsEqualArgs {
  next: MarkdownLinkRouting | undefined;
  previous: MarkdownLinkRouting | undefined;
}

interface AreMarkdownThreadMentionsEqualArgs {
  next: MarkdownThreadMentions | undefined;
  previous: MarkdownThreadMentions | undefined;
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
  preferredTheme: Theme;
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
// Security-critical order: raw HTML must become nodes before sanitization can
// strip unsafe elements, attributes, and URLs.
const MARKDOWN_HTML_REHYPE_PLUGINS: MarkdownRehypePlugins = [
  rehypeRaw,
  rehypeSanitize,
];

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
    previous.resolveLinkHref === next.resolveLinkHref
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

function buildLocalFileAwareUrlTransform({
  fallbackUrlTransform,
  localFileRouting,
}: BuildLocalFileAwareUrlTransformArgs): UrlTransform {
  return (value, key, node) => {
    if (key === "href") {
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

    return (fallbackUrlTransform ?? defaultUrlTransform)(value, key, node);
  };
}

function MarkdownAnchor({
  children,
  href,
  linkRouting,
  ...anchorProps
}: MarkdownAnchorProps) {
  const localFileRouting = linkRouting?.localFile;
  const onOpenLocalFileLink = localFileRouting?.onOpenLink;
  const isAppRouteHref = isMarkdownAppRouteHref({ href });
  const localFileLink =
    !isAppRouteHref && localFileRouting
      ? parseLocalFileHref({
          absoluteLinks: localFileRouting.absoluteLinks,
          href,
        })
      : null;
  const anchorHref = buildLocalFileAnchorHref(localFileLink, href);
  const handleAnchorClick = (event: MarkdownAnchorEvent) => {
    if (localFileLink && onOpenLocalFileLink) {
      if (onOpenLocalFileLink(localFileLink)) {
        event.preventDefault();
      }
      return;
    }

    if (isAppRouteHref) {
      return;
    }

    // Defer ordinary web-link routing (e.g. opening in the in-app browser) to
    // the handler, which prevents default only when it takes over the open.
    if (linkRouting?.onOpenLink && href && linkRouting.onOpenLink({ href })) {
      event.preventDefault();
    }
  };

  return (
    <RouteAnchor
      {...anchorProps}
      href={anchorHref}
      className={cn(
        "break-words underline underline-offset-2",
        localFileLink && "inline-flex items-baseline gap-1",
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
          className="size-3 shrink-0 self-center text-subtle-foreground"
        />
      ) : null}
    </RouteAnchor>
  );
}

function MarkdownCode({
  className: codeClassName,
  children,
  node: _node,
  preferredTheme,
  ...props
}: MarkdownCodeRendererProps) {
  const codeText = String(children ?? "").replace(/\n$/, "");
  const language = getMarkdownCodeLanguage({ className: codeClassName });
  const isBlock = isMarkdownCodeBlock({ codeText, language });
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
          <CopyButton text={codeText} label="Copy code" />
        </div>
        <pre className="overflow-x-auto px-3 pb-3 pt-1">
          <code
            className={cn(
              "font-mono text-xs",
              language ? `language-${language}` : "",
            )}
            {...props}
          >
            {codeText}
          </code>
        </pre>
      </div>
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
  return (
    <div
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
  setExpandedImageUrl,
  threadMentions,
}: BuildMarkdownComponentsArgs): Components {
  function MarkdownLink(props: MarkdownAnchorProps) {
    return <MarkdownAnchor {...props} linkRouting={linkRouting} />;
  }

  function MarkdownCodeRenderer(props: MarkdownCodeProps) {
    return <MarkdownCode {...props} preferredTheme={preferredTheme} />;
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

function useMarkdownContentWidthVariable() {
  const contentRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = contentRef.current;
    if (!element) {
      return;
    }

    setMarkdownContentWidthVariable({
      element,
      width: element.getBoundingClientRect().width,
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
        element,
        width: entry.contentRect.width,
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return contentRef;
}

const FRONTMATTER_PATTERN = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

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
              <span className="font-medium text-muted-foreground/70">{key}</span>
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
  urlTransform,
}: MarkdownPreviewProps) {
  const preferredTheme = usePreferredTheme();
  const contentRef = useMarkdownContentWidthVariable();
  const [expandedImageUrl, setExpandedImageUrl] = useState<string | null>(null);
  const localFileRouting = linkRouting?.localFile;
  const normalizeLocalFileLinks = localFileRouting !== undefined;
  const markdownContent = useMemo(
    () =>
      normalizeLocalFileLinks
        ? normalizeLocalFileMarkdownLinks(content)
        : content,
    [content, normalizeLocalFileLinks],
  );
  const { frontmatter, body } = useMemo(
    () => splitMarkdownFrontmatter(markdownContent),
    [markdownContent],
  );
  const markdownComponents = useMemo(
    () =>
      buildMarkdownComponents({
        linkRouting,
        preferredTheme,
        setExpandedImageUrl,
        threadMentions,
      }),
    [linkRouting, preferredTheme, threadMentions],
  );
  // The thread-mention pipeline only activates when `threadMentions` is set.
  // Assistant content (no mentions) keeps the unchanged `[remarkGfm]` pipeline,
  // including CommonMark soft breaks. The mention branch adds `remark-breaks` so
  // a single `\n` stays a line break — generated bodies (child-outcome reports,
  // provisioning transcripts) rely on the prior `whitespace-pre-wrap` behavior.
  const remarkPlugins = useMemo(
    () =>
      threadMentions !== undefined
        ? [remarkGfm, remarkBreaks, remarkThreadMentions]
        : [remarkGfm],
    [threadMentions],
  );
  const resolvedUrlTransform = useMemo(
    () =>
      localFileRouting
        ? buildLocalFileAwareUrlTransform({
            fallbackUrlTransform: urlTransform,
            localFileRouting,
          })
        : urlTransform,
    [localFileRouting, urlTransform],
  );

  return (
    <>
      <div
        ref={contentRef}
        className={cn(
          "max-w-none break-words text-sm leading-relaxed text-foreground",
          className,
        )}
      >
        {frontmatter !== null ? (
          <MarkdownFrontmatter source={frontmatter} />
        ) : null}
        <ReactMarkdown
          rehypePlugins={allowHtml ? MARKDOWN_HTML_REHYPE_PLUGINS : undefined}
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
