import { ResourceOverflowMenu } from "@bb/shared-ui/resource-list";

export function AutomationActionsMenu({
  name,
  pending,
  runDisabledReason,
  onRunNow,
  onDelete,
}: {
  name: string;
  pending: boolean;
  runDisabledReason?: string;
  onRunNow: () => void;
  onDelete: () => void;
}) {
  return (
    <ResourceOverflowMenu
      label={`${name} actions`}
      disabled={pending}
      items={[
        {
          label: "Run now",
          icon: "Play",
          disabled: runDisabledReason !== undefined,
          disabledReason: runDisabledReason,
          onSelect: onRunNow,
        },
        { kind: "separator" },
        {
          label: "Delete",
          icon: "Trash2",
          tone: "destructive",
          onSelect: onDelete,
        },
      ]}
    />
  );
}
