import { useId } from "react";
import type { SetupJobOffer } from "@bb/server-contract";
import { Checkbox } from "@bb/shared-ui/checkbox";

export function SetupJobCheckbox({
  offer,
  checked,
  disabled,
  onCheckedChange,
}: {
  offer: SetupJobOffer;
  checked: boolean;
  disabled: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const descriptionId = useId();
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3">
      <Checkbox
        checked={checked}
        disabled={disabled}
        aria-describedby={descriptionId}
        onCheckedChange={(value) => onCheckedChange(value === true)}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-sm font-medium">{offer.title}</span>
        <span id={descriptionId} className="text-xs text-muted-foreground">
          Runs in {offer.projectName} with {offer.providerName} at 10 pm,
          Monday–Friday ({offer.timezone}). You review every change before it
          leaves your machine. You can turn this off in Automations.
        </span>
      </span>
    </label>
  );
}
