import {
  createContext,
  useContext,
  type ComponentType,
  type ReactNode,
} from "react";
import type { Nodes, Parent, RootContent } from "mdast";
// Side-effect import: augments mdast's `Data` with `hName`/`hProperties`.
import type {} from "mdast-util-to-hast";
import type {
  BbNavigate,
  PluginMessageDirectiveProps,
} from "@get-bb/plugin-sdk";
import { visit } from "unist-util-visit";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount.js";
import { PluginThreadPanelNavigationProvider } from "@/components/plugin/plugin-thread-panel-navigation.js";
import {
  resolveMessageDirectiveRegistry,
  type ResolvedMessageDirective,
} from "@/lib/plugin-slot-resolvers.js";
import type { PluginMessageDirectiveSlot } from "@/lib/plugin-slots.js";

/**
 * Assistant-message plugin directives (`::inline-vis{file="demo.html"}`).
 *
 * Parsing is owned by the unified/remark-directive ecosystem — not plugin
 * regex callbacks. Only the assistant conversation path activates this
 * pipeline (via {@link MarkdownMessageDirectives}); user messages and generic
 * Markdown previews leave directives as ordinary text.
 *
 * Recognized mounts use an indexed custom HAST element (same pattern as prompt
 * mentions) so attributes stay in a host-owned table rather than DOM attrs.
 */

/** Max plugin directive components mounted per message body. */
export const MESSAGE_DIRECTIVE_MOUNT_LIMIT = 32;

const MESSAGE_DIRECTIVE_HAST_NAME = "bb-message-directive";
// hast property key — `mdast-util-to-hast` lowercases it into
// `data-directive-index` for the component to read back.
const MESSAGE_DIRECTIVE_INDEX_PROPERTY = "dataDirectiveIndex";

export type MessageDirectiveRegistryEntry = ResolvedMessageDirective;

/** Directive name → unique registration, or an explicit cross-plugin collision. */
export type MessageDirectiveRegistry = ReadonlyMap<
  string,
  MessageDirectiveRegistryEntry
>;

export interface MountedMessageDirective {
  attributes: Readonly<Record<string, string>>;
  index: number;
  slot: PluginMessageDirectiveSlot;
  source: string;
}

export interface MarkdownMessageDirectives {
  /** Pre-built registry from the timeline-level plugin-slot subscription. */
  registry: MessageDirectiveRegistry;
  message: PluginMessageDirectiveProps["message"];
  openWorkspaceFile: PluginMessageDirectiveProps["openWorkspaceFile"];
  openThreadPanel: MarkdownMessageDirectiveOpenThreadPanel | null;
}

export type MarkdownMessageDirectiveOpenThreadPanel = (
  options: Parameters<BbNavigate["openThreadPanel"]>[0] & {
    pluginId: string;
  },
) => boolean;

/**
 * Resolved form held during a single MarkdownPreview render: registry + message
 * identity + the index-aligned mount table filled by the remark transform.
 */
export interface ResolvedMessageDirectives {
  mounts: MountedMessageDirective[];
  message: PluginMessageDirectiveProps["message"];
  openWorkspaceFile: PluginMessageDirectiveProps["openWorkspaceFile"];
  openThreadPanel: MarkdownMessageDirectiveOpenThreadPanel | null;
  registry: MessageDirectiveRegistry;
}

/**
 * `remark-directive` emits three node kinds from a single `:` grammar. Only the
 * leaf form (`::name`) mounts a plugin component; the text form is handled
 * solely to rewrite it back to literal prose. Container directives (`:::name`)
 * are deliberately left alone — `:::` at the start of a line is not incidental
 * prose the way an inline `:` is, and rewriting the block to literal text would
 * both stop a nested `::name` from mounting and collapse the block's line
 * structure.
 */
type DirectiveNodeType = "textDirective" | "leafDirective";

interface DirectiveNode {
  type: DirectiveNodeType;
  name?: string;
  attributes?: Record<string, string | null | undefined> | null;
  children?: unknown[];
  position?: {
    start?: { offset?: number | undefined };
    end?: { offset?: number | undefined };
  };
}

