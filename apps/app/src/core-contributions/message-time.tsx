import { useState } from "react";
import type { ExperimentalMessageMetadataProps } from "@get-bb/plugin-sdk";
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { usePointerCoarse } from "@bb/shared-ui/hooks/use-pointer-coarse";
import {
  formatShortMessageTime,
  MessageTime,
} from "@bb/shared-ui/message-time";

function InlineMessageTime({ message }: ExperimentalMessageMetadataProps) {
  const isPointerCoarse = usePointerCoarse();
  const [now] = useState(() => new Date());
  if (isPointerCoarse) return null;
  return (
    <MessageTime
      timestamp={message.createdAt}
      label={formatShortMessageTime(message.createdAt, now)}
    />
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_messageMetadata({
    id: "time",
    placement: "actionRow",
    component: InlineMessageTime,
  });
});
