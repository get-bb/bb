import { experimental_copyToClipboard } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { copyAutomationDetailLink } from "./src/automation-link.js";
import { ResourceOverflowMenu } from "@/components/ui/resource-list";

export function AutomationActionsMenu({
  name,
  projectId,
  automationId,
  pending,
  runDisabledReason,
  onRunNow,
  onDelete,
}: {
  name: string;
  projectId: string;
  automationId: string;
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
        {
          label: "Copy link",
          icon: "Link",
          onSelect: () => {
            void copyAutomationDetailLink(
              window.location.origin,
              projectId,
              automationId,
              (text) => experimental_copyToClipboard({ text }),
              toast,
            );
          },
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
