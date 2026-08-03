import type { PermissionMode } from "@bb/domain";
import type { PickerOption } from "@/components/pickers/OptionPicker";

/**
 * The permission modes as the user sees them. Shared by the composer pickers
 * (which pick the mode a thread runs with) and Settings → Machines (which
 * picks the highest mode a machine allows), so the two never drift.
 */
export const PERMISSION_MODE_OPTIONS: PickerOption<PermissionMode>[] = [
  {
    value: "accept-edits",
    label: "Accept Edits",
    description:
      "Applies edits inside the workspace automatically. Anything beyond the workspace asks you first.",
  },
  {
    value: "auto",
    label: "Approve for me",
    description:
      "Same workspace sandbox, with requests reviewed automatically. High-risk actions can still come back to you.",
  },
  {
    value: "full",
    label: "Full Access",
    tone: "warning",
    description:
      "No sandbox and no approvals — the agent can run anything on your machine.",
  },
];
