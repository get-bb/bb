import type { ExperimentalMessageMetadataProps } from "@get-bb/plugin-sdk";
import { usePointerCoarse } from "@bb/shared-ui/hooks/use-pointer-coarse";
import {
  collectPluginAppRegistrations,
  definePluginApp,
} from "@/lib/plugin-app-definition";
import { formatShortMessageTime, MessageTime } from "./message-time.js";

function InlineMessageTime({ message }: ExperimentalMessageMetadataProps) {
  const isPointerCoarse = usePointerCoarse();
  if (isPointerCoarse) return null;
  return (
    <MessageTime
      timestamp={message.createdAt}
      label={formatShortMessageTime(message.createdAt, new Date())}
    />
  );
}

export const coreMessageMetadata = collectPluginAppRegistrations(
  definePluginApp((app) => {
    app.slots.experimental_messageMetadata({
      id: "time",
      placement: "actionRow",
      component: InlineMessageTime,
    });
  }),
).messageMetadata.map((slot) => ({ ...slot, pluginId: "core", generation: 0 }));
