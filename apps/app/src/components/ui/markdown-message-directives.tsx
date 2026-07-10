import {
  createContext,
  useContext,
  type ComponentType,
  type ReactNode,
} from "react";
import type { Nodes, Parent, RootContent } from "mdast";
// Side-effect import: augments mdast's `Data` with `hName`/`hProperties`.
import type {} from "mdast-util-to-hast";
import type { PluginMessageDirectiveProps } from "@bb/plugin-sdk";
import { visit } from "unist-util-visit";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount.js";
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

export type MessageDirectiveRegistryEntry =
  | { status: "ok"; slot: PluginMessageDirectiveSlot }
  | { status: "collision"; pluginIds: readonly string[] };

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
}

/**
 * Resolved form held during a single MarkdownPreview render: registry + message
 * identity + the index-aligned mount table filled by the remark transform.
 */
export interface ResolvedMessageDirectives {
  mounts: MountedMessageDirective[];
  message: PluginMessageDirectiveProps["message"];
  openWorkspaceFile: PluginMessageDirectiveProps["openWorkspaceFile"];
  registry: MessageDirectiveRegistry;
}

interface LeafDirectiveNode {
  type: "leafDirective";
  name?: string;
  attributes?: Record<string, string | null | undefined> | null;
  children?: unknown[];
  position?: {
    start?: { offset?: number | undefined };
    end?: { offset?: number | undefined };
  };
}

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
  const byId = new Map<string, PluginMessageDirectiveSlot[]>();
  for (const slot of slots) {
    const existing = byId.get(slot.id);
    if (existing === undefined) {
      byId.set(slot.id, [slot]);
    } else {
      existing.push(slot);
    }
  }

  const registry = new Map<string, MessageDirectiveRegistryEntry>();
  for (const [id, claimants] of byId) {
    if (claimants.length === 1) {
      const slot = claimants[0];
      if (slot === undefined) continue;
      registry.set(id, { status: "ok", slot });
      continue;
    }
    // Unique plugin ids, sorted for a stable warning message.
    const pluginIds = [
      ...new Set(claimants.map((claimant) => claimant.pluginId)),
    ].sort();
    // Same plugin registered twice should already be rejected at collection
    // time; if it still appears, treat multi-plugin (or multi-entry) as a
    // collision so no component wins.
    if (pluginIds.length >= 2 || claimants.length >= 2) {
      registry.set(id, { status: "collision", pluginIds });
      warn(
        `[plugin] message directive "${id}" claimed by multiple plugins (${pluginIds.join(", ")}); rendering as literal text`,
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
): string {
  const keys = Object.keys(attributes);
  if (keys.length === 0) {
    return `::${name}`;
  }
  const body = keys
    .map((key) => `${key}=${JSON.stringify(attributes[key] ?? "")}`)
    .join(" ");
  return `::${name}{${body}}`;
}

function directiveSourceFromNode(
  node: LeafDirectiveNode,
  markdownSource: string,
  name: string,
  attributes: Readonly<Record<string, string>>,
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
  return reconstructDirectiveSource(name, attributes);
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

function literalDirectiveNode(source: string): RootContent {
  return {
    type: "paragraph",
    children: [{ type: "text", value: source }],
  };
}

function isLeafDirective(node: unknown): node is LeafDirectiveNode {
  return (
    typeof node === "object" &&
    node !== null &&
    (node as { type?: unknown }).type === "leafDirective"
  );
}

/**
 * Remark transformer: rewrite recognized leaf directives into indexed custom
 * elements; leave unknown / collision / over-limit directives as literal
 * source text. Must run after `remark-directive` has produced leaf nodes.
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
      if (
        !isLeafDirective(node) ||
        parent === undefined ||
        index === undefined
      ) {
        return;
      }
      const name = typeof node.name === "string" ? node.name : "";
      const attributes = normalizeDirectiveAttributes(node.attributes);
      const source = directiveSourceFromNode(
        node,
        markdownSource,
        name,
        attributes,
      );

      if (name.length === 0) {
        parent.children.splice(index, 1, literalDirectiveNode(source));
        return index;
      }

      const entry = registry.get(name);
      if (entry === undefined || entry.status === "collision") {
        parent.children.splice(index, 1, literalDirectiveNode(source));
        return index;
      }

      if (mounts.length >= MESSAGE_DIRECTIVE_MOUNT_LIMIT) {
        parent.children.splice(index, 1, literalDirectiveNode(source));
        return index;
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
        <Component
          attributes={attributes}
          source={source}
          message={message}
          openWorkspaceFile={openWorkspaceFile}
        />
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
export const MessageDirectiveRegistryContext =
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