/** Source marker for each directive kind (used to reconstruct literal text). */
const DIRECTIVE_MARKERS: Record<DirectiveNodeType, string> = {
  textDirective: ":",
  leafDirective: "::",
};

interface RemarkMessageDirectiveFile {
  value: unknown;
}

interface MessageDirectiveElementProps {
  "data-directive-index"?: string;
}

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "bb-message-directive": MessageDirectiveElementProps;
    }
  }
}

/**
 * Build a deterministic registry from flattened slot rows. When two or more
 * plugins claim the same directive id, neither wins — the entry is a collision
 * and a single console warning is issued (not per message).
 */
export function buildMessageDirectiveRegistry(
  slots: readonly PluginMessageDirectiveSlot[],
  options?: { warn?: (message: string) => void },
): MessageDirectiveRegistry {
  const warn = options?.warn ?? defaultCollisionWarn;
  const registry = resolveMessageDirectiveRegistry(slots);
  for (const [id, directive] of registry) {
    if (directive.status === "collision") {
      warn(
        `[plugin] message directive "${id}" claimed by multiple plugins (${directive.pluginIds.join(", ")}); rendering as literal text`,
      );
    }
  }
  return registry;
}

function defaultCollisionWarn(message: string): void {
  console.warn(message);
}

/**
 * Normalize directive attributes to untrusted string values. Non-string
 * attribute values from the parser are dropped.
 */
export function normalizeDirectiveAttributes(
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

/**
 * Reconstruct `::name{k="v"}` source when AST position offsets are unavailable.
 */
export function reconstructDirectiveSource(
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

function messageDirectiveMountNode(index: number): RootContent {
  // Block-level stand-in: empty paragraph rewritten to the custom element via
  // `data.hName`, matching the prompt-mention indexed-sentinel pattern.
  return {
    type: "paragraph",
    children: [],
    data: {
      hName: MESSAGE_DIRECTIVE_HAST_NAME,
      hProperties: { [MESSAGE_DIRECTIVE_INDEX_PROPERTY]: index },
    },
  };
}

/**
 * Replace the directive at `index` with its literal source and return the index
 * traversal should resume from.
 *
 * A text directive lives inside phrasing content (e.g. mid-paragraph), so it is
 * rewritten inline — not as a block paragraph, which would split the
 * surrounding text onto its own line — and merged into an adjacent `text`
 * sibling so the rewritten prose stays a single text node, indistinguishable
 * from text that was never parsed as a directive. A leaf directive is
 * block-level, so a paragraph is the correct literal stand-in.
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

  // A merged node no longer spans its recorded source range, and nothing
  // downstream reads text positions, so drop the stale span rather than leave a
  // wrong one — the same as the freshly built nodes below, which have none.
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
  if (type === "textDirective" || type === "leafDirective") {
    return node as DirectiveNode;
  }
  return null;
}

/**
 * Remark transformer: rewrite recognized leaf directives (`::name`) into indexed
 * custom elements; leave unknown / collision / over-limit leaf directives as
 * literal source text. Text directives (`:name`) never mount and are always
 * rewritten to their literal source, so incidental prose colons (`13:30`,
 * `key:value`, `:D`) render verbatim instead of collapsing into
 * `mdast-util-to-hast`'s empty-`<div>` fallback. Container directives are not
 * touched. Must run after `remark-directive` has produced the directive nodes.
 *
 * Mutates `mounts` in document order so indices stay stable when later text
 * streams in after an already-complete directive.
 */
export function remarkMessageDirectives(args: {
  mounts: MountedMessageDirective[];
  registry: MessageDirectiveRegistry;
}) {
  const { mounts, registry } = args;
  return (tree: Nodes, file: RemarkMessageDirectiveFile): void => {
    const markdownSource =
      typeof file.value === "string" ? file.value : String(file.value ?? "");
    // Each parse owns the mount table: clear so a re-transform with the same
    // array reference does not accumulate duplicate indices.
    mounts.length = 0;
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

      // Only leaf directives (`::name`) mount a plugin component. A text
      // directive (`:name`) is almost always an incidental parse of ordinary
      // prose — a time like `13:30`, a `key:value` pair, an emoticon like `:D`.
      // Left in the tree it reaches `mdast-util-to-hast`, which renders an
      // unknown directive as an empty block `<div>`; nested inside a paragraph
      // that both drops the directive's text and injects a stray line break.
      // Rewrite it back to literal source so the prose renders verbatim.
      if (directive.type !== "leafDirective") {
        return spliceLiteralDirective(parent, index, directive.type, source);
      }

      if (name.length === 0) {
        return spliceLiteralDirective(parent, index, directive.type, source);
      }

      const entry = registry.get(name);
      if (entry === undefined || entry.status === "collision") {
        return spliceLiteralDirective(parent, index, directive.type, source);
      }

      if (mounts.length >= MESSAGE_DIRECTIVE_MOUNT_LIMIT) {
        return spliceLiteralDirective(parent, index, directive.type, source);
      }

      const mountIndex = mounts.length;
      mounts.push({
        attributes,
        index: mountIndex,
        slot: entry.slot,
        source,
      });
      parent.children.splice(index, 1, messageDirectiveMountNode(mountIndex));
      return index;
    });
  };
}

