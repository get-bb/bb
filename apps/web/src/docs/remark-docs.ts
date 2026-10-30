import { replaceSource } from "fumadocs-core/mdx-plugins/stringifier";
import type { Nodes, Parent, Root, RootContent } from "mdast";
import type {} from "remark-directive";
import { videoMarkdown } from "./video-files";

type VFile = Parameters<typeof replaceSource>[0];

export const CALLOUT_TONES = { note: "Note", warning: "Warning" } as const;

export type CalloutTone = keyof typeof CALLOUT_TONES;

export function isCalloutTone(value: unknown): value is CalloutTone {
  return typeof value === "string" && Object.hasOwn(CALLOUT_TONES, value);
}

function quote(markdown: string): string {
  return markdown
    .trim()
    .split("\n")
    .map((line) => (line.length > 0 ? `> ${line}` : ">"))
    .join("\n");
}

export function calloutMarkdown(
  tone: CalloutTone,
  title: string,
  body: string,
): string {
  const label = CALLOUT_TONES[tone];
  const trimmed = body.trim();
  if (title.length > 0) {
    return quote(`**${label}: ${title}**\n\n${trimmed}`);
  }
  return quote(`**${label}:** ${trimmed}`);
}

export function tabMarkdown(label: string, body: string): string {
  return `**${label}:**\n\n${body.trim()}`;
}

function jsxAttribute(node: Nodes, name: string): string | undefined {
  if (node.type !== "mdxJsxFlowElement") return undefined;
  for (const attribute of node.attributes) {
    if (
      attribute.type === "mdxJsxAttribute" &&
      attribute.name === name &&
      typeof attribute.value === "string"
    ) {
      return attribute.value;
    }
  }
  return undefined;
}

function registerMarkdown(node: Nodes, file: VFile) {
  if (node.type === "mdxJsxFlowElement" && node.name === "Video") {
    const src = jsxAttribute(node, "src");
    const title = jsxAttribute(node, "title");
    if (src !== undefined && title !== undefined) {
      replaceSource(file, node, () => videoMarkdown(title, src));
    }
    return;
  }
  if (node.type === "containerDirective" && isCalloutTone(node.name)) {
    const tone = node.name;
    const title = node.children.find(
      (child) => child.type === "paragraph" && child.data?.directiveLabel,
    );
    const body = node.children.filter((child) => child !== title);
    replaceSource(file, node, (s) =>
      calloutMarkdown(
        tone,
        title ? s.inner(title).trim() : "",
        body.map((child) => s.stringify(child)).join("\n\n"),
      ),
    );
    return;
  }
  if (node.type === "mdxJsxFlowElement" && node.name === "Tabs") {
    replaceSource(file, node, (s) =>
      node.children
        .map((child) => s.stringify(child).trim())
        .filter((text) => text.length > 0)
        .join("\n\n"),
    );
    return;
  }
  if (node.type === "mdxJsxFlowElement" && node.name === "Tab") {
    const label = jsxAttribute(node, "value");
    if (label === undefined) return;
    if (node.position) {
      replaceSource(file, node, (s) => tabMarkdown(label, s.inner(node)));
      return;
    }
    const [first] = node.children;
    if (first) {
      replaceSource(file, first, (s) => tabMarkdown(label, s.stringify(first)));
    }
  }
}

function visit(node: Nodes, file: VFile) {
  registerMarkdown(node, file);
  if ("children" in node) {
    for (const child of node.children) visit(child, file);
  }
}

export function remarkDocsMarkdown() {
  return (tree: Root, file: VFile) => visit(tree, file);
}

function directiveAsText(node: RootContent): RootContent[] {
  if (node.type === "textDirective") {
    return [{ type: "text", value: `:${node.name}` }, ...node.children];
  }
  if (node.type === "leafDirective") {
    return [
      {
        type: "paragraph",
        children: [{ type: "text", value: `::${node.name}` }, ...node.children],
      },
    ];
  }
  return [node];
}

function restoreDirectives(node: Nodes) {
  if (!("children" in node)) return;
  const parent: Parent = node;
  parent.children = parent.children.flatMap(directiveAsText);
  for (const child of parent.children) restoreDirectives(child);
}

export function remarkRestoreTextDirectives() {
  return (tree: Root) => restoreDirectives(tree);
}
