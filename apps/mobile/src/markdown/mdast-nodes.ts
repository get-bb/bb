/**
 * Custom mdast nodes the bb transforms emit and the native renderer reads.
 *
 * The web app runs the same transforms but smuggles its custom elements
 * through `data.hName` (mdast → hast → React DOM). The native renderer walks
 * mdast directly, so the transforms here splice typed nodes into the tree
 * instead. `mdast`'s content unions are augmented so the custom nodes are
 * legal children wherever phrasing / flow content is allowed.
 */
import type {
  Data,
  Literal,
  Node,
  Parent,
  PhrasingContent,
  RootContent,
} from "mdast";
import type { PromptMentionResource } from "@bb/domain";

/** Inline sentinel for an authored prompt mention (offset-based, every kind). */
export interface BbPromptMentionNode extends Node {
  type: "bbPromptMention";
  /** Index into the `IndexedPromptMention[]` returned by the substitution. */
  index: number;
  data?: Data;
}

/** Inline `@thread:<id>` token or exact raw thread id found in prose. */
export interface BbThreadMentionNode extends Node {
  type: "bbThreadMention";
  threadId: string;
  /** True when the id was a bare persisted id rather than an `@thread:` token. */
  rawThreadId: boolean;
  /** True when the raw id was the entire value of an inline-code span. */
  inlineCode: boolean;
  data?: Data;
}

export type BbDirectiveKind = "leaf" | "container";

/**
 * A `::name{...}` leaf or `:::name … :::` container directive. The renderer
 * offers it to the host (`renderDirective`); `source` is the literal fallback.
 */
export interface BbDirectiveNode extends Parent {
  type: "bbDirective";
  kind: BbDirectiveKind;
  name: string;
  attributes: Readonly<Record<string, string>>;
  /** Exact source slice (or a reconstruction when positions are missing). */
  source: string;
  /** Container body; empty for leaf directives. */
  children: RootContent[];
  data?: Data;
}

export type BbMarkdownNode =
  | BbPromptMentionNode
  | BbThreadMentionNode
  | BbDirectiveNode;

declare module "mdast" {
  interface PhrasingContentMap {
    bbPromptMention: BbPromptMentionNode;
    bbThreadMention: BbThreadMentionNode;
  }
  interface BlockContentMap {
    bbDirective: BbDirectiveNode;
  }
  interface RootContentMap {
    bbPromptMention: BbPromptMentionNode;
    bbThreadMention: BbThreadMentionNode;
    bbDirective: BbDirectiveNode;
  }
}

export interface IndexedPromptMention {
  resource: PromptMentionResource;
  /** The exact source span (`@thread:<id>`, `@src/foo.ts`, `/deploy`, …). */
  serializedText: string;
}

export type { Literal, PhrasingContent, RootContent };
