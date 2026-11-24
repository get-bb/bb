import type {
  ExperimentalMessageActionAvailability,
  ExperimentalMessageActionAvailabilityInput,
  ExperimentalMessageActionInvocation,
  ExperimentalMessageRequests,
  ExperimentalPluginActionContext,
  PluginComposerApi,
  PluginMessageActionContext,
  PluginMessageActionRegistration,
  ThreadChatMessageAction,
  ThreadChatMessageReference,
} from "@get-bb/plugin-sdk";
import type { PluginComposerHost } from "@/components/plugin/plugin-composer-host";
import type { ThreadTimelineMessageAction } from "@/components/thread/timeline/types";
import { createComposerHandleBinding } from "@get-bb/plugin-sdk/internal/composer-handle";
import { collectMessageActionRegistration } from "@get-bb/plugin-sdk/internal/plugin-app-collector";
import { detachedComposerController } from "./plugin-composer-handle";
import type { PluginMessageActionSlot } from "./plugin-slots";
import { createRetiredOpenPanel } from "./plugin-panel-controller";

export interface MessageActionTarget {
  threadId: string;
  message: ThreadChatMessageReference;
  messageRequests: ExperimentalMessageRequests;
  canSpawnChild: boolean;
}

export interface MessageActionSelection {
  text: string;
  readMarkdown: () => string | null;
}

interface BuildMessageActionsArgs {
  slots: readonly PluginMessageActionSlot[];
  target: MessageActionTarget;
  selection?: MessageActionSelection;
  composerHost: PluginComposerHost | null;
  actionContext: (pluginId: string) => ExperimentalPluginActionContext;
}

function messageActionComposer(
  pluginId: string,
  threadId: string,
  host: PluginComposerHost | null,
): PluginComposerApi | null {
  if (host === null) return null;
  if (host.scope.kind !== "thread" || host.scope.threadId !== threadId) {
    return null;
  }
  return createComposerHandleBinding(
    host.textEffectKey,
    detachedComposerController(pluginId, host, "a message action's"),
  ).handle;
}

function warnMessageAction(
  slot: PluginMessageActionSlot,
  phase: "availability" | "run",
  detail: unknown,
): void {
  console.warn(
    `[plugin:${slot.pluginId}] messageAction "${slot.id}" ${
      phase === "run" ? "failed" : "availability failed"
    }: ${detail instanceof Error ? detail.message : String(detail)}`,
  );
}

function isAvailability(
  value: unknown,
): value is ExperimentalMessageActionAvailability {
  return value === "enabled" || value === "disabled" || value === "hidden";
}

function evaluateAvailability(
  slot: PluginMessageActionSlot,
  input: ExperimentalMessageActionAvailabilityInput,
): ExperimentalMessageActionAvailability {
  if (!slot.experimental_roles.includes(input.message.role)) return "hidden";
  const availability = slot.experimental_availability;
  if (availability === undefined) return "enabled";
  try {
    const result: unknown = availability(input);
    if (isAvailability(result)) return result;
    warnMessageAction(
      slot,
      "availability",
      `returned ${JSON.stringify(result)}, expected "enabled", "disabled" or "hidden"`,
    );
  } catch (error) {
    warnMessageAction(slot, "availability", error);
  }
  return "hidden";
}

async function runMessageAction(
  slot: PluginMessageActionSlot,
  context: () => PluginMessageActionContext,
): Promise<boolean> {
  try {
    return (await slot.run(context())) === true;
  } catch (error) {
    warnMessageAction(slot, "run", error);
    return false;
  }
}

export function buildMessageActions({
  slots,
  target,
  selection,
  composerHost,
  actionContext,
}: BuildMessageActionsArgs): readonly ThreadTimelineMessageAction[] {
  const input: ExperimentalMessageActionAvailabilityInput = {
    threadId: target.threadId,
    message: target.message,
    ...(selection === undefined ? {} : { selectedText: selection.text }),
    messageRequests: target.messageRequests,
    canSpawnChild: target.canSpawnChild,
  };
  const actions: (ThreadTimelineMessageAction & { order: number })[] = [];
  for (const slot of slots) {
    const placement = slot.experimental_placements.find((candidate) =>
      selection === undefined
        ? candidate !== "selection"
        : candidate === "selection",
    );
    if (placement === undefined) continue;
    const availability = evaluateAvailability(slot, input);
    if (availability === "hidden") continue;
    actions.push({
      key: `${slot.pluginId}/${slot.id}/${slot.generation}`,
      pluginId: slot.pluginId,
      icon: slot.icon ?? null,
      label: slot.title,
      placement,
      disabled: availability === "disabled",
      order: slot.experimental_order ?? Number.POSITIVE_INFINITY,
      run: (invokedFrom: ExperimentalMessageActionInvocation) =>
        runMessageAction(slot, () => {
          const markdown = selection?.readMarkdown() ?? null;
          const bound = actionContext(slot.pluginId);
          const context: PluginMessageActionContext & {
            openPanel: ReturnType<typeof createRetiredOpenPanel>;
          } = {
            ...bound,
            threadId: target.threadId,
            message: target.message,
            ...(selection === undefined
              ? {}
              : {
                  selectedText: selection.text,
                  experimental_selectedMarkdown: markdown ?? selection.text,
                }),
            openPanel: createRetiredOpenPanel(bound.panel),
            composer: messageActionComposer(
              slot.pluginId,
              target.threadId,
              composerHost,
            ),
            experimental_invokedFrom: invokedFrom,
            experimental_messageRequests: target.messageRequests,
          };
          return context;
        }),
    });
  }
  return actions.sort((left, right) =>
    left.order === right.order ? 0 : left.order - right.order,
  );
}

const THREAD_CHAT_ACTIONS_KIND = "ThreadChat.experimental_messageActions";
const LEGACY_THREAD_CHAT_ACTIONS_KIND = "ThreadChat.messageActions";

function legacyThreadChatAction(
  action: ThreadChatMessageAction,
): PluginMessageActionRegistration {
  return {
    id: action.id,
    title: action.title,
    ...(action.icon === undefined ? {} : { icon: action.icon }),
    ...(action.roles === undefined ? {} : { experimental_roles: action.roles }),
    experimental_placements: ["inline"],
    run: (context) => action.run(context.message),
  };
}

export function collectThreadChatMessageActions({
  pluginId,
  legacyActions,
  registrations,
}: {
  pluginId: string;
  legacyActions: readonly ThreadChatMessageAction[] | undefined;
  registrations: readonly PluginMessageActionRegistration[] | undefined;
}): readonly PluginMessageActionSlot[] {
  const seenIds = new Set<string>();
  const collect = (
    kind: string,
    registration: PluginMessageActionRegistration,
  ): PluginMessageActionSlot => {
    const collected = collectMessageActionRegistration(kind, registration);
    if (seenIds.has(collected.id)) {
      throw new Error(`${kind}: duplicate id "${collected.id}"`);
    }
    seenIds.add(collected.id);
    return {
      ...collected,
      id: `thread-chat/${collected.id}`,
      pluginId,
      generation: 0,
    };
  };
  return [
    ...(legacyActions ?? []).map((action) =>
      collect(LEGACY_THREAD_CHAT_ACTIONS_KIND, legacyThreadChatAction(action)),
    ),
    ...(registrations ?? []).map((registration) =>
      collect(THREAD_CHAT_ACTIONS_KIND, registration),
    ),
  ];
}