interface BuildMessageDirectiveComponentArgs {
  mounts: readonly MountedMessageDirective[];
  message: PluginMessageDirectiveProps["message"];
  openWorkspaceFile: PluginMessageDirectiveProps["openWorkspaceFile"];
  openThreadPanel: MarkdownMessageDirectiveOpenThreadPanel | null;
}

/**
 * `components` renderer for the custom hast element. Looks the mount up by
 * sentinel index and wraps the plugin component in {@link PluginSlotMount}
 * so plugin context, scoped CSS, and crash isolation apply. Crash fallback is
 * the original directive source (not the generic crash chip).
 */
export function buildMessageDirectiveComponent({
  mounts,
  message,
  openWorkspaceFile,
  openThreadPanel,
}: BuildMessageDirectiveComponentArgs): ComponentType<MessageDirectiveElementProps> {
  function MessageDirectiveElement(props: MessageDirectiveElementProps) {
    const rawIndex = props["data-directive-index"];
    if (rawIndex === undefined) {
      return null;
    }
    const mount = mounts[Number(rawIndex)];
    if (mount === undefined) {
      return null;
    }
    const { slot, attributes, source } = mount;
    const Component = slot.component;
    return (
      <PluginSlotMount
        key={`${slot.pluginId}/${slot.id}/${slot.generation}`}
        pluginId={slot.pluginId}
        slotKind="messageDirective"
        slotId={slot.id}
        crashFallback={source}
      >
        {openThreadPanel === null ? (
          <Component
            attributes={attributes}
            source={source}
            message={message}
            openWorkspaceFile={openWorkspaceFile}
          />
        ) : (
          <PluginThreadPanelNavigationProvider
            openThreadPanel={openThreadPanel}
          >
            <Component
              attributes={attributes}
              source={source}
              message={message}
              openWorkspaceFile={openWorkspaceFile}
            />
          </PluginThreadPanelNavigationProvider>
        )}
      </PluginSlotMount>
    );
  }

  return MessageDirectiveElement;
}

/**
 * Timeline-level registry context: subscribe once via {@link usePluginSlots},
 * build the registry, and provide it here so individual messages do not each
 * open a store subscription.
 */
const MessageDirectiveRegistryContext =
  createContext<MessageDirectiveRegistry | null>(null);

export function MessageDirectiveRegistryProvider({
  registry,
  children,
}: {
  registry: MessageDirectiveRegistry;
  children: ReactNode;
}) {
  return (
    <MessageDirectiveRegistryContext.Provider value={registry}>
      {children}
    </MessageDirectiveRegistryContext.Provider>
  );
}

export function useMessageDirectiveRegistry(): MessageDirectiveRegistry | null {
  return useContext(MessageDirectiveRegistryContext);
}
