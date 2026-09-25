import type { IconName } from "@/components/ui/icon";
import type { ThreadRowActionId } from "../../shared/preferences.js";

export const THREAD_ROW_ACTIONS: Record<
  ThreadRowActionId,
  { title: string; icon: IconName }
> = {
  split: { title: "Open in split", icon: "Columns2" },
  copyLink: { title: "Copy thread link", icon: "Copy" },
  read: { title: "Mark read / unread", icon: "MailOpen" },
  pin: { title: "Pin", icon: "Pin" },
  move: { title: "Move to section", icon: "SectionMove" },
  rename: { title: "Rename", icon: "Edit" },
  archive: { title: "Archive", icon: "Archive" },
};
