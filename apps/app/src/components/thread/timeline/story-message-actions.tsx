import type { ComponentProps } from "react";
import { ConversationMessageContent } from "./ConversationMessageContent";
import { useAppNavigationHost } from "@/lib/app-navigation-host";
import { useBindPluginActionContext } from "@/lib/plugin-action-context-provider";
import { buildMessageActions } from "@/lib/plugin-message-actions";
import {
  EMPTY_PLUGIN_SLOT_SNAPSHOT,
  type PluginMessageActionSlot,
} from "@/lib/plugin-slots";
import type { ThreadTimelineMessageAction } from "./types";

interface StoryPluginAction {
  key: string;
  icon: string;
  label: string;
  onSelect: () => void;
}

interface StoryMessageActionsArgs {
  role: "user" | "assistant";
  text: string;
  onAddToChat?: (text: string) => void;
  onEdit?: () => void;
  onFork?: () => void;
  forkDisabled?: boolean;
  pluginActions?: readonly StoryPluginAction[];
}

function storyPluginSlot(action: StoryPluginAction): PluginMessageActionSlot {
  return {
    id: action.key.replace(/\W/gu, "-"),
    title: action.label,
    icon: action.icon,
    experimental_surfaces: ["thread-view", "embedded-chat"],
    experimental_roles: ["user", "assistant"],
    experimental_placements: ["inline", "selection"],
    run: action.onSelect,
    pluginId: "story",
    generation: 0,
  };
}

export function useStoryMessageActions({
  role,
  text,
  onAddToChat,
  onEdit,
  onFork,
  forkDisabled = false,
  pluginActions = [],
}: StoryMessageActionsArgs): readonly ThreadTimelineMessageAction[] {
  const bind = useBindPluginActionContext();
  const host = useAppNavigationHost();
  return buildMessageActions({
    slots: [
      ...EMPTY_PLUGIN_SLOT_SNAPSHOT.messageActions,
      ...pluginActions.map(storyPluginSlot),
    ],
    target: {
      threadId: "thr_story",
      message: {
        id: "msg_story",
        threadId: "thr_story",
        role,
        text,
        sourceSeqEnd: 1,
        experimental_messageSeq: 1,
        experimental_settled: true,
        experimental_attachments: [],
        experimental_imageUrls: [],
      },
      messageRequests: {
        addToChat: onAddToChat ?? null,
        edit: onEdit ?? null,
        fork: onFork ?? null,
      },
      canSpawnChild: !forkDisabled,
    },
    composerHost: null,
    actionContext: (pluginId) => bind(pluginId, () => host),
  });
}

type ConversationMessageContentProps = ComponentProps<
  typeof ConversationMessageContent
>;

type StoryConversationMessageProps = ConversationMessageContentProps &
  Omit<StoryMessageActionsArgs, "role" | "text">;

export function StoryConversationMessage({
  onAddToChat,
  onEdit,
  onFork,
  forkDisabled,
  pluginActions,
  ...props
}: StoryConversationMessageProps) {
  const actions = useStoryMessageActions({
    role: props.role,
    text: props.text,
    ...(onAddToChat === undefined ? {} : { onAddToChat }),
    ...(onEdit === undefined ? {} : { onEdit }),
    ...(onFork === undefined ? {} : { onFork }),
    ...(forkDisabled === undefined ? {} : { forkDisabled }),
    ...(pluginActions === undefined ? {} : { pluginActions }),
  });
  return <ConversationMessageContent {...props} actions={actions} />;
}
