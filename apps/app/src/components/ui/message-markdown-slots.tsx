import { useMemo, type ReactNode } from "react";
import type { PluginMessageDirectiveMessage } from "@get-bb/plugin-sdk";
import { useAtomValue } from "jotai";
import {
  codeFencePicksAtom,
  messageDirectivePicksAtom,
} from "@/lib/plugin-choice-picks";
import { useExclusiveBootState } from "@/lib/plugin-replacement-preference";
import { usePluginFrontendsSettled } from "@/lib/plugin-frontend-boot-state";
import {
  usePluginSlotKind,
  type PluginMessageDirectiveSlot,
} from "@/lib/plugin-slots";
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
  type MessageDirectiveRegistry,
  type UnclaimedMessageDirectivePolicy,
} from "./markdown-message-directives.js";

interface MessageDirectiveRegistryInputs {
  bbPluginIds: ReadonlySet<string>;
  picks: Readonly<Record<string, string>>;
  settledOnce: boolean;
  slots: readonly PluginMessageDirectiveSlot[];
  unclaimed: UnclaimedMessageDirectivePolicy;
}

let latestMessageDirectiveRegistry: {
  inputs: MessageDirectiveRegistryInputs;
  registry: MessageDirectiveRegistry;
} | null = null;

function resolveMessageDirectiveRegistry(
  inputs: MessageDirectiveRegistryInputs,
): MessageDirectiveRegistry {
  const latest = latestMessageDirectiveRegistry;
  if (
    latest !== null &&
    latest.inputs.bbPluginIds === inputs.bbPluginIds &&
    latest.inputs.picks === inputs.picks &&
    latest.inputs.settledOnce === inputs.settledOnce &&
    latest.inputs.slots === inputs.slots &&
    latest.inputs.unclaimed === inputs.unclaimed
  ) {
    return latest.registry;
  }
  const registry = buildMessageDirectiveRegistry(inputs.slots, {
    unclaimed: inputs.unclaimed,
    picks: inputs.picks,
    boot: { bbPluginIds: inputs.bbPluginIds, settledOnce: inputs.settledOnce },
  });
  latestMessageDirectiveRegistry = { inputs, registry };
  return registry;
}

export function MessageSlotRegistriesProvider({
  children,
}: {
  children: ReactNode;
}) {
  const messageDirectiveSlots = usePluginSlotKind("messageDirectives");
  const codeFenceRendererSlots = usePluginSlotKind("codeFenceRenderers");
  const directivePicks = useAtomValue(messageDirectivePicksAtom);
  const codeFencePicks = useAtomValue(codeFencePicksAtom);
  const { bbPluginIds, settledOnce } = useExclusiveBootState();
  const settled = usePluginFrontendsSettled();
  const messageDirectiveRegistry = resolveMessageDirectiveRegistry({
    bbPluginIds,
    picks: directivePicks,
    settledOnce,
    slots: messageDirectiveSlots,
    unclaimed: settled ? "literal" : "hold",
  });
  const codeFenceRendererRegistry = useMemo(
    () =>
      buildCodeFenceRendererRegistry(codeFenceRendererSlots, codeFencePicks, {
        bbPluginIds,
        settledOnce,
      }),
    [bbPluginIds, codeFencePicks, codeFenceRendererSlots, settledOnce],
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
      registry === null ||
      (registry.directives.size === 0 && registry.unclaimed === "literal")
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
