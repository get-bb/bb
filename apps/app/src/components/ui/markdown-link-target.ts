import { parseApplicationUrl } from "@bb/domain/application-url";
import type { Heading, Nodes, Root } from "mdast";
import type { MouseEvent as ReactMouseEvent } from "react";
import { visit } from "unist-util-visit";
import { resolveRouteHref } from "@/lib/route-paths";
import {
  parseLocalFileHref,
  resolveRelativeLocalFileHref,
  type MarkdownAbsoluteLocalFileLinkRouting,
  type MarkdownPreviewLocalFileLink,
  type MarkdownRelativeLocalFileLinkRouting,
} from "./markdown-local-file-link.js";
import type {
  MarkdownLinkRouting,
  MarkdownLocalFileLinkRouting,
} from "./markdown-link-routing.js";
import type { MarkdownPreviewLinkHandler } from "./markdown-link.js";

export interface ResolvedMarkdownLocalFileTarget {
  href: string;
  link: MarkdownPreviewLocalFileLink;
  sourceKind: "absolute" | "relative";
}

export type MarkdownLinkTarget =
  | { kind: "fragment"; id: string }
  | { kind: "app-route" }
  | { kind: "local-file"; link: MarkdownPreviewLocalFileLink }
  | { kind: "application-url"; href: string }
  | { kind: "url"; href: string };

interface ResolveMarkdownLinkTargetArgs {
  currentOrigin: string | null;
  href: string;
  localFileRouting: MarkdownLocalFileLinkRouting | undefined;
}

interface OpenMarkdownLinkTargetArgs {
  event: ReactMouseEvent<HTMLAnchorElement>;
  linkRouting: MarkdownLinkRouting | undefined;
  openUrl: MarkdownPreviewLinkHandler;
  openApplicationUrl: (href: string) => void;
  target: MarkdownLinkTarget;
}

const MARKDOWN_PREVIEW_ROOT_SELECTOR = "[data-markdown-preview]";
const SANITIZED_ID_PREFIX = "user-content-";

export function resolveMarkdownLocalFileTarget(
  value: string,
  absolute: MarkdownAbsoluteLocalFileLinkRouting,
  relative: MarkdownRelativeLocalFileLinkRouting | undefined,
): ResolvedMarkdownLocalFileTarget | null {
  const absoluteLink =
    parseLocalFileHref({ absoluteLinks: absolute, href: value }) ??
    (absolute.kind === "trusted-host" && relative !== undefined
      ? parseLocalFileHref({
          absoluteLinks: { kind: "contained", rootPath: relative.rootPath },
          href: value,
        })
      : null);
  if (absoluteLink !== null) {
    return {
      href: value,
      link: absoluteLink,
      sourceKind: "absolute",
    };
  }
  if (relative === undefined) {
    return null;
  }

  const resolvedHref = resolveRelativeLocalFileHref({
    href: value,
    ...relative,
  });
  if (resolvedHref === null) {
    return null;
  }
  const relativeLink = parseLocalFileHref({
    absoluteLinks:
      absolute.kind === "trusted-host"
        ? { kind: "contained", rootPath: relative.rootPath }
        : absolute,
    href: resolvedHref,
  });
  return relativeLink === null
    ? null
    : {
        href: resolvedHref,
        link: relativeLink,
        sourceKind: "relative",
      };
}

function decodeFragment(fragment: string): string {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}

export function resolveMarkdownLinkTarget({
  currentOrigin,
  href,
  localFileRouting,
}: ResolveMarkdownLinkTargetArgs): MarkdownLinkTarget {
  if (href.startsWith("#") && href.length > 1) {
    return { kind: "fragment", id: decodeFragment(href.slice(1)) };
  }
  if (
    currentOrigin !== null &&
    resolveRouteHref({ currentOrigin, href }) !== null
  ) {
    return { kind: "app-route" };
  }
  const localFile =
    localFileRouting === undefined
      ? null
      : resolveMarkdownLocalFileTarget(
          href,
          localFileRouting.absoluteLinks,
          localFileRouting.relativeLinks,
        );
  if (localFile !== null) {
    return { kind: "local-file", link: localFile.link };
  }
  if (parseApplicationUrl(href) !== null) {
    return { kind: "application-url", href };
  }
  return { kind: "url", href };
}

function findMarkdownFragmentElement(
  anchor: HTMLElement,
  id: string,
): HTMLElement | null {
  const root = anchor.closest<HTMLElement>(MARKDOWN_PREVIEW_ROOT_SELECTOR);
  if (root === null) return null;
  const elements = Array.from(root.querySelectorAll<HTMLElement>("[id]"));
  const sanitizedId = `${SANITIZED_ID_PREFIX}${id}`;
  return (
    elements.find((element) => element.id === id) ??
    elements.find((element) => element.id === sanitizedId) ??
    null
  );
}

function isModifiedClick(event: ReactMouseEvent<HTMLAnchorElement>): boolean {
  return (
    event.button !== 0 ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  );
}

export function openMarkdownLinkTarget({
  event,
  linkRouting,
  openApplicationUrl,
  openUrl,
  target,
}: OpenMarkdownLinkTargetArgs): void {
  switch (target.kind) {
    case "fragment":
      event.preventDefault();
      findMarkdownFragmentElement(
        event.currentTarget,
        target.id,
      )?.scrollIntoView({ block: "start" });
      return;
    case "app-route":
      return;
    case "local-file":
      if (linkRouting?.localFile?.onOpenLink(target.link)) {
        event.preventDefault();
      }
      return;
    case "application-url":
      event.preventDefault();
      openApplicationUrl(target.href);
      return;
    case "url":
      if (isModifiedClick(event)) return;
      if ((linkRouting?.onOpenLink ?? openUrl)({ href: target.href })) {
        event.preventDefault();
      }
      return;
  }
}

function headingText(node: Nodes): string {
  if (node.type === "text" || node.type === "inlineCode") return node.value;
  if (!("children" in node)) return "";
  return node.children.map(headingText).join("");
}

function slugifyHeading(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
    .replace(/ /gu, "-");
}

export function remarkHeadingIds() {
  return (tree: Root) => {
    const used = new Map<string, number>();
    visit(tree, "heading", (node: Heading) => {
      const base = slugifyHeading(headingText(node));
      if (base.length === 0) return;
      const count = used.get(base) ?? 0;
      used.set(base, count + 1);
      node.data = {
        ...node.data,
        hProperties: {
          ...node.data?.hProperties,
          id: count === 0 ? base : `${base}-${count}`,
        },
      };
    });
  };
}
