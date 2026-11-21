import { createContext, memo, useContext, type ReactNode } from "react";
import type { Nodes, Paragraph, Parent, RootContent } from "mdast";
import type {} from "mdast-util-to-hast";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk";
import { SKIP, visit } from "unist-util-visit";
import type {} from "remark-parse";
import { directive as directiveSyntax } from "micromark-extension-directive";
import type { Extension } from "micromark-util-types";
import type { Processor } from "unified";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount.js";
import { Link } from "react-router-dom";
import { PLUGIN_CHOICES_TITLE } from "@/lib/plugin-choice-picks";
import { SETTINGS_SEARCH_ANCHOR_STATE_KEY } from "@/components/settings/settings-search";
import { getSettingsSectionRoutePath } from "@/components/settings/settings-sections";
import type { ExclusiveBootState } from "@/lib/plugin-replacement-preference";
import {
  resolveMessageDirectiveRegistry,
  type ResolvedMessageDirective,
} from "@/lib/plugin-slot-resolvers.js";
import type { PluginMessageDirectiveSlot } from "@/lib/plugin-slots.js";

export const MESSAGE_DIRECTIVE_MOUNT_LIMIT = 32;

const MESSAGE_DIRECTIVE_HAST_NAME = "bb-message-directive";
const MESSAGE_DIRECTIVE_INDEX_PROPERTY = "dataDirectiveIndex";

export type UnclaimedMessageDirectivePolicy = "hold" | "literal";

export interface MessageDirectiveRegistry {
  directives: ReadonlyMap<string, ResolvedMessageDirective>;
  unclaimed: UnclaimedMessageDirectivePolicy;
}

export type MountedMessageDirective =
  | {
      kind: "plugin";
      attributes: Readonly<Record<string, string>>;
      index: number;
      slot: PluginMessageDirectiveSlot;
      source: string;
    }
  | {
      kind: "contested";
      index: number;
      name: string;
      pluginIds: readonly string[];
      source: string;
    };

export interface MarkdownMessageDirectives {
  registry: MessageDirectiveRegistry;
  message: PluginMessageDirectiveProps["message"];
  openWorkspaceFile: PluginMessageDirectiveProps["openWorkspaceFile"];
}

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

export function buildMessageDirectiveRegistry(
  slots: readonly PluginMessageDirectiveSlot[],
  options: {
    unclaimed: UnclaimedMessageDirectivePolicy;
    picks: Readonly<Record<string, string>>;
    boot: ExclusiveBootState;
  },
): MessageDirectiveRegistry {
  return {
    directives: resolveMessageDirectiveRegistry(
      slots,
      options.picks,
      options.boot,
    ),
    unclaimed: options.unclaimed,
  };
}

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

function heldMessageDirectiveNode(): RootContent {
  return {
    type: "paragraph",
    children: [],
    data: { hName: MESSAGE_DIRECTIVE_HAST_NAME },
  };
}

function messageDirectiveMountNode(index: number): RootContent {
  return {
    type: "paragraph",
    children: [],
    data: {
      hName: MESSAGE_DIRECTIVE_HAST_NAME,
      hProperties: { [MESSAGE_DIRECTIVE_INDEX_PROPERTY]: index },
    },
  };
}

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
  if (type === "textDirective" || type === "leafDirective") {
    return node as DirectiveNode;
  }
  return null;
}

function gluedDirectiveSyntax(registry: MessageDirectiveRegistry): Extension {
  const constructs = directiveSyntax().text?.[58];
  const textDirective = Array.isArray(constructs) ? constructs[0] : constructs;
  if (textDirective === undefined) {
    throw new Error("Directive text tokenizer is unavailable");
  }
  return {
    text: {
      58: {
        previous: (code) => code === null,
        tokenize(effects, ok, nok) {
          const eventStart = this.events.length;
          const startLine = this.now().line;
          const start = textDirective.tokenize.call(
            this,
            effects,
            (code) => {
              let name = "";
              let hasAttributes = false;
              for (let i = eventStart; i < this.events.length; i += 1) {
                const [kind, token] = this.events[i]!;
                if (kind !== "exit") continue;
                if (token.type === "directiveTextName") {
                  name = this.sliceSerialize(token);
                } else if (token.type === "directiveTextAttributes") {
                  hasAttributes =
                    token.start.line === startLine &&
                    token.end.line === startLine;
                }
              }
              const entry = registry.directives.get(name);
              const claimable =
                entry === undefined
                  ? registry.unclaimed === "hold"
                  : entry.status !== "literal";
              return hasAttributes && claimable ? ok(code) : nok(code);
            },
            nok,
          );
          return (code) => {
            const afterMarker = start(code);
            return (secondColon) => {
              if (secondColon !== 58 || afterMarker === undefined) {
                return nok(secondColon);
              }
              effects.enter("directiveTextMarker");
              effects.consume(secondColon);
              effects.exit("directiveTextMarker");
              return afterMarker;
            };
          };
        },
      },
    },
  };
}

