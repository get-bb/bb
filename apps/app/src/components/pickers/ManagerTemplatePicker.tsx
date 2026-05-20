import { useMemo } from "react";
import type { ManagerTemplateSummary } from "@bb/server-contract";
import { OptionPicker, type PickerOption } from "./OptionPicker";

export interface ManagerTemplatePickerProps {
  templates: readonly ManagerTemplateSummary[];
  value: string;
  onChange: (templateName: string) => void;
  /** Render with the menu open on mount. Story-only escape hatch. */
  defaultOpen?: boolean;
  /** Whether the menu blocks page interaction. Defaults to Radix's true; pass false in stories. */
  modal?: boolean;
}

export function ManagerTemplatePicker({
  templates,
  value,
  onChange,
  defaultOpen,
  modal,
}: ManagerTemplatePickerProps) {
  const options = useMemo<readonly PickerOption<string>[]>(
    () =>
      templates.map((template) => ({
        value: template.name,
        label: template.name,
        ...(template.isActive ? { description: "Active default" } : {}),
      })),
    [templates],
  );

  return (
    <OptionPicker
      label="Template"
      value={value}
      options={options}
      onChange={onChange}
      defaultOpen={defaultOpen}
      modal={modal}
    />
  );
}
