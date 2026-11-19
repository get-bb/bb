import { useMemo, type ReactNode } from "react";
import type { PluginMessageDirectiveMessage } from "@get-bb/plugin-sdk";
import { usePluginSlotKind } from "@/lib/plugin-slots";
import {
  buildCodeFenceRendererRegistry,
  CodeFenceRendererHost,
  CodeFenceRendererRegistryProvider,
  useCodeFenceRendererRegistry,
} from "./markdown-code-fence-renderers.js";
import {
  buildMessageDirectiveRegistry,
  MessageDirectiveRegistryProvider,
  useMessageDirectiveRegistry,
  type MarkdownMessageDirectives,
} from "./markdown-message-directives.js";

export function MessageSlotRegistriesProvider({
  children,
}: {
  children: ReactNode;
}) {
  const messageDirectiveSlots = usePluginSlotKind("messageDirectives");
  const codeFenceRendererSlots = usePluginSlotKind("codeFenceRenderers");
  const messageDirectiveRegistry = useMemo(
    () => buildMessageDirectiveRegistry(messageDirectiveSlots),
    [messageDirectiveSlots],
  );
  const codeFenceRendererRegistry = useMemo(
    () => buildCodeFenceRendererRegistry(codeFenceRendererSlots),
    [codeFenceRendererSlots],
  );
  return (
    <CodeFenceRendererRegistryProvider registry={codeFenceRendererRegistry}>
      <MessageDirectiveRegistryProvider registry={messageDirectiveRegistry}>
        {children}
      </MessageDirectiveRegistryProvider>
    </CodeFenceRendererRegistryProvider>
  );
}

export function useMessageDirectives(
  message: PluginMessageDirectiveMessage,
  openWorkspaceFile: MarkdownMessageDirectives["openWorkspaceFile"],
): MarkdownMessageDirectives | undefined {
  const registry = useMessageDirectiveRegistry();
  return useMemo(
    () =>
      registry === null || registry.size === 0
        ? undefined
        : { registry, message, openWorkspaceFile },
    [registry, message, openWorkspaceFile],
  );
}

export function MessageCodeFences({
  children,
  message,
  streaming,
}: {
  children: ReactNode;
  message: PluginMessageDirectiveMessage;
  streaming: boolean;
}) {
  const registry = useCodeFenceRendererRegistry();
  if (registry === null) {
    return children;
  }
  return (
    <CodeFenceRendererHost
      registry={registry}
      message={message}
      streaming={streaming}
    >
      {children}
    </CodeFenceRendererHost>
  );
}
