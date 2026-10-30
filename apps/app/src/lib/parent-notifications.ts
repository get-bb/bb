import type { ThreadParentNotifications } from "@bb/domain";

interface ParentNotificationsOption {
  value: ThreadParentNotifications;
  label: string;
  description: string;
}

export const PARENT_NOTIFICATIONS_OPTIONS: readonly ParentNotificationsOption[] =
  [
    {
      value: "auto",
      label: "Auto",
      description: "Every finished turn, failure, and blocker",
    },
    {
      value: "stuck",
      label: "When stuck",
      description: "Only failures, interruptions, and blockers",
    },
    { value: "off", label: "Off", description: "Never" },
  ];