export function remarkMessageDirectives(
  this: Processor,
  args: {
    indexBase: number;
    limit: number;
    mounts: MountedMessageDirective[];
    registry: MessageDirectiveRegistry;
  },
) {
  const { indexBase, limit, mounts, registry } = args;
  const data = this.data();
  const extensions =
    data.micromarkExtensions ?? (data.micromarkExtensions = []);
  extensions.push(gluedDirectiveSyntax(registry));
  return (tree: Nodes, file: RemarkMessageDirectiveFile): void => {
    const markdownSource =
      typeof file.value === "string" ? file.value : String(file.value ?? "");
    mounts.length = 0;
    visit(tree, (node, index, parent: Parent | undefined) => {
      if (parent === undefined || index === undefined) return;
      const paragraph = node.type === "paragraph" ? node : null;
      const leadingDirective = asDirectiveNode(paragraph?.children[0]);
      const isGlued =
        leadingDirective?.type === "textDirective" &&
        markdownSource.startsWith(
          "::",
          leadingDirective.position?.start?.offset ?? -1,
        );
      const directive = isGlued ? leadingDirective : asDirectiveNode(node);
      if (directive === null) return;
      const marker = isGlued ? "::" : DIRECTIVE_MARKERS[directive.type];
      const name = typeof directive.name === "string" ? directive.name : "";
      const attributes = normalizeDirectiveAttributes(directive.attributes);
      const source = directiveSourceFromNode(
        directive,
        markdownSource,
        name,
        attributes,
        marker,
      );

      const entry = registry.directives.get(name);
      const isBlock = isGlued || directive.type === "leafDirective";
      if (
        isBlock &&
        name.length > 0 &&
        ((entry === undefined && registry.unclaimed === "hold") ||
          entry?.status === "loading")
      ) {
        const remainder: Paragraph | null =
          isGlued && paragraph !== null && paragraph.children.length > 1
            ? { ...paragraph, children: paragraph.children.slice(1) }
            : null;
        parent.children.splice(
          index,
          1,
          heldMessageDirectiveNode(),
          ...(remainder === null ? [] : [remainder]),
        );
        return [SKIP, index];
      }
      if (
        !isBlock ||
        name.length === 0 ||
        entry === undefined ||
        (entry.status !== "ok" && entry.status !== "collision") ||
        mounts.length >= limit
      ) {
        if (isGlued) return;
        return spliceLiteralDirective(parent, index, directive.type, source);
      }

      const mountIndex = indexBase + mounts.length;
      mounts.push(
        entry.status === "ok"
          ? {
              kind: "plugin",
              attributes,
              index: mountIndex,
              slot: entry.slot,
              source,
            }
          : {
              kind: "contested",
              index: mountIndex,
              name,
              pluginIds: entry.pluginIds,
              source,
            },
      );
      const remainder: Paragraph | null =
        isGlued && paragraph !== null && paragraph.children.length > 1
          ? { ...paragraph, children: paragraph.children.slice(1) }
          : null;
      parent.children.splice(
        index,
        1,
        messageDirectiveMountNode(mountIndex),
        ...(remainder === null ? [] : [remainder]),
      );
      return [SKIP, index];
    });
  };
}

export interface MessageDirectiveRenderContext {
  message: PluginMessageDirectiveProps["message"];
  openWorkspaceFile: PluginMessageDirectiveProps["openWorkspaceFile"];
}

export const EMPTY_MOUNTED_MESSAGE_DIRECTIVES: readonly MountedMessageDirective[] =
  [];

export const MessageDirectiveMountsContext = createContext<{
  mounts: readonly MountedMessageDirective[];
  render: MessageDirectiveRenderContext | null;
}>({ mounts: EMPTY_MOUNTED_MESSAGE_DIRECTIVES, render: null });

export function MessageDirectiveElement(props: MessageDirectiveElementProps) {
  const { mounts, render } = useContext(MessageDirectiveMountsContext);
  const rawIndex = props["data-directive-index"];
  if (rawIndex === undefined || render === null) {
    return null;
  }
  const mount = mounts[Number(rawIndex)];
  if (mount === undefined) {
    return null;
  }
  if (mount.kind === "contested") {
    return <ContestedMessageDirective mount={mount} />;
  }
  return <MountedMessageDirectiveView mount={mount} render={render} />;
}

function ContestedMessageDirective({
  mount,
}: {
  mount: Extract<MountedMessageDirective, { kind: "contested" }>;
}) {
  return (
    <div data-contested-message-directive={mount.name}>
      <p>{mount.source}</p>
      <p className="text-sm text-muted-foreground">
        {mount.pluginIds.length} plugins claim <code>::{mount.name}</code>
        {" · "}
        <Link
          to={getSettingsSectionRoutePath("plugins")}
          state={{ [SETTINGS_SEARCH_ANCHOR_STATE_KEY]: PLUGIN_CHOICES_TITLE }}
          className="underline underline-offset-2 hover:text-foreground"
        >
          Choose
        </Link>
      </p>
    </div>
  );
}

const MountedMessageDirectiveView = memo(function MountedMessageDirectiveView({
  mount,
  render,
}: {
  mount: Extract<MountedMessageDirective, { kind: "plugin" }>;
  render: MessageDirectiveRenderContext;
}) {
  const { message, openWorkspaceFile } = render;
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
});

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
