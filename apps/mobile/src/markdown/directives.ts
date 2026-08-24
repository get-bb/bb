import type { Node, Nodes, Parent, RootContent } from "mdast";
import { visit } from "unist-util-visit";
import type { BbDirectiveKind, BbDirectiveNode } from "./mdast-nodes";

/**
 * Directive normalization for assistant bodies (`::inline-vis{file="x"}`,
 * `:::workflow-preview … :::`). Adapted from
 * `apps/app/src/components/ui/markdown-message-directives.tsx`.
 *
 * `remark-directive` emits three node kinds from a single `:` grammar:
 *
 * - text directives (`:name`) are almost always an incidental parse of prose
 *   (`13:30`, `key:value`, `:D`); they are always rewritten back to literal
 *   source and merged into the neighbouring text node;
 * - leaf directives (`::name{…}`) and container directives (`:::name`) become
 *   `bbDirective` nodes carrying the normalized attributes and the exact
 *   source slice. The renderer offers each one to the host
 *   (`renderDirective`) and falls back to the literal source when the host
 *   returns null, so unknown directives read exactly as authored.
 *
 * The web mounts only leaf directives and leaves containers untouched; the
 * native renderer has no plugin runtime, so both are surfaced as data and the
 * host decides.
 */

/** Max directives surfaced per body; the rest stay literal text. */
export const MARKDOWN_DIRECTIVE_LIMIT = 32;

type DirectiveNodeType =
  | "textDirective"
  | "leafDirective"
  | "containerDirective";

interface DirectiveNode {
  type: DirectiveNodeType;
  name?: string;
  attributes?: Record<string, string | null | undefined> | null;
  children?: unknown[];
  position?: NonNullable<Node["position"]>;
}

const DIRECTIVE_MARKERS: Record<DirectiveNodeType, string> = {
  textDirective: ":",
  leafDirective: "::",
  containerDirective: ":::",
};

/**
 * Normalize directive attributes to untrusted string values. Non-string
 * attribute values from the parser are dropped.
 */
function normalizeDirectiveAttributes(
  attributes: Record<string, string | null | undefined> | null | undefined,
): Record<string, string> {
  if (attributes === null || attributes === undefined) {
    return {};
  }
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (typeof value === "string") {
      normalized[key] = value;
    }
  }
  return normalized;
}

/** Reconstruct `::name{k="v"}` source when AST position offsets are unavailable. */
function reconstructDirectiveSource(
  name: string,
  attributes: Readonly<Record<string, string>>,
  marker = "::",
): string {
  const keys = Object.keys(attributes);
  if (keys.length === 0) {
    return `${marker}${name}`;
  }
  const body = keys
    .map((key) => `${key}=${JSON.stringify(attributes[key] ?? "")}`)
    .join(" ");
  return `${marker}${name}{${body}}`;
}

function directiveSourceFromNode(
  node: DirectiveNode,
  markdownSource: string,
  name: string,
  attributes: Readonly<Record<string, string>>,
  marker: string,
): string {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  if (
    typeof start === "number" &&
    typeof end === "number" &&
    start >= 0 &&
    end >= start &&
    end <= markdownSource.length
  ) {
    return markdownSource.slice(start, end);
  }
  return reconstructDirectiveSource(name, attributes, marker);
}

/**
 * Replace the directive at `index` with its literal source and return the
 * index traversal should resume from. A text directive lives inside phrasing
 * content, so it is merged into an adjacent `text` sibling; a block directive
 * becomes a paragraph.
 */
function spliceLiteralDirective(
  parent: Parent,
  index: number,
  type: DirectiveNodeType,
  source: string,
): number {
  if (type !== "textDirective") {
    parent.children.splice(index, 1, {
      type: "paragraph",
      children: [{ type: "text", value: source }],
    });
    return index;
  }

  const previous = parent.children[index - 1];
  const next = parent.children[index + 1];
  if (previous?.type === "text") {
    previous.value += source;
    previous.position = undefined;
    if (next?.type === "text") {
      previous.value += next.value;
      parent.children.splice(index, 2);
    } else {
      parent.children.splice(index, 1);
    }
    return index;
  }
  if (next?.type === "text") {
    next.value = `${source}${next.value}`;
    next.position = undefined;
    parent.children.splice(index, 1);
    return index;
  }
  parent.children.splice(index, 1, { type: "text", value: source });
  return index;
}

function asDirectiveNode(node: unknown): DirectiveNode | null {
  if (typeof node !== "object" || node === null) {
    return null;
  }
  const type = (node as { type?: unknown }).type;
  if (
    type === "textDirective" ||
    type === "leafDirective" ||
    type === "containerDirective"
  ) {
    return node as DirectiveNode;
  }
  return null;
}

function directiveKind(type: DirectiveNodeType): BbDirectiveKind {
  return type === "containerDirective" ? "container" : "leaf";
}

interface RemarkFileLike {
  value: unknown;
}

/**
 * Remark transformer (runs after `remark-directive`): text directives →
 * literal prose; leaf/container directives → `bbDirective` nodes (up to
 * {@link MARKDOWN_DIRECTIVE_LIMIT}, then literal).
 */
export function remarkBbDirectives() {
  return (tree: Nodes, file: RemarkFileLike): void => {
    const markdownSource =
      typeof file.value === "string" ? file.value : String(file.value ?? "");
    let surfaced = 0;
    visit(tree, (node, index, parent: Parent | undefined) => {
      const directive = asDirectiveNode(node);
      if (directive === null || parent === undefined || index === undefined) {
        return;
      }
      const marker = DIRECTIVE_MARKERS[directive.type];
      const name = typeof directive.name === "string" ? directive.name : "";
      const attributes = normalizeDirectiveAttributes(directive.attributes);
      const source = directiveSourceFromNode(
        directive,
        markdownSource,
        name,
        attributes,
        marker,
      );

      if (
        directive.type === "textDirective" ||
        name.length === 0 ||
        surfaced >= MARKDOWN_DIRECTIVE_LIMIT
      ) {
        return spliceLiteralDirective(parent, index, directive.type, source);
      }

      surfaced += 1;
      const children =
        directive.type === "containerDirective" &&
        Array.isArray(directive.children)
          ? (directive.children as RootContent[])
          : [];
      const replacement: BbDirectiveNode = {
        type: "bbDirective",
        kind: directiveKind(directive.type),
        name,
        attributes,
        source,
        children,
        ...(directive.position === undefined
          ? {}
          : { position: directive.position }),
      };
      parent.children.splice(index, 1, replacement);
      // Continue into the container body so nested directives normalize too.
      return index;
    });
  };
}
