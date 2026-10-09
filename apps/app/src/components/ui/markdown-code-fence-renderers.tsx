import { createContext, useContext, type ReactNode } from "react";
import type { Code, Nodes, Root } from "mdast";
import type {} from "mdast-util-to-hast";
import type { ExperimentalCodeFenceRendererProps } from "@get-bb/plugin-sdk";
import { visit } from "unist-util-visit";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount.js";
import { PluginThreadPanelNavigationProvider } from "@/components/plugin/plugin-thread-panel-navigation.js";
import { resolveCodeFenceRendererRegistry } from "@/lib/plugin-slot-resolvers.js";
import type { PluginCodeFenceRendererSlot } from "@/lib/plugin-slots.js";
import type { MarkdownMessageDirectiveOpenThreadPanel } from "./markdown-message-directives.js";
import {
  closesAnyIndentMarkdownFence,
  parseMarkdownFenceStart,
} from "./markdown-prompt-blockquote-boundaries.js";

const CODE_FENCE_INDEX_PROPERTY = "dataCodeFenceIndex";
const CODE_FENCE_COMPLETE_PROPERTY = "dataCodeFenceComplete";
const MARKDOWN_CONTAINER_PREFIX_PATTERN = /^[ \t>]*/u;

export type CodeFenceRendererRegistry = ReadonlyMap<
  string,
  PluginCodeFenceRendererSlot
>;

export type CodeFenceCounts = ReadonlyMap<string, number>;

export const EMPTY_CODE_FENCE_COUNTS: CodeFenceCounts = new Map();

export interface MarkdownCodeFenceRenderers {
  registry: CodeFenceRendererRegistry;
  message: ExperimentalCodeFenceRendererProps["message"];
  openThreadPanel: MarkdownMessageDirectiveOpenThreadPanel | null;
}

export interface CodeFenceElementProps {
  "data-code-fence-index"?: string;
  "data-code-fence-complete"?: string;
}

interface RemarkCodeFenceRenderersFile {
  value: unknown;
}

export function buildCodeFenceRendererRegistry(
  slots: readonly PluginCodeFenceRendererSlot[],
  options?: { warn?: (message: string) => void },
): CodeFenceRendererRegistry {
  const warn = options?.warn ?? ((message: string) => console.warn(message));
  const registry = new Map<string, PluginCodeFenceRendererSlot>();
  for (const [language, resolved] of resolveCodeFenceRendererRegistry(slots)) {
    if (resolved.pluginIds.length > 1) {
      warn(
        `[plugin] code fence language "${language}" claimed by multiple plugins (${resolved.pluginIds.join(", ")}); rendering with ${resolved.slot.pluginId}`,
      );
    }
    registry.set(language, resolved.slot);
  }
  return registry;
}

function isClosedCodeFence(node: Code, markdownSource: string): boolean {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined) {
    return false;
  }
  const lines = markdownSource.slice(start, end).split("\n");
  const fence = parseMarkdownFenceStart(lines[0] ?? "");
  const closingLine = lines.at(-1);
  if (fence === null || lines.length < 2 || closingLine === undefined) {
    return false;
  }
  return (
    closesAnyIndentMarkdownFence(
      closingLine.replace(MARKDOWN_CONTAINER_PREFIX_PATTERN, ""),
      fence,
    ) &&
    (node.value === "" || node.value.split("\n").length === lines.length - 2)
  );
}

export function countClaimedCodeFences(
  tree: Nodes,
  registry: CodeFenceRendererRegistry,
): CodeFenceCounts {
  const counts = new Map<string, number>();
  visit(tree, "code", (node) => {
    const language = node.lang?.toLowerCase();
    if (language !== undefined && registry.has(language)) {
      counts.set(language, (counts.get(language) ?? 0) + 1);
    }
  });
  return counts;
}

export function remarkCodeFenceRenderers(args: {
  counts: Map<string, number>;
  indexBase: CodeFenceCounts;
  registry: CodeFenceRendererRegistry;
}) {
  const { counts, indexBase, registry } = args;
  return (tree: Root, file: RemarkCodeFenceRenderersFile): void => {
    const markdownSource =
      typeof file.value === "string" ? file.value : String(file.value ?? "");
    counts.clear();
    visit(tree, "code", (node) => {
      const language = node.lang?.toLowerCase();
      if (language === undefined || !registry.has(language)) {
        return;
      }
      const ordinal = counts.get(language) ?? 0;
      counts.set(language, ordinal + 1);
      node.data ??= {};
      node.data.hProperties = {
        ...node.data.hProperties,
        [CODE_FENCE_INDEX_PROPERTY]: String(
          (indexBase.get(language) ?? 0) + ordinal,
        ),
        [CODE_FENCE_COMPLETE_PROPERTY]: String(
          isClosedCodeFence(node, markdownSource),
        ),
      };
    });
  };
}

export const CodeFenceRenderersContext =
  createContext<MarkdownCodeFenceRenderers | null>(null);

const CodeFenceOriginalContext = createContext<ReactNode>(null);

function CodeFenceOriginal() {
  return <>{useContext(CodeFenceOriginalContext)}</>;
}

export function CodeFenceRendererMount({
  code,
  complete,
  index,
  language,
  original,
}: Pick<
  ExperimentalCodeFenceRendererProps,
  "code" | "complete" | "index" | "language"
> & {
  original: ReactNode;
}) {
  const renderers = useContext(CodeFenceRenderersContext);
  const slot = renderers?.registry.get(language);
  if (renderers === null || slot === undefined) {
    return original;
  }
  const Component = slot.component;
  const element = (
    <CodeFenceOriginalContext.Provider value={original}>
      <Component
        code={code}
        language={language}
        index={index}
        complete={complete}
        message={renderers.message}
        Original={CodeFenceOriginal}
      />
    </CodeFenceOriginalContext.Provider>
  );
  return (
    <PluginSlotMount
      key={`${slot.pluginId}/${slot.id}/${slot.generation}`}
      pluginId={slot.pluginId}
      slotKind="codeFenceRenderer"
      slotId={slot.id}
      crashFallback={original}
    >
      {renderers.openThreadPanel === null ? (
        element
      ) : (
        <PluginThreadPanelNavigationProvider
          openThreadPanel={renderers.openThreadPanel}
        >
          {element}
        </PluginThreadPanelNavigationProvider>
      )}
    </PluginSlotMount>
  );
}

const CodeFenceRendererRegistryContext =
  createContext<CodeFenceRendererRegistry | null>(null);

export function CodeFenceRendererRegistryProvider({
  registry,
  children,
}: {
  registry: CodeFenceRendererRegistry;
  children: ReactNode;
}) {
  return (
    <CodeFenceRendererRegistryContext.Provider value={registry}>
      {children}
    </CodeFenceRendererRegistryContext.Provider>
  );
}

export function useCodeFenceRendererRegistry(): CodeFenceRendererRegistry | null {
  return useContext(CodeFenceRendererRegistryContext);
}
