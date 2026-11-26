import type { ComponentProps } from "react";
import { ConversationMessageContent } from "./ConversationMessageContent";
import { useAppNavigationHost } from "@/lib/app-navigation-host";
import { useBindPluginActionContext } from "@/lib/plugin-action-context-provider";
import { buildMessageActions } from "@/lib/plugin-message-actions";
import {
  EMPTY_PLUGIN_SLOT_SNAPSHOT,
  type PluginMessageActionSlot,
} from "@/lib/plugin-slots";
import type { PluginComposerHost } from "@/components/plugin/plugin-composer-host";
import { STORY_THREAD_ID } from "./StoryDraftPromptBox";
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
  composerHost?: PluginComposerHost;
  onEdit?: () => void;
  canFork?: boolean;
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
  composerHost,
  onEdit,
  canFork = false,
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
      threadId: STORY_THREAD_ID,
      message: {
        id: "msg_story",
        threadId: STORY_THREAD_ID,
        role,
        text,
        sourceSeqEnd: 1,
        experimental_messageSeq: 1,
        experimental_settled: true,
        experimental_attachments: [],
        experimental_imageUrls: [],
      },
      messageRequests: { edit: onEdit ?? null },
      canFork,
      canSpawnChild: !forkDisabled,
    },
    composerHost: composerHost ?? null,
    actionContext: (pluginId) => bind(pluginId, () => host),
  });
}

type ConversationMessageContentProps = ComponentProps<
  typeof ConversationMessageContent
>;

type StoryConversationMessageProps = ConversationMessageContentProps &
  Omit<StoryMessageActionsArgs, "role" | "text">;

export function StoryConversationMessage({
  composerHost,
  onEdit,
  canFork,
  forkDisabled,
  pluginActions,
  ...props
}: StoryConversationMessageProps) {
  const actions = useStoryMessageActions({
    role: props.role,
    text: props.text,
    ...(composerHost === undefined ? {} : { composerHost }),
    ...(onEdit === undefined ? {} : { onEdit }),
    ...(canFork === undefined ? {} : { canFork }),
    ...(forkDisabled === undefined ? {} : { forkDisabled }),
    ...(pluginActions === undefined ? {} : { pluginActions }),
  });
  return <ConversationMessageContent {...props} actions={actions} />;
}
