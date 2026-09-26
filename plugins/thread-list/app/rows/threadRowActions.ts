import type { IconName } from "@/components/ui/icon";
import type { ThreadRowActionId } from "../../shared/preferences.js";

export const THREAD_ROW_ACTIONS: Record<
  ThreadRowActionId,
  { label: string; icon: IconName }
> = {
  split: { label: "Open in split", icon: "Columns2" },
  copyLink: { label: "Copy thread link", icon: "Copy" },
  read: { label: "Mark read / unread", icon: "MailOpen" },
  pin: { label: "Pin", icon: "Pin" },
  move: { label: "Move to section", icon: "SectionMove" },
  rename: { label: "Rename", icon: "Edit" },
  archive: { label: "Archive", icon: "Archive" },
};
