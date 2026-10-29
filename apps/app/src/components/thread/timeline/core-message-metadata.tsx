import type { ExperimentalMessageMetadataProps } from "@get-bb/plugin-sdk";
import {
  collectPluginAppRegistrations,
  definePluginApp,
} from "@/lib/plugin-app-definition";
import { formatShortMessageTime, MessageTime } from "./message-time.js";

function InlineMessageTime({ message }: ExperimentalMessageMetadataProps) {
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
      placement: "actions",
      component: InlineMessageTime,
    });
  }),
).messageMetadata.map((slot) => ({ ...slot, pluginId: "core", generation: 0 }));
